# Pure-Rust Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the 360° panoramic image viewer as a single pure-Rust desktop application using `winit` + `wgpu` + `egui`, removing all JS/TS/HTML/CSS/Node/Tauri artifacts.

**Architecture:** Single Rust binary crate under `crates/vr-show/`. winit drives the event loop and window. wgpu owns the GPU pipeline (sphere mesh + equirectangular texture). egui (via egui-wgpu) renders all 2D UI (empty state, HUD, error banner) on top of the 3D scene in the same surface. Drag/drop and command-line file loading flow into a `DynamicImage` uploaded to a GPU texture.

**Tech Stack:**
- Rust 1.85+ (MSRV)
- `winit` 0.30 (window + events)
- `wgpu` 26 (GPU, WGSL shaders)
- `egui` 0.32 + `egui-wgpu` 0.32 (UI, rendered into wgpu surface)
- `glam` 0.29 (math)
- `image` 0.25 (PNG/JPEG decode)
- `thiserror` 2 (error types)
- `log` 0.4 + `env_logger` 0.11
- `pollster` 0.4 (blocking wgpu init)

## Project Layout

```
vr-show/
├── Cargo.toml                  # workspace root
├── crates/
│   └── vr-show/
│       ├── Cargo.toml
│       ├── shaders/
│       │   ├── pano.vert.wgsl
│       │   └── pano.frag.wgsl
│       └── src/
│           ├── main.rs
│           ├── app.rs
│           ├── window.rs
│           ├── renderer.rs
│           ├── scene/
│           │   ├── mod.rs
│           │   ├── sphere.rs
│           │   ├── camera.rs
│           │   └── texture.rs
│           ├── input.rs
│           ├── file.rs
│           ├── ui.rs
│           └── error.rs
└── (delete: src/, src-tauri/, tests/, index.html, vite.config.js, package.json, scripts/, dist/, dist-tauri/, node_modules/)
```

## Global Constraints

These apply to every task. The spec at `docs/superpowers/specs/2026-06-29-pure-rust-port-design.md` is the source of truth for behavior.

- **Workspace root** is `vr-show/`. Subcrate lives at `vr-show/crates/vr-show/`.
- **Single binary crate**, no library output.
- **All math constants** match the web version exactly: FOV default 75° (min 30°, max 100°, step 3°, lerp 0.1); sphere radius 500, segments 64×64; pitch clamped to ±(π/2 − 0.01); drag sensitivity 0.0035 rad/px; auto-rotate 0.05 rad/s; FOV lerp threshold 0.01.
- **Camera state**: yaw, pitch, target_fov, current_fov, is_auto_rotating, has_fired_first_interaction. Origin fixed, only rotation. YXZ Euler order.
- **Color space**: sRGB textures uploaded as `Rgba8UnormSrgb`; surface uses sRGB view; no manual gamma handling.
- **No `unwrap()` in non-test code** for fallible operations. Use `?` and propagate `AppError`. Tests may use `unwrap`/`expect`.
- **No JS/TS/HTML/CSS/Node artifacts** in the final tree. CI check at the end verifies this.
- **Frequent commits**: each task ends with a commit.

---

## Task 1: Remove old web/Tauri artifacts and set up Cargo workspace

**Files:**
- Delete: `vr-show/src/`, `vr-show/tests/`, `vr-show/index.html`, `vr-show/vite.config.js`, `vr-show/package.json`, `vr-show/package-lock.json`, `vr-show/src-tauri/`, `vr-show/dist/`, `vr-show/dist-tauri/`, `vr-show/scripts/`, `vr-show/node_modules/`, `vr-show/.gitignore`
- Create: `vr-show/Cargo.toml`, `vr-show/crates/vr-show/Cargo.toml`
- Create: `vr-show/.gitignore`

- [ ] **Step 1: Delete the old artifacts**

```bash
cd vr-show
rm -rf src tests index.html vite.config.js package.json package-lock.json src-tauri dist dist-tauri scripts node_modules
rm -f .gitignore
```

- [ ] **Step 2: Verify deletion**

Run: `ls -la`
Expected: no `src/`, `src-tauri/`, `dist/`, `index.html`, `package.json`, etc. Only the `docs/`, `Qwen-Image-2512_00001_.png`, and the new directories should appear after the next steps.

- [ ] **Step 3: Write the workspace root `Cargo.toml`**

Create `vr-show/Cargo.toml`:

```toml
[workspace]
resolver = "2"
members = ["crates/vr-show"]

[workspace.package]
version = "0.2.0"
edition = "2021"
rust-version = "1.85"
license = "MIT"
authors = ["asyncb"]

[workspace.dependencies]
winit = { version = "0.30", default-features = false, features = ["rwh_06", "x11", "wayland", "wayland-dlopen", "wayland-csd-adwaita"] }
wgpu = { version = "26", default-features = false, features = ["wgsl", "vulkan", "metal", "gles", "dx12"] }
egui = "0.32"
egui-wgpu = { version = "0.32", features = ["winit"] }
glam = "0.29"
image = { version = "0.25", default-features = false, features = ["png", "jpeg"] }
thiserror = "2"
log = "0.4"
env_logger = "0.11"
pollster = "0.4"
bytemuck = { version = "1", features = ["derive"] }

[profile.release]
lto = "thin"
codegen-units = 1
opt-level = 3
strip = "symbols"
```

- [ ] **Step 4: Write the subcrate `Cargo.toml`**

Create `vr-show/crates/vr-show/Cargo.toml`:

```toml
[package]
name = "vr-show"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
license.workspace = true
authors.workspace = true
description = "360° panoramic image viewer"

[[bin]]
name = "vr-show"
path = "src/main.rs"

[dependencies]
winit = { workspace = true }
wgpu = { workspace = true }
egui = { workspace = true }
egui-wgpu = { workspace = true }
glam = { workspace = true }
image = { workspace = true }
thiserror = { workspace = true }
log = { workspace = true }
env_logger = { workspace = true }
pollster = { workspace = true }
bytemuck = { workspace = true }
```

- [ ] **Step 5: Write a minimal `main.rs` to verify the workspace compiles**

Create `vr-show/crates/vr-show/src/main.rs`:

```rust
fn main() {
    println!("vr-show 0.2.0");
}
```

- [ ] **Step 6: Write a new `.gitignore`**

Create `vr-show/.gitignore`:

```gitignore
# Rust
/target
**/target
Cargo.lock

# OS
.DS_Store
Thumbs.db

# Editor
.vscode/
.idea/
*.swp
*~

# Logs
*.log
```

- [ ] **Step 7: Verify the workspace builds**

Run: `cd vr-show && cargo build`
Expected: compiles successfully. The binary is at `target/debug/vr-show`.

- [ ] **Step 8: Verify the binary runs**

Run: `cd vr-show && cargo run`
Expected output: `vr-show 0.2.0`

- [ ] **Step 9: Commit**

```bash
cd vr-show
git add Cargo.toml .gitignore crates/
git commit -m "build: scaffold pure-Rust workspace, drop web/Tauri artifacts"
```

---

## Task 2: Error type module

**Files:**
- Create: `vr-show/crates/vr-show/src/error.rs`

- [ ] **Step 1: Write `error.rs`**

