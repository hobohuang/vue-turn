import { describe, expect, it } from 'vitest'

import { computeFlipSpec, fanStaticLayout } from '@/lib/flipSpec'
import { FAN_SHEET_BUDGET, MAX_JUMP_STEPS, planJump, type JumpPlanOptions, type JumpPlanStep } from '@/lib/jumpPlan'

const ASPECT = 0.75

function plan(overrides: Partial<JumpPlanOptions>): JumpPlanStep[] {
  return planJump({
    currentPage: 3,
    target: 5,
    displayedPages: 2,
    forwardDirection: 'left',
    numPages: 10,
    pageAspect: ASPECT,
    ...overrides,
  })
}

/** 沿步骤链模拟整条扇形翻页：每步用 computeFlipSpec(leafSpan) 计算 spec，校验落点衔接 */
function walkChain(overrides: Partial<JumpPlanOptions>) {
  const options: JumpPlanOptions = {
    currentPage: 3,
    target: 5,
    displayedPages: 2,
    forwardDirection: 'left',
    numPages: 10,
    pageAspect: ASPECT,
    ...overrides,
  }
  const result = planJump(options)
  let page = options.currentPage
  for (const step of result) {
    const spec = computeFlipSpec({
      currentPage: page,
      displayedPages: options.displayedPages,
      forwardDirection: options.forwardDirection,
      backward: step.delta < 0,
      pageAspect: options.pageAspect,
      numPages: options.numPages,
      leafSpan: step.span,
    })
    expect(spec.delta).toBe(step.delta)
    page += spec.delta
    expect(page).toBeGreaterThanOrEqual(0)
    expect(page).toBeLessThanOrEqual(options.numPages - 1)
  }
  return { result, landing: page }
}

describe('planJump', () => {
  it('returns no steps for the current page', () => {
    expect(plan({ target: 3 })).toEqual([])
  })

  it('flips leaf by leaf for short jumps', () => {
    // 3 → 5 → 7 → 9（末步为封底边界）
    const steps = plan({ target: 9 })
    expect(steps.map((s) => [s.from, s.span, s.delta, s.boundary])).toEqual([
      [3, 1, 2, false],
      [5, 1, 2, false],
      [7, 1, 2, true],
    ])
  })

  it('walks cover boundaries as single-sheet steps', () => {
    // 从封面出发：封面展开(+1 边界) → 内页逐张 → 封底合上(+2 边界)
    const steps = plan({ currentPage: 0, target: 9 })
    expect(steps.map((s) => [s.from, s.boundary])).toEqual([
      [0, true],
      [1, false],
      [3, false],
      [5, false],
      [7, true],
    ])
  })

  it('merges inner leaves into growing chunks for long jumps', () => {
    // 42 页：1 → 39 共 19 张内页 + 封底边界步；预算 5 步 → [3,4,4,4,4]
    const { result, landing } = walkChain({
      currentPage: 1,
      target: 41,
      numPages: 42,
    })
    expect(landing).toBe(41)
    expect(result.map((s) => [s.span, s.delta, s.boundary])).toEqual([
      [3, 6, false],
      [4, 8, false],
      [4, 8, false],
      [4, 8, false],
      [4, 8, false],
      [1, 2, true],
    ])
    expect(MAX_JUMP_STEPS).toBe(6)
    expect(FAN_SHEET_BUDGET).toBe(280)
  })

  it('keeps cover/back-cover boundary steps unmerged on both ends', () => {
    // 从封面跳到封底：两端边界各占一步，中间 19 张内页合并为 4 步 [4,5,5,5]
    const { result, landing } = walkChain({
      currentPage: 0,
      target: 41,
      numPages: 42,
    })
    expect(landing).toBe(41)
    expect(result.map((s) => [s.span, s.delta, s.boundary])).toEqual([
      [1, 1, true],
      [4, 8, false],
      [5, 10, false],
      [5, 10, false],
      [5, 10, false],
      [1, 2, true],
    ])
  })

  it('plans backward long jumps symmetrically', () => {
    // 封底 → 第 1 页：封底展开边界 + 19 张内页合并为 [3,4,4,4,4]
    const { result, landing } = walkChain({
      currentPage: 41,
      target: 1,
      numPages: 42,
    })
    expect(landing).toBe(1)
    expect(result.map((s) => [s.span, s.delta, s.boundary])).toEqual([
      [1, -2, true],
      [3, -6, false],
      [4, -8, false],
      [4, -8, false],
      [4, -8, false],
      [4, -8, false],
    ])
  })

  it('plans single-page mode jumps with per-page spans', () => {
    // 单页模式每张纸一页：2 → 18 共 16 步 → 合并为 [2,2,3,3,3,3]
    const { result, landing } = walkChain({
      currentPage: 2,
      target: 18,
      displayedPages: 1,
      numPages: 20,
    })
    expect(landing).toBe(18)
    expect(result.map((s) => [s.span, s.delta])).toEqual([
      [2, 2],
      [2, 2],
      [3, 3],
      [3, 3],
      [3, 3],
      [3, 3],
    ])
  })

  it('returns no steps when the target is unreachable (defensive)', () => {
    // 0 页书/越界目标：走不出任何一步
    expect(plan({ currentPage: 0, target: 5, numPages: 0 })).toEqual([])
  })
})

