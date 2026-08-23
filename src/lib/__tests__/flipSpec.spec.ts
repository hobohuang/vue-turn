import { describe, expect, it } from 'vitest'

import { computeFlipSpec, PAGE_HEIGHT, pageWidth, spreadLayout } from '@/lib/flipSpec'
import type { FlipSpec } from '@/types/flipbook'

const ASPECT = 0.75

function spec(overrides: Partial<Parameters<typeof computeFlipSpec>[0]>): FlipSpec {
  return computeFlipSpec({
    currentPage: 2,
    displayedPages: 2,
    forwardDirection: 'left',
    backward: false,
    pageAspect: ASPECT,
    numPages: 10,
    ...overrides,
  })
}

describe('pageWidth', () => {
  it('derives width from height and aspect', () => {
    expect(pageWidth(0.75)).toBeCloseTo(PAGE_HEIGHT * 0.75, 10)
  })
})

describe('computeFlipSpec in spread mode', () => {
  it('flips forward ltr with geometry A', () => {
    expect(spec({})).toEqual({
      geometry: 'A',
      hingeX: 0,
      frontIndex: 3,
      backIndex: 4,
      staticPages: [
        { index: 2, slot: 'left' },
        { index: 5, slot: 'right' },
      ],
      delta: 2,
    })
  })

  it('flips backward ltr with geometry B', () => {
    expect(spec({ currentPage: 4, backward: true })).toEqual({
      geometry: 'B',
      hingeX: 0,
      frontIndex: 4,
      backIndex: 3,
      staticPages: [
        { index: 2, slot: 'left' },
        { index: 5, slot: 'right' },
      ],
      delta: -2,
    })
  })

  it('flips forward rtl with geometry B and mirrored statics', () => {
    expect(spec({ forwardDirection: 'right' })).toEqual({
      geometry: 'B',
      hingeX: 0,
      frontIndex: 3,
      backIndex: 4,
      staticPages: [
        { index: 5, slot: 'left' },
        { index: 2, slot: 'right' },
      ],
      delta: 2,
    })
  })

  it('flips backward rtl with geometry A and mirrored statics', () => {
    expect(spec({ currentPage: 4, forwardDirection: 'right', backward: true })).toEqual({
      geometry: 'A',
      hingeX: 0,
      frontIndex: 4,
      backIndex: 3,
      staticPages: [
        { index: 5, slot: 'left' },
        { index: 2, slot: 'right' },
      ],
      delta: -2,
    })
  })

  it('opens the cover with a real sheet while the book slides apart', () => {
    expect(spec({ currentPage: 0 })).toEqual({
      geometry: 'A',
      hingeX: 0,
      frontIndex: 0,
      backIndex: 1,
      staticPages: [{ index: 2, slot: 'right' }],
      delta: 1,
      worldFromX: -pageWidth(ASPECT) / 2,
      worldToX: 0,
      fromFitWidth: pageWidth(ASPECT),
      toFitWidth: pageWidth(ASPECT) * 2,
    })
  })

  it('opens the cover mirrored for rtl', () => {
    expect(spec({ currentPage: 0, forwardDirection: 'right' })).toEqual({
      geometry: 'B',
      hingeX: 0,
      frontIndex: 0,
      backIndex: 1,
      staticPages: [{ index: 2, slot: 'left' }],
      delta: 1,
      worldFromX: pageWidth(ASPECT) / 2,
      worldToX: 0,
      fromFitWidth: pageWidth(ASPECT),
      toFitWidth: pageWidth(ASPECT) * 2,
    })
  })

  it('closes the cover back to the center', () => {
    expect(spec({ currentPage: 1, backward: true })).toEqual({
      geometry: 'B',
      hingeX: 0,
      frontIndex: 1,
      backIndex: 0,
      staticPages: [{ index: 2, slot: 'right' }],
      delta: -1,
      worldFromX: 0,
      worldToX: -pageWidth(ASPECT) / 2,
      fromFitWidth: pageWidth(ASPECT) * 2,
      toFitWidth: pageWidth(ASPECT),
    })
  })

  it('closes the cover mirrored for rtl', () => {
    expect(spec({ currentPage: 1, forwardDirection: 'right', backward: true })).toEqual({
      geometry: 'A',
      hingeX: 0,
      frontIndex: 1,
      backIndex: 0,
      staticPages: [{ index: 2, slot: 'left' }],
      delta: -1,
      worldFromX: 0,
      worldToX: pageWidth(ASPECT) / 2,
      fromFitWidth: pageWidth(ASPECT) * 2,
      toFitWidth: pageWidth(ASPECT),
    })
  })

  it('closes the back cover with a real sheet while the book converges', () => {
    expect(spec({ currentPage: 7 })).toEqual({
      geometry: 'A',
      hingeX: 0,
      frontIndex: 8,
      backIndex: 9,
      staticPages: [{ index: 7, slot: 'left' }],
      delta: 2,
      worldFromX: 0,
      worldToX: pageWidth(ASPECT) / 2,
      fromFitWidth: pageWidth(ASPECT) * 2,
      toFitWidth: pageWidth(ASPECT),
    })
  })

  it('opens the back cover with a real sheet', () => {
    expect(spec({ currentPage: 9, backward: true })).toEqual({
      geometry: 'B',
      hingeX: 0,
      frontIndex: 9,
      backIndex: 8,
      staticPages: [{ index: 7, slot: 'left', fromSlot: 'center' }],
      delta: -2,
      worldFromX: pageWidth(ASPECT) / 2,
      worldToX: 0,
      fromFitWidth: pageWidth(ASPECT),
      toFitWidth: pageWidth(ASPECT) * 2,
    })
  })
})

