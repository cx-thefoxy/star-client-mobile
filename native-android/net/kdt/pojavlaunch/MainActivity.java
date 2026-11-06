package net.kdt.pojavlaunch;

import org.lwjgl.glfw.CallbackBridge;

/**
 * libpojavexec_awt.so (Java AWT bridge) looks this class up by name and calls these static methods. Star's real activity is
 * app.starclient.mobile.MainActivity; this only forwards to CallbackBridge so AWT link/clipboard calls don't crash.
 */
public final class MainActivity {
  private MainActivity() { }
  public static void openLink(String url) { CallbackBridge.accessAndroidClipboard(CallbackBridge.CLIPBOARD_OPEN, url); }
  public static void putClipboardData(String data, String mimeType) { CallbackBridge.accessAndroidClipboard(CallbackBridge.CLIPBOARD_COPY, data); }
  public static void querySystemClipboard() { /* AWT paste from system clipboard is not supported */ }
}
