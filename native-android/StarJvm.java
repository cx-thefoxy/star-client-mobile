package app.starclient.mobile;

/** JNI entry to the bundled JRE (implemented in Rust, src-tauri/src/android.rs). Only use inside the ":jvm" process. */
public final class StarJvm {
  static { System.loadLibrary("star_client_lib"); }
  private StarJvm() { }
  public static native int run(String jreDir, String[] args, String logPath);
}
