package app.starclient.mobile

import android.graphics.drawable.ColorDrawable
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    // Draw under the camera cut-out too (otherwise a strip at the screen edge stays unrendered while the game runs).
    if (android.os.Build.VERSION.SDK_INT >= 28) {
      val a = window.attributes
      a.layoutInDisplayCutoutMode = if (android.os.Build.VERSION.SDK_INT >= 30) WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS else WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
      window.attributes = a
    }
    window.setBackgroundDrawable(ColorDrawable(0xFF050606.toInt())) // same near-black as the app: no coloured screen while the page loads
    StarBridge.init(this)
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    hideBars()
    hookInput()
    watchIme()
  }

  /** Direct, synchronous input path for the game (a Tauri invoke() round trip took ~60 ms, so the camera only got ~15 updates/s). */
  @androidx.annotation.Keep class Direct {
    @androidx.annotation.Keep @JavascriptInterface fun input(t: String, key: Int, button: Int, down: Boolean, x: Float, y: Float, dy: Double) { StarBridge.input(t, key, button, down, x, y, dy) }
  }

  /** Tells the page whether the phone keyboard is really visible (the Keyboard button toggles by that, even after Back hid it). */
  private fun watchIme() {
    val h = android.os.Handler(android.os.Looper.getMainLooper())
    var last: Boolean? = null
    val r = object : Runnable {
      override fun run() {
        try {
          val root = window.decorView
          val vis = androidx.core.view.ViewCompat.getRootWindowInsets(root)?.isVisible(WindowInsetsCompat.Type.ime())
          val w = findWeb(root)
          if (vis != null && vis != last && w != null) { last = vis; w.evaluateJavascript("window.__starIme&&window.__starIme($vis)", null) }
        } catch (_: Throwable) { }
        h.postDelayed(this, 300)
      }
    }
    h.postDelayed(r, 1000)
  }

  private var hooked = false
  private fun findWeb(v: View): WebView? {
    if (v is WebView) return v
    if (v is ViewGroup) for (i in 0 until v.childCount) findWeb(v.getChildAt(i))?.let { return it }
    return null
  }
  private fun hookInput() {
    val root = window.decorView
    val l = object : ViewTreeObserver.OnGlobalLayoutListener {
      override fun onGlobalLayout() {
        if (hooked) return
        val w = findWeb(root) ?: return
        hooked = true
        try { w.addJavascriptInterface(Direct(), "StarNative") } catch (_: Throwable) { }
        root.viewTreeObserver.removeOnGlobalLayoutListener(this)
      }
    }
    root.viewTreeObserver.addOnGlobalLayoutListener(l)
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) hideBars()
  }

  /** Full-screen landscape like a game: hide status and navigation bars (swipe to reveal). */
  private fun hideBars() {
    WindowCompat.setDecorFitsSystemWindows(window, false)
    val c = WindowCompat.getInsetsController(window, window.decorView)
    c.hide(WindowInsetsCompat.Type.systemBars())
    c.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
  }
}
