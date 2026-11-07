package com.bytedance.android.bytehook;

import androidx.annotation.Keep;

/**
 * libbytehook.so (the inline-hook library used by libexithook / libpojavexec) calls FindClass on this exact class in JNI_OnLoad and
 * registers its natives on it. Pojav pulls it from the "com.bytedance:bytehook" Gradle dependency; Star ships only the .so, so this class
 * provides the same native declarations (a superset of the 1.0.x / 1.1.x versions: unused declarations are harmless).
 */
@Keep
public final class ByteHook {
  private ByteHook() { }
  static { try { System.loadLibrary("bytehook"); } catch (Throwable ignored) { } }
  @Keep public static native int nativeInit(int mode, boolean debug);
  @Keep public static native int nativeAddIgnore(String callerPathName);
  @Keep public static native int nativeGetMode();
  @Keep public static native boolean nativeGetDebug();
  @Keep public static native void nativeSetDebug(boolean debug);
  @Keep public static native boolean nativeGetRecordable();
  @Keep public static native void nativeSetRecordable(boolean recordable);
  @Keep public static native String nativeGetRecords(int itemFlags);
  @Keep public static native String nativeGetArch();
  @Keep public static native void nativeDumpRecords(int fd);
  @Keep public static native void nativeDumpRecords(String pathName);
}
