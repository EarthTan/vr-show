use crate::error::AppError;
use crate::input::InputAction;
use crate::renderer::Renderer;
use crate::scene::camera::CameraState;
use crate::window::WindowState;
use std::path::{Path, PathBuf};
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
    pub panorama: Option<crate::scene::texture::PanoramaTexture>,
    pending_load: Option<PathBuf>,
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
            panorama: None,
            pending_load: None,
        })
    }

    pub fn set_pending_load(&mut self, path: PathBuf) {
        self.pending_load = Some(path);
    }

    pub fn load_panorama(&mut self, path: &Path) {
        let Some(ws) = &self.window_state else {
            return;
        };
        match crate::file::load_panorama(path) {
            Ok(image) => {
                if let Some(warning) = crate::file::aspect_ratio_warning(&image) {
                    log::warn!("{warning}");
                }
                let texture = crate::scene::texture::PanoramaTexture::from_image(
                    &ws.device, &ws.queue, &image,
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
                if let Some(p) = self.pending_load.take() {
                    self.load_panorama(&p);
                }
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
                            self.last_pointer = None;
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
                InputAction::FilesDropped(paths) => {
                    if let Some(p) = paths.into_iter().next() {
                        self.load_panorama(&p);
                    }
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
        let Some(ws) = &mut self.window_state else {
            return;
        };
        let Some(renderer) = &self.renderer else {
            return;
        };

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
        let view = frame
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = ws
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
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
        Self::new()
            .expect("App::new only fails on winit::error::OsError, which is not normally reachable")
    }
}
