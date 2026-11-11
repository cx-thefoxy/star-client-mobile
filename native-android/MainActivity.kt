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
    window.setBackgroundDrawable(ColorDrawable(0xFF050606.toInt())) // same near-black as the app: no coloured screen while the page loads
    StarBridge.init(this)
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    hideBars()
    hookInput()
  }

  /** Direct, synchronous input path for the game (a Tauri invoke() round trip took ~60 ms, so the camera only got ~15 updates/s). */
  @androidx.annotation.Keep class Direct {
    @androidx.annotation.Keep @JavascriptInterface fun input(t: String, key: Int, button: Int, down: Boolean, x: Float, y: Float, dy: Double) { StarBridge.input(t, key, button, down, x, y, dy) }
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
