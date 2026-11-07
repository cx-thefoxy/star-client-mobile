package app.starclient.mobile;

import android.app.Service;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.Message;
import android.os.Messenger;
import android.util.Log;
import android.view.Surface;
import net.kdt.pojavlaunch.utils.JREUtils;
import org.lwjgl.glfw.CallbackBridge;

/**
 * Lives in the ":jvm" process, next to the JVM and libpojavexec. The UI process (WebView + SurfaceView) talks to it through a
 * Messenger: input events and the game Surface. See StarGameClient for the sending side.
 */
public class StarGameService extends Service {
  static final int MSG_INPUT = 1, MSG_SURFACE = 2, MSG_SURFACE_GONE = 3, MSG_LAUNCH = 4;
  private static final String TAG = "StarGameService";
  private Surface surface;
  private Bundle launchData;
  private boolean started;

  private final Messenger messenger = new Messenger(new Handler(Looper.getMainLooper()) {
    @Override public void handleMessage(Message m) {
      try {
        switch (m.what) {
          case MSG_INPUT: input(m.getData()); break;
          case MSG_SURFACE: surface(m.getData()); break;
          case MSG_SURFACE_GONE: gone(); break;
          case MSG_LAUNCH: launchData = m.getData(); tryStart(); break;
        }
      } catch (Throwable t) { Log.e(TAG, "msg " + m.what, t); }
    }
  });

  @Override public void onCreate() {
    super.onCreate();
    try { CallbackBridge.init(this); } catch (Throwable t) { Log.e(TAG, "CallbackBridge (is libpojavexec.so in jniLibs?)", t); }
  }

  @Override public IBinder onBind(Intent i) { return messenger.getBinder(); }

  private void input(Bundle b) throws Exception {
    String t = b.getString("t", "");
    boolean down = b.getBoolean("down");
    if ("key".equals(t)) StarInput.key(b.getInt("key"), down);
    else if ("mouse".equals(t)) StarInput.mouse(b.getInt("button"), down);
    else if ("cursor".equals(t)) StarInput.cursor(b.getFloat("x"), b.getFloat("y"));
    else if ("scroll".equals(t)) StarInput.scroll(b.getDouble("dy"));
    else if ("char".equals(t)) StarInput.chr(b.getInt("key"));
  }

  private void surface(Bundle b) {
    b.setClassLoader(Surface.class.getClassLoader());
    Surface s = b.getParcelable("surface");
    if (s == null || !s.isValid()) return;
    int w = b.getInt("w"), h = b.getInt("h");
    CallbackBridge.physicalWidth = b.getInt("pw");
    CallbackBridge.physicalHeight = b.getInt("ph");
    CallbackBridge.windowWidth = w;
    CallbackBridge.windowHeight = h;
    if (surface != null) surface.release();
    surface = s;
    JREUtils.setupBridgeWindow(s);
    CallbackBridge.sendUpdateWindowSize(w, h);
    tryStart();
  }

  private void gone() {
    JREUtils.releaseBridgeWindow();
    if (surface != null) { surface.release(); surface = null; }
  }

  private static void note(String log, String msg) {
    Log.e(TAG, msg);
    try (java.io.FileOutputStream o = new java.io.FileOutputStream(log, true)) { o.write((msg + "\n").getBytes()); } catch (Exception ignored) { }
  }

