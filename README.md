# vr-show

A 360° panoramic image viewer, written in pure Rust (`winit` + `wgpu` + `egui`).

## Build

```bash
cargo build --release
```

Binary at `target/release/vr-show`.

## Run

```bash
cargo run --release -- path/to/equirectangular.jpg
```

Or launch without arguments and drag an image into the window.

## Package

```bash
# .deb (Ubuntu/Debian)
cargo install cargo-deb
cargo deb -p vr-show
# → target/debian/vr-show_0.2.0-1_amd64.deb

# AppImage (Linux, portable)
# (requires appimagetool on PATH)
mkdir -p target/appimage/vr-show.AppDir/usr/bin
cp target/release/vr-show target/appimage/vr-show.AppDir/usr/bin/
# (set up AppRun, .desktop, icon — then:)
appimagetool target/appimage/vr-show.AppDir target/appimage/vr-show-0.2.0-x86_64.AppImage
# → target/appimage/vr-show-0.2.0-x86_64.AppImage
```

## Controls

| Action | Effect |
|--------|--------|
| Click + drag | Rotate camera |
| Scroll wheel | Zoom (FOV 30°–100°) |
| Drop image file | Load panorama |
| CLI argument | Load on startup |

First interaction stops auto-rotation.

## Supported formats

PNG and JPEG (equirectangular, 2:1 aspect ratio). Non-2:1 images load but display stretched with a warning.

## Project layout

```
crates/vr-show/src/
├── main.rs        # CLI arg parsing, event loop
├── app.rs         # ApplicationHandler, rendering, input, egui
├── window.rs      # Window + wgpu surface + device
├── renderer.rs    # 3D pipeline (sphere + panorama)
├── input.rs       # winit events → typed actions
├── file.rs        # Image loading + aspect ratio check
├── error.rs       # Error types
├── ui.rs          # egui overlay (HUD, error banner)
└── scene/
    ├── camera.rs  # CameraState (yaw/pitch/FOV)
    ├── sphere.rs  # Sphere mesh generation
    └── texture.rs # GPU texture upload
shaders/
├── pano.vert.wgsl # Vertex shader
└── pano.frag.wgsl # Fragment shader
```

See `docs/superpowers/specs/2026-06-29-pure-rust-port-design.md` for the full design spec.
See `docs/superpowers/plans/2026-06-29-pure-rust-port.md` for the implementation plan.
