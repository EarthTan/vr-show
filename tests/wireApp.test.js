import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock three.js so Viewer can construct without a real WebGL context
vi.mock('three', () => {
  class FakeTexture {
    constructor(image) { this.image = image }
    dispose() {}
  }
  class FakeGeometry { dispose() {} }
  class FakeMesh {
    constructor(geometry, material) { this.geometry = geometry; this.material = material }
  }
  class FakeMaterial { dispose() {} }
  class FakeScene { add() {} remove() {} }
  class FakePerspectiveCamera {
    constructor(fov, aspect, near, far) {
      this.fov = fov; this.aspect = aspect; this.near = near; this.far = far
      this.position = { set() {} }
      this.rotation = { set() {}, y: 0, x: 0, order: '' }
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

// Mock Image so FileLoader doesn't try to decode real bytes
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

describe('main.js wireApp integration', () => {
  let elements
  let fileInput
  let emptyState
  let emptyInner
  let hud
  let errorBanner
  let canvas

  beforeEach(() => {
    document.body.innerHTML = `
      <canvas id="viewer-canvas"></canvas>
      <div id="empty-state" class="empty-state">
        <div class="empty-state-inner"></div>
      </div>
      <div id="hud" class="hud"></div>
      <div id="error-banner" class="error-banner"></div>
      <input id="file-input" type="file" hidden />
    `
    fileInput = document.getElementById('file-input')
    emptyState = document.getElementById('empty-state')
    emptyInner = emptyState.querySelector('.empty-state-inner')
    hud = document.getElementById('hud')
    errorBanner = document.getElementById('error-banner')
    canvas = document.getElementById('viewer-canvas')

    // happy-dom does not implement canvas.getContext for webgl — stub it
    canvas.getContext = () => ({ stub: true })

    elements = {
      fileInput,
      emptyStateEl: emptyState,
      hudEl: hud,
      errorBannerEl: errorBanner,
      viewerCanvasSelector: '#viewer-canvas',
    }
  })

  it('does not throw when wired with real DOM elements', async () => {
    const { wireApp } = await import('../src/main.js')
    expect(() => wireApp(elements)).not.toThrow()
  })

  it('clicking empty-state-inner triggers fileInput.click()', async () => {
    const restore = installFakeImage()
    const { wireApp } = await import('../src/main.js')
    wireApp(elements)

    let clickCount = 0
    const origClick = fileInput.click
    fileInput.click = () => { clickCount++ }

    emptyInner.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(clickCount).toBe(1)
    fileInput.click = origClick
    restore()
  })

  it('dropping a non-image file makes the error banner visible with the right message', async () => {
    const { wireApp } = await import('../src/main.js')
    wireApp(elements)

    const file = new File(['x'], 'doc.pdf', { type: 'application/pdf' })
    const dt = new DataTransfer()
    dt.items.add(file)
    const ev = new DragEvent('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(ev, 'dataTransfer', { value: dt })
    window.dispatchEvent(ev)

    expect(errorBanner.classList.contains('visible')).toBe(true)
    expect(errorBanner.textContent).toBe('请拖入图片文件')
  })

  it('dropping an image triggers onImageLoaded -> emptyState.hide() and hud.show()', async () => {
    const restore = installFakeImage()
    const { wireApp } = await import('../src/main.js')
    wireApp(elements)

    emptyInner.dispatchEvent(new MouseEvent('click', { bubbles: true }))  // ensure DOM updates work

    // Stub EmptyState/HUD show/hide so we can verify they were called
    // Actually we can just check the classList changes after image loads
    const file = new File(['fake'], 'pano.png', { type: 'image/png' })
    const dt = new DataTransfer()
    dt.items.add(file)
    const ev = new DragEvent('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(ev, 'dataTransfer', { value: dt })
    window.dispatchEvent(ev)

    // Wait for the fake image to "load"
    await new Promise(r => setTimeout(r, 50))

    expect(emptyState.classList.contains('hidden')).toBe(true)
    expect(hud.classList.contains('visible')).toBe(true)
    restore()
  })
})
