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
        assert_eq!(
            m.indices.len(),
            (SPHERE_SEGMENTS * SPHERE_SEGMENTS * 6) as usize
        );
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
