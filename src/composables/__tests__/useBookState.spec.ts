import { describe, expect, it } from 'vitest'

import { useBookState } from '@/composables/useBookState'

describe('book state', () => {
  function seededState(numPages = 10) {
    const state = useBookState()
    state.setNumPages(numPages)
    return state
  }

  it('starts on page one', () => {
    const state = seededState()
    expect(state.page.value).toBe(1)
    expect(state.currentPage.value).toBe(0)
  })

  it('reports forward availability until the back cover', () => {
    const state = seededState()
    expect(state.canGoForward.value).toBe(true)
    state.goToPage(9)
    expect(state.canGoForward.value).toBe(false)
    expect(state.canGoBack.value).toBe(true)
  })

  it('blocks backward flips near the front cover', () => {
    const state = seededState()
    expect(state.canGoBack.value).toBe(false)
    state.goToPage(2)
    expect(state.canGoBack.value).toBe(true)
  })

  it('maps flip sides to direction for ltr', () => {
    const state = seededState()
    expect(state.canFlipLeft.value).toBe(state.canGoForward.value)
    expect(state.canFlipRight.value).toBe(state.canGoBack.value)
  })

  it('maps flip sides to direction for rtl', () => {
    const state = seededState()
    state.setForwardDirection('right')
    expect(state.canFlipLeft.value).toBe(state.canGoBack.value)
    expect(state.canFlipRight.value).toBe(state.canGoForward.value)
  })

  it('keeps odd left pages and aligns even targets in two-page mode', () => {
    const state = seededState()
    state.goToPage(3)
    expect(state.currentPage.value).toBe(3)
    state.goToPage(4)
    expect(state.currentPage.value).toBe(3)
  })

  it('keeps the front and back cover reachable in two-page mode', () => {
    const state = seededState()
    state.goToPage(0)
    expect(state.currentPage.value).toBe(0)
    state.goToPage(9)
    expect(state.currentPage.value).toBe(9)
  })

  it('commits cover transitions by one page', () => {
    const state = seededState()
    state.startFlip()
    state.commitFlip(1)
    expect(state.currentPage.value).toBe(1)
    state.startFlip()
    state.commitFlip(-1)
    expect(state.currentPage.value).toBe(0)
  })

  it('keeps odd targets untouched in single-page mode', () => {
    const state = seededState()
    state.setDisplayedPages(1)
    state.goToPage(3)
    expect(state.currentPage.value).toBe(3)
  })

  it('clamps targets beyond the book', () => {
    const state = seededState()
    state.goToPage(99)
    expect(state.currentPage.value).toBe(9)
  })

  it('ignores navigation while flipping', () => {
    const state = seededState()
    state.startFlip()
    expect(state.isFlipping.value).toBe(true)
    state.goToPage(4)
    expect(state.currentPage.value).toBe(0)
  })

  it('commits flips by delta and releases the lock', () => {
    const state = seededState()
    state.startFlip()
    state.commitFlip(2)
    expect(state.currentPage.value).toBe(2)
    expect(state.isFlipping.value).toBe(false)
    expect(state.page.value).toBe(3)
  })

  it('commits backward flips', () => {
    const state = seededState()
    state.goToPage(4)
    expect(state.currentPage.value).toBe(3)
    state.startFlip()
    state.commitFlip(-2)
    expect(state.currentPage.value).toBe(1)
  })
})
