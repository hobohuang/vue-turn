import { describe, expect, it } from 'vitest'

import { computeStackSides, pageAtFraction, stackThickness, STACK_SATURATE } from '@/lib/pageStack'

const WIDTH = 3

function sides(overrides: Partial<Parameters<typeof computeStackSides>[0]>) {
  return computeStackSides({
    currentPage: 2,
    displayedPages: 2,
    forwardDirection: 'left',
    numPages: 10,
    sheetWidth: WIDTH,
    ...overrides,
  })
}

describe('computeStackSides in spread mode', () => {
  it('splits read pages left and remaining pages right for ltr', () => {
    expect(sides({})).toEqual({
      left: { first: 1, count: 2, step: -1, edgeX: -WIDTH, dir: -1 },
      right: { first: 4, count: 6, step: 1, edgeX: WIDTH, dir: 1 },
    })
  })

  it('mirrors sides for rtl', () => {
    expect(sides({ forwardDirection: 'right' })).toEqual({
      left: { first: 4, count: 6, step: 1, edgeX: -WIDTH, dir: -1 },
      right: { first: 1, count: 2, step: -1, edgeX: WIDTH, dir: 1 },
    })
  })

  it('hides both sides when the book is closed (cover or back cover up)', () => {
    // 封面：内页被硬页盖住，无纸叠
    expect(sides({ currentPage: 0 })).toEqual({ left: null, right: null })
    // 封底（末索引为奇数时居中）：同样无纸叠
    expect(sides({ currentPage: 9, numPages: 10 })).toEqual({ left: null, right: null })
    // 末索引为偶数时封底与前一页成跨页，书仍打开，正常显示纸叠
    expect(sides({ currentPage: 8, numPages: 10 }).left).not.toBeNull()
  })

  it('hugs the half-width edge in single-page mode', () => {
    expect(sides({ displayedPages: 1 }).left?.edgeX).toBe(-WIDTH / 2)
    expect(sides({ displayedPages: 1 }).right?.edgeX).toBe(WIDTH / 2)
  })

  it('keeps read count equal to currentPage and remaining count consistent', () => {
    for (const currentPage of [1, 3, 5, 7]) {
      const s = sides({ currentPage })
      expect(s.left?.count).toBe(currentPage)
      expect(s.right?.count).toBe(10 - 1 - Math.min(currentPage + 1, 9))
      // 两侧页数总和 + 当前可见两页 = 总页数
      expect((s.left?.count ?? 0) + (s.right?.count ?? 0) + 2).toBe(10)
    }
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
  const leftSide = { first: 5, count: 6, step: -1, edgeX: -3, dir: -1 } as const
  const rightSide = { first: 6, count: 4, step: 1, edgeX: 3, dir: 1 } as const

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
