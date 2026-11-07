package app.starclient.mobile;

import android.content.Context;
import android.view.SurfaceHolder;
import android.view.SurfaceView;

/**
 * Game render surface, lives in the UI process behind the transparent WebView (controls). The Surface itself is sent to the
 * ":jvm" process (StarGameClient -> StarGameService -> libpojavexec). scale = Settings "resolution scale" (0.25..1).
 */
public class StarGameSurface extends SurfaceView implements SurfaceHolder.Callback {
  private float scale = 1f;

  public StarGameSurface(Context c) {
    super(c);
    getHolder().addCallback(this);
    StarGameClient.connect(c);
  }

  public void setResolutionScale(float s) { scale = Math.max(0.25f, Math.min(1f, s)); }

  @Override public void surfaceCreated(SurfaceHolder h) { }

  @Override
  public void surfaceChanged(SurfaceHolder h, int format, int width, int height) {
    int w = Math.max(1, Math.round(width * scale)), hh = Math.max(1, Math.round(height * scale));
    h.setFixedSize(w, hh);
    StarGameClient.surface(h.getSurface(), w, hh, width, height);
  }

  @Override public void surfaceDestroyed(SurfaceHolder h) { StarGameClient.surfaceGone(); }
}