  /** The JVM starts only when both the launch data and a valid Surface are here (once per process). */
  private synchronized void tryStart() {
    if (started || launchData == null || surface == null || !surface.isValid()) return;
    started = true;
    final Bundle d = launchData;
    new Thread(() -> {
      final String log = d.getString("log", "/dev/null");
      int code = -99;
      try {
        String jre = d.getString("jre"), nat = d.getString("nativeDir"), gameDir = d.getString("gameDir");
        note(log, "[star] step 1: :jvm process up, pid " + android.os.Process.myPid() + ", abi " + android.os.Build.SUPPORTED_ABIS[0]);
        String[] so = new java.io.File(nat).list();
        if (so != null) java.util.Arrays.sort(so);
        note(log, "[star] nativeLibDir " + nat + ": " + (so == null ? "(unreadable)" : String.join(" ", so)));
        String gl = d.getString("renderer", "").toLowerCase().contains("ltw") && new java.io.File(nat, "libltw.so").exists() ? "libltw.so" : "libgl4es_114.so"; // LTW not bundled -> gl4es
        java.io.File glFile = new java.io.File(nat, gl);
        if (!new java.io.File(nat, "libpojavexec.so").exists()) throw new Exception("libpojavexec.so is missing in jniLibs/arm64-v8a (see native-android/jniLibs).");
        if (!glFile.exists()) throw new Exception(gl + " is missing in jniLibs/arm64-v8a (renderer).");
        note(log, "[star] step 2: environment");
        android.system.Os.setenv("POJAV_NATIVEDIR", nat, true);
        android.system.Os.setenv("JAVA_HOME", jre, true);
        android.system.Os.setenv("HOME", gameDir, true);
        android.system.Os.setenv("TMPDIR", d.getString("tmp"), true);
        android.system.Os.setenv("POJAV_RENDERER", gl.equals("libltw.so") ? "opengles3_ltw" : "opengles2", true);
        android.system.Os.setenv("LIBGL_ES", gl.equals("libltw.so") ? "3" : "2", true);
        android.system.Os.setenv("LIBGL_NOERROR", "1", true);
        android.system.Os.setenv("LIBGL_MIPMAP", "3", true);
        android.system.Os.setenv("AWTSTUB_WIDTH", String.valueOf(CallbackBridge.windowWidth), true);
        android.system.Os.setenv("AWTSTUB_HEIGHT", String.valueOf(CallbackBridge.windowHeight), true);
        JREUtils.setLdLibraryPath(jre + "/lib/server:" + jre + "/lib:" + jre + "/lib/jli:" + jre + "/lib/aarch64/server:" + jre + "/lib/aarch64:" + jre + "/lib/aarch64/jli:/system/lib64:/vendor/lib64:" + nat);
        note(log, "[star] step 3: preloading libs");
        for (String lib : new String[] { "libopenal.so", "libfreetype.so", gl }) {
          java.io.File f = new java.io.File(nat, lib);
          if (f.exists() && !JREUtils.dlopen(f.getAbsolutePath())) note(log, "[star] dlopen failed: " + lib);
        }
        new java.io.File(gameDir).mkdirs();
        JREUtils.chdir(gameDir);
        note(log, "[star] step 4: setupExitMethod");
        JREUtils.setupExitMethod(getApplication());
        note(log, "[star] step 5: initializeHooks");
        JREUtils.initializeHooks();
        note(log, "[star] step 6: hooks ready, starting JVM");
        String[] extra = d.getStringArray("args");
        java.util.ArrayList<String> a = new java.util.ArrayList<>();
        a.add("-Djava.io.tmpdir=" + d.getString("tmp"));
        a.add("-XX:+UseSerialGC");
        a.add("-Djava.awt.headless=true");
        a.add("-Dorg.lwjgl.librarypath=" + nat);                 // arm64 liblwjgl*.so first (the Mojang natives-linux jars are x86_64)
        a.add("-Dorg.lwjgl.system.allocator=system");            // no liblwjgl_jemalloc.so is bundled: do not try to load it
        a.add("-Djna.nosys=true");                               // never use the (older) libjnidispatch.so found in nativeLibDir
        a.add("-Dorg.lwjgl.openal.libname=" + nat + "/libopenal.so");
        a.add("-Dorg.lwjgl.opengl.libname=" + gl);
        a.add("-Dorg.lwjgl.freetype.libname=" + nat + "/libfreetype.so");
        a.add("-Dglfwstub.windowWidth=" + CallbackBridge.windowWidth);
        a.add("-Dglfwstub.windowHeight=" + CallbackBridge.windowHeight);
        a.add("-Dglfwstub.initEgl=false");
        a.add("-Dos.name=Linux");
        a.add("-Dorg.lwjgl.vulkan.libname=libvulkan.so");
        a.add("-Dlog4j2.formatMsgNoLookups=true");
        if (extra != null) {
          for (String e : extra) {
            // The patched GLFW classes call System.loadLibrary("pojavexec") from inside the JVM: nativeLibDir must be on java.library.path
            // (first, so the arm64 liblwjgl*.so win over the x86_64 ones the Mojang natives jars extract into the version folder).
            if (e.startsWith("-Djava.library.path=")) a.add("-Djava.library.path=" + nat + ":" + e.substring("-Djava.library.path=".length()));
            else a.add(e);
          }
        }
        code = StarJvm.run(jre, a.toArray(new String[0]), log);
      } catch (Throwable t) { note(log, "[star] " + t); }
      note(log, "\n[exit " + code + "]");
      android.os.Process.killProcess(android.os.Process.myPid());
    }, "star-jvm").start();
  }
}
