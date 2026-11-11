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

## Playing on a phone
- **Touch controls**: joystick (WASD), buttons, drag anywhere on the game = look. Layouts are per screen (game / inventory / pause / menu) and editable. There is no on-screen hotbar or Look pad: tap the game's own hotbar to pick a slot.
- **Editing controls**: Pause > *Edit controls* opens the editor on top of the running game (no restart). Quick add has packs (D-pad, combat pad, slots 1-9 row, arrow keys) and presets for hotbar slots, chat/menu keys (Enter, Backspace, `/`, arrows) and extras (F1/F2/F11, Zoom, Fly...).
- **Mouse button** (top centre): ON = touchpad cursor (starts in the middle; drag moves it, tap = click, two taps = double click, hold = drag). OFF = direct touch on the game's buttons.
- **Keyboard** button opens the phone keyboard. Letters, digits and US-layout symbols are sent as key + character events; it stays open until you press the button again. Non-Latin text is not supported on 1.8.9.
- **Start-up logo**: the Mojang logo is replaced by the Star Client mark (a patched *copy* of the version jar, `<id>-star.jar`; the original is never modified and still passes the SHA-1 check).
- **Launcher splash**: white glint while checking for updates, green when up to date, yellow when an update exists.
- **Help & logs** in the launcher produces the diagnostics report to send when something breaks.

- **Returning to the app** while a game runs brings you straight back to it.
- **Defaults on first launch of a game folder**: render distance 6, 60 fps cap, no vsync, minimal particles (`.star-tuned` marks it done; change them in-game afterwards).

## Input notes (for developers)
Input goes through a direct JS->Java bridge (`window.StarNative`, set up in `MainActivity`) with the Tauri `invoke` queue as fallback: an invoke round trip costs ~60 ms, which limited look-around to ~15 updates/s.

`org.lwjgl.glfw.CallbackBridge` natives must NOT be annotated `@CriticalNative`: the bundled `libpojavexec.so` expects `(JNIEnv*, jclass, ...)`, so critical calls shifted every int argument (keys arrived as `1`/`0`, clicks as the wrong button). Cursor moves still worked because floats use other registers.

## Not supported on Android
Forge / NeoForge (installer needs a second JVM), opening folders, desktop tray/window options.
