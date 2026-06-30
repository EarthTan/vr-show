# 纯 Rust 移植 — 设计文档

**日期**：2026-06-29
**项目**：`vr-show/`
**前置文档**：`2026-06-25-360-pano-viewer-design.md`、`2026-06-25-desktop-package-design.md`

## 目的

把 360° 全景图查看器从「Vite + Three.js + Tauri 2」前端栈**完全重写**为单一 Rust 原生桌面应用。删除所有 JS / TS / HTML / CSS / Node 依赖。最终产物是一个 `cargo build --release` 直接产出的二进制，跨 macOS / Windows / Linux 三个桌面平台运行。

## 动机

1. 减少技术栈：当前一个简单应用经过 6 层（Rust → Tauri webview → HTML → CSS → JS → WebGL），运行时跨越 C++/JS/着色器三种语言。
2. 单一语言：项目主体 ~400 行 JS + ~9 行 Rust。所有逻辑统一到 Rust。
3. 摆脱 webview 依赖：避免 Tauri 在 Linux 上 WebKitGTK 版本要求、macOS Gatekeeper 等待 webview 启动等运行时问题。
4. 真正的原生体验：启动更快、内存占用更低、UI 响应更跟手。

## 范围

**包含**
- 完整的视觉/交互行为与现有 web 版一致（见下方"行为兼容"小节）
- 从文件管理器拖拽图片到窗口加载
- 命令行参数打开文件
- 单元测试覆盖关键业务逻辑
- macOS / Windows / Linux 三平台可构建可运行

**不包含（YAGNI）**
- 移动端（iOS / Android）
- 触屏 / 陀螺仪 / WebXR
- 安装包（`.dmg` / `.msi` / `.deb`）—— 第一版只交付 `cargo build` 产物；后续可加 `cargo-bundle`
- 多图库、缩略图、历史
- 截图、标注、测距
- 自动更新、设置面板、主题切换
- 任何网络功能

## 行为兼容（与现有 web 版 1:1）

从 web 版复刻到 Rust 版的可见行为，必须保持一致：

1. **空状态**：启动后黑底居中显示「拖入一张全景图 / 或将图片拖到此处 · 点击选择文件」，虚线灰边框。
2. **加载方式**：拖放 + 文件选择对话框（点击空状态触发）。
3. **拖动旋转**：水平 yaw 无限制；垂直 pitch 钳制在 ±(π/2 - 0.01) 弧度（约 ±89°）。拖动时光标变 `grabbing`，松开恢复 `grab`。
4. **滚轮缩放**：FOV 在 30° ~ 100° 之间，每滚一次步进 3°，向 target FOV 平滑过渡（lerp 系数 0.1）。
5. **自动旋转**：加载图片后场景绕 Y 轴自动旋转，角速度 0.05 rad/s。首次 pointer-down 或 wheel 事件触发后立即停止。
6. **HUD**：加载图片后底部居中显示「拖动旋转 · 滚轮缩放」，3 秒后自动淡出。
7. **错误横幅**：非图片文件（`type` 不以 `image/` 开头）显示「请拖入图片文件」红条 3 秒；图片解码失败显示「图片加载失败」3 秒。
8. **多次加载**：加载新图时正确释放旧图资源（纹理、几何、材质），不留闪烁、不重新触发自动旋转。
9. **非 2:1 图片**：仍能加载（显示会拉伸），但向 stderr 输出警告 `Image aspect ratio is W:H, not 2:1. It will display stretched.`。
10. **窗口缩放**：canvas 随窗口大小变化，比例正确。
11. **退出**：关闭按钮干净退出，无残留进程。

## 技术栈

