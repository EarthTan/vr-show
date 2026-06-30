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
                MouseScrollDelta::PixelDelta(PhysicalPosition { y, .. }) => *y as f32,
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
