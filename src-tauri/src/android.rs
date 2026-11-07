//! Android glue: bundled Java runtimes, the JVM launcher (JLI), and the bridge to the small Java layer
//! (game Surface, input, `:jvm` process). Everything else (downloads, versions, loaders, accounts) is shared Rust.
use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};

/// Bundled runtime majors (assets/jre/<major>/{bin-arm64,universal}.tar.xz inside the APK).
pub const BUNDLED: [u32; 3] = [8, 17, 21];

/// Smallest bundled runtime that satisfies the version's `javaVersion.majorVersion`.
pub fn bundled_major(required: u32) -> u32 {
    if required <= 8 { 8 } else if required <= 17 { 17 } else { 21 }
}

pub fn jre_dir(runtimes: &Path, major: u32) -> PathBuf { runtimes.join(format!("jre{major}")) }

pub fn jre_valid(jre: &Path) -> bool {
    let jvm = jre.join("lib/server/libjvm.so").exists() || jre.join("lib/aarch64/server/libjvm.so").exists();
    jvm && (jre.join("lib/modules").exists() || jre.join("lib/rt.jar").exists())
}

pub struct StartOpts {
    pub jre: PathBuf,
    pub log: PathBuf,
    pub game_dir: PathBuf,
    pub tmp: PathBuf,
    pub renderer: String,
    pub args: Vec<String>,
}

#[cfg(target_os = "android")]
pub use imp::*;
#[cfg(not(target_os = "android"))]
pub use stub::*;

#[cfg(not(target_os = "android"))]
mod stub {
    use super::*;
    fn no() -> AppError { AppError::Java("the game can only run on Android".into()) }
    pub async fn ensure_runtime(_runtimes: &Path, _major: u32) -> AppResult<PathBuf> { Err(no()) }
    pub fn start_game(_o: StartOpts) -> AppResult<()> { Err(no()) }
    pub fn send_input(_t: &str, _key: i32, _button: i32, _down: bool, _x: f32, _y: f32, _dy: f64) {}
    pub fn set_surface(_show: bool, _scale: f32) {}
    pub fn stop_game() {}
    pub fn extract_asset(_name: &str, _dst: &Path) -> AppResult<bool> { Ok(false) }
    pub fn service_died() -> bool { false }
    pub fn clear_service_died() {}
}

#[cfg(target_os = "android")]
mod imp {
    use super::*;
    use jni::objects::{GlobalRef, JClass, JObjectArray, JString, JValue};
    use jni::sys::{jint, jobject};
    use jni::{JNIEnv, JavaVM};
    use std::ffi::{CStr, CString};
    use std::os::raw::{c_char, c_int};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::OnceLock;

    static VM: OnceLock<JavaVM> = OnceLock::new();
    static BRIDGE: OnceLock<GlobalRef> = OnceLock::new();
    static APK: OnceLock<PathBuf> = OnceLock::new();
    static DIED: AtomicBool = AtomicBool::new(false);

    pub fn service_died() -> bool { DIED.load(Ordering::SeqCst) }

    /// Copies `assets/<name>` out of the APK to `dst` (Ok(false) when the APK does not contain it).
    pub fn extract_asset(name: &str, dst: &Path) -> AppResult<bool> {
        let Some(apk) = APK.get() else { return Ok(false) };
        let mut zip = zip::ZipArchive::new(std::fs::File::open(apk)?).map_err(|e| AppError::Java(format!("APK: {e}")))?;
        let full = format!("assets/{name}");
        let Ok(mut entry) = zip.by_name(&full) else { return Ok(false) };
        if let Some(p) = dst.parent() { std::fs::create_dir_all(p)?; }
        let tmp = dst.with_extension("part");
        { let mut f = std::fs::File::create(&tmp)?; std::io::copy(&mut entry, &mut f)?; }
        std::fs::rename(&tmp, dst)?;
        Ok(true)
    }
    pub fn clear_service_died() { DIED.store(false, Ordering::SeqCst) }

    // ---------------------------------------------------------------- Java -> Rust

