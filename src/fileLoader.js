const ERROR_NOT_IMAGE = 'not-image'
const ERROR_LOAD_FAILED = 'load-failed'

export class FileLoader {
  constructor(fileInput, dropTarget) {
    this.fileInput = fileInput
    this.dropTarget = dropTarget
    this.onImageLoaded = null
    this.onError = null
    this.onDragStateChange = null
    this._dragDepth = 0

    this._bindInput()
    this._bindDrop()
  }

  _bindInput() {
    this.fileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0]
      if (file) this._handleFile(file)
    })
  }

  _bindDrop() {
    const target = this.dropTarget

    target.addEventListener('dragenter', (e) => {
      e.preventDefault()
      this._dragDepth++
      if (this._dragDepth === 1) this.onDragStateChange?.(true)
    })

    target.addEventListener('dragover', (e) => {
      e.preventDefault()
    })

    target.addEventListener('dragleave', (e) => {
      e.preventDefault()
      this._dragDepth = Math.max(0, this._dragDepth - 1)
      if (this._dragDepth === 0) this.onDragStateChange?.(false)
    })

    target.addEventListener('drop', (e) => {
      e.preventDefault()
      this._dragDepth = 0
      this.onDragStateChange?.(false)
      const file = e.dataTransfer?.files?.[0]
      if (file) this._handleFile(file)
    })
  }

  _handleFile(file) {
    if (!file.type.startsWith('image/')) {
      this.onError?.(ERROR_NOT_IMAGE)
      return
    }

    const img = new Image()
    img.onload = () => {
      if (Math.abs(img.width / img.height - 2) > 0.05) {
        console.warn(`Image aspect ratio is ${img.width}:${img.height}, not 2:1. It will display stretched.`)
      }
      this.onImageLoaded?.(img)
    }
    img.onerror = () => this.onError?.(ERROR_LOAD_FAILED)
    img.src = URL.createObjectURL(file)
  }
}