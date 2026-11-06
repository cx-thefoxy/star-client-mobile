package org.lwjgl.glfw;

import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;
import android.view.Choreographer;
import androidx.annotation.Keep;
import androidx.annotation.Nullable;
import dalvik.annotation.optimization.CriticalNative;
import java.nio.ByteBuffer;
import java.nio.FloatBuffer;
import java.util.ArrayList;

/**
 * Trimmed copy of PojavLauncher's org.lwjgl.glfw.CallbackBridge (LGPL-3.0).
 * Class name, package and native signatures must stay identical: libpojavexec.so registers its natives under this name.
 * Removed Pojav-only dependencies (net.kdt.pojavlaunch.*, gamepad handler); clipboard/link use a Context set by init().
 * Runs only inside the process that hosts the JVM (":jvm"), see StarGameActivity.
 */
public class CallbackBridge {
  public static final Choreographer sChoreographer = Choreographer.getInstance();
  private static boolean isGrabbing = false;
  private static final ArrayList<GrabListener> grabListeners = new ArrayList<>();
  private static Context sContext;

  public static final int CLIPBOARD_COPY = 2000;
  public static final int CLIPBOARD_PASTE = 2001;
  public static final int CLIPBOARD_OPEN = 2002;

  // GLFW constants (same values as LwjglGlfwKeycode in Pojav)
  private static final int GLFW_MOD_SHIFT = 0x1, GLFW_MOD_CONTROL = 0x2, GLFW_MOD_ALT = 0x4, GLFW_MOD_CAPS_LOCK = 0x10, GLFW_MOD_NUM_LOCK = 0x20;
  private static final int GLFW_KEY_LEFT_SHIFT = 340, GLFW_KEY_LEFT_CONTROL = 341, GLFW_KEY_LEFT_ALT = 342, GLFW_KEY_CAPS_LOCK = 280, GLFW_KEY_NUM_LOCK = 282;

  public static volatile int windowWidth, windowHeight;
  public static volatile int physicalWidth, physicalHeight;
  public static float mouseX, mouseY;
  public volatile static boolean holdingAlt, holdingCapslock, holdingCtrl, holdingNumlock, holdingShift;

  public static ByteBuffer sGamepadButtonBuffer; // not provided by this libpojavexec build; stays null
  public static FloatBuffer sGamepadAxisBuffer; // not provided by this libpojavexec build; stays null
  public static boolean sGamepadDirectInput = false;

  /** Call once from StarGameActivity.onCreate before the JVM starts (needed for clipboard / open-link requests from the game). */
  public static void init(Context appContext) { sContext = appContext.getApplicationContext(); }

  public static void putMouseEventWithCoords(int button, float x, float y) {
    putMouseEventWithCoords(button, true, x, y);
    sChoreographer.postFrameCallbackDelayed(l -> putMouseEventWithCoords(button, false, x, y), 33);
  }

  public static void putMouseEventWithCoords(int button, boolean isDown, float x, float y) {
    sendCursorPos(x, y);
    sendMouseKeycode(button, getCurrentMods(), isDown);
  }

  public static void sendCursorPos(float x, float y) {
    mouseX = x;
    mouseY = y;
    nativeSendCursorPos(mouseX, mouseY);
  }

  public static void sendKeycode(int keycode, char keychar, int scancode, int modifiers, boolean isDown) {
    if (keycode != 0) nativeSendKey(keycode, scancode, isDown ? 1 : 0, modifiers);
    if (isDown && keychar != '\u0000') {
      nativeSendCharMods(keychar, modifiers);
      nativeSendChar(keychar);
    }
  }

  public static void sendChar(char keychar, int modifiers) {
    nativeSendCharMods(keychar, modifiers);
    nativeSendChar(keychar);
  }

  public static void sendKeyPress(int keyCode, int modifiers, boolean status) { sendKeyPress(keyCode, 0, modifiers, status); }
  public static void sendKeyPress(int keyCode, int scancode, int modifiers, boolean status) { sendKeyPress(keyCode, '\u0000', scancode, modifiers, status); }
  public static void sendKeyPress(int keyCode, char keyChar, int scancode, int modifiers, boolean status) { sendKeycode(keyCode, keyChar, scancode, modifiers, status); }

  public static void sendKeyPress(int keyCode) {
    sendKeyPress(keyCode, getCurrentMods(), true);
    sendKeyPress(keyCode, getCurrentMods(), false);
  }

  public static void sendMouseButton(int button, boolean status) { sendMouseKeycode(button, getCurrentMods(), status); }
  public static void sendMouseKeycode(int button, int modifiers, boolean isDown) { nativeSendMouseButton(button, isDown ? 1 : 0, modifiers); }

