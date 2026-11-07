package app.starclient.mobile;

import java.io.File;
import java.util.ArrayList;

/** JNI entry to the bundled JRE (implemented in Rust, src-tauri/src/android.rs). Only use inside the ":jvm" process. */
public final class StarJvm {
  static { System.loadLibrary("star_client_lib"); }
  private StarJvm() { }
  public static native int run(String jreDir, String[] args, String logPath);

  /** The APK's nativeLibraryDir (libpojavexec.so, liblwjgl*.so, libjnidispatch.so ...). */
  private static String nativeDir() {
    try {
      String n = android.system.Os.getenv("POJAV_NATIVEDIR");
      if (n != null && new File(n, "libpojavexec.so").exists()) return n;
      String ld = android.system.Os.getenv("LD_LIBRARY_PATH");
      if (ld != null) for (String p : ld.split(":")) if (new File(p, "libpojavexec.so").exists()) return p;
    } catch (Throwable ignored) { }
    return null;
  }

  /**
   * Fixes the JVM arguments right before the JVM starts:
   * 1) java.library.path gets the APK lib dir FIRST: GLFW (Pojav) calls System.loadLibrary("pojavexec"), and Mojang's x86 natives must not win.
   * 2) org.lwjgl.librarypath: LWJGL loads Pojav's liblwjgl*.so from there (fixes "Incompatible Java and native library versions").
   * 3) jna.nosys=true: do not use the old libjnidispatch.so (6.1.6) from the APK, JNA unpacks its own from the jar.
   */
  public static String[] fix(String[] args) {
    String nat = nativeDir();
    ArrayList<String> out = new ArrayList<>();
    boolean lp = false, lw = false, jn = false;
    for (String a : args) {
      if (nat != null && a.startsWith("-Djava.library.path=")) {
        String cur = a.substring("-Djava.library.path=".length());
        out.add("-Djava.library.path=" + nat + (cur.isEmpty() ? "" : ":" + cur));
        lp = true; continue;
      }
      if (a.startsWith("-Dorg.lwjgl.librarypath=")) lw = true;
      if (a.startsWith("-Djna.nosys=")) jn = true;
      out.add(a);
    }
    if (nat != null && !lp) out.add(0, "-Djava.library.path=" + nat);
    if (nat != null && !lw) out.add(0, "-Dorg.lwjgl.librarypath=" + nat);
    if (!jn) out.add(0, "-Djna.nosys=true");
    return out.toArray(new String[0]);
  }
}