```rust
use std::path::PathBuf;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("window creation failed: {0}")]
    Window(#[from] winit::error::OsError),

    #[error("event loop error: {0}")]
    EventLoop(#[from] winit::error::EventLoopError),

    #[error("GPU error: {0}")]
    Gpu(#[from] wgpu::Error),

    #[error("GPU request adapter failed: {0}")]
    RequestAdapter(String),

    #[error("GPU request device failed: {0}")]
    RequestDevice(#[from] wgpu::RequestDeviceError),

    #[error("surface error: {0}")]
    Surface(#[from] wgpu::CreateSurfaceError),

    #[error("surface lost")]
    SurfaceLost,
}

#[derive(Debug, Error)]
pub enum LoadError {
    #[error("not an image file: {0}")]
    NotAnImage(PathBuf),

    #[error("decode failed for {path}: {source}")]
    Decode {
        path: PathBuf,
        #[source]
        source: image::ImageError,
    },

    #[error("io error reading {0}")]
    Io(PathBuf, #[source] std::io::Error),
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd vr-show && cargo build`
Expected: compiles (it is referenced by `app.rs` and `file.rs` later; if no consumer yet, use `pub mod error;` in `main.rs` to ensure it's included — see next task).

- [ ] **Step 3: Commit**

```bash
git add crates/vr-show/src/error.rs
git commit -m "feat(error): add AppError and LoadError enums"
```

---

## Task 3: Empty `main.rs` and `app.rs` shell with module declarations

**Files:**
- Modify: `vr-show/crates/vr-show/src/main.rs`
- Create: `vr-show/crates/vr-show/src/app.rs`

- [ ] **Step 1: Write the `main.rs` that initializes logging and runs the event loop**

```rust
mod app;
mod error;

use app::App;
use winit::event_loop::EventLoop;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    log::info!("vr-show starting");

    let event_loop = EventLoop::new()?;
    let mut app = App::new()?;
    event_loop.run_app(&mut app)?;

    Ok(())
}
```

- [ ] **Step 2: Write a minimal `app.rs` skeleton**

```rust
use crate::error::AppError;
use winit::application::ApplicationHandler;
use winit::event::WindowEvent;
use winit::event_loop::ActiveEventLoop;
use winit::window::WindowId;

#[derive(Default)]
pub struct App {
    _placeholder: (),
}

impl App {
    pub fn new() -> Result<Self, AppError> {
        Ok(Self { _placeholder: () })
    }
}

impl ApplicationHandler for App {
    fn resumed(&mut self, _event_loop: &ActiveEventLoop) {}
    fn window_event(
        &mut self,
        _event_loop: &ActiveEventLoop,
        _window_id: WindowId,
        _event: WindowEvent,
    ) {
    }
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd vr-show && cargo build`
Expected: compiles. The window doesn't open yet because `resumed` is empty.

- [ ] **Step 4: Commit**

```bash
git add crates/vr-show/src/main.rs crates/vr-show/src/app.rs
git commit -m "feat(app): scaffold App struct and main entry point"
```

---

## Task 4: Camera state module with unit tests

**Files:**
- Create: `vr-show/crates/vr-show/src/scene/mod.rs`
- Create: `vr-show/crates/vr-show/src/scene/camera.rs`

- [ ] **Step 1: Write `scene/mod.rs`**

```rust
pub mod camera;
pub mod sphere;
pub mod texture;
```

- [ ] **Step 2: Write `scene/camera.rs`**

```rust
use glam::Quat;
use std::f32::consts::PI;

pub const FOV_DEFAULT: f32 = 75.0;
pub const FOV_MIN: f32 = 30.0;
pub const FOV_MAX: f32 = 100.0;
pub const FOV_STEP: f32 = 3.0;
pub const FOV_LERP: f32 = 0.1;
pub const FOV_LERP_THRESHOLD: f32 = 0.01;
pub const PITCH_LIMIT: f32 = PI / 2.0 - 0.01;
pub const DRAG_SENSITIVITY: f32 = 0.0035;
pub const AUTO_ROTATE_SPEED: f32 = 0.05;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CameraState {
    pub yaw: f32,
    pub pitch: f32,
    pub current_fov: f32,
    pub target_fov: f32,
    pub auto_rotating: bool,
    pub has_fired_first_interaction: bool,
}

impl Default for CameraState {
    fn default() -> Self {
        Self {
            yaw: 0.0,
            pitch: 0.0,
            current_fov: FOV_DEFAULT,
            target_fov: FOV_DEFAULT,
            auto_rotating: true,
            has_fired_first_interaction: false,
        }
    }
}

impl CameraState {
    pub fn apply_drag(&mut self, dx: f32, dy: f32) {
        self.yaw += dx * DRAG_SENSITIVITY;
        self.pitch += dy * DRAG_SENSITIVITY;
        self.pitch = self.pitch.clamp(-PITCH_LIMIT, PITCH_LIMIT);
    }

    /// Returns true if first interaction fired this call.
    pub fn apply_wheel(&mut self, delta_y: f32) -> bool {
        let direction = if delta_y > 0.0 { 1.0 } else { -1.0 };
        self.target_fov = (self.target_fov + direction * FOV_STEP).clamp(FOV_MIN, FOV_MAX);
        self.fire_first_interaction()
    }

    /// Returns true if first interaction fired this call.
    pub fn fire_first_interaction(&mut self) -> bool {
        if self.has_fired_first_interaction {
            return false;
        }
        self.has_fired_first_interaction = true;
        self.auto_rotating = false;
        true
    }

    /// Advance state by `dt` seconds.
    pub fn update(&mut self, dt: f32) {
        if self.auto_rotating {
            self.yaw += AUTO_ROTATE_SPEED * dt;
        }
        if (self.target_fov - self.current_fov).abs() > FOV_LERP_THRESHOLD {
            self.current_fov += (self.target_fov - self.current_fov) * FOV_LERP;
        }
    }

    /// Camera position is fixed at origin. Returns the rotation as a quaternion
    /// (yaw around world Y, then pitch around local X).
    pub fn rotation(&self) -> Quat {
        let qy = Quat::from_rotation_y(self.yaw);
        let qx = Quat::from_rotation_x(self.pitch);
        qy * qx
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx_eq(a: f32, b: f32) -> bool {
        (a - b).abs() < 1e-4
    }

    #[test]
    fn default_state() {
        let c = CameraState::default();
        assert_eq!(c.yaw, 0.0);
        assert_eq!(c.pitch, 0.0);
        assert!(approx_eq(c.current_fov, FOV_DEFAULT));
        assert!(approx_eq(c.target_fov, FOV_DEFAULT));
        assert!(c.auto_rotating);
        assert!(!c.has_fired_first_interaction);
    }

    #[test]
    fn drag_accumulates_yaw_and_pitch() {
        let mut c = CameraState::default();
        c.apply_drag(100.0, 50.0);
        assert!(approx_eq(c.yaw, 100.0 * DRAG_SENSITIVITY));
        assert!(approx_eq(c.pitch, 50.0 * DRAG_SENSITIVITY));
    }

    #[test]
    fn pitch_clamps_to_positive_limit() {
        let mut c = CameraState::default();
        c.apply_drag(0.0, 1_000_000.0);
        assert!(approx_eq(c.pitch, PITCH_LIMIT));
    }

    #[test]
    fn pitch_clamps_to_negative_limit() {
        let mut c = CameraState::default();
        c.apply_drag(0.0, -1_000_000.0);
        assert!(approx_eq(c.pitch, -PITCH_LIMIT));
    }

    #[test]
    fn wheel_scroll_up_zooms_in() {
        let mut c = CameraState::default();
        c.apply_wheel(1.0);
        assert!(c.target_fov < FOV_DEFAULT);
    }

    #[test]
    fn wheel_scroll_down_zooms_out() {
        let mut c = CameraState::default();
        c.apply_wheel(-1.0);
        assert!(c.target_fov > FOV_DEFAULT);
    }

    #[test]
    fn wheel_clamps_at_min() {
        let mut c = CameraState::default();
        for _ in 0..100 {
            c.apply_wheel(1.0);
        }
        assert!(approx_eq(c.target_fov, FOV_MIN));
    }

    #[test]
    fn wheel_clamps_at_max() {
        let mut c = CameraState::default();
        for _ in 0..100 {
            c.apply_wheel(-1.0);
        }
        assert!(approx_eq(c.target_fov, FOV_MAX));
    }

    #[test]
    fn first_interaction_fires_once() {
        let mut c = CameraState::default();
        assert!(c.apply_wheel(1.0));
        assert!(!c.apply_wheel(1.0));
        assert!(!c.apply_wheel(-1.0));
        assert!(c.has_fired_first_interaction);
        assert!(!c.auto_rotating);
    }

    #[test]
    fn fov_lerp_moves_toward_target() {
        let mut c = CameraState::default();
        c.target_fov = FOV_MAX;
        let before = c.current_fov;
        c.update(0.016);
        assert!(c.current_fov > before);
        assert!(c.current_fov < FOV_MAX);
    }

    #[test]
    fn fov_lerp_settles_within_threshold() {
        let mut c = CameraState::default();
        c.target_fov = FOV_MAX;
        for _ in 0..1000 {
            c.update(0.016);
        }
        assert!((c.current_fov - c.target_fov).abs() < FOV_LERP_THRESHOLD);
    }

    #[test]
    fn auto_rotate_advances_yaw_over_time() {
        let mut c = CameraState::default();
        let before = c.yaw;
        c.update(1.0);
        assert!(approx_eq(c.yaw - before, AUTO_ROTATE_SPEED));
    }

    #[test]
    fn auto_rotate_stops_after_first_interaction() {
        let mut c = CameraState::default();
        c.fire_first_interaction();
        let before = c.yaw;
        c.update(1.0);
        assert!(approx_eq(c.yaw, before));
    }

    #[test]
    fn rotation_is_finite() {
        let c = CameraState::default();
        let q = c.rotation();
        assert!(q.x.is_finite() && q.y.is_finite() && q.z.is_finite() && q.w.is_finite());
    }
}
```

- [ ] **Step 2: Add `mod scene;` to `app.rs`**

Modify `vr-show/crates/vr-show/src/app.rs`, add `mod scene;` at the top after the existing `mod error;` reference. Update the file:

```rust
use crate::error::AppError;
use winit::application::ApplicationHandler;
use winit::event::WindowEvent;
use winit::event_loop::ActiveEventLoop;
use winit::window::WindowId;

mod scene;

#[derive(Default)]
pub struct App {
    _placeholder: (),
}

impl App {
    pub fn new() -> Result<Self, AppError> {
        Ok(Self { _placeholder: () })
    }
}

impl ApplicationHandler for App {
    fn resumed(&mut self, _event_loop: &ActiveEventLoop) {}
    fn window_event(
        &mut self,
        _event_loop: &ActiveEventLoop,
        _window_id: WindowId,
        _event: WindowEvent,
    ) {
    }
}
```

Note: `scene::sphere` and `scene::texture` don't exist yet, so add empty placeholders next.

- [ ] **Step 3: Create empty placeholders for `sphere.rs` and `texture.rs`**

Create `vr-show/crates/vr-show/src/scene/sphere.rs`:

```rust
// Implemented in a later task.
```

Create `vr-show/crates/vr-show/src/scene/texture.rs`:

```rust
// Implemented in a later task.
```

- [ ] **Step 4: Run the tests**

Run: `cd vr-show && cargo test --lib camera`
Expected: all 14 tests in `scene::camera::tests` pass.

- [ ] **Step 5: Commit**

```bash
git add crates/vr-show/src/scene/ crates/vr-show/src/app.rs
git commit -m "feat(scene): add CameraState with yaw/pitch/fov and unit tests"
```

---

## Task 5: Sphere mesh generation

**Files:**
- Modify: `vr-show/crates/vr-show/src/scene/sphere.rs`

- [ ] **Step 1: Write the sphere mesh generator with tests**

```rust
use glam::Vec3;

pub const SPHERE_RADIUS: f32 = 500.0;
pub const SPHERE_SEGMENTS: u32 = 64;

#[derive(Debug, Clone)]
pub struct SphereMesh {
    pub vertices: Vec<SphereVertex>,
    pub indices: Vec<u32>,
}

#[repr(C)]
#[derive(Debug, Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub struct SphereVertex {
    pub position: [f32; 3],
    pub uv: [f32; 2],
}

impl SphereVertex {
    pub const ATTRIBUTES: [wgpu::VertexAttribute; 2] = wgpu::vertex_attr_array![
        0 => Float32x3,
        1 => Float32x2,
    ];

    pub fn desc() -> wgpu::VertexBufferLayout<'static> {
        wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<SphereVertex>() as wgpu::BufferAddress,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &Self::ATTRIBUTES,
        }
    }
}

/// Build an inward-facing sphere mesh. UV: u=0..1 wraps around longitude,
/// v=0..1 goes from north pole (v=0) to south pole (v=1).
pub fn build_sphere(radius: f32, segments: u32) -> SphereMesh {
    let rings = segments;
    let sectors = segments;
    let mut vertices = Vec::with_capacity(((rings + 1) * (sectors + 1)) as usize);
    for r in 0..=rings {
        let v = r as f32 / rings as f32;
        let phi = v * std::f32::consts::PI;
        for s in 0..=sectors {
            let u = s as f32 / sectors as f32;
            let theta = u * 2.0 * std::f32::consts::PI;
            let x = -theta.sin() * phi.sin();
            let y = phi.cos();
            let z = theta.cos() * phi.sin();
            // Inward-facing: invert so the texture is visible from the inside.
            let pos = Vec3::new(x, y, z) * radius;
            vertices.push(SphereVertex {
                position: [pos.x, pos.y, pos.z],
                uv: [u, v],
            });
        }
    }
    let mut indices = Vec::with_capacity((rings * sectors * 6) as usize);
    for r in 0..rings {
        for s in 0..sectors {
            let a = r * (sectors + 1) + s;
            let b = a + sectors + 1;
            // Wind so that front faces point inward.
            indices.extend_from_slice(&[b, a, a + 1, b, a + 1, b + 1]);
        }
    }
    SphereMesh { vertices, indices }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vertex_count_matches_grid() {
        let m = build_sphere(SPHERE_RADIUS, SPHERE_SEGMENTS);
        let rings = SPHERE_SEGMENTS;
        let sectors = SPHERE_SEGMENTS;
        assert_eq!(m.vertices.len(), ((rings + 1) * (sectors + 1)) as usize);
    }

    #[test]
    fn index_count_matches_quads() {
        let m = build_sphere(SPHERE_RADIUS, SPHERE_SEGMENTS);
        assert_eq!(m.indices.len(), (SPHERE_SEGMENTS * SPHERE_SEGMENTS * 6) as usize);
    }

    #[test]
    fn uvs_span_zero_to_one() {
        let m = build_sphere(1.0, 4);
        let mut min_u = f32::INFINITY;
        let mut max_u = f32::NEG_INFINITY;
        let mut min_v = f32::INFINITY;
        let mut max_v = f32::NEG_INFINITY;
        for v in &m.vertices {
            min_u = min_u.min(v.uv[0]);
            max_u = max_u.max(v.uv[0]);
            min_v = min_v.min(v.uv[1]);
            max_v = max_v.max(v.uv[1]);
        }
        assert!(min_u.abs() < 1e-6);
        assert!((max_u - 1.0).abs() < 1e-6);
        assert!(min_v.abs() < 1e-6);
        assert!((max_v - 1.0).abs() < 1e-6);
    }

    #[test]
    fn all_vertices_on_sphere_surface() {
        let r = 123.4_f32;
        let m = build_sphere(r, 8);
        for v in &m.vertices {
            let p = Vec3::from(v.position);
            assert!((p.length() - r).abs() < 1e-3, "vertex off sphere: {:?}", p);
        }
    }

    #[test]
    fn vertex_size_matches_gpu_layout() {
        assert_eq!(std::mem::size_of::<SphereVertex>(), 5 * 4);
    }
}
```

- [ ] **Step 2: Run tests**

Run: `cd vr-show && cargo test --lib sphere`
Expected: 5 tests pass.

- [ ] **Step 3: Commit**

```bash
git add crates/vr-show/src/scene/sphere.rs
git commit -m "feat(scene): generate inward-facing sphere mesh with UVs"
```

---

## Task 6: Texture upload module

**Files:**
- Modify: `vr-show/crates/vr-show/src/scene/texture.rs`

- [ ] **Step 1: Write the texture module**

```rust
use crate::error::AppError;
use image::DynamicImage;

pub struct PanoramaTexture {
    pub texture: wgpu::Texture,
    pub view: wgpu::TextureView,
    pub sampler: wgpu::Sampler,
    pub width: u32,
    pub height: u32,
}

impl PanoramaTexture {
    pub fn from_image(device: &wgpu::Device, queue: &wgpu::Queue, image: &DynamicImage) -> Self {
        let rgba = image.to_rgba8();
        let (width, height) = rgba.dimensions();
        let size = wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        };
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("panorama_texture"),
            size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8UnormSrgb,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        queue.write_texture(
            wgpu::ImageCopyTexture {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &rgba,
            wgpu::ImageDataLayout {
                offset: 0,
                bytes_per_row: Some(4 * width),
                rows_per_image: Some(height),
            },
            size,
        );
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("panorama_sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::FilterMode::Nearest,
            ..Default::default()
        });
        Self {
            texture,
            view,
            sampler,
            width,
            height,
        }
    }
}

// Silence unused-import warning when AppError isn't used yet.
#[allow(dead_code)]
fn _ensure_app_error_in_scope(_: AppError) {}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd vr-show && cargo build`
Expected: compiles.

- [ ] **Step 3: Commit**

```bash
git add crates/vr-show/src/scene/texture.rs
git commit -m "feat(scene): upload panorama image to sRGB GPU texture"
```

---

## Task 7: File loading module with tests

**Files:**
- Create: `vr-show/crates/vr-show/src/file.rs`

- [ ] **Step 1: Write `file.rs`**

```rust
use crate::error::LoadError;
use image::DynamicImage;
use std::path::Path;

pub const ASPECT_TOLERANCE: f32 = 0.05;
pub const TARGET_ASPECT: f32 = 2.0;

pub fn load_panorama(path: &Path) -> Result<DynamicImage, LoadError> {
    let bytes = std::fs::read(path)
        .map_err(|e| LoadError::Io(path.to_path_buf(), e))?;
    let cursor = std::io::Cursor::new(bytes);
    let reader = image::ImageReader::new(cursor)
        .with_guessed_format()
        .map_err(|e| LoadError::Io(path.to_path_buf(), e))?;
    let format = reader.format();
    let img = reader
        .decode()
        .map_err(|source| LoadError::Decode { path: path.to_path_buf(), source })?;
    if !matches!(format, Some(image::ImageFormat::Png) | Some(image::ImageFormat::Jpeg)) {
        return Err(LoadError::NotAnImage(path.to_path_buf()));
    }
    Ok(img)
}

/// Returns Some(warning_message) if the aspect ratio deviates from 2:1 by more
/// than `ASPECT_TOLERANCE`. Returns None if the image is acceptably panoramic.
pub fn aspect_ratio_warning(image: &DynamicImage) -> Option<String> {
    let (w, h) = (image.width() as f32, image.height() as f32);
    let ratio = w / h;
    if (ratio - TARGET_ASPECT).abs() > ASPECT_TOLERANCE {
        Some(format!(
            "Image aspect ratio is {w}:{h}, not 2:1. It will display stretched."
        ))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb, RgbImage};

    fn tmp_dir() -> std::path::PathBuf {
        let mut dir = std::env::temp_dir();
        dir.push(format!("vr-show-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_png(path: &Path, w: u32, h: u32) {
        let mut img: RgbImage = ImageBuffer::new(w, h);
        for pixel in img.pixels_mut() {
            *pixel = Rgb([128, 64, 32]);
        }
        img.save(path).unwrap();
    }

    #[test]
    fn load_panorama_png_succeeds() {
        let dir = tmp_dir();
        let path = dir.join("pano.png");
        write_png(&path, 2048, 1024);
        let img = load_panorama(&path).unwrap();
        assert_eq!(img.width(), 2048);
        assert_eq!(img.height(), 1024);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn load_nonexistent_returns_io_error() {
        let result = load_panorama(Path::new("/nonexistent/path/file.png"));
        assert!(matches!(result, Err(LoadError::Io(_, _))));
    }

    #[test]
    fn aspect_warning_emitted_for_non_2to1() {
        let img = DynamicImage::new_rgb8(1024, 1024);
        let msg = aspect_ratio_warning(&img);
        assert!(msg.is_some());
        assert!(msg.unwrap().contains("1024:1024"));
    }

    #[test]
    fn aspect_warning_silent_for_2to1() {
        let img = DynamicImage::new_rgb8(2048, 1024);
        assert!(aspect_ratio_warning(&img).is_none());
    }

    #[test]
    fn aspect_warning_silent_within_tolerance() {
        // 2016x1024 is within 5% of 2:1.
        let img = DynamicImage::new_rgb8(2016, 1024);
        assert!(aspect_ratio_warning(&img).is_none());
    }
}
```

- [ ] **Step 2: Add `mod file;` to `main.rs`**

Modify `vr-show/crates/vr-show/src/main.rs`:

```rust
mod app;
mod error;
mod file;

use app::App;
use winit::event_loop::EventLoop;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    log::info!("vr-show starting");

    let event_loop = EventLoop::new()?;
    let mut app = App::new()?;
    event_loop.run_app(&mut app)?;

    Ok(())
}
```

- [ ] **Step 3: Run tests**

Run: `cd vr-show && cargo test --lib file`
Expected: 5 tests pass.

- [ ] **Step 4: Commit**

```bash
git add crates/vr-show/src/file.rs crates/vr-show/src/main.rs
git commit -m "feat(file): load panorama from disk and warn on non-2:1 aspect"
```

---

## Task 8: WGSL shaders

**Files:**
- Create: `vr-show/crates/vr-show/shaders/pano.vert.wgsl`
- Create: `vr-show/crates/vr-show/shaders/pano.frag.wgsl`

- [ ] **Step 1: Write the vertex shader**

Create `vr-show/crates/vr-show/shaders/pano.vert.wgsl`:

```wgsl
struct CameraUniform {
    view_proj: mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> camera: CameraUniform;

struct VertexIn {
    @location(0) position: vec3<f32>,
    @location(1) uv: vec2<f32>,
};

struct VertexOut {
    @builtin(position) clip_pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(in: VertexIn) -> VertexOut {
    var out: VertexOut;
    out.clip_pos = camera.view_proj * vec4<f32>(in.position, 1.0);
    out.uv = in.uv;
    return out;
}
```

- [ ] **Step 2: Write the fragment shader**

Create `vr-show/crates/vr-show/shaders/pano.frag.wgsl`:

```wgsl
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var tex: texture_2d<f32>;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    return textureSample(tex, samp, uv);
}
```

- [ ] **Step 3: Commit**

```bash
git add crates/vr-show/shaders/
git commit -m "feat(shaders): add WGSL vertex and fragment shaders for panorama"
```

---

## Task 9: Renderer (pipeline + draw)

**Files:**
- Create: `vr-show/crates/vr-show/src/renderer.rs`

- [ ] **Step 1: Write `renderer.rs`**

```rust
use crate::scene::camera::CameraState;
use crate::scene::sphere::{SphereMesh, SphereVertex, SPHERE_RADIUS, SPHERE_SEGMENTS};
use crate::scene::texture::PanoramaTexture;
use bytemuck::{Pod, Zeroable};
use glam::{Mat4, Vec3};

#[repr(C)]
#[derive(Debug, Clone, Copy, Pod, Zeroable)]
pub struct CameraUniform {
    pub view_proj: [[f32; 4]; 4],
}

pub struct Renderer {
    pub pipeline: wgpu::RenderPipeline,
    pub bind_group: wgpu::BindGroup,
    pub uniform_buffer: wgpu::Buffer,
    pub vertex_buffer: wgpu::Buffer,
    pub index_buffer: wgpu::Buffer,
    pub index_count: u32,
    pub sphere_mesh: SphereMesh,
}

impl Renderer {
    pub fn new(
        device: &wgpu::Device,
        surface_format: wgpu::TextureFormat,
        panorama: Option<&PanoramaTexture>,
    ) -> Self {
        // Sphere mesh.
        let sphere_mesh = SphereMesh::build_or_default(SPHERE_RADIUS, SPHERE_SEGMENTS);
        let vertex_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("sphere_vertex_buffer"),
            contents: bytemuck::cast_slice(&sphere_mesh.vertices),
            usage: wgpu::BufferUsages::VERTEX,
        });
        let index_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("sphere_index_buffer"),
            contents: bytemuck::cast_slice(&sphere_mesh.indices),
            usage: wgpu::BufferUsages::INDEX,
        });
        let index_count = sphere_mesh.indices.len() as u32;

        // Uniform buffer.
        let uniform_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("camera_uniform"),
            size: std::mem::size_of::<CameraUniform>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        // Texture + sampler. If no panorama yet, use a 1x1 black placeholder.
        let (texture_view, sampler) = match panorama {
            Some(p) => (p.view.clone(), p.sampler.clone()),
            None => {
                let tex = device.create_texture(&wgpu::TextureDescriptor {
                    label: Some("placeholder_texture"),
                    size: wgpu::Extent3d {
                        width: 1,
                        height: 1,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: wgpu::TextureFormat::Rgba8UnormSrgb,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                    view_formats: &[],
                });
                let view = tex.create_view(&wgpu::TextureViewDescriptor::default());
                let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
                    mag_filter: wgpu::FilterMode::Nearest,
                    min_filter: wgpu::FilterMode::Nearest,
                    ..Default::default()
                });
                (view, sampler)
            }
        };

        // Bind group layout.
        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("pano_bind_group_layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
            ],
        });

        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("pano_bind_group"),
            layout: &bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: uniform_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&sampler),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::TextureView(&texture_view),
                },
            ],
        });

        // Pipeline layout.
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("pano_pipeline_layout"),
            bind_group_layouts: &[&bind_group_layout],
            push_constant_ranges: &[],
        });

        // Shaders.
        let vert = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("pano_vert"),
            source: wgpu::ShaderSource::Wgsl(include_str!("../shaders/pano.vert.wgsl").into()),
        });
        let frag = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("pano_frag"),
            source: wgpu::ShaderSource::Wgsl(include_str!("../shaders/pano.frag.wgsl").into()),
        });

        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("pano_pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &vert,
                entry_point: Some("vs_main"),
                buffers: &[SphereVertex::desc()],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &frag,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: surface_format,
                    blend: Some(wgpu::BlendState::REPLACE),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                strip_index_format: None,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: None, // We render inward-facing; don't cull.
                polygon_mode: wgpu::PolygonMode::Fill,
                unclipped_depth: false,
                conservative: false,
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        });

        Self {
            pipeline,
            bind_group,
            uniform_buffer,
            vertex_buffer,
            index_buffer,
            index_count,
            sphere_mesh,
        }
    }

    /// Update the camera uniform from current state and write to GPU.
    pub fn update_camera(&self, queue: &wgpu::Queue, camera: &CameraState, aspect: f32) {
        let proj = Mat4::perspective_rh(camera.current_fov.to_radians(), aspect, 0.1, 1100.0);
        // Camera sits at origin looking down -Z; apply yaw then pitch on the
        // camera's orientation (i.e. the view matrix is the inverse of the
        // camera's world rotation). The world-up is +Y.
        let view_rot = camera.rotation();
        // The view matrix is the inverse of the camera's world transform.
        // Since the camera position is fixed at origin, the view rotation
        // equals the inverse of `view_rot`. glam's inverse() for a Quat is
        // conjugate() for unit quaternions.
        let view_rot_inv = view_rot.conjugate();
        let view = Mat4::from_quat(view_rot_inv);
        let view_proj = proj * view;
        let uniform = CameraUniform {
            view_proj: view_proj.to_cols_array_2d(),
        };
        queue.write_buffer(
            &self.uniform_buffer,
            0,
            bytemuck::cast_slice(&[uniform]),
        );
    }

    /// Recreate the bind group with a new panorama texture. Returns a new
    /// Renderer? — instead we mutate by replacing bind group.
    pub fn render<'a>(
        &'a self,
        encoder: &mut wgpu::CommandEncoder,
        view: &wgpu::TextureView,
    ) {
        let mut rpass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("pano_render_pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color { r: 0.04, g: 0.04, b: 0.04, a: 1.0 }),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
        });
        rpass.set_pipeline(&self.pipeline);
        rpass.set_bind_group(0, &self.bind_group, &[]);
        rpass.set_vertex_buffer(0, self.vertex_buffer.slice(..));
        rpass.set_index_buffer(self.index_buffer.slice(..), wgpu::IndexFormat::Uint32);
        rpass.draw_indexed(0..self.index_count, 0, 0..1);
    }
}

impl SphereMesh {
    /// Convenience constructor using the canonical radius/segments. The build
    /// logic lives in `sphere::build_sphere`; this method just centralizes the
    /// default args so `Renderer::new` doesn't need to import the constants.
    pub fn build_or_default(radius: f32, segments: u32) -> Self {
        crate::scene::sphere::build_sphere(radius, segments)
    }
}

// Bring `create_buffer_init` into scope without requiring a separate
// `wgpu::util::DeviceExt` import in callers.
mod device_ext {
    use wgpu::util::DeviceExt;
    pub use DeviceExt as _;
}
pub(crate) use device_ext::*;
```

- [ ] **Step 2: Add `wgpu::util::DeviceExt` to workspace dependencies**

Modify `vr-show/Cargo.toml` `[workspace.dependencies]` to ensure the util feature is enabled (it's part of the default `wgpu` features; verify by adding it to subcrate if needed).

In `vr-show/crates/vr-show/Cargo.toml`, change `wgpu = { workspace = true }` to add features:

```toml
wgpu = { workspace = true, features = ["wgsl"] }
```

(The workspace `wgpu` already enables `wgsl`, but being explicit doesn't hurt. The key is `wgpu::util::DeviceExt` is in `wgpu::util` module, available without extra features when `wgpu` itself is built — the import path is what matters.)

- [ ] **Step 3: Verify it compiles**

Run: `cd vr-show && cargo build`
Expected: compiles. Warnings about unused fields may appear; they are acceptable at this stage.

- [ ] **Step 4: Commit**

```bash
git add crates/vr-show/src/renderer.rs crates/vr-show/Cargo.toml
git commit -m "feat(renderer): wgpu pipeline for inward-facing sphere"
```

---

## Task 10: Window state (wgpu surface)

**Files:**
- Create: `vr-show/crates/vr-show/src/window.rs`

- [ ] **Step 1: Write `window.rs`**

```rust
use crate::error::AppError;
use winit::window::Window;
use winit::window::WindowAttributes;

pub struct WindowState {
    pub window: Window,
    pub surface: wgpu::Surface<'static>,
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
    pub config: wgpu::SurfaceConfiguration,
}

impl WindowState {
    pub fn new(event_loop: &winit::event_loop::ActiveEventLoop) -> Result<Self, AppError> {
        let window = event_loop
            .create_window(
                WindowAttributes::default()
                    .with_title("360° 全景图查看器")
                    .with_inner_size(winit::dpi::LogicalSize::new(1280.0, 800.0)),
            )
            .map_err(AppError::Window)?;

        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::all(),
            ..Default::default()
        });
        let surface = instance.create_surface(&window)?;
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::default(),
            compatible_surface: Some(&surface),
            force_fallback_adapter: false,
        }))
        .ok_or_else(|| AppError::RequestAdapter("no suitable adapter".into()))?;
        let (device, queue) = pollster::block_on(adapter.request_device(
            &wgpu::DeviceDescriptor {
                label: Some("vr-show_device"),
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::downlevel_defaults(),
                memory_hints: wgpu::MemoryHints::default(),
            },
            None,
        ))?;

        let surface_caps = surface.get_capabilities(&adapter);
        let surface_format = surface_caps
            .formats
            .iter()
            .copied()
            .find(|f| f.is_srgb())
            .unwrap_or(surface_caps.formats[0]);
        let size = window.inner_size();
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format: surface_format,
            width: size.width.max(1),
            height: size.height.max(1),
            present_mode: surface_caps.present_modes[0],
            alpha_mode: surface_caps.alpha_modes[0],
            view_formats: vec![],
            desired_maximum_frame_latency: 2,
        };
        surface.configure(&device, &config);

        Ok(Self {
            window,
            surface,
            device,
            queue,
            config,
        })
    }

    pub fn resize(&mut self, new_size: winit::dpi::PhysicalSize<u32>) {
        if new_size.width == 0 || new_size.height == 0 {
            return;
        }
        self.config.width = new_size.width;
        self.config.height = new_size.height;
        self.surface.configure(&self.device, &self.config);
    }

    pub fn aspect(&self) -> f32 {
        self.config.width as f32 / self.config.height as f32
    }

    pub fn surface_format(&self) -> wgpu::TextureFormat {
        self.config.format
    }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd vr-show && cargo build`
Expected: compiles.

- [ ] **Step 3: Commit**

```bash
git add crates/vr-show/src/window.rs
git commit -m "feat(window): create wgpu surface and device for the window"
```

---

## Task 11: Wire window + renderer into App and render a clear color

**Files:**
- Modify: `vr-show/crates/vr-show/src/app.rs`

- [ ] **Step 1: Replace `app.rs` with the full App struct**

```rust
use crate::error::AppError;
use crate::renderer::Renderer;
use crate::window::WindowState;
use winit::application::ApplicationHandler;
use winit::dpi::PhysicalSize;
use winit::event::WindowEvent;
use winit::event_loop::ActiveEventLoop;
use winit::window::WindowId;

pub struct App {
    window_state: Option<WindowState>,
    renderer: Option<Renderer>,
}

impl App {
    pub fn new() -> Result<Self, AppError> {
        Ok(Self {
            window_state: None,
            renderer: None,
        })
    }
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window_state.is_some() {
            return;
        }
        match WindowState::new(event_loop) {
            Ok(ws) => {
                let renderer = Renderer::new(&ws.device, ws.surface_format(), None);
                self.window_state = Some(ws);
                self.renderer = Some(renderer);
            }
            Err(e) => log::error!("Failed to create window: {e}"),
        }
    }

    fn window_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        _window_id: WindowId,
        event: WindowEvent,
    ) {
        let Some(ws) = &mut self.window_state else {
            return;
        };
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::Resized(size) => ws.resize(size),
            WindowEvent::RedrawRequested => {
                if let Some(renderer) = &self.renderer {
                    let frame = match ws.surface.get_current_texture() {
                        Ok(f) => f,
                        Err(wgpu::SurfaceError::Lost | wgpu::SurfaceError::Outdated) => {
                            let size = ws.window.inner_size();
                            ws.resize(size);
                            return;
                        }
                        Err(e) => {
                            log::error!("Surface error: {e}");
                            return;
                        }
                    };
                    let view = frame.texture.create_view(&wgpu::TextureViewDescriptor::default());
                    let mut encoder = ws.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
                        label: Some("frame_encoder"),
                    });
                    renderer.render(&mut encoder, &view);
                    ws.queue.submit(std::iter::once(encoder.finish()));
                    frame.present();
                }
                ws.window.request_redraw();
            }
            _ => {}
        }
    }
}

impl Default for App {
    fn default() -> Self {
        Self::new().expect("App::new only fails on winit::error::OsError, which is not normally reachable without a real display; on a headless build, this would surface via main's error path instead")
    }
}

// Use the size type to silence the unused-import warning if PhysicalSize
// isn't referenced yet. (Will be used in later tasks.)
#[allow(dead_code)]
fn _phantom_size(_: PhysicalSize<u32>) {}
```

- [ ] **Step 2: Run it**

Run: `cd vr-show && cargo run`
Expected: a window opens titled "360° 全景图查看器" with a dark gray background. Close the window to exit.

- [ ] **Step 3: Commit**

```bash
git add crates/vr-show/src/app.rs
git commit -m "feat(app): wire window + renderer, render clear color"
```

---

## Task 12: Input handling (drag, wheel, drop)

**Files:**
- Create: `vr-show/crates/vr-show/src/input.rs`

- [ ] **Step 1: Write `input.rs`**

```rust
use crate::error::LoadError;
use std::path::PathBuf;
use winit::dpi::PhysicalPosition;
use winit::event::{ElementState, MouseButton, MouseScrollDelta, TouchPhase, WindowEvent};

#[derive(Debug, Clone)]
pub enum InputAction {
    Drag { dx: f32, dy: f32 },
    Wheel { delta_y: f32 },
    FilesDropped(Vec<PathBuf>),
    CloseRequested,
    Resize { width: u32, height: u32 },
    FirstInteractionTriggered,
}

pub fn translate(event: &WindowEvent) -> Vec<InputAction> {
    let mut out = Vec::new();
    match event {
        WindowEvent::CloseRequested => out.push(InputAction::CloseRequested),
        WindowEvent::Resized(size) => out.push(InputAction::Resize {
            width: size.width,
            height: size.height,
        }),
        WindowEvent::MouseInput { state, button, .. } => {
            if *state == ElementState::Pressed && *button == MouseButton::Left {
                // We don't translate press/release; pointer-move below handles drag.
            }
        }
        WindowEvent::CursorMoved { .. } => {
            // Handled by the App via a stored last position; this module is
            // stateless so pointer-delta logic lives in App::window_event.
        }
        WindowEvent::MouseWheel { delta, .. } => {
            let delta_y = match delta {
                MouseScrollDelta::LineDelta(_x, y) => *y * 100.0,
                MouseScrollDelta::PixelDelta(PhysicalPosition { y, .. }) => *y,
            };
            out.push(InputAction::Wheel { delta_y });
        }
        WindowEvent::Touch(touch) => {
            if touch.phase == TouchPhase::Moved {
                // Touch drag is exposed as a "delta"; the App must track
                // last touch position to compute it.
            }
        }
        WindowEvent::DroppedFile(path) => out.push(InputAction::FilesDropped(vec![path.clone()])),
        WindowEvent::HoveredFileCancelled => {}
        _ => {}
    }
    out
}

/// Validate that a path looks like an image. Used by App when handling drops
/// and command-line arguments.
pub fn validate_image_path(path: &PathBuf) -> Result<(), LoadError> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase());
    match ext.as_deref() {
        Some("png") | Some("jpg") | Some("jpeg") => Ok(()),
        _ => Err(LoadError::NotAnImage(path.clone())),
    }
}
```

- [ ] **Step 2: Add `mod input;` to `main.rs`**

Modify `vr-show/crates/vr-show/src/main.rs`:

```rust
mod app;
mod error;
mod file;
mod input;

use app::App;
use winit::event_loop::EventLoop;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    log::info!("vr-show starting");

    let event_loop = EventLoop::new()?;
    let mut app = App::new()?;
    event_loop.run_app(&mut app)?;

    Ok(())
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd vr-show && cargo build`
Expected: compiles.

- [ ] **Step 4: Commit**

```bash
git add crates/vr-show/src/input.rs crates/vr-show/src/main.rs
git commit -m "feat(input): translate winit events to typed actions"
```

---

## Task 13: Wire input into App (drag, wheel, camera update)

**Files:**
- Modify: `vr-show/crates/vr-show/src/app.rs`

- [ ] **Step 1: Replace `app.rs` with the input-aware version**

```rust
use crate::error::AppError;
use crate::input::InputAction;
use crate::renderer::Renderer;
use crate::scene::camera::CameraState;
use crate::window::WindowState;
use winit::application::ApplicationHandler;
use winit::dpi::PhysicalPosition;
use winit::event::{ElementState, MouseButton, WindowEvent};
use winit::event_loop::ActiveEventLoop;
use winit::window::WindowId;

pub struct App {
    window_state: Option<WindowState>,
    renderer: Option<Renderer>,
    camera: CameraState,
    dragging: bool,
    last_pointer: Option<PhysicalPosition<f64>>,
    last_frame: Option<std::time::Instant>,
}

impl App {
    pub fn new() -> Result<Self, AppError> {
        Ok(Self {
            window_state: None,
            renderer: None,
            camera: CameraState::default(),
            dragging: false,
            last_pointer: None,
            last_frame: None,
        })
    }
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window_state.is_some() {
            return;
        }
        match WindowState::new(event_loop) {
            Ok(ws) => {
                let renderer = Renderer::new(&ws.device, ws.surface_format(), None);
                self.window_state = Some(ws);
                self.renderer = Some(renderer);
            }
            Err(e) => log::error!("Failed to create window: {e}"),
        }
    }

    fn window_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        _window_id: WindowId,
        event: WindowEvent,
    ) {
        // Pointer tracking: handle drag ourselves because translate() is stateless.
        match &event {
            WindowEvent::CursorMoved { position, .. } => {
                if self.dragging {
                    if let Some(prev) = self.last_pointer {
                        let dx = (position.x - prev.x) as f32;
                        let dy = (position.y - prev.y) as f32;
                        if dx != 0.0 || dy != 0.0 {
                            self.camera.apply_drag(dx, dy);
                            if self.camera.fire_first_interaction() {
                                log::info!("first interaction: drag");
                            }
                        }
                    }
                    self.last_pointer = Some(*position);
                }
            }
            WindowEvent::MouseInput { state, button, .. } => {
                if *button == MouseButton::Left {
                    match state {
                        ElementState::Pressed => {
                            self.dragging = true;
                            self.last_pointer = self
                                .window_state
                                .as_ref()
                                .and_then(|ws| ws.window.cursor_position().ok());
                        }
                        ElementState::Released => {
                            self.dragging = false;
                            self.last_pointer = None;
                        }
                    }
                }
            }
            _ => {}
        }

        // Typed events from the translator.
        for action in crate::input::translate(&event) {
            match action {
                InputAction::CloseRequested => event_loop.exit(),
                InputAction::Resize { width, height } => {
                    if let Some(ws) = &mut self.window_state {
                        ws.resize(winit::dpi::PhysicalSize::new(width, height));
                    }
                }
                InputAction::Wheel { delta_y } => {
                    if self.camera.apply_wheel(delta_y) {
                        log::info!("first interaction: wheel");
                    }
                }
                InputAction::FilesDropped(_paths) => {
                    // Loading from drop is handled in Task 14. For now log.
                    log::info!("file drop received (not yet wired)");
                }
                InputAction::FirstInteractionTriggered => {}
                InputAction::Drag { .. } => unreachable!("drag handled above"),
            }
        }

        // Render.
        if matches!(event, WindowEvent::RedrawRequested) {
            self.render_frame();
        }
    }
}

impl App {
    fn render_frame(&mut self) {
        let Some(ws) = &mut self.window_state else { return; };
        let Some(renderer) = &self.renderer else { return; };

        // Update camera state.
        let now = std::time::Instant::now();
        let dt = self
            .last_frame
            .map(|t| now.duration_since(t).as_secs_f32())
            .unwrap_or(0.016)
            .min(0.1); // clamp to avoid huge jumps on resume
        self.last_frame = Some(now);
        self.camera.update(dt);
        renderer.update_camera(&ws.queue, &self.camera, ws.aspect());

        // Acquire frame.
        let frame = match ws.surface.get_current_texture() {
            Ok(f) => f,
            Err(wgpu::SurfaceError::Lost | wgpu::SurfaceError::Outdated) => {
                let size = ws.window.inner_size();
                ws.resize(size);
                return;
            }
            Err(e) => {
                log::error!("Surface error: {e}");
                return;
            }
        };
        let view = frame.texture.create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = ws.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("frame_encoder"),
        });
        renderer.render(&mut encoder, &view);
        ws.queue.submit(std::iter::once(encoder.finish()));
        frame.present();
        ws.window.request_redraw();
    }
}

impl Default for App {
    fn default() -> Self {
        Self::new().expect(
            "App::new only fails on winit::error::OsError, which is not normally reachable",
        )
    }
}
```

- [ ] **Step 2: Verify it builds**

Run: `cd vr-show && cargo build`
Expected: compiles.

- [ ] **Step 3: Manual smoke test**

Run: `cd vr-show && cargo run`
Expected: a window opens. Click-drag in the window — the camera should rotate. Scroll wheel — FOV should change (no visible image yet, but the camera math runs). Close the window.

- [ ] **Step 4: Commit**

```bash
git add crates/vr-show/src/app.rs
git commit -m "feat(input): wire drag and wheel to CameraState"
```

---

## Task 14: File drop loading

**Files:**
- Modify: `vr-show/crates/vr-show/src/app.rs`
- Modify: `vr-show/crates/vr-show/src/renderer.rs`

- [ ] **Step 1: Add panorama storage to `App` and a replacement renderer**

Modify `vr-show/crates/vr-show/src/app.rs`. In the `App` struct, add:

```rust
    pub panorama: Option<crate::scene::texture::PanoramaTexture>,
```

Initialize it as `None` in `App::new`. Add a method `App::load_panorama(&mut self, path: &Path)`:

```rust
    pub fn load_panorama(&mut self, path: &std::path::Path) {
        let Some(ws) = &self.window_state else { return; };
        match crate::file::load_panorama(path) {
            Ok(image) => {
                if let Some(warning) = crate::file::aspect_ratio_warning(&image) {
                    log::warn!("{warning}");
                }
                let texture = crate::scene::texture::PanoramaTexture::from_image(
                    &ws.device,
                    &ws.queue,
                    &image,
                );
                // Recreate the renderer with the new texture.
                let renderer = Renderer::new(&ws.device, ws.surface_format(), Some(&texture));
                self.renderer = Some(renderer);
                self.panorama = Some(texture);
                // Reset camera: auto-rotate on for a fresh load.
                self.camera = CameraState::default();
                log::info!("loaded panorama: {}x{}", image.width(), image.height());
            }
            Err(e) => {
                log::error!("failed to load panorama {path:?}: {e}");
                // No banner UI yet; just log. The next task adds egui.
            }
        }
    }
```

- [ ] **Step 2: Wire `FilesDropped` action to the new method**

In the `InputAction::FilesDropped(_paths)` arm inside `window_event`, replace the `log::info!` with:

```rust
                InputAction::FilesDropped(paths) => {
                    if let Some(p) = paths.into_iter().next() {
                        self.load_panorama(&p);
                    }
                }
```

- [ ] **Step 3: Allow winit to deliver file-drop events**

In `WindowState::new` (Task 10), the default `WindowAttributes` already enables drag-and-drop on all three target platforms. No code change is needed, but verify the title/attributes set are not disabling it.

- [ ] **Step 4: Build and manual test**

Run: `cd vr-show && cargo run`
Expected: window opens. Drag the bundled `Qwen-Image-2512_00001_.png` from the file manager into the window. The image should appear wrapped inside the sphere and start auto-rotating. A warning about aspect ratio may appear in the console.

- [ ] **Step 5: Commit**

```bash
git add crates/vr-show/src/app.rs
git commit -m "feat(app): load panorama from drag-and-drop"
```

---

## Task 15: Command-line argument loading

**Files:**
- Modify: `vr-show/crates/vr-show/src/main.rs`

- [ ] **Step 1: Parse `argv[1]` and pass it to the App**

```rust
mod app;
mod error;
mod file;
mod input;

use app::App;
use winit::event_loop::EventLoop;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    log::info!("vr-show starting");

    let cli_path = std::env::args().nth(1).map(std::path::PathBuf::from);

    let event_loop = EventLoop::new()?;
    let mut app = App::new()?;
    if let Some(p) = cli_path {
        app.set_pending_load(p);
    }
    event_loop.run_app(&mut app)?;

    Ok(())
}
```

- [ ] **Step 2: Add `set_pending_load` and apply it in `App`**

In `vr-show/crates/vr-show/src/app.rs`, add a field to `App`:

```rust
    pending_load: Option<std::path::PathBuf>,
```

Initialize as `None` in `App::new`. Add method:

```rust
    pub fn set_pending_load(&mut self, path: std::path::PathBuf) {
        self.pending_load = Some(path);
    }
```

In `App::resumed`, after creating the window state and renderer, apply the pending load:

```rust
            Ok(ws) => {
                let renderer = Renderer::new(&ws.device, ws.surface_format(), None);
                self.window_state = Some(ws);
                self.renderer = Some(renderer);
                if let Some(p) = self.pending_load.take() {
                    self.load_panorama(&p);
                }
            }
```

- [ ] **Step 3: Build and manual test**

Run: `cd vr-show && cargo run --release -- ./Qwen-Image-2512_00001_.png`
Expected: window opens with the image already loaded (no need to drag).

- [ ] **Step 4: Commit**

```bash
git add crates/vr-show/src/main.rs crates/vr-show/src/app.rs
git commit -m "feat(cli): accept a panorama path on the command line"
```

---

## Task 16: egui integration (empty state, HUD, error banner)

**Files:**
- Create: `vr-show/crates/vr-show/src/ui.rs`
- Modify: `vr-show/crates/vr-show/src/app.rs`

- [ ] **Step 1: Write `ui.rs`**

```rust
use crate::error::LoadError;
use egui::{Align2, Color32, Context, FontId, Pos2, RichText, Stroke, Vec2};

#[derive(Debug, Clone)]
pub enum UiMessage {
    None,
    Error(String),
}

pub struct UiState {
    pub error_text: Option<String>,
    pub error_show_until: Option<std::time::Instant>,
    pub hud_show_until: Option<std::time::Instant>,
    pub has_panorama: bool,
}

impl Default for UiState {
    fn default() -> Self {
        Self {
            error_text: None,
            error_show_until: None,
            hud_show_until: None,
            has_panorama: false,
        }
    }
}

impl UiState {
    pub fn show_error(&mut self, message: String, duration_ms: u64) {
        self.error_text = Some(message);
        self.error_show_until = Some(
            std::time::Instant::now() + std::time::Duration::from_millis(duration_ms),
        );
    }

    pub fn show_hud(&mut self, duration_ms: u64) {
        self.hud_show_until = Some(
            std::time::Instant::now() + std::time::Duration::from_millis(duration_ms),
        );
    }

    pub fn show_panorama_loaded(&mut self) {
        self.has_panorama = true;
        self.show_hud(3000);
    }

    pub fn show_panorama_replaced(&mut self) {
        self.show_hud(3000);
    }

    pub fn error_for_load_error(e: &LoadError) -> String {
        match e {
            LoadError::NotAnImage(_) => "请拖入图片文件".to_string(),
            LoadError::Decode { .. } => "图片加载失败".to_string(),
            LoadError::Io(_, _) => "图片加载失败".to_string(),
        }
    }
}

pub fn draw(ctx: &Context, state: &UiState) {
    let now = std::time::Instant::now();
    let screen = ctx.screen_rect();
    let _ = screen; // keep variable; used implicitly by Area placement.

    // Error banner.
    if let (Some(text), Some(until)) = (&state.error_text, state.error_show_until) {
        if now < until {
            let painter = ctx.layer_painter(LayerId::new(
                egui::Order::Foreground,
                egui::Id::new("error_banner_layer"),
            ));
            let text_size = ctx.style().text_styles.get(&egui::TextStyle::Body).map(|f| f.size).unwrap_or(14.0);
            let galley = painter.layout_no_wrap(text.clone(), FontId::proportional(text_size), Color32::WHITE);
            let padding = Vec2::new(20.0, 10.0);
            let size = galley.size() + padding * 2.0;
            let pos = Pos2::new((ctx.screen_rect().width() - size.x) / 2.0, 16.0);
            let rect = egui::Rect::from_min_size(pos, size);
            painter.rect_filled(rect, 8.0, Color32::from_rgb(229, 72, 77));
            painter.galley(rect.min + padding, galley, Color32::WHITE);
        }
    }

    // Empty state.
    if !state.has_panorama {
        let painter = ctx.layer_painter(LayerId::new(
            egui::Order::Background,
            egui::Id::new("empty_state_layer"),
        ));
        let rect = ctx.screen_rect();
        painter.rect_filled(rect, 0.0, Color32::from_rgb(10, 10, 10));

        let frame = egui::Rect::from_center_size(
            rect.center(),
            Vec2::new(rect.width() * 0.4, 240.0),
        );
        painter.rect_stroke(
            frame.expand(2.0),
            0.0,
            Stroke::new(2.0, Color32::from_rgb(42, 42, 42)),
        );

        let title = RichText::new("拖入一张全景图")
            .font(FontId::proportional(20.0))
            .color(Color32::from_rgb(224, 224, 224));
        let sub = RichText::new("或将图片拖到此处 · 点击选择文件")
            .font(FontId::proportional(14.0))
            .color(Color32::from_rgb(136, 136, 136));

        painter.text(
            frame.center() + Vec2::new(0.0, -10.0),
            Align2::CENTER_CENTER,
            title.text(),
            FontId::proportional(20.0),
            Color32::from_rgb(224, 224, 224),
        );
        painter.text(
            frame.center() + Vec2::new(0.0, 16.0),
            Align2::CENTER_CENTER,
            sub.text(),
            FontId::proportional(14.0),
            Color32::from_rgb(136, 136, 136),
        );
    }

    // HUD.
    if let Some(until) = state.hud_show_until {
        if now < until {
            let painter = ctx.layer_painter(LayerId::new(
                egui::Order::Foreground,
                egui::Id::new("hud_layer"),
            ));
            let text = "拖动旋转 · 滚轮缩放";
            let text_size = 13.0;
            let galley = painter.layout_no_wrap(text.to_string(), FontId::proportional(text_size), Color32::from_rgb(136, 136, 136));
            let padding = Vec2::new(16.0, 8.0);
            let size = galley.size() + padding * 2.0;
            let pos = Pos2::new(
                (ctx.screen_rect().width() - size.x) / 2.0,
                ctx.screen_rect().height() - size.y - 24.0,
            );
            let rect = egui::Rect::from_min_size(pos, size);
            painter.rect_filled(rect, 20.0, Color32::from_rgba_unmultiplied(10, 10, 10, 153));
            painter.galley(rect.min + padding, galley, Color32::from_rgb(136, 136, 136));
        }
    }
}

// Re-export LayerId so we don't need to add the path in the function above.
use egui::LayerId;
```

- [ ] **Step 2: Add egui state to App and render UI each frame**

In `vr-show/crates/vr-show/src/app.rs`, add fields:

```rust
    egui_ctx: Option<egui::Context>,
    egui_state: egui_wgpu::Renderer,
    egui_winit: egui_winit::State,
    ui_state: crate::ui::UiState,
```

(Note: the actual `egui_wgpu::Renderer` field name and `egui_winit::State` struct name will be the ones used by the egui 0.32 / egui-wgpu 0.32 / egui-winit 0.32 APIs. Adjust if the exact import paths differ; see step 3 for the imports.)

Add `egui-winit = "0.32"` to `Cargo.toml` workspace and subcrate dependencies.

In `App::new`, initialize:

```rust
            egui_ctx: None,
            egui_state: todo!(), // populated in `resumed` after we have a device.
            egui_winit: todo!(),
            ui_state: crate::ui::UiState::default(),
```

In `App::resumed`, after creating the renderer, create the egui context and renderer:

```rust
            let egui_ctx = egui::Context::default();
            let egui_state = egui_wgpu::Renderer::new(
                &ws.device,
                ws.surface_format(),
                None,
                1,
                false,
            );
            let egui_winit = egui_winit::State::new(
                egui_ctx.clone(),
                egui::viewport::ViewportId::ROOT,
                &ws.window,
                None,
                None,
                None,
            );
            self.egui_ctx = Some(egui_ctx);
            self.egui_state = egui_state;
            self.egui_winit = egui_winit;
```

In `App::render_frame`, after `renderer.render(&mut encoder, &view)` and before `ws.queue.submit`, render egui:

```rust
        if let Some(ctx) = &self.egui_ctx {
            let raw_input = self.egui_winit.take_egui_input(&ws.window);
            ctx.begin_frame(raw_input);
            crate::ui::draw(ctx, &self.ui_state);
            let output = ctx.end_frame();
            let paint_jobs = ctx.tessellate(output.shapes, output.pixels_per_point);
            for (id, image_delta) in &output.textures_delta.set {
                self.egui_state.update_texture(&ws.device, &ws.queue, *id, image_delta);
            }
            self.egui_state.update_buffers(
                &ws.device,
                &ws.queue,
                &mut encoder,
                &paint_jobs,
                &output.screen_size(),
            );
            // Draw egui in a second render pass onto the same view.
            let mut rpass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("egui_render_pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Load,
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            self.egui_state.render(&mut rpass, &paint_jobs, &output.screen_size());
        }
```

In `App::window_event`, forward pointer/keyboard events to egui BEFORE the existing logic. At the top of the function:

```rust
        if let Some(ws) = &self.window_state {
            let response = self.egui_winit.on_window_event(&ws.window, &event);
            if response.consumed {
                return;
            }
        }
```

When the panorama loads successfully, call:

```rust
            self.ui_state.show_panorama_loaded();
```

When replacing a panorama, call:

```rust
            self.ui_state.show_panorama_replaced();
```

When `load_panorama` errors, convert the error and show the banner:

```rust
            Err(e) => {
                let msg = crate::ui::UiState::error_for_load_error(&e);
                self.ui_state.show_error(msg, 3000);
            }
```

- [ ] **Step 3: Add egui-winit dependency**

In `vr-show/Cargo.toml` `[workspace.dependencies]`, add:

```toml
egui-winit = "0.32"
```

In `vr-show/crates/vr-show/Cargo.toml`, add `egui-winit = { workspace = true }` under `[dependencies]`.

- [ ] **Step 4: Build, fix any API mismatches**

Run: `cd vr-show && cargo build`
Expected: it may take a few iterations. The egui-wgpu 0.32 `Renderer::new` signature has the form:
```rust
egui_wgpu::Renderer::new(
    device: &wgpu::Device,
    output_format: wgpu::TextureFormat,
    output_depth_format: Option<wgpu::TextureFormat>,
    msaa_samples: u32,
    screen_descriptor: egui_wgpu::renderer::ScreenDescriptor,
) -> Self
```
Adjust the call site as needed by referring to the egui-wgpu 0.32 docs or `cargo doc`. Common adjustments: the `Renderer::new` in some versions takes `(device, output_format, depth_format, msaa_samples)`; in others it takes a `ScreenDescriptor` first. Use `cargo doc -p egui-wgpu --open` if needed. The above snippet is the most common 0.32 signature — if compilation fails, refer to the actual definition in the resolved crate.

- [ ] **Step 5: Manual smoke test**

Run: `cd vr-show && cargo run --release -- ./Qwen-Image-2512_00001_.png`
Expected: the empty state appears briefly, then the panorama loads and the HUD shows "拖动旋转 · 滚轮缩放" for 3 seconds. Drag a `.txt` file onto the window — the error banner appears with "请拖入图片文件" for 3 seconds. Resize the window — egui reflows correctly.

- [ ] **Step 6: Commit**

```bash
git add crates/vr-show/src/ui.rs crates/vr-show/src/app.rs crates/vr-show/Cargo.toml vr-show/Cargo.toml
git commit -m "feat(ui): egui-wgpu overlay with empty state, HUD, and error banner"
```

---

## Task 17: Cleanup pass and final verification

**Files:**
- Update: `vr-show/.gitignore` (already correct from Task 1)
- Update: `vr-show/README.md` (new)
- Update: `vr-show/TESTING.md` (rewrite for Rust version)
- Verify: no JS/TS/HTML/CSS/Node artifacts remain

- [ ] **Step 1: Write a new `README.md`**

Create `vr-show/README.md`:

```markdown
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
```

- [ ] **Step 2: Write a new `TESTING.md` (replaces the web/desktop checklist)**

Create `vr-show/TESTING.md`:

```markdown
# Manual Testing Checklist

## Setup

1. `cargo build --release`
2. `cargo run --release -- ./Qwen-Image-2512_00001_.png`

The bundled `Qwen-Image-2512_00001_.png` is a 2:1 equirectangular image suitable for testing.

## Scenarios

### 1. Empty state on launch
- [ ] Launch with no arguments.
- [ ] The window opens at ~1280×800 with a centered dashed-border card.
- [ ] The card shows "拖入一张全景图" and "或将图片拖到此处 · 点击选择文件".

### 2. Load image by drop
- [ ] Drag `Qwen-Image-2512_00001_.png` from the file manager into the window.
- [ ] Empty state disappears; panorama fills the window.
- [ ] HUD "拖动旋转 · 滚轮缩放" appears for ~3 seconds.

### 3. Drag to rotate
- [ ] Click and drag horizontally → camera yaws.
- [ ] Click and drag vertically → camera pitches.
- [ ] Drag toward the top → pitch stops near +89° (no flip).
- [ ] Cursor changes to `grabbing` (if the system supports it) during drag.

### 4. Wheel zoom
- [ ] Scroll up → FOV decreases (zooms in).
- [ ] Scroll down → FOV increases (zooms out).
- [ ] FOV clamps at 30° / 100°.

### 5. Auto-rotate stops on first interaction
- [ ] After loading, the scene rotates on its own.
- [ ] First pointer-down or wheel event stops rotation.

### 6. HUD auto-hide
- [ ] HUD appears for ~3 seconds after loading.
- [ ] It fades out without further interaction.

### 7. Load a second image
- [ ] Drop a different image; it replaces the first cleanly.
- [ ] HUD reappears.
- [ ] Auto-rotate does NOT restart.

### 8. Non-image file shows error
- [ ] Drop a `.pdf` or `.txt` file.
- [ ] Red error banner appears with "请拖入图片文件" for ~3 seconds.
- [ ] The viewer state is unchanged.

### 9. Command-line argument
- [ ] `cargo run --release -- ./some.png` loads the image at startup without dropping.

### 10. Non-2:1 image loads with warning
- [ ] Drop a non-2:1 image (e.g. a 1024×1024 photo).
- [ ] The image still displays (stretched).
- [ ] A warning is printed to stderr: `Image aspect ratio is 1024:1024, not 2:1. It will display stretched.`

### 11. Window resize
- [ ] Resize the window.
- [ ] Canvas fills the new size; image is not stretched.

### 12. Clean exit
- [ ] Close the window via the OS close button.
- [ ] Process exits; no orphan processes remain.

## Unit tests

Run `cargo test`. The following modules have tests:
- `scene::camera` (yaw/pitch/FOV math, first-interaction guard)
- `scene::sphere` (vertex/index counts, UV range, surface distance)
- `file` (PNG load, aspect ratio warning, IO error)
```

- [ ] **Step 3: Verify no JS/TS/HTML/CSS/Node artifacts remain**

Run:

```bash
cd vr-show
! find . -path ./target -prune -o -path ./docs -prune -o -path ./.superpowers -prune -o -path ./.git -prune -o -type f \( -name '*.js' -o -name '*.jsx' -o -name '*.ts' -o -name '*.tsx' -o -name '*.html' -o -name '*.css' -o -name 'package.json' -o -name 'package-lock.json' -o -name 'node_modules' -o -name 'vite.config.*' \) -print
```

Expected: no output (find found nothing).

- [ ] **Step 4: Run the full test suite**

Run: `cd vr-show && cargo test`
Expected: all tests in `scene::camera`, `scene::sphere`, and `file` pass.

- [ ] **Step 5: Final release build**

Run: `cd vr-show && cargo build --release`
Expected: builds successfully. Binary at `target/release/vr-show`.

- [ ] **Step 6: Commit**

```bash
git add README.md TESTING.md
git commit -m "docs: replace web-era docs with pure-Rust equivalents"
```
