import { describe, expect, it } from 'vitest'

import {
  computeStackSides,
  deriveStackEdges,
  pageAtFraction,
  stackThickness,
  STACK_SATURATE,
} from '@/lib/pageStack'

function sides(overrides: Partial<Parameters<typeof computeStackSides>[0]>) {
  return computeStackSides({
    currentPage: 2,
    displayedPages: 2,
    forwardDirection: 'left',
    numPages: 10,
    ...overrides,
  })
}

describe('computeStackSides in spread mode', () => {
  it('splits read pages left and remaining pages right for ltr', () => {
    // 封面已平躺左侧，不计入纸叠层数
    expect(sides({})).toEqual({
      left: { first: 1, count: 1, step: -1 },
      right: { first: 4, count: 6, step: 1 },
    })
  })

  it('mirrors sides for rtl', () => {
    expect(sides({ forwardDirection: 'right' })).toEqual({
      left: { first: 4, count: 6, step: 1 },
      right: { first: 1, count: 1, step: -1 },
    })
  })

  it('shows the whole book minus the cover when closed', () => {
    // 封面朝上：右侧纸叠为除封面外的整本书
    expect(sides({ currentPage: 0 })).toEqual({
      left: null,
      right: { first: 1, count: 9, step: 1 },
    })
    // 封底朝上：左侧纸叠为除封底外的整本书（封面计入）
    expect(sides({ currentPage: 9, numPages: 10 })).toEqual({
      left: { first: 8, count: 8, step: -1 },
      right: null,
    })
  })

  it('excludes the flat cover/back cover from stacks', () => {
    // 封面平躺后左侧只剩已读内页
    expect(sides({ currentPage: 1 }).left).toBeNull()
    // 封底合上时右侧为 1 层（封底本身，尚未平躺）
    expect(sides({ currentPage: 7 }).right).toEqual({ first: 9, count: 1, step: 1 })
    // 封底平躺后右侧无纸叠
    expect(sides({ currentPage: 8 }).right).toBeNull()
  })

  it('shows only the unread stack on the seam-opposite side in single-page mode', () => {
    // 单页模式页缝固定在阅读方向一侧：纸叠只出现在缝对侧（未读页堆叠），
    // 已读页翻出缝侧、不堆叠
    expect(sides({ displayedPages: 1 })).toEqual({
      left: null,
      right: { first: 3, count: 7, step: 1 },
    })
    // RTL：缝在右缘，纸叠在左
    expect(sides({ displayedPages: 1, forwardDirection: 'right' })).toEqual({
      left: { first: 3, count: 7, step: 1 },
      right: null,
    })
    // 翻到末页：剩余为 0，两侧皆无
    expect(sides({ displayedPages: 1, currentPage: 9, numPages: 10 })).toEqual({
      left: null,
      right: null,
    })
  })

  it('keeps layer counts consistent with visible and flat pages', () => {
    for (const currentPage of [2, 3, 5, 7]) {
      const s = sides({ currentPage })
      // 封面平躺不计入
      expect(s.left?.count).toBe(currentPage - 1)
      expect(s.right?.count).toBe(10 - 1 - Math.min(currentPage + 1, 9))
      // 两侧层数 + 可见两页 + 平躺封面 = 总页数
      expect((s.left?.count ?? 0) + (s.right?.count ?? 0) + 2 + 1).toBe(10)
    }
  })
})

describe('deriveStackEdges', () => {
  // 单页世界宽 1.5（跨页合并网格为 3）
  const W = 1.5

  it('derives both edges from an open spread', () => {
    expect(
      deriveStackEdges([
        { x: -W / 2, halfWidth: W / 2 },
        { x: W / 2, halfWidth: W / 2 },
      ]),
    ).toEqual({ left: -W, right: W })
  })

  it('derives half-width edges from a centered page (closed book)', () => {
    expect(deriveStackEdges([{ x: 0, halfWidth: W / 2 }])).toEqual({
      left: -W / 2,
      right: W / 2,
    })
  })

  it('derives full-width edges from a merged spread mesh', () => {
    expect(deriveStackEdges([{ x: 0, halfWidth: W }])).toEqual({ left: -W, right: W })
  })

  it('reports null only when no page reaches the spine', () => {
    // 仅右侧有页：左缘压在书脊（0），右缘来自该页；
    // 该侧无层数时条带本就隐藏，0 与 null 等价
    expect(deriveStackEdges([{ x: W / 2, halfWidth: W / 2 }])).toEqual({
      left: 0,
      right: W,
    })
    // 页面整体位于书脊严格右侧（非槽位布局）时左缘为 null
    expect(deriveStackEdges([{ x: (W / 2) * 2, halfWidth: W / 2 }])).toEqual({
      left: null,
      right: W * 1.5,
    })
  })

  it('takes the outermost edge when pages stack up', () => {
    expect(
      deriveStackEdges([
        { x: -W / 2, halfWidth: W / 2 },
        { x: -W / 2 + 0.01, halfWidth: W / 2 },
        { x: W / 2, halfWidth: W / 2 },
      ]),
    ).toEqual({ left: -W, right: W })
  })

  it('returns both null for an empty layout', () => {
    expect(deriveStackEdges([])).toEqual({ left: null, right: null })
  })
})

describe('stackThickness', () => {
  it('returns zero for empty side or zero depth', () => {
    expect(stackThickness(0, 10, 1)).toBe(0)
    expect(stackThickness(5, 10, 0)).toBe(0)
  })

  it('reaches max depth when the whole book is stacked', () => {
    expect(stackThickness(10, 10, 0.6)).toBeCloseTo(0.6, 10)
  })

  it('scales proportionally for small books', () => {
    expect(stackThickness(4, 10, 0.6)).toBeCloseTo(0.24, 10)
  })

  it('saturates beyond the reference page count', () => {
    // 10000 页的书：按饱和参考值归一，而非按总页数
    const thick = stackThickness(60, 10000, 0.6)
    expect(thick).toBeCloseTo(0.6 * (60 / STACK_SATURATE), 10)
    expect(thick).toBeLessThan(0.6)
    // 全部页数堆叠时封顶到 maxDepth，条带不会无限增长
    expect(stackThickness(10000, 10000, 0.6)).toBeCloseTo(0.6, 10)
  })
})

describe('pageAtFraction', () => {
  const leftSide = { first: 5, count: 6, step: -1 } as const
  const rightSide = { first: 6, count: 4, step: 1 } as const

  it('maps the inner edge to the first layer', () => {
    expect(pageAtFraction(leftSide, 0)).toBe(5)
    expect(pageAtFraction(rightSide, 0)).toBe(6)
  })

  it('maps the outer edge to the last layer', () => {
    expect(pageAtFraction(leftSide, 1)).toBe(0)
    expect(pageAtFraction(rightSide, 1)).toBe(9)
  })

  it('walks pages along the step direction', () => {
    expect(pageAtFraction(leftSide, 0.5)).toBe(2)
    expect(pageAtFraction(rightSide, 0.5)).toBe(8)
  })

  it('clamps out-of-range and invalid fractions', () => {
    expect(pageAtFraction(leftSide, -1)).toBe(5)
    expect(pageAtFraction(leftSide, 2)).toBe(0)
    expect(pageAtFraction(leftSide, Number.NaN)).toBe(5)
    // 非有限值回退到比例 0（内侧首层）
    expect(pageAtFraction(leftSide, Number.POSITIVE_INFINITY)).toBe(5)
  })

  it('degenerates to first for an empty side', () => {
    expect(pageAtFraction({ ...leftSide, count: 0 }, 0.5)).toBe(5)
  })
})
