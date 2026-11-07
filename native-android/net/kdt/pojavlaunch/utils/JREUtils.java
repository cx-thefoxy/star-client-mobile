package net.kdt.pojavlaunch.utils;

/**
 * Only the native declarations from PojavLauncher's JREUtils (LGPL-3.0). libpojavexec.so registers them under this exact
 * class name; the rest of Pojav's JREUtils (runtime/env/graphics setup) is replaced by Star's own launch code.
 */
public final class JREUtils {
  private JREUtils() { }
  public static native int chdir(String path);
  public static native boolean dlopen(String libPath);
  public static native void setLdLibraryPath(String ldLibraryPath);
  public static native void setupBridgeWindow(Object surface);
  public static native void releaseBridgeWindow();
  public static native void initializeHooks(); // lives in libexithook.so
  public static native void setupExitMethod(android.content.Context context);
  static { System.loadLibrary("exithook"); System.loadLibrary("pojavexec"); }
}
