package net.kdt.pojavlaunch;

import android.content.Context;
import android.util.Log;
import androidx.annotation.Keep;

/**
 * libpojavexec.so / libexithook.so (setupExitMethod) look this class up by name and call showExitMessage when the JVM calls exit() or
 * dies from a signal. Pojav's signature changed between releases ((Context,int) and (Context,int,boolean isSignal)), so both exist: JNI
 * resolves the exact one the native library asks for. Star runs the JVM in the ":jvm" process, so the process ending is the exit signal
 * (StarGameClient.onServiceDisconnected).
 */
@Keep
public final class ExitActivity {
  private ExitActivity() { }

  @Keep public static void showExitMessage(Context ctx, int code, boolean isSignal) {
    Log.i("StarExit", "JVM exit code " + code + (isSignal ? " (signal)" : ""));
    try { Thread.sleep(150); } catch (InterruptedException ignored) { }
    android.os.Process.killProcess(android.os.Process.myPid());
  }

  @Keep public static void showExitMessage(Context ctx, int code) { showExitMessage(ctx, code, false); }
}
