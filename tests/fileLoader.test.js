import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FileLoader } from '../src/fileLoader.js'

function makeFile(name, type) {
  return new File(['x'], name, { type })
}

function makeImageFile() {
  return makeFile('pano.png', 'image/png')
}

describe('FileLoader', () => {
  let input
  let dropTarget
  let loader

  beforeEach(() => {
    document.body.innerHTML = '<input id="file-input" type="file" hidden />'
    input = document.getElementById('file-input')
    dropTarget = document.createElement('div')
    document.body.appendChild(dropTarget)
    loader = new FileLoader(input, dropTarget)
  })

  it('calls onError("not-image") when a non-image file is dropped', () => {
    const onError = vi.fn()
    loader.onError = onError

    const dt = new DataTransfer()
    dt.items.add(makeFile('doc.pdf', 'application/pdf'))
    const ev = new DragEvent('drop')
    Object.defineProperty(ev, 'dataTransfer', { value: dt })
    dropTarget.dispatchEvent(ev)

    expect(onError).toHaveBeenCalledWith('not-image')
  })

  it('calls onError("not-image") for a non-image picked via input', () => {
    const onError = vi.fn()
    loader.onError = onError

    Object.defineProperty(input, 'files', {
      value: [makeFile('doc.pdf', 'application/pdf')],
      configurable: true
    })
    input.dispatchEvent(new Event('change'))

    expect(onError).toHaveBeenCalledWith('not-image')
  })

  it('calls onImageLoaded with an HTMLImageElement for a valid image', () => {
    const onImageLoaded = vi.fn()
    loader.onImageLoaded = onImageLoaded

    // Stub Image so the test doesn't need a real decode
    const origImage = globalThis.Image
    class FakeImage {
      constructor() {
        this._listeners = {}
      }
      set src(_) {
        setTimeout(() => {
          this.width = 2048
          this.height = 1024
          this.onload?.()
        }, 0)
      }
      addEventListener() {}
    }
    globalThis.Image = FakeImage

    const dt = new DataTransfer()
    dt.items.add(makeImageFile())
    const ev = new DragEvent('drop')
    Object.defineProperty(ev, 'dataTransfer', { value: dt })
    dropTarget.dispatchEvent(ev)

    return new Promise((resolve) => {
      onImageLoaded.mockImplementation(() => {
        globalThis.Image = origImage
        expect(onImageLoaded).toHaveBeenCalledTimes(1)
        expect(onImageLoaded.mock.calls[0][0]).toBeInstanceOf(FakeImage)
        resolve()
      })
    })
  })

  it('fires onDragStateChange on dragenter and dragleave', () => {
    const onDragStateChange = vi.fn()
    loader.onDragStateChange = onDragStateChange

    dropTarget.dispatchEvent(new Event('dragenter'))
    expect(onDragStateChange).toHaveBeenLastCalledWith(true)

    dropTarget.dispatchEvent(new Event('dragleave'))
    expect(onDragStateChange).toHaveBeenLastCalledWith(false)
  })
})