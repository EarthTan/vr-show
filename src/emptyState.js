export class EmptyState {
  constructor(element, onPick) {
    this.element = element
    this.onPick = onPick
    const inner = element.querySelector('.empty-state-inner')
    if (inner && onPick) {
      inner.addEventListener('click', () => onPick())
    }
  }

  hide() {
    this.element.classList.add('hidden')
  }

  setDragActive(active) {
    this.element.classList.toggle('drag-active', active)
  }
}