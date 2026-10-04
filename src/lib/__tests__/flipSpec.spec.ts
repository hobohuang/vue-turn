import { describe, expect, it } from 'vitest'

import { buildPageSources } from '@/lib/pageMapping'
import { computeFlipSpec, mergeSpreadPlacements, PAGE_HEIGHT, sheetWorldWidth, spreadLayout } from '@/lib/flipSpec'
import type { FlipSpec, StaticPlacement } from '@/types/turn'

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

describe('sheetWorldWidth', () => {
  it('derives width from height and aspect', () => {
    expect(sheetWorldWidth(0.75)).toBeCloseTo(PAGE_HEIGHT * 0.75, 10)
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
      boundary: true,
      worldFromX: -sheetWorldWidth(ASPECT) / 2,
      worldToX: 0,
      fromFitWidth: sheetWorldWidth(ASPECT),
      toFitWidth: sheetWorldWidth(ASPECT) * 2,
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
      boundary: true,
      worldFromX: sheetWorldWidth(ASPECT) / 2,
      worldToX: 0,
      fromFitWidth: sheetWorldWidth(ASPECT),
      toFitWidth: sheetWorldWidth(ASPECT) * 2,
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
      boundary: true,
      worldFromX: 0,
      worldToX: -sheetWorldWidth(ASPECT) / 2,
      fromFitWidth: sheetWorldWidth(ASPECT) * 2,
      toFitWidth: sheetWorldWidth(ASPECT),
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
      boundary: true,
      worldFromX: 0,
      worldToX: sheetWorldWidth(ASPECT) / 2,
      fromFitWidth: sheetWorldWidth(ASPECT) * 2,
      toFitWidth: sheetWorldWidth(ASPECT),
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
      boundary: true,
      worldFromX: 0,
      worldToX: sheetWorldWidth(ASPECT) / 2,
      fromFitWidth: sheetWorldWidth(ASPECT) * 2,
      toFitWidth: sheetWorldWidth(ASPECT),
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
      boundary: true,
      worldFromX: sheetWorldWidth(ASPECT) / 2,
      worldToX: 0,
      fromFitWidth: sheetWorldWidth(ASPECT),
      toFitWidth: sheetWorldWidth(ASPECT) * 2,
    })
  })
})

describe('computeFlipSpec in single-page mode', () => {
  const hinge = sheetWorldWidth(ASPECT) / 2

  it('flips forward ltr around the fixed left seam', () => {
    expect(spec({ displayedPages: 1 })).toEqual({
      geometry: 'A',
      hingeX: -hinge,
      frontIndex: 2,
      backIndex: 3,
      staticPages: [{ index: 3, slot: 'center' }],
      delta: 1,
      reverse: false,
    })
  })

  it('flips backward ltr in from the same left seam (reverse)', () => {
    // 页缝固定在左缘：后退为目标页纸张从左缘翻回放平、盖住仍显示的当前页
    expect(spec({ displayedPages: 1, currentPage: 3, backward: true })).toEqual({
      geometry: 'A',
      hingeX: -hinge,
      frontIndex: 2,
      backIndex: 3,
      staticPages: [{ index: 3, slot: 'center' }],
      delta: -1,
      reverse: true,
    })
  })

  it('flips forward rtl around the fixed right seam', () => {
    expect(spec({ displayedPages: 1, forwardDirection: 'right' })).toEqual({
      geometry: 'B',
      hingeX: hinge,
      frontIndex: 2,
      backIndex: 3,
      staticPages: [{ index: 3, slot: 'center' }],
      delta: 1,
      reverse: false,
    })
  })

  it('flips backward rtl in from the same right seam (reverse)', () => {
    expect(
      spec({ displayedPages: 1, currentPage: 3, forwardDirection: 'right', backward: true }),
    ).toEqual({
      geometry: 'B',
      hingeX: hinge,
      frontIndex: 2,
      backIndex: 3,
      staticPages: [{ index: 3, slot: 'center' }],
      delta: -1,
      reverse: true,
    })
  })
})

