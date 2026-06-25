import * as THREE from 'three'

const FOV_DEFAULT = 75
const FOV_MIN = 30
const FOV_MAX = 100
const FOV_STEP = 3
const FOV_LERP = 0.1
const SPHERE_RADIUS = 500
const SPHERE_SEGMENTS = 64
const PITCH_LIMIT = Math.PI / 2 - 0.01
const DRAG_SENSITIVITY = 0.0035
const AUTO_ROTATE_SPEED = 0.05

export class Viewer {
  constructor(canvasSelector) {
    const canvas = document.querySelector(canvasSelector)
    this.canvas = canvas

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(
      FOV_DEFAULT,
      window.innerWidth / window.innerHeight,
      0.1,
      1100
    )
    this.camera.position.set(0, 0, 0)

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.setSize(window.innerWidth, window.innerHeight)

    this.yaw = 0
    this.pitch = 0
    this.targetFOV = FOV_DEFAULT
    this.isAutoRotating = true
    this.hasFiredFirstInteraction = false
    this._listeners = { firstInteraction: [] }
    this._dragging = false
    this._lastX = 0
    this._lastY = 0

    this.mesh = null
    this.texture = null
    this.material = null

    this._bindEvents()
    this._loop = this._loop.bind(this)
    this._lastTime = performance.now()
    requestAnimationFrame(this._loop)
  }

  on(event, handler) {
    this._listeners[event]?.push(handler)
  }

  _emit(event) {
    for (const h of this._listeners[event] ?? []) h()
  }

  _bindEvents() {
    window.addEventListener('resize', () => this._onResize())

    this.canvas.addEventListener('pointerdown', (e) => this._onPointerDown(e))
    this.canvas.addEventListener('pointermove', (e) => this._onPointerMove(e))
    this.canvas.addEventListener('pointerup', (e) => this._onPointerUp(e))
    this.canvas.addEventListener('pointercancel', (e) => this._onPointerUp(e))

    this.canvas.addEventListener('wheel', (e) => this._onWheel(e), { passive: false })
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
  }

  _onPointerDown(e) {
    this._dragging = true
    this._lastX = e.clientX
    this._lastY = e.clientY
    this.canvas.classList.add('dragging')
    this.canvas.setPointerCapture?.(e.pointerId)
  }

  _onPointerMove(e) {
    if (!this._dragging) return
    const dx = e.clientX - this._lastX
    const dy = e.clientY - this._lastY
    this._lastX = e.clientX
    this._lastY = e.clientY

    this.yaw -= dx * DRAG_SENSITIVITY
    this.pitch -= dy * DRAG_SENSITIVITY
    if (this.pitch > PITCH_LIMIT) this.pitch = PITCH_LIMIT
    if (this.pitch < -PITCH_LIMIT) this.pitch = -PITCH_LIMIT
  }

  _onPointerUp(e) {
    if (!this._dragging) return
    this._dragging = false
    this.canvas.classList.remove('dragging')
    this.canvas.releasePointerCapture?.(e.pointerId)
    this._fireFirstInteraction()
  }

  _onWheel(e) {
    e.preventDefault()
    const direction = e.deltaY > 0 ? 1 : -1
    this.targetFOV += direction * FOV_STEP
    if (this.targetFOV < FOV_MIN) this.targetFOV = FOV_MIN
    if (this.targetFOV > FOV_MAX) this.targetFOV = FOV_MAX
    this._fireFirstInteraction()
  }

  _fireFirstInteraction() {
    if (this.hasFiredFirstInteraction) return
    this.hasFiredFirstInteraction = true
    this.isAutoRotating = false
    this._emit('firstInteraction')
  }

  setAutoRotate(enabled) {
    this.isAutoRotating = enabled
  }

  loadTexture(image) {
    // Dispose previous
    if (this.texture) this.texture.dispose()
    if (this.material) this.material.dispose()
    if (this.mesh) {
      this.scene.remove(this.mesh)
      this.mesh.geometry.dispose()
    }

    const texture = new THREE.Texture(image)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.mapping = THREE.EquirectangularReflectionMapping
    texture.needsUpdate = true

    const geometry = new THREE.SphereGeometry(SPHERE_RADIUS, SPHERE_SEGMENTS, SPHERE_SEGMENTS)
    const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide })
    const mesh = new THREE.Mesh(geometry, material)

    this.texture = texture
    this.material = material
    this.mesh = mesh
    this.scene.add(mesh)
  }

  _loop(now) {
    const dt = (now - this._lastTime) / 1000
    this._lastTime = now

    if (this.isAutoRotating) {
      this.yaw += AUTO_ROTATE_SPEED * dt
    }

    // Smooth FOV
    if (Math.abs(this.camera.fov - this.targetFOV) > 0.01) {
      this.camera.fov += (this.targetFOV - this.camera.fov) * FOV_LERP
      this.camera.updateProjectionMatrix()
    }

    // Apply yaw/pitch to camera (yaw around world Y, pitch around local X)
    this.camera.rotation.order = 'YXZ'
    this.camera.rotation.y = this.yaw
    this.camera.rotation.x = this.pitch

    this.renderer.render(this.scene, this.camera)
    requestAnimationFrame(this._loop)
  }
}