  public static void sendMouseKeycode(int keycode) {
    sendMouseKeycode(keycode, getCurrentMods(), true);
    sendMouseKeycode(keycode, getCurrentMods(), false);
  }

  public static void sendScroll(double xoffset, double yoffset) { nativeSendScroll(xoffset, yoffset); }
  public static void sendUpdateWindowSize(int w, int h) { nativeSendScreenSize(w, h); }
  public static boolean isGrabbing() { return isGrabbing; }

  // Called from JRE side
  @SuppressWarnings("unused") @Keep
  public static @Nullable String accessAndroidClipboard(int type, String copy) {
    if (sContext == null) return type == CLIPBOARD_PASTE ? "" : null;
    ClipboardManager cm = (ClipboardManager) sContext.getSystemService(Context.CLIPBOARD_SERVICE);
    switch (type) {
      case CLIPBOARD_COPY:
        cm.setPrimaryClip(ClipData.newPlainText("Copy", copy));
        return null;
      case CLIPBOARD_PASTE:
        if (cm.hasPrimaryClip() && cm.getPrimaryClipDescription().hasMimeType(ClipDescription.MIMETYPE_TEXT_PLAIN)) {
          CharSequence t = cm.getPrimaryClip().getItemAt(0).getText();
          return t == null ? "" : t.toString();
        }
        return "";
      case CLIPBOARD_OPEN:
        try { sContext.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(copy)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); } catch (Exception ignored) { }
        return null;
      default: return null;
    }
  }

  public static int getCurrentMods() {
    int m = 0;
    if (holdingAlt) m |= GLFW_MOD_ALT;
    if (holdingCapslock) m |= GLFW_MOD_CAPS_LOCK;
    if (holdingCtrl) m |= GLFW_MOD_CONTROL;
    if (holdingNumlock) m |= GLFW_MOD_NUM_LOCK;
    if (holdingShift) m |= GLFW_MOD_SHIFT;
    return m;
  }

  /** Shift/Ctrl/Alt/Caps/Num must be tracked here so later key and mouse events carry the right GLFW modifier bits. */
  public static void setModifiers(int keyCode, boolean isDown) {
    switch (keyCode) {
      case GLFW_KEY_LEFT_SHIFT: holdingShift = isDown; return;
      case GLFW_KEY_LEFT_CONTROL: holdingCtrl = isDown; return;
      case GLFW_KEY_LEFT_ALT: holdingAlt = isDown; return;
      case GLFW_KEY_CAPS_LOCK: holdingCapslock = isDown; return;
      case GLFW_KEY_NUM_LOCK: holdingNumlock = isDown;
    }
  }

  // Called from JRE side
  @SuppressWarnings("unused") @Keep
  private static void onDirectInputEnable() {
    Log.i("CallbackBridge", "onDirectInputEnable()");
    sGamepadDirectInput = true;
  }

  // Called from JRE side
  @SuppressWarnings("unused") @Keep
  private static void onGrabStateChanged(final boolean grabbing) {
    isGrabbing = grabbing;
    sChoreographer.postFrameCallbackDelayed((time) -> {
      if (isGrabbing != grabbing) return;
      synchronized (grabListeners) { for (GrabListener g : grabListeners) g.onGrabState(grabbing); }
    }, 16);
  }

  public static void addGrabListener(GrabListener l) { synchronized (grabListeners) { l.onGrabState(isGrabbing); grabListeners.add(l); } }
  public static void removeGrabListener(GrabListener l) { synchronized (grabListeners) { grabListeners.remove(l); } }

  @Keep @CriticalNative public static native void nativeSetUseInputStackQueue(boolean useInputStackQueue);
  @Keep @CriticalNative private static native boolean nativeSendChar(char codepoint);
  @Keep @CriticalNative private static native boolean nativeSendCharMods(char codepoint, int mods);
  @Keep @CriticalNative private static native void nativeSendKey(int key, int scancode, int action, int mods);
  @Keep @CriticalNative private static native void nativeSendCursorPos(float x, float y);
  @Keep @CriticalNative private static native void nativeSendMouseButton(int button, int action, int mods);
  @Keep @CriticalNative private static native void nativeSendScroll(double xoffset, double yoffset);
  @Keep @CriticalNative private static native void nativeSendScreenSize(int width, int height);
  public static native void nativeSetWindowAttrib(int attrib, int value);

  static {
    System.loadLibrary("pojavexec");
  }
}
