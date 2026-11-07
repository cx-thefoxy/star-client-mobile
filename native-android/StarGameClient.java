package app.starclient.mobile;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.IBinder;
import android.os.Message;
import android.os.Messenger;
import android.util.Log;
import android.view.Surface;

/** UI-process side of the link to StarGameService (":jvm" process). Input and the game Surface travel through it. */
final class StarGameClient {
  private static Messenger svc;
  private static boolean binding;
  private static Runnable pendingSurface, pendingLaunch;
  /** Receives MSG_GRAB from the service and forwards it to the web UI. */
  private static final Messenger reply = new Messenger(new Handler(Looper.getMainLooper()) {
    @Override public void handleMessage(Message m) { if (m.what == StarGameService.MSG_GRAB) StarBridge.grab(m.arg1 == 1); }
  });

  private StarGameClient() { }

  static synchronized void connect(Context c) {
    if (svc != null || binding) return;
    binding = true;
    boolean ok = c.getApplicationContext().bindService(new Intent(c, StarGameService.class), new android.content.ServiceConnection() {
      @Override public void onServiceConnected(ComponentName n, IBinder b) {
        Runnable r, l;
        Messenger ms = new Messenger(b);
        try { Message reg = Message.obtain(null, StarGameService.MSG_REGISTER); reg.replyTo = reply; ms.send(reg); } catch (Exception e) { Log.w("StarGameClient", e); }
        synchronized (StarGameClient.class) { svc = ms; binding = false; r = pendingSurface; pendingSurface = null; l = pendingLaunch; pendingLaunch = null; }
        if (l != null) l.run();
        if (r != null) r.run();
      }
      @Override public void onServiceDisconnected(ComponentName n) { reset(); }   // :jvm process died (JVM exit)
      @Override public void onBindingDied(ComponentName n) { reset(); }
    }, Context.BIND_AUTO_CREATE);
    if (!ok) binding = false;
  }

  private static synchronized void reset() { boolean was = svc != null; svc = null; binding = false; if (was) StarBridge.serviceDied(); }

  private static boolean send(Message m) {
    Messenger s;
    synchronized (StarGameClient.class) { s = svc; }
    if (s == null) return false;
    try { s.send(m); return true; } catch (Exception e) { Log.w("StarGameClient", e); reset(); return false; }
  }

  static boolean input(String t, int key, int button, boolean down, float x, float y, double dy) {
    Message m = Message.obtain(null, StarGameService.MSG_INPUT);
    Bundle b = new Bundle();
    b.putString("t", t); b.putInt("key", key); b.putInt("button", button); b.putBoolean("down", down);
    b.putFloat("x", x); b.putFloat("y", y); b.putDouble("dy", dy);
    m.setData(b);
    return send(m);
  }

  /** w/h = game window size in pixels (after resolution scale), pw/ph = real surface size. Re-sent after (re)connect. */
  static void surface(final Surface s, final int w, final int h, final int pw, final int ph) {
    Runnable r = () -> {
      Message m = Message.obtain(null, StarGameService.MSG_SURFACE);
      Bundle b = new Bundle();
      b.putParcelable("surface", s); b.putInt("w", w); b.putInt("h", h); b.putInt("pw", pw); b.putInt("ph", ph);
      m.setData(b);
      send(m);
    };
    synchronized (StarGameClient.class) { if (svc == null) { pendingSurface = r; return; } }
    r.run();
  }

  static void surfaceGone() {
    synchronized (StarGameClient.class) { pendingSurface = null; }
    send(Message.obtain(null, StarGameService.MSG_SURFACE_GONE));
  }

  /** Hands the JVM launch data to the ":jvm" process. The service starts the JVM only after the game Surface has arrived. */
  static void launch(Context c, final Bundle data) {
    Runnable r = () -> {
      Message m = Message.obtain(null, StarGameService.MSG_LAUNCH);
      m.setData(data);
      if (!send(m)) Log.e("StarGameClient", "launch message not delivered");
    };
    synchronized (StarGameClient.class) { if (svc == null) { pendingLaunch = r; connect(c); return; } }
    r.run();
  }
}
