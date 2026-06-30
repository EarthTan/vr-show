# vr-show

A 360° panoramic image viewer, written in pure Rust.

## Build

```
cargo build --release
```

## Run

```
cargo run --release -- path/to/equirectangular.jpg
```

Or launch without arguments and drag an image into the window.

## Controls

- Click and drag: rotate
- Scroll wheel: zoom (FOV 30° – 100°)
- First interaction stops auto-rotation.

## Supported image formats

PNG and JPEG. Non-equirectangular images (anything not 2:1) load but display stretched, with a one-time warning printed to stderr.

## Project layout

See `docs/superpowers/specs/2026-06-29-pure-rust-port-design.md`.