describe('computeFlipSpec in single-page mode', () => {
  const hinge = pageWidth(ASPECT) / 2

  it('flips forward ltr around the left edge', () => {
    expect(spec({ displayedPages: 1 })).toEqual({
      geometry: 'A',
      hingeX: -hinge,
      frontIndex: 2,
      backIndex: 3,
      staticPages: [{ index: 3, slot: 'center' }],
      delta: 1,
    })
  })

  it('flips backward ltr around the right edge', () => {
    expect(spec({ displayedPages: 1, currentPage: 3, backward: true })).toEqual({
      geometry: 'B',
      hingeX: hinge,
      frontIndex: 3,
      backIndex: 2,
      staticPages: [{ index: 2, slot: 'center' }],
      delta: -1,
    })
  })

  it('flips forward rtl around the right edge', () => {
    expect(spec({ displayedPages: 1, forwardDirection: 'right' })).toEqual({
      geometry: 'B',
      hingeX: hinge,
      frontIndex: 2,
      backIndex: 3,
      staticPages: [{ index: 3, slot: 'center' }],
      delta: 1,
    })
  })

  it('flips backward rtl around the left edge', () => {
    expect(
      spec({ displayedPages: 1, currentPage: 3, forwardDirection: 'right', backward: true }),
    ).toEqual({
      geometry: 'A',
      hingeX: -hinge,
      frontIndex: 3,
      backIndex: 2,
      staticPages: [{ index: 2, slot: 'center' }],
      delta: -1,
    })
  })
})

describe('spreadLayout', () => {
  it('lays out ltr spreads', () => {
    expect(
      spreadLayout({ currentPage: 2, displayedPages: 2, forwardDirection: 'left', numPages: 10 }),
    ).toEqual([
      { index: 2, slot: 'left' },
      { index: 3, slot: 'right' },
    ])
  })

  it('lays out rtl spreads mirrored', () => {
    expect(
      spreadLayout({ currentPage: 2, displayedPages: 2, forwardDirection: 'right', numPages: 10 }),
    ).toEqual([
      { index: 3, slot: 'left' },
      { index: 2, slot: 'right' },
    ])
  })

  it('centers the single page', () => {
    expect(
      spreadLayout({ currentPage: 2, displayedPages: 1, forwardDirection: 'left', numPages: 10 }),
    ).toEqual([{ index: 2, slot: 'center' }])
  })

  it('centers the front cover in spread mode', () => {
    expect(
      spreadLayout({ currentPage: 0, displayedPages: 2, forwardDirection: 'left', numPages: 10 }),
    ).toEqual([{ index: 0, slot: 'center' }])
  })

  it('centers the back cover in spread mode', () => {
    expect(
      spreadLayout({ currentPage: 9, displayedPages: 2, forwardDirection: 'left', numPages: 10 }),
    ).toEqual([{ index: 9, slot: 'center' }])
  })
})