describe('fanStaticLayout', () => {
  it('keeps the from left page and reveals the target right page (forward ltr)', () => {
    // 3 → 7：左页 3 留驻、右页 8 揭示（首张纸起飞后露出）
    expect(fanStaticLayout({ currentPage: 3, target: 7, displayedPages: 2, forwardDirection: 'left', numPages: 10 })).toEqual([
      { index: 3, slot: 'left' },
      { index: 8, slot: 'right' },
    ])
  })

  it('mirrors the stay/reveal slots for backward ltr', () => {
    // 7 → 3：右页 8 留驻（飞纸落定侧）、左页 3 揭示
    expect(fanStaticLayout({ currentPage: 7, target: 3, displayedPages: 2, forwardDirection: 'left', numPages: 10 })).toEqual([
      { index: 8, slot: 'right' },
      { index: 3, slot: 'left' },
    ])
  })

  it('mirrors slots for rtl forward jumps', () => {
    // RTL 前进：页码左右镜像（跨页 [3,4] 显示为 4 左 3 右），飞纸从左向右——
    // 右页 3 留驻、左页 8 揭示（落点跨页 [7,8] 的 8 在左槽）
    expect(fanStaticLayout({ currentPage: 3, target: 7, displayedPages: 2, forwardDirection: 'right', numPages: 10 })).toEqual([
      { index: 3, slot: 'right' },
      { index: 8, slot: 'left' },
    ])
  })

  it('omits the static page when the from side is a centered cover', () => {
    // 从封面出发：封面本身就是飞纸，无留驻页
    expect(fanStaticLayout({ currentPage: 0, target: 5, displayedPages: 2, forwardDirection: 'left', numPages: 10 })).toEqual([
      { index: 6, slot: 'right' },
    ])
  })

  it('omits the static page when the target is a centered back cover', () => {
    // 跳到封底：落点侧无揭示页（末张飞纸背面即封底）
    expect(fanStaticLayout({ currentPage: 3, target: 9, displayedPages: 2, forwardDirection: 'left', numPages: 10 })).toEqual([
      { index: 3, slot: 'left' },
    ])
  })

  it('shows the target page in single-page forward mode', () => {
    expect(fanStaticLayout({ currentPage: 2, target: 6, displayedPages: 1, forwardDirection: 'left', numPages: 10 })).toEqual([
      { index: 6, slot: 'center' },
    ])
  })

  it('keeps the current page in single-page backward mode (reverse sheets cover it)', () => {
    expect(fanStaticLayout({ currentPage: 6, target: 2, displayedPages: 1, forwardDirection: 'left', numPages: 10 })).toEqual([
      { index: 6, slot: 'center' },
    ])
  })
})
