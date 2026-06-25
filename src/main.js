import { Viewer } from './viewer.js'
import { FileLoader } from './fileLoader.js'
import { EmptyState } from './emptyState.js'
import { HUD } from './hud.js'
import { ErrorBanner } from './errorBanner.js'

function webglAvailable() {
  const canvas = document.createElement('canvas')
  return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'))
}

function showFatalError(message) {
  const banner = document.getElementById('error-banner')
  if (banner) {
    banner.textContent = message
    banner.classList.add('visible')
    banner.style.pointerEvents = 'auto'
  }
  const emptyState = document.getElementById('empty-state')
  if (emptyState) emptyState.classList.add('hidden')
}

export function wireApp({ fileInput, emptyStateEl, hudEl, errorBannerEl, viewerCanvasSelector }) {
  const viewer = new Viewer(viewerCanvasSelector)
  const emptyState = new EmptyState(emptyStateEl, () => fileInput.click())
  const hud = new HUD(hudEl)
  const errorBanner = new ErrorBanner(errorBannerEl)
  const fileLoader = new FileLoader(fileInput, window)

  fileLoader.onImageLoaded = (img) => {
    viewer.loadTexture(img)
    emptyState.hide()
    hud.show()
  }

  fileLoader.onError = (reason) => {
    const messages = {
      'not-image': '请拖入图片文件',
      'load-failed': '图片加载失败'
    }
    errorBanner.show(messages[reason] ?? '发生错误')
  }

  fileLoader.onDragStateChange = (active) => {
    emptyState.setDragActive(active)
  }

  viewer.on('firstInteraction', () => {
    viewer.setAutoRotate(false)
    hud.hide()
  })

  return { viewer, emptyState, hud, errorBanner, fileLoader }
}

function boot() {
  if (!webglAvailable()) {
    showFatalError('请用支持 WebGL 的现代浏览器')
    return
  }
  try {
    const fileInput = document.getElementById('file-input')
    const emptyStateEl = document.getElementById('empty-state')
    const hudEl = document.getElementById('hud')
    const errorBannerEl = document.getElementById('error-banner')
    if (!fileInput || !emptyStateEl || !hudEl || !errorBannerEl) {
      throw new Error('Required DOM element missing')
    }
    wireApp({
      fileInput,
      emptyStateEl,
      hudEl,
      errorBannerEl,
      viewerCanvasSelector: '#viewer-canvas'
    })
  } catch (e) {
    console.error('Initialization failed:', e)
    showFatalError('初始化失败：' + e.message)
  }
}

boot()