describe('computeFlipSpec with leafSpan (jump riffle chunks)', () => {
  it('flips forward two sheets at once', () => {
    // 从跨页 [3,4] 一次翻 2 张：纸背落点为跨页 [7,8] 的左页
    expect(spec({ currentPage: 3, leafSpan: 2 })).toEqual({
      geometry: 'A',
      hingeX: 0,
      frontIndex: 4,
      backIndex: 7,
      staticPages: [
        { index: 3, slot: 'left' },
        { index: 8, slot: 'right' },
      ],
      delta: 4,
    })
  })

  it('flips backward two sheets at once', () => {
    // 从跨页 [7,8] 一次翻回 2 张：纸背落点为跨页 [3,4] 的右页
    expect(spec({ currentPage: 7, backward: true, leafSpan: 2 })).toEqual({
      geometry: 'B',
      hingeX: 0,
      frontIndex: 7,
      backIndex: 4,
      staticPages: [
        { index: 3, slot: 'left' },
        { index: 8, slot: 'right' },
      ],
      delta: -4,
    })
  })

  it('clamps invalid spans to a single sheet', () => {
    expect(spec({ leafSpan: 0 })).toEqual(spec({}))
    expect(spec({ leafSpan: -3 })).toEqual(spec({}))
    expect(spec({ leafSpan: 1.8 })).toEqual(spec({}))
  })

  it('keeps single-page forward spans on the fixed seam', () => {
    expect(spec({ displayedPages: 1, currentPage: 2, leafSpan: 3 })).toEqual({
      geometry: 'A',
      hingeX: -sheetWorldWidth(ASPECT) / 2,
      frontIndex: 2,
      backIndex: 5,
      staticPages: [{ index: 5, slot: 'center' }],
      delta: 3,
      reverse: false,
    })
  })

  it('keeps single-page backward spans reversed', () => {
    expect(spec({ displayedPages: 1, currentPage: 5, backward: true, leafSpan: 3 })).toEqual({
      geometry: 'A',
      hingeX: -sheetWorldWidth(ASPECT) / 2,
      frontIndex: 2,
      backIndex: 5,
      staticPages: [{ index: 5, slot: 'center' }],
      delta: -3,
      reverse: true,
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

describe('mergeSpreadPlacements', () => {
  // 封面(p0) + 普通(p1) + 补位空白(p2) + 跨页左(p3)/右(p4) + 普通(p5)
  const sources = buildPageSources([
    { spread: false },
    { spread: false },
    { spread: true },
    { spread: false },
  ])

  it('merges the two halves of one spread item into a centered full page (ltr)', () => {
    const placements = spreadLayout({
      currentPage: 3,
      displayedPages: 2,
      forwardDirection: 'left',
      numPages: sources.length,
    })
    expect(placements).toEqual([
      { index: 3, slot: 'left' },
      { index: 4, slot: 'right' },
    ])
    expect(mergeSpreadPlacements(placements, sources)).toEqual([
      { index: 3, slot: 'center', spread: true },
    ])
  })

  it('pairs by source identity regardless of slot (rtl)', () => {
    const placements = spreadLayout({
      currentPage: 3,
      displayedPages: 2,
      forwardDirection: 'right',
      numPages: sources.length,
    })
    expect(placements).toEqual([
      { index: 4, slot: 'left' },
      { index: 3, slot: 'right' },
    ])
    expect(mergeSpreadPlacements(placements, sources)).toEqual([
      { index: 3, slot: 'center', spread: true },
    ])
  })

  it('keeps a half page whose partner is not visible', () => {
    // 当前页=跨页右半(p4)，其左半(p3)不在布局中 → 保持原样
    const placements = spreadLayout({
      currentPage: 4,
      displayedPages: 2,
      forwardDirection: 'left',
      numPages: sources.length,
    })
    expect(mergeSpreadPlacements(placements, sources)).toEqual(placements)
  })

  it('does not merge blank pages or full-region pages', () => {
    // 补位空白页(p2)与跨页左半(p3)同屏：空白不参与合并
    const blankPair: StaticPlacement[] = [
      { index: 2, slot: 'left' },
      { index: 3, slot: 'right' },
    ]
    expect(mergeSpreadPlacements(blankPair, sources)).toEqual(blankPair)
    // 普通页（region=full）不与相邻页合并
    const normalPair: StaticPlacement[] = [
      { index: 1, slot: 'left' },
      { index: 3, slot: 'right' },
    ]
    expect(mergeSpreadPlacements(normalPair, sources)).toEqual(normalPair)
  })

  it('leaves centered pages untouched', () => {
    const placements = spreadLayout({
      currentPage: 0,
      displayedPages: 2,
      forwardDirection: 'left',
      numPages: sources.length,
    })
    expect(mergeSpreadPlacements(placements, sources)).toEqual(placements)
  })
})
