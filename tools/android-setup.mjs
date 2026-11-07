// Run after `npx tauri android init`: copies the small Java/Kotlin layer, Pojav libraries and the bundled JREs into the
// generated Android project and patches manifest + gradle. Safe to run repeatedly.
import { existsSync, readFileSync, writeFileSync, cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const A = "src-tauri/gen/android/app";
const MAIN = `${A}/src/main`;
if (!existsSync(A)) { console.error("Run `npm run tauri android init` first."); process.exit(1); }
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const PKG_DIR = `${MAIN}/java/app/starclient/mobile`;
mkdirSync(PKG_DIR, { recursive: true });

// 1. Java / Kotlin layer (packages are fixed: libpojavexec.so registers natives under these exact class names)
for (const f of ["StarBridge.java", "StarJvm.java", "StarInput.java", "StarGameSurface.java", "StarGameService.java", "StarGameClient.java"])
  cpSync(path.join("native-android", f), path.join(PKG_DIR, f));
cpSync("native-android/MainActivity.kt", path.join(PKG_DIR, "MainActivity.kt"));
for (const d of ["org", "net", "com"]) cpSync(path.join("native-android", d), path.join(`${MAIN}/java`, d), { recursive: true });

// 2. Pojav binaries (libpojavexec.so, libexithook.so, libbytehook.so, libgl4es_114.so, ...) and bundled runtimes
if (existsSync("native-android/jniLibs")) cpSync("native-android/jniLibs", `${MAIN}/jniLibs`, { recursive: true });
if (existsSync("native-android/jre")) { rmSync(`${MAIN}/assets/jre`, { recursive: true, force: true }); cpSync("native-android/jre", `${MAIN}/assets/jre`, { recursive: true }); }

// 2b. Pojav's patched GLFW classes (native-android/components/lwjgl3/lwjgl-glfw-classes.jar), prepended to the game classpath at launch
if (existsSync("native-android/components")) { rmSync(`${MAIN}/assets/components`, { recursive: true, force: true }); cpSync("native-android/components", `${MAIN}/assets/components`, { recursive: true }); }
else console.warn("WARNING: native-android/components/lwjgl3/lwjgl-glfw-classes.jar is missing: the game cannot open a window without it.");

// 2c. R8 must not strip classes that only native code refers to (libpojavexec / libbytehook look them up by name)
const pro = `${A}/proguard-rules.pro`;
const keep = "\n# star: classes looked up from native code\n-keep class net.kdt.pojavlaunch.** { *; }\n-keep class org.lwjgl.** { *; }\n-keep class com.bytedance.** { *; }\n-keep class app.starclient.mobile.** { *; }\n";
if (existsSync(pro)) { const cur = readFileSync(pro, "utf8"); if (!cur.includes("com.bytedance")) writeFileSync(pro, cur + keep); } else writeFileSync(pro, keep);

// 3. Launcher icons
cpSync("native-android/res", `${MAIN}/res`, { recursive: true });

// 4. Manifest: landscape, no cloud backup of tokens, extract native libs (the JVM dlopens them by path), the ":jvm" game service
const mf = `${MAIN}/AndroidManifest.xml`;
let m = readFileSync(mf, "utf8");
m = m.replace(/android:allowBackup="[^"]*"/, 'android:allowBackup="false"');
if (!m.includes("extractNativeLibs")) m = m.replace("<application", '<application\n        android:extractNativeLibs="true"\n        android:largeHeap="true"');
if (!m.includes("screenOrientation")) m = m.replace("<activity", '<activity\n            android:screenOrientation="sensorLandscape"');
if (!m.includes("StarGameService")) m = m.replace("</application>", '    <service android:name=".StarGameService" android:process=":jvm" android:exported="false" />\n    </application>');
writeFileSync(mf, m);

// 5. Gradle: legacy JNI packaging (real .so files), fixed signing key so updates install over older builds, version from package.json
const mt = /^(\d+)\.(\d+)\.(\d+)(?:-alpha\.(\d+))?/.exec(pkg.version);
const code = Number(mt[1]) * 10_000_000 + Number(mt[2]) * 100_000 + Number(mt[3]) * 1_000 + Number(mt[4] ?? 999);
cpSync("tools/star-debug.keystore", `${A}/star-debug.keystore`);
const gf = `${A}/build.gradle.kts`;
let g = readFileSync(gf, "utf8");
if (!g.includes("starSigning")) {
  g = g.replace(/android\s*\{/, `android {
    packaging { jniLibs { useLegacyPackaging = true } }
    signingConfigs { create("starSigning") { storeFile = file("star-debug.keystore"); storePassword = "starclient"; keyAlias = "starclient"; keyPassword = "starclient" } }`);
  g = g.replace(/getByName\("debug"\)\s*\{/, 'getByName("debug") {\n            signingConfig = signingConfigs.getByName("starSigning")');
  g = g.replace(/getByName\("release"\)\s*\{/, 'getByName("release") {\n            signingConfig = signingConfigs.getByName("starSigning")');
}
g = g.replace(/versionCode\s*=\s*[^\n]+/, `versionCode = ${code}`).replace(/versionName\s*=\s*"[^"]*"/, `versionName = "${pkg.version}"`);
writeFileSync(gf, g);

console.log(`Android project ready (versionName ${pkg.version}, versionCode ${code}).`);
