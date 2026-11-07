# Star Client Mobile (Tauri 2 + Rust)

Minecraft Java launcher for Android. Same app as Star Client for PC (same Rust backend: accounts, downloads, versions, Fabric/Quilt,
Modrinth, instances) with a touch layer for playing. No About page, no desktop-only features (window controls, tray, folder buttons).

## Layout
- `src/` React UI (PC UI + `src/mobile/`: controls, editor, game screen, on-screen keyboard)
- `src-tauri/` Rust backend. `src/android.rs` = bundled Java unpack, JVM launcher (JLI), bridge to the Java layer
- `native-android/` small Java/Kotlin layer (game SurfaceView, `:jvm` process service, Pojav shims), `jniLibs/`, `jre/`
- `tools/android-setup.mjs` patches the generated Android project; `.github/workflows/android.yml` builds the APK

## Build (GitHub Actions or locally with Android SDK/NDK + Rust)
1. Copy `jniLibs/` and `jre/` from the old full zip into `native-android/` (Pojav `.so` files, JRE 8/17/21 `bin-arm64.tar.xz` + `universal.tar.xz`).
1b. Put Pojav's patched GLFW classes at `native-android/components/lwjgl3/lwjgl-glfw-classes.jar` (from the old zip / PojavLauncher APK `assets/components/lwjgl3/`). Without it the game has no window; the launcher logs a warning and the setup script prints WARNING.
2. `npm install && npx tauri android init --ci && node tools/android-setup.mjs`
3. `npx tauri android build --apk --target aarch64 --debug` (set `STAR_MS_CLIENT_ID` for Microsoft sign-in)

## Not supported on Android
Forge / NeoForge (installer needs a second JVM), opening folders, desktop tray/window options.
