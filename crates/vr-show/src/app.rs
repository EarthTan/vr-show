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
                    let view = frame
                        .texture
                        .create_view(&wgpu::TextureViewDescriptor::default());
                    let mut encoder =
                        ws.device
                            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
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