    /// StarBridge.init() (UI process): remembers the VM, the bridge class (the app class loader is only reachable from here) and the APK path.
    #[no_mangle]
    pub extern "system" fn Java_app_starclient_mobile_StarBridge_nativeInit<'l>(mut env: JNIEnv<'l>, class: JClass<'l>, apk: JString<'l>) {
        if let Ok(vm) = env.get_java_vm() { let _ = VM.set(vm); }
        if let Ok(g) = env.new_global_ref(&class) { let _ = BRIDGE.set(g); }
        if let Ok(s) = env.get_string(&apk) { let _ = APK.set(PathBuf::from(String::from(s))); }
    }

    /// Called by StarGameClient when the `:jvm` process disappears (also on a crash that never wrote `[exit`).
    #[no_mangle]
    pub extern "system" fn Java_app_starclient_mobile_StarBridge_nativeServiceDied<'l>(_env: JNIEnv<'l>, _class: JClass<'l>) {
        DIED.store(true, Ordering::SeqCst);
    }

    // ---------------------------------------------------------------- Rust -> Java

    /// Turns a JNI error into text; for a Java exception it includes the first lines of the stack trace.
    fn describe(env: &mut JNIEnv, name: &str, e: jni::errors::Error) -> String {
        if matches!(e, jni::errors::Error::JavaException) {
            if let Ok(t) = env.exception_occurred() {
                let _ = env.exception_clear();
                if let Ok(cls) = env.find_class("android/util/Log") {
                    if let Ok(v) = env.call_static_method(cls, "getStackTraceString", "(Ljava/lang/Throwable;)Ljava/lang/String;", &[JValue::Object(&t)]) {
                        if let Ok(o) = v.l() {
                            if let Ok(js) = env.get_string(&JString::from(o)) {
                                let s: String = js.into();
                                return format!("{name}: {}", s.lines().take(7).collect::<Vec<_>>().join(" | "));
                            }
                        }
                    }
                }
            }
        }
        let _ = env.exception_clear();
        format!("{name}: {e}")
    }

    fn call(name: &str, sig: &str, args: &[JValue]) -> AppResult<()> {
        let vm = VM.get().ok_or_else(|| AppError::Java("native bridge not initialised".into()))?;
        let class = BRIDGE.get().ok_or_else(|| AppError::Java("native bridge not initialised".into()))?;
        let mut env = vm.attach_current_thread_permanently().map_err(|e| AppError::Java(format!("JNI attach: {e}")))?;
        // SAFETY: the global ref lives for the whole process and really is a java.lang.Class.
        let cls = unsafe { JClass::from_raw(class.as_obj().as_raw() as jobject as _) };
        env.call_static_method(&cls, name, sig, args).map_err(|e| AppError::Java(describe(&mut env, name, e)))?;
        Ok(())
    }

    pub fn send_input(t: &str, key: i32, button: i32, down: bool, x: f32, y: f32, dy: f64) {
        let Some(vm) = VM.get() else { return };
        let Ok(mut env) = vm.attach_current_thread_permanently() else { return };
        let Ok(js) = env.new_string(t) else { return };
        let _ = call_with(&mut env, "input", "(Ljava/lang/String;IIZFFD)V",
            &[JValue::Object(&js), JValue::Int(key), JValue::Int(button), JValue::Bool(down as u8), JValue::Float(x), JValue::Float(y), JValue::Double(dy)]);
    }

    fn call_with(env: &mut JNIEnv, name: &str, sig: &str, args: &[JValue]) -> AppResult<()> {
        let class = BRIDGE.get().ok_or_else(|| AppError::Java("native bridge not initialised".into()))?;
        let cls = unsafe { JClass::from_raw(class.as_obj().as_raw() as jobject as _) };
        env.call_static_method(&cls, name, sig, args).map_err(|e| AppError::Java(describe(env, name, e)))?;
        Ok(())
    }

    pub fn set_surface(show: bool, scale: f32) { let _ = call("surface", "(ZF)V", &[JValue::Bool(show as u8), JValue::Float(scale)]); }
    pub fn stop_game() { let _ = call("stop", "()V", &[]); }

    pub fn start_game(o: StartOpts) -> AppResult<()> {
        let vm = VM.get().ok_or_else(|| AppError::Java("native bridge not initialised".into()))?;
        let mut env = vm.attach_current_thread_permanently().map_err(|e| AppError::Java(format!("JNI attach: {e}")))?;
        fn je(e: jni::errors::Error) -> AppError { AppError::Java(format!("JNI: {e}")) }
        fn js<'a>(env: &mut JNIEnv<'a>, v: &str) -> AppResult<JString<'a>> { env.new_string(v).map_err(je) }
        let jre = js(&mut env, &o.jre.to_string_lossy())?;
        let log = js(&mut env, &o.log.to_string_lossy())?;
        let gd = js(&mut env, &o.game_dir.to_string_lossy())?;
        let tmp = js(&mut env, &o.tmp.to_string_lossy())?;
        let rd = js(&mut env, &o.renderer)?;
        let string_cls = env.find_class("java/lang/String").map_err(je)?;
        let empty = env.new_string("").map_err(je)?;
        let arr = env.new_object_array(o.args.len() as i32, &string_cls, &empty).map_err(je)?;
        for (i, a) in o.args.iter().enumerate() {
            let js = env.new_string(a).map_err(je)?;
            env.set_object_array_element(&arr, i as i32, js).map_err(je)?;
        }
        DIED.store(false, Ordering::SeqCst);
        call_with(&mut env, "launch", "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;[Ljava/lang/String;)V",
            &[JValue::Object(&jre), JValue::Object(&log), JValue::Object(&gd), JValue::Object(&tmp), JValue::Object(&rd), JValue::Object(&arr)])
    }

    // ---------------------------------------------------------------- bundled runtimes

    /// Unpacks the bundled runtime once into `runtimes/jre<major>` and returns its directory.
    pub async fn ensure_runtime(runtimes: &Path, major: u32) -> AppResult<PathBuf> {
        let dst = jre_dir(runtimes, major);
        if jre_valid(&dst) { return Ok(dst); }
        let apk = APK.get().cloned().ok_or_else(|| AppError::Java("APK path unknown".into()))?;
        let runtimes = runtimes.to_path_buf();
        tokio::task::spawn_blocking(move || unpack_bundled(&apk, &runtimes, major))
            .await.map_err(|e| AppError::Java(e.to_string()))?
    }

    fn unpack_bundled(apk: &Path, runtimes: &Path, major: u32) -> AppResult<PathBuf> {
        let dst = jre_dir(runtimes, major);
        let tmp = runtimes.join(format!(".tmp-jre{major}"));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp)?;
        let mut zip = zip::ZipArchive::new(std::fs::File::open(apk)?).map_err(|e| AppError::Java(format!("APK: {e}")))?;
        for part in ["bin-arm64.tar.xz", "universal.tar.xz"] {
            let name = format!("assets/jre/{major}/{part}");
            let entry = zip.by_name(&name).map_err(|_| AppError::Java(format!("Java {major} is not bundled in this build ({name} missing)")))?;
            let mut ar = tar::Archive::new(xz2::read::XzDecoder::new(std::io::BufReader::new(entry)));
            ar.set_preserve_permissions(true);
            ar.set_overwrite(true);
            // `unpack` rejects entries that escape `tmp`.
            ar.unpack(&tmp).map_err(|e| AppError::Java(format!("unpacking {name}: {e}")))?;
        }
        if major == 8 { unpack_packs(&tmp)?; }
        if !jre_valid(&tmp) { let _ = std::fs::remove_dir_all(&tmp); return Err(AppError::Java(format!("bundled Java {major} is incomplete"))); }
        let _ = std::fs::remove_dir_all(&dst);
        std::fs::rename(&tmp, &dst)?;
        Ok(dst)
    }

    fn collect_packs(d: &Path, out: &mut Vec<PathBuf>) {
        let Ok(rd) = std::fs::read_dir(d) else { return };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() { collect_packs(&p, out); } else if p.extension().map_or(false, |x| x == "pack") { out.push(p); }
        }
    }

    /// Java 8 ships lib/**.jar.pack; convert with the runtime's own unpack200 started through the system linker
    /// (Android 10+ does not allow executing files from app data directly).
    fn unpack_packs(root: &Path) -> AppResult<()> {
        let mut packs = Vec::new();
        collect_packs(&root.join("lib"), &mut packs);
        if packs.is_empty() { return Ok(()); }
        let unp = root.join("bin/unpack200");
        if !unp.exists() { return Err(AppError::Java("bin/unpack200 is missing in the Java 8 runtime".into())); }
        for pk in packs {
            let jar = pk.with_extension("");
            let out = std::process::Command::new("/system/bin/linker64").arg(&unp).arg("-r").arg(&pk).arg(&jar).output()?;
            if !out.status.success() || !jar.exists() {
                return Err(AppError::Java(format!("unpack200 failed on {}: {}", jar.display(), String::from_utf8_lossy(&out.stderr))));
            }
        }
        Ok(())
    }

    // ---------------------------------------------------------------- JVM (runs in the ":jvm" process)

    type JliLaunch = unsafe extern "C" fn(
        argc: c_int, argv: *mut *mut c_char, jargc: c_int, jargv: *const *const c_char, appclassc: c_int, appclassv: *const *const c_char,
        fullversion: *const c_char, dotversion: *const c_char, pname: *const c_char, lname: *const c_char,
        javaargs: u8, cpwildcard: u8, javaw: u8, ergo: c_int,
    ) -> c_int;

    fn note(msg: &str) { eprintln!("{msg}"); }

    /// Starts the JRE inside this process through JLI_Launch (same idea as PojavLauncher). Only call from the ":jvm" process:
    /// a JVM can be created once per process. Output goes to the log file.
    #[no_mangle]
    pub extern "system" fn Java_app_starclient_mobile_StarJvm_run<'l>(mut env: JNIEnv<'l>, _c: JClass<'l>, jre: JString<'l>, jargs: JObjectArray<'l>, log: JString<'l>) -> jint {
        let jre_dir: String = match env.get_string(&jre) { Ok(s) => s.into(), Err(_) => return -1 };
        let log_path: String = match env.get_string(&log) { Ok(s) => s.into(), Err(_) => return -1 };
        let n = env.get_array_length(&jargs).unwrap_or(0);
        let mut args: Vec<CString> = Vec::new();
        for i in 0..n {
            if let Ok(o) = env.get_object_array_element(&jargs, i) {
                if let Ok(s) = env.get_string(&JString::from(o)) { if let Ok(c) = CString::new(String::from(s)) { args.push(c); } }
            }
        }
        unsafe { run_jvm(&jre_dir, &log_path, &args) }
    }

    unsafe fn run_jvm(jre: &str, log: &str, args: &[CString]) -> jint {
        if let Ok(c) = CString::new(log) {
            let fd = libc::open(c.as_ptr(), libc::O_WRONLY | libc::O_CREAT | libc::O_APPEND, 0o644);
            if fd >= 0 { libc::dup2(fd, 1); libc::dup2(fd, 2); }
        }
        std::env::set_var("JAVA_HOME", jre);
        // libjli re-executes the java binary when LD_LIBRARY_PATH is set but does not start with the JVM directory ("trying to exec ...":
        // Android forbids exec from the app data dir). With the variable unset it never re-executes. The libraries are found anyway:
        // libjvm/libjli are dlopen'ed by absolute path below, the rest of the JRE uses $ORIGIN, and the service already registered the
        // search path with the loader (JREUtils.setLdLibraryPath).
        std::env::remove_var("LD_LIBRARY_PATH");
        let pick = |a: String, b: String| if Path::new(&a).exists() { a } else { b };
        let jvm = pick(format!("{jre}/lib/server/libjvm.so"), format!("{jre}/lib/aarch64/server/libjvm.so"));
        let jli = pick(format!("{jre}/lib/libjli.so"), format!("{jre}/lib/aarch64/jli/libjli.so"));
        let (jvm_c, jli_c) = (CString::new(jvm).unwrap(), CString::new(jli).unwrap());
        let flags = libc::RTLD_NOW | libc::RTLD_GLOBAL;
        if libc::dlopen(jvm_c.as_ptr(), flags).is_null() { note(&format!("dlopen libjvm failed: {}", dl_err())); return -2; }
        let h = libc::dlopen(jli_c.as_ptr(), flags);
        if h.is_null() { note(&format!("dlopen libjli failed: {}", dl_err())); return -3; }
        let sym = libc::dlsym(h, b"JLI_Launch\0".as_ptr() as *const c_char);
        if sym.is_null() { note("JLI_Launch not found"); return -4; }
        let launch: JliLaunch = std::mem::transmute(sym);

        let java = CString::new(format!("{jre}/bin/java")).unwrap();
        let mut argv: Vec<*mut c_char> = Vec::with_capacity(args.len() + 2);
        argv.push(java.as_ptr() as *mut c_char);
        let errfile = CString::new(format!("-XX:ErrorFile={log}.hs_err")).unwrap();
        argv.push(errfile.as_ptr() as *mut c_char);
        for a in args { argv.push(a.as_ptr() as *mut c_char); }
        argv.push(std::ptr::null_mut());
        let (full, dot, pname, lname) = (CString::new("21.0.1-internal").unwrap(), CString::new("21.0").unwrap(), CString::new("java").unwrap(), CString::new("openjdk").unwrap());
        note(&format!("[star] JLI_Launch: java={jre}/bin/java, {} args", args.len()));
        let ret = launch((args.len() + 2) as c_int, argv.as_mut_ptr(), 0, std::ptr::null(), 0, std::ptr::null(),
            full.as_ptr(), dot.as_ptr(), pname.as_ptr(), lname.as_ptr(), 0, 1, 0, 0);
        note(&format!("[star] JLI_Launch returned {ret}"));
        libc::fflush(std::ptr::null_mut());
        ret
    }

    unsafe fn dl_err() -> String { let e = libc::dlerror(); if e.is_null() { String::new() } else { CStr::from_ptr(e).to_string_lossy().into_owned() } }
}
