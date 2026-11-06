# Star HUD — Fabric 1.21.1

This is the first real source implementation of Star HUD for Minecraft Java 1.21.1 and Fabric. It reads the launcher's `config/star-client.json` and provides:

- FPS and block coordinates
- server ping when player-list latency is available
- rolling one-second left-click CPS (sampled at client tick boundaries)
- armor durability percentages
- WASD + jump keystrokes
- hold-to-zoom (default key: C)
- an optional toggle-sprint key (default key: V), disabled by default

The mod is client-side. It does not grant cosmetics or server-side effects. The current compatibility declaration remains unverified until the source builds and a real game session is tested.

## Build

Prerequisites: JDK 21 and Gradle 8.x with network access to Fabric/Maven repositories.

From this directory run:

```bash
gradle build
```

The `remapJar` task is configured to copy the remapped output to `star-mod/dist/star-hud-1.21.1.jar`, which is the filename expected by the launcher bridge. Then rebuild Star Client so the Tauri bundle can include the jar.

Do not mark this version as verified until you have built it and exercised the HUD inside Minecraft 1.21.1 with Fabric Loader and Fabric API installed.
