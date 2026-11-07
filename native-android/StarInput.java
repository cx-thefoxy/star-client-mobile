package app.starclient.mobile;

import java.lang.reflect.Method;

/**
 * Forwards input to org.lwjgl.glfw.CallbackBridge (PojavLauncher, LGPL-3.0) by reflection, so this project still compiles
 * before that class is added. Native methods are registered by libpojavexec.so under exactly that class name.
 */
final class StarInput {
  private static Class<?> cb;
  private static Throwable failed;
  private static final java.util.HashMap<String, Method> methods = new java.util.HashMap<>();
  private static float mx, my;

  private static Class<?> bridge() throws Exception {
    if (failed != null) throw new Exception("CallbackBridge unavailable: " + failed);
    if (cb == null) {
      try { cb = Class.forName("org.lwjgl.glfw.CallbackBridge"); }
      catch (Throwable t) { failed = t; throw new Exception("CallbackBridge unavailable: " + t); }
    }
    return cb;
  }

  private static Object call(String name, Class<?>[] types, Object... args) throws Exception {
    String k = name + types.length;
    Method m = methods.get(k);
    if (m == null) { m = bridge().getMethod(name, types); methods.put(k, m); }
    return m.invoke(null, args);
  }

  static void key(int key, boolean down) throws Exception {
    // Track Shift/Ctrl/Alt so later keys and clicks carry the right GLFW modifier bits (Ctrl+click, Shift+click...).
    call("setModifiers", new Class<?>[] { int.class, boolean.class }, key, down);
    int mods = (Integer) call("getCurrentMods", new Class<?>[0]);
    call("sendKeyPress", new Class<?>[] { int.class, int.class, boolean.class }, key, mods, down);
  }

  static void mouse(int button, boolean down) throws Exception {
    call("sendMouseButton", new Class<?>[] { int.class, boolean.class }, button, down);
  }

  static void cursor(float x, float y) throws Exception {
    mx = x; my = y;
    call("sendCursorPos", new Class<?>[] { float.class, float.class }, mx, my);
  }

  static void scroll(double dy) throws Exception {
    call("sendScroll", new Class<?>[] { double.class, double.class }, 0.0, dy);
  }

  static void chr(int c) throws Exception {
    call("sendChar", new Class<?>[] { char.class, int.class }, (char) c, (Integer) call("getCurrentMods", new Class<?>[0]));
  }
}
