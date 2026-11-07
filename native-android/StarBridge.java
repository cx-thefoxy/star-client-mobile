package app.starclient.mobile;

import android.app.Activity;
import android.app.ActivityManager;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;

/**
 * The only door between Rust (libstar_client_lib.so) and Android UI classes. Rust calls the static methods below through JNI
 * (src-tauri/src/android.rs); the two natives go the other way. All launcher logic lives in Rust.
 */
public final class StarBridge {
  static { System.loadLibrary("star_client_lib"); }
  private StarBridge() { }

  public static native void nativeInit(String apkPath);
  public static native void nativeServiceDied();

  private static Activity activity;
  private static StarGameSurface surface;

  public static void init(Activity a) {
    activity = a;
    nativeInit(a.getApplicationInfo().sourceDir);
  }

  /** Called by StarGameClient when the ":jvm" process is gone. */
  static void serviceDied() {
    try { logExitReason(); } catch (Throwable ignored) { }
    nativeServiceDied();
  }

  private static String lastLog;

  /** The ":jvm" process can die without writing anything (native crash, killed): ask Android why and put it in the game log. */
  private static void logExitReason() throws Exception {
    Activity a = activity;
    if (a == null || lastLog == null || android.os.Build.VERSION.SDK_INT < 30) return;
    ActivityManager am = (ActivityManager) a.getSystemService(android.content.Context.ACTIVITY_SERVICE);
    for (android.app.ApplicationExitInfo i : am.getHistoricalProcessExitReasons(a.getPackageName(), 0, 8)) {
      if (i.getProcessName() == null || !i.getProcessName().endsWith(":jvm")) continue;
      String[] names = { "?", "EXIT_SELF", "SIGNALED", "LOW_MEMORY", "CRASH", "CRASH_NATIVE", "ANR", "INITIALIZATION_FAILURE", "PERMISSION_CHANGE", "EXCESSIVE_RESOURCE_USAGE", "USER_REQUESTED", "USER_STOPPED", "DEPENDENCY_DIED", "OTHER" };
      int r = i.getReason();
      String line = "\n[star] :jvm process ended: reason=" + (r >= 0 && r < names.length ? names[r] : String.valueOf(r)) + " status=" + i.getStatus() + " desc=" + i.getDescription() + "\n";
      try (java.io.FileOutputStream f = new java.io.FileOutputStream(lastLog, true)) { f.write(line.getBytes()); }
      try {
        java.io.File hs = new java.io.File(lastLog + ".hs_err");
        if (hs.exists()) {
          java.util.List<String> ls = java.nio.file.Files.readAllLines(hs.toPath());
          StringBuilder sb = new StringBuilder("[star] hs_err:\n");
          for (int k = 0; k < Math.min(ls.size(), 45); k++) sb.append(ls.get(k)).append('\n');
          try (java.io.FileOutputStream f = new java.io.FileOutputStream(lastLog, true)) { f.write(sb.toString().getBytes()); }
        }
      } catch (Throwable ignored) { }
      if (r != 4 && r != 5) return; // only a crash has a tombstone; a normal exit must not print old crashes from the logcat history
      try {
        Process pr = Runtime.getRuntime().exec(new String[] { "logcat", "-d", "-v", "brief", "-t", "1500" });
        java.io.BufferedReader br = new java.io.BufferedReader(new java.io.InputStreamReader(pr.getInputStream()));
        java.util.ArrayList<String> all = new java.util.ArrayList<>();
        String ln;
        while ((ln = br.readLine()) != null) all.add(ln.length() > 500 ? ln.substring(0, 500) : ln);
        int sig = -1;
        for (int k = all.size() - 1; k >= 0; k--) if (all.get(k).contains("Fatal signal") && all.get(k).contains("pid " + i.getPid())) { sig = k; break; }
        StringBuilder sb = new StringBuilder("[star] crash head:\n");
        if (sig >= 0) {
          for (int k = Math.max(0, sig - 6); k < Math.min(all.size(), sig + 160); k++) {
            String l = all.get(k);
            String body = l.contains("): ") ? l.substring(l.indexOf("): ") + 3).trim() : l.trim();
            if (body.matches("^(x\\d+|lr|sp|pc|pst|r\\d+|fp|ip)\\s.*")) continue; // CPU registers: no use
            if (body.startsWith("memory near") || body.matches("^[0-9a-f]{8,16}\\s.*")) continue; // memory dumps
            if (l.contains("#") && l.contains(" pc ") && !(l.contains("#0") || l.contains("#1"))) continue; // only frames #0-#19
            sb.append(l).append('\n');
          }
        } else {
          sb.append("(no 'Fatal signal' line visible to the app; last 25 error lines)\n");
          int n = 0;
          for (int k = all.size() - 1; k >= 0 && n < 25; k--) if (all.get(k).startsWith("E/") || all.get(k).startsWith("F/")) { sb.insert(sb.indexOf("\n") + 1, all.get(k) + "\n"); n++; }
        }
        try (java.io.FileOutputStream f = new java.io.FileOutputStream(lastLog, true)) { f.write(sb.toString().getBytes()); }
      } catch (Throwable ignored) { }
      return;
    }
  }

  /** Shows/hides the game SurfaceView behind the web view and makes the web view transparent while the game is visible. */
  public static void surface(final boolean show, final float scale) {
    final Activity a = activity;
    if (a == null) return;
    a.runOnUiThread(() -> {
      ViewGroup content = a.findViewById(android.R.id.content);
      if (content == null) return;
      android.webkit.WebView web = findWebView(content);
      if (show) {
        if (surface == null) {
          surface = new StarGameSurface(a);
          content.addView(surface, 0, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }
        surface.setResolutionScale(scale);
        if (web != null) web.setBackgroundColor(0);
      } else if (surface != null) {
        content.removeView(surface);
        surface = null;
      }
    });
  }

  private static android.webkit.WebView findWebView(View v) {
    if (v instanceof android.webkit.WebView) return (android.webkit.WebView) v;
    if (v instanceof ViewGroup) {
      ViewGroup g = (ViewGroup) v;
      for (int i = 0; i < g.getChildCount(); i++) { android.webkit.WebView w = findWebView(g.getChildAt(i)); if (w != null) return w; }
    }
    return null;
  }

  public static void input(String t, int key, int button, boolean down, float x, float y, double dy) {
    StarGameClient.input(t, key, button, down, x, y, dy);
  }

  /** The JVM starts inside ":jvm" once its Surface exists (surface(true, ..) is called when the game screen opens). */
  public static void launch(String jre, String log, String gameDir, String tmp, String renderer, String[] args) {
    Activity a = activity;
    if (a == null) return;
    lastLog = log;
    Bundle b = new Bundle();
    b.putString("jre", jre); b.putString("log", log); b.putString("gameDir", gameDir); b.putString("tmp", tmp);
    b.putString("nativeDir", a.getApplicationInfo().nativeLibraryDir); b.putString("renderer", renderer);
    b.putStringArray("args", args);
    StarGameClient.launch(a, b);
  }

  /** Quit game: kill the ":jvm" process. */
  public static void stop() {
    Activity a = activity;
    if (a == null) return;
    try {
      ActivityManager am = (ActivityManager) a.getSystemService(android.content.Context.ACTIVITY_SERVICE);
      for (ActivityManager.RunningAppProcessInfo p : am.getRunningAppProcesses())
        if (p.processName != null && p.processName.endsWith(":jvm")) android.os.Process.killProcess(p.pid);
    } catch (Exception ignored) { }
  }
}
