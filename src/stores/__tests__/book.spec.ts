import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useBookStore } from '@/stores/book'

describe('book store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  function seededStore(numPages = 10) {
    const store = useBookStore('test')
    store.setNumPages(numPages)
    return store
  }

  it('starts on page one', () => {
    const store = seededStore()
    expect(store.page).toBe(1)
    expect(store.currentPage).toBe(0)
  })

  it('reports forward availability until the back cover', () => {
    const store = seededStore()
    expect(store.canGoForward).toBe(true)
    store.goToPage(9)
    expect(store.canGoForward).toBe(false)
    expect(store.canGoBack).toBe(true)
  })

  it('blocks backward flips near the front cover', () => {
    const store = seededStore()
    expect(store.canGoBack).toBe(false)
    store.goToPage(2)
    expect(store.canGoBack).toBe(true)
  })

  it('maps flip sides to direction for ltr', () => {
    const store = seededStore()
    expect(store.canFlipLeft).toBe(store.canGoForward)
    expect(store.canFlipRight).toBe(store.canGoBack)
  })

  it('maps flip sides to direction for rtl', () => {
    const store = seededStore()
    store.setForwardDirection('right')
    expect(store.canFlipLeft).toBe(store.canGoBack)
    expect(store.canFlipRight).toBe(store.canGoForward)
  })

  it('keeps odd left pages and aligns even targets in two-page mode', () => {
    const store = seededStore()
    store.goToPage(3)
    expect(store.currentPage).toBe(3)
    store.goToPage(4)
    expect(store.currentPage).toBe(3)
  })

  it('keeps the front and back cover reachable in two-page mode', () => {
    const store = seededStore()
    store.goToPage(0)
    expect(store.currentPage).toBe(0)
    store.goToPage(9)
    expect(store.currentPage).toBe(9)
  })

  it('commits cover transitions by one page', () => {
    const store = seededStore()
    store.startFlip()
    store.commitFlip(1)
    expect(store.currentPage).toBe(1)
    store.startFlip()
    store.commitFlip(-1)
    expect(store.currentPage).toBe(0)
  })

  it('keeps odd targets untouched in single-page mode', () => {
    const store = seededStore()
    store.setDisplayedPages(1)
    store.goToPage(3)
    expect(store.currentPage).toBe(3)
  })

  it('clamps targets beyond the book', () => {
    const store = seededStore()
    store.goToPage(99)
    expect(store.currentPage).toBe(9)
  })

  it('ignores navigation while flipping', () => {
    const store = seededStore()
    store.startFlip()
    expect(store.isFlipping).toBe(true)
    store.goToPage(4)
    expect(store.currentPage).toBe(0)
  })

  it('commits flips by delta and releases the lock', () => {
    const store = seededStore()
    store.startFlip()
    store.commitFlip(2)
    expect(store.currentPage).toBe(2)
    expect(store.isFlipping).toBe(false)
    expect(store.page).toBe(3)
  })

  it('commits backward flips', () => {
    const store = seededStore()
    store.goToPage(4)
    expect(store.currentPage).toBe(3)
    store.startFlip()
    store.commitFlip(-2)
    expect(store.currentPage).toBe(1)
  })
})
