package app.starclient.mobile

import android.os.Bundle
import android.view.WindowManager
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    StarBridge.init(this)
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    hideBars()
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
