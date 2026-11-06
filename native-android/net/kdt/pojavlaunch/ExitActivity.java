package net.kdt.pojavlaunch;

import android.content.Context;
import android.util.Log;

/**
 * libpojavexec.so (setupExitMethod) looks this class up by name and calls showExitMessage(Context, int) when the JVM calls exit().
 * Star runs the JVM in the ":jvm" process, so the process ending is the exit signal (StarGameClient.onServiceDisconnected).
 */
public final class ExitActivity {
  private ExitActivity() { }
  public static void showExitMessage(Context ctx, int code) {
    Log.i("StarExit", "JVM exit code " + code);
    android.os.Process.killProcess(android.os.Process.myPid());
  }
}