| 用途 | Crate | 版本 | 备注 |
|---|---|---|---|
| 窗口 / 事件循环 | `winit` | 0.30 | 用 `ApplicationHandler` trait，事件驱动 |
| GPU 抽象 | `wgpu` | 27 | Vulkan / Metal / DX12 / GLES，WGSL 着色器。spec 原计划 wgpu 29，实施时实测 `naga 26.x` 在 rustc ≥ 1.86 上因 `codespan-reporting` 兼容性问题无法编译（[gfx-rs/wgpu#7968](https://github.com/gfx-rs/wgpu/issues/7968)），回退到 wgpu 27（含修复） |
| 数学 | `glam` | 0.29 | 矩阵、向量、四元数，glam 已是 wgpu 生态默认 |
| 图像解码 | `image` | 0.25 | PNG / JPEG / WebP，统一接口 |
| UI 框架 | `egui` | 0.33 | 即时模式 UI，纯 Rust。`egui-wgpu` + `egui-winit` 也用 0.33 系列。后续升级时四者一起升 |
| 字体（egui 自带） | `egui` 默认 | — | 不用加载外部字体 |
| 错误处理 | `thiserror` | 2 | 应用层错误类型 |
| 日志 | `log` + `env_logger` | 0.4 / 0.11 | 警告输出到 stderr |
| 序列化（如需） | — | — | 第一版不需要 |

**不引入**：`tauri`、`tao`、`wgpu_glyph`、`glyphon`、`iced`、`fltk`、`anyhow`（用 `thiserror` + `Result<T, AppError>`）、`tokio`（单线程同步即可）、`rfd`（第一版不弹原生文件对话框，统一通过拖拽 + 命令行打开；如未来需要再添加）。

**Rust MSRV**:1.88(wgpu 27 和 egui 0.33 的共同下限)。

## 架构

单一二进制 crate，工作区布局：

```
vr-show/
├── Cargo.toml              # workspace 根
├── docs/superpowers/specs/
├── README.md
└── crates/
    └── vr-show/            # 唯一 crate
        ├── Cargo.toml
        ├── src/
        │   ├── main.rs          # 入口：winit EventLoop + App
        │   ├── app.rs           # App 状态机
        │   ├── window.rs        # winit 窗口 + wgpu surface 初始化
        │   ├── renderer.rs      # wgpu device/queue/pipeline 持有
        │   ├── scene/
        │   │   ├── mod.rs
        │   │   ├── sphere.rs    # 球面网格生成
        │   │   ├── camera.rs    # yaw/pitch/FOV 状态
        │   │   └── texture.rs   # 从 image::DynamicImage 上传到 wgpu
        │   ├── input.rs         # 拖拽 + 鼠标 + 滚轮事件 → camera 状态
        │   ├── file.rs          # 加载文件 → DynamicImage，错误处理
        │   ├── ui.rs            # egui 上下文 + 空状态/错误/HUD
        │   └── error.rs         # AppError 类型
        ├── tests/               # 集成测试
        └── examples/            # （空）
```

### 模块职责（每个单元一个清晰职责）

**`main.rs`** —— 创建 `EventLoop`，构造 `App`，运行。**不超过 30 行**。

**`app.rs`** —— 实现 `ApplicationHandler`。持有：`Window`、`WindowState`(wgpu surface/device/queue)、`Renderer`、`Scene`、`Ui`、`InputState`。所有状态变更的协调者。`window_event` / `about_to_wait` 分发到子模块。

**`window.rs`** —— `WindowState::new(event_loop) -> Self`：创建 `Window`、配置 `wgpu::Instance`、请求 `Adapter`、创建 `Device` + `Queue`、创建 `Surface`、配置 `SurfaceConfiguration`。提供 `resize(new_size)` 和 `render() -> Result<SurfaceTexture>`。

**`renderer.rs`** —— 持有 wgpu 资源：球面 mesh 的 vertex/index buffer、纹理、uniform buffer、`RenderPipeline`、bind group。提供 `render(encoder, view, &scene)`。**不**做场景逻辑。

**`scene/sphere.rs`** —— 纯函数 `build_sphere(radius, segments) -> SphereMesh { vertices, indices }`。CPU 端生成。**不**依赖 wgpu，可单元测试。

**`scene/camera.rs`** —— `CameraState { yaw, pitch, target_fov, current_fov, auto_rotating, has_fired_first_interaction }`。方法：`update(dt)`（自动旋转 + FOV lerp）、`apply_drag(dx, dy)`、`apply_wheel(delta)`、`fire_first_interaction()`。**不**依赖 wgpu，可单元测试。

**`scene/texture.rs`** —— `upload_texture(device, queue, &image::DynamicImage) -> TextureAndView`。RGBA8 + sRGB 格式。

**`input.rs`** —— 把 winit 事件翻译成 camera 状态变化。**不**调用 camera 直接，而是返回 `InputAction` 枚举让 `app.rs` 决定。

**`file.rs`** —— `load_panorama(path: &Path) -> Result<DynamicImage, LoadError>`：打开文件、用 `image::ImageReader` 嗅探格式、解码、检查宽高比、输出警告。`LoadError` 枚举：`NotAnImage`、`DecodeFailed`、`IoError(io::Error)`。

**`ui.rs`** —— egui 集成：每帧 `ctx.run(raw_input, |ui| { ... })`。绘制空状态、错误横幅、HUD 提示。通过 channel/callback 与 `App` 通信（点击空状态 → 触发文件选择对话框）。

**`error.rs`** —— `AppError` 枚举：`Window(WindowError)`、`Gpu(wgpu::Error)`、`File(LoadError)`、`EventLoop(winit::error::EventLoopError)`。`From` impl 各子类型。

### 数据流（每帧）

```
EventLoop::run_app(&mut app)
    ↓
app.about_to_wait() / app.window_event()
    ↓
input::translate(event) → Vec<InputAction>
    ↓
app 处理 InputAction:
    - PointerDrag(dx, dy)  → camera.apply_drag()
    - Wheel(delta)         → camera.apply_wheel()
    - FileDropped(path)    → file::load() → scene::texture::upload() → scene.replace_pano()
    - KeyEsc               → event_loop.exit()
    ↓
app.window_event(RedrawRequested) OR app.about_to_wait()：
    ↓
window_state.render() → SurfaceTexture
    ↓
renderer.render(encoder, view, &scene)    # 球面 + 纹理
    ↓
ui.render(ctx, &mut encoder, view)         # egui 叠加
    ↓
queue.submit([encoder.finish()])
```

### 资源释放

`scene.replace_pano(new_image)` 必须：
- 旧的 `wgpu::Texture` drop（wgpu 句柄引用计数归零后 GPU 资源释放）
- 旧的 `wgpu::Buffer`（uniform）drop
- 旧 mesh 顶点的 `wgpu::Buffer` 保留（球面几何不变）—— 实际上不需要重建球面，所以这部分 buffer 一次创建永驻

## UI（egui 用法）

egui 在 GPU 层面是「画 2D 三角形 + 文字」到同一个 wgpu surface。集成方式：

1. `egui::Context::new()` 创建上下文
2. `egui_wgpu::Renderer::new(device, surface_format, depth_format, 1)` 创建 wgpu 渲染后端
3. 每帧：`ctx.begin_frame()` → 跑用户闭包绘制 UI → `ctx.end_frame()` → 拿到 `egui::FullOutput` → 喂给 `egui_wgpu::Renderer` → 拿到 `Vec<egui::epaint::ClippedPrimitive>` → encode render pass

**UI 元素映射**：

| 原 web 版 | Rust 版（egui） |
|---|---|
| `<div id="empty-state">` 居中卡片 | `egui::CentralPanel` 透明背景 + 内部 `egui::Frame` 渲染虚线框 + 文字 |
| `<div id="hud">` 底部居中提示 | `egui::Area` 锚点 `Bottom` + 居中 `Label` |
| `<div id="error-banner">` 顶部红条 | `egui::Area` 锚点 `Top` + 红色背景 `Label` |
| `<input type="file">` 触发 | 暂不实现 GUI 文件按钮；靠拖拽 + 命令行参数。egui 端点击空状态可以打开原生文件对话框（用 `rfd` crate —— 但这是新依赖） |

**关于 rfd（文件对话框）的决定**：
- 第一版**不**用 `rfd`。空状态点击不响应，或响应但不打开文件对话框（用日志提示用户拖拽）。
- 理由：少一个依赖；当前 web 版点击空状态是「触发 file input」语义，Rust 版要触发文件对话框就必须跨平台写代码。拖拽 + 命令行已覆盖核心场景。
- **可接受？** —— 这点写在这里等用户 review 时确认。

如果确认不引 rfd，空状态点击区域不响应点击事件（或响应并仅在 stderr 输出 "请拖拽文件到窗口"）。

## 着色器（WGSL）

只需要两个着色器，球面渲染 + egui 渲染（egui 自带）。球面着色器是核心：

**顶点着色器 `pano.vert.wgsl`**：
```wgsl
struct Camera {
    view_proj: mat4x4<f32>,
    yaw: f32, pitch: f32, _pad0: f32, _pad1: f32,
}
@group(0) @binding(0) var<uniform> camera: Camera;

struct VertexIn {
    @location(0) position: vec3<f32>,
    @location(1) uv: vec2<f32>,
}

struct VertexOut {
    @builtin(position) clip_pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

@vertex
fn vs_main(in: VertexIn) -> VertexOut {
    var out: VertexOut;
    out.clip_pos = camera.view_proj * vec4<f32>(in.position, 1.0);
    out.uv = in.uv;
    return out;
}
```

**片元着色器 `pano.frag.wgsl`**：
```wgsl
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var tex: texture_2d<f32>;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    return textureSample(tex, samp, uv);
}
```

着色器用 `include_str!` 嵌入二进制，零运行时依赖。

**视图投影矩阵**：相机位置固定在原点，朝向由 yaw/pitch 决定（绕 Y 轴 yaw，绕相机局部 X 轴 pitch）。视图矩阵从 `Camera::look_at_origin(yaw, pitch)` 推导。**背面剔除关掉**，因为相机在球**内部**。**深度测试关掉**（始终在背景绘制，UI 叠加）。

## 色彩管线

- 纹理格式：`wgpu::TextureFormat::Rgba8UnormSrgb`
- surface 格式：`wgpu::TextureFormat::Bgra8UnormSrgb`（或 swapchain 实际格式）—— sRGB view
- wgpu 26+ 默认 sRGB 工作流，无需手动 gamma 转换

**与 web 版完全一致**。

## 错误处理

```rust
// src/error.rs
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("window creation failed: {0}")]
    Window(#[from] winit::error::OsError),

    #[error("event loop error: {0}")]
    EventLoop(#[from] winit::error::EventLoopError),

    #[error("GPU error: {0}")]
    Gpu(#[from] wgpu::Error),

    #[error("GPU request adapter/device failed: {0}")]
    GpuRequest(String),

    #[error("surface error: {0}")]
    Surface(#[from] wgpu::CreateSurfaceError),
}

// src/file.rs
#[derive(Debug, thiserror::Error)]
pub enum LoadError {
    #[error("not an image file: {0}")]
    NotAnImage(String),

    #[error("decode failed: {0}")]
    DecodeFailed(#[from] image::ImageError),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}
```

应用层 `Result<T, AppError>`。错误时把消息传给 `ErrorBanner` UI 显示，**不** panic。

## 测试策略

**单元测试**（`cargo test`，无窗口/GPU 依赖）：
- `scene/sphere.rs`：球面顶点数 / 索引数 / UV 范围 / 法线方向（朝外）
- `scene/camera.rs`：拖动数学、pitch 钳制、FOV 钳制与 lerp、自动旋转速度、首次交互标志
- `file.rs`：PNG 正常加载、非图片错误、宽高比警告触发条件

**集成测试**（`cargo test`，需要 GPU）—— **跳过**：在没有 GPU 的 CI 上不可行。第一版**不做**集成测试。

**手工 smoke**（更新 `TESTING.md` 沿用 web 版的 10 场景 + D11-D15 桌面场景）—— Rust 版等价验证。

## 构建与发布

**第一版交付**：
- `cargo build --release` 在三个平台各产生一个可执行文件
- `cargo install --path .` 可从源码安装
- 不做 `.dmg` / `.msi` / `.deb` / `.AppImage` 打包

**后续可加**（不在本设计范围）：
- `cargo-bundle` 或 `cargo-packager` 出安装包
- `cargo dist` 做 GitHub Release

**Cargo.toml workspace 关键字段**：
```toml
[package]
name = "vr-show"
version = "0.2.0"   # 0.1.0 是 web 版
edition = "2021"
rust-version = "1.87"  # wgpu 29 MSRV

[dependencies]
winit = "0.30"
wgpu = { version = "29", default-features = false, features = ["wgsl", "vulkan", "metal", "gles", "dx12"] }
glam = "0.29"
image = { version = "0.25", default-features = false, features = ["png", "jpeg"] }
egui = "0.32"
egui-wgpu = "0.32"  # 实施时验证与 egui 版本的精确匹配关系，必要时锁版到具体 patch 版本
thiserror = "2"
log = "0.4"
env_logger = "0.11"
pollster = "0.4"   # 阻塞等 wgpu 初始化，免去 async runtime

[profile.release]
lto = "thin"
codegen-units = 1
opt-level = 3
strip = "symbols"
```

**要删除的目录/文件**（实施时执行）：
- `vr-show/src/`（JS 源码）
- `vr-show/tests/`（JS 测试）
- `vr-show/index.html`
- `vr-show/vite.config.js`
- `vr-show/package.json`、`vr-show/package-lock.json`
- `vr-show/src-tauri/`（Tauri 壳）
- `vr-show/dist/`、`vr-show/dist-tauri/`（构建产物）
- `vr-show/scripts/copy-bundles.sh`（Tauri 配套脚本）
- `vr-show/node_modules/`（依赖）
- `vr-show/.gitignore` 改写（去掉 Node 相关）
- `vr-show/TESTING.md` 改写（去掉 web 章节，保留并适配桌面场景）
- `vr-show/Qwen-Image-2512_00001_.png` 保留（作为测试样本）
- 顶部 `.superpowers/` 不动（与本任务无关）

**新增**：
- `vr-show/Cargo.toml`（workspace 根）
- `vr-show/crates/vr-show/`（实际 crate）
- `vr-show/README.md` 重写为 Rust 版说明

## 实施阶段

大致顺序（不写具体 plan，只列阶段）：

1. **脚手架**：建立 workspace、Cargo.toml、main.rs 打印「Hello, world」并打开空窗口。
2. **GPU 初始化**：window.rs 完整跑通 wgpu device/queue/surface 渲染纯色背景。
3. **球面网格 + 渲染器**：scene/sphere.rs 生成网格，renderer.rs 绘制带纯色纹理的球面。
4. **纹理加载**：scene/texture.rs 用占位图跑通上传管线。
5. **相机控制**：scene/camera.rs + input.rs，实现拖拽旋转、滚轮缩放、自动旋转。
6. **文件加载**：file.rs 处理拖拽事件、解码、宽高比警告、错误展示。
7. **egui UI**：ui.rs 集成 egui-wgpu，画空状态/错误横幅/HUD。
8. **命令行参数 + 清理**：main.rs 处理 argv[1]；删除 web 时代残留；更新 TESTING.md / README。
9. **单元测试**：为 sphere/camera/file 写测试。

## 风险与决策记录

| 风险 | 影响 | 缓解 |
|---|---|---|
| wgpu 29 仍较新，文档/示例滞后 | 集成困难 | 用 wgpu 官方 examples 仓库对应版本作参考；遇坑查 issue |
| egui-wgpu 与 wgpu 版本必须精确匹配 | 编译失败 | Cargo.toml 锁版本，不放任 floating |
| Linux 上无 GPU / 驱动不兼容 | 启动失败 | 退回 GLES 后端（已在 features 中） |
| 球面 UV 在两极的纹理拉伸 | 视觉失真 | 与 web 版行为一致（同样的 SphereGeometry），不做特殊处理 |
| 失去 webview 的 HTML 调试便利 | 开发效率 | 编译错误信息 + `RUST_LOG=debug` 详细日志；`cargo run` 启动 |

**显式不做**：
- 不引入 `rfd` 文件对话框（决策见「UI」小节）
- 不做安装包打包
- 不做移动端
- 不做触屏/陀螺仪
- 不做集成测试
- 不做 wasm 编译目标

## 验收标准

完成后所有这些必须为真：

1. `cargo build --release` 在 macOS / Windows / Linux 三平台都成功。
2. 启动后窗口大小 1280×800，标题「360° 全景图查看器」。
3. 看到空状态文字与虚线边框。
4. 拖一张 PNG / JPEG 全景图到窗口，图片作为球内壁显示，可拖动旋转、滚轮缩放。
5. 拖一张非图片文件，红色错误横幅 3 秒后消失。
6. 命令行 `vr-show image.png` 启动后直接加载该图。
7. 加载非 2:1 图片时 stderr 输出宽高比警告。
8. 关闭按钮干净退出，无 panic、无残留进程。
9. `cargo test` 全部通过。
10. 仓库内无 `.js`、`.ts`、`.html`、`.css`、`.json`（除 `.superpowers/`、`Cargo.lock`、`Cargo.toml`、`.gitignore`）、无 `node_modules/`、无 `package*.json`、无 `src-tauri/`。
