import { describe, it, expect, beforeEach, vi } from 'vitest'

// We need a slightly more sophisticated three.js mock that tracks
// PerspectiveCamera's rotation like the real one (so we can verify
// drag direction by computing the look direction).
vi.mock('three', () => {
  class FakeTexture { constructor(image) { this.image = image } dispose() {} }
  class FakeGeometry { dispose() {} }
  class FakeMesh {
    constructor(geometry, material) { this.geometry = geometry; this.material = material }
  }
  class FakeMaterial { dispose() {} }
  class FakeScene { add() {} remove() {} }

  // Mimic Euler-based rotation: when .y or .x is set, just store the values.
  // We expose them as a real object so tests can read .rotation.y etc.
  class FakePerspectiveCamera {
    constructor(fov, aspect, near, far) {
      this.fov = fov; this.aspect = aspect; this.near = near; this.far = far
      this.position = { set() {} }
      this.rotation = { y: 0, x: 0, order: 'YXZ' }
    }
    updateProjectionMatrix() {}
  }

  class FakeWebGLRenderer {
    constructor() {}
    setPixelRatio() {}
    setSize() {}
    render() {}
  }

  return {
    Texture: FakeTexture,
    SphereGeometry: FakeGeometry,
    MeshBasicMaterial: FakeMaterial,
    Mesh: FakeMesh,
    Scene: FakeScene,
    PerspectiveCamera: FakePerspectiveCamera,
    WebGLRenderer: FakeWebGLRenderer,
    SRGBColorSpace: 'srgb',
    EquirectangularReflectionMapping: 'equirect',
    BackSide: 1,
  }
})

// Mock Image (fileLoader's onImageLoaded path needs it, but not drag)
function installFakeImage() {
  const orig = globalThis.Image
  class FakeImage {
    constructor() { this._listeners = {} }
    set src(_) {
      setTimeout(() => { this.width = 2048; this.height = 1024; this.onload?.() }, 0)
    }
    addEventListener() {}
  }
  globalThis.Image = FakeImage
  return () => { globalThis.Image = orig }
}

describe('Viewer drag direction', () => {
  let canvas
  let viewer

  beforeEach(() => {
    document.body.innerHTML = '<canvas id="viewer-canvas"></canvas>'
    canvas = document.getElementById('viewer-canvas')
    canvas.getContext = () => ({ stub: true })
    canvas.setPointerCapture = () => {}
    canvas.releasePointerCapture = () => {}
  })

  it('drag right (positive dx) increases yaw (camera turns right)', async () => {
    const restore = installFakeImage()
    const { Viewer } = await import('../src/viewer.js')
    viewer = new Viewer('#viewer-canvas')

    const initialYaw = viewer.yaw
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 400, clientY: 300, pointerId: 1, bubbles: true }))
    canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 500, clientY: 300, pointerId: 1, bubbles: true }))
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 500, clientY: 300, pointerId: 1, bubbles: true }))

    expect(viewer.yaw).toBeGreaterThan(initialYaw)
    restore()
  })

  it('drag down (positive dy) decreases pitch (camera looks down)', async () => {
    const restore = installFakeImage()
    const { Viewer } = await import('../src/viewer.js')
    viewer = new Viewer('#viewer-canvas')

    const initialPitch = viewer.pitch
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 400, clientY: 300, pointerId: 1, bubbles: true }))
    canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 400, clientY: 400, pointerId: 1, bubbles: true }))
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 400, clientY: 400, pointerId: 1, bubbles: true }))

    expect(viewer.pitch).toBeLessThan(initialPitch)
    restore()
  })

  it('drag left (negative dx) decreases yaw (camera turns left)', async () => {
    const restore = installFakeImage()
    const { Viewer } = await import('../src/viewer.js')
    viewer = new Viewer('#viewer-canvas')

    const initialYaw = viewer.yaw
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 400, clientY: 300, pointerId: 1, bubbles: true }))
    canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 300, clientY: 300, pointerId: 1, bubbles: true }))
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 300, clientY: 300, pointerId: 1, bubbles: true }))

    expect(viewer.yaw).toBeLessThan(initialYaw)
    restore()
  })

  it('drag up (negative dy) increases pitch (camera looks up)', async () => {
    const restore = installFakeImage()
    const { Viewer } = await import('../src/viewer.js')
    viewer = new Viewer('#viewer-canvas')

    const initialPitch = viewer.pitch
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 400, clientY: 300, pointerId: 1, bubbles: true }))
    canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 400, clientY: 200, pointerId: 1, bubbles: true }))
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 400, clientY: 200, pointerId: 1, bubbles: true }))

    expect(viewer.pitch).toBeGreaterThan(initialPitch)
    restore()
  })

  it('pitch is clamped to ±(π/2 - 0.01)', async () => {
    const restore = installFakeImage()
    const { Viewer } = await import('../src/viewer.js')
    viewer = new Viewer('#viewer-canvas')

    // Drag down a huge amount
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 400, clientY: 300, pointerId: 1, bubbles: true }))
    canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 400, clientY: 10000, pointerId: 1, bubbles: true }))
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 400, clientY: 10000, pointerId: 1, bubbles: true }))

    const PITCH_LIMIT = Math.PI / 2 - 0.01
    expect(viewer.pitch).toBeGreaterThanOrEqual(-PITCH_LIMIT)
    expect(viewer.pitch).toBeLessThanOrEqual(PITCH_LIMIT)
    restore()
  })
})
