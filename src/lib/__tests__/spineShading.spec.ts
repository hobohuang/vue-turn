import { describe, expect, it } from 'vitest'

import { spineScaleOf, spineUOf, spineUOfPlacement } from '@/lib/spineShading'

const base = { displayedPages: 2 as 1 | 2, ltr: true, numPages: 8 }

describe('spineUOf', () => {
  it('places the spine at the inner edge and the outer edge opposite', () => {
    // LTR：左页书脊在右缘(u=1)、外缘在左缘(u=0);右页镜像
    expect(spineUOf({ ...base, index: 2, slot: 'left' })).toEqual({ inner: 1, outer: 0 })
    expect(spineUOf({ ...base, index: 3, slot: 'right' })).toEqual({ inner: 0, outer: 1 })
    // RTL 镜像页码配对不改变左右槽的书脊侧
    expect(spineUOf({ ...base, ltr: false, index: 2, slot: 'left' })).toEqual({ inner: 1, outer: 0 })
    expect(spineUOf({ ...base, ltr: false, index: 3, slot: 'right' })).toEqual({ inner: 0, outer: 1 })
  })

  it('marks a merged spread with center spine and dual outer edges', () => {
    expect(spineUOf({ ...base, index: 4, slot: 'center', spread: true })).toEqual({
      inner: 0.5,
      outer: 'both',
    })
  })

  it('places closed cover and back cover spines by reading direction', () => {
    // LTR 合书：封面书脊在左、封底在右;RTL 镜像
    expect(spineUOf({ ...base, index: 0, slot: 'center' })).toEqual({ inner: 0, outer: 1 })
    expect(spineUOf({ ...base, index: 7, slot: 'center' })).toEqual({ inner: 1, outer: 0 })
    expect(spineUOf({ ...base, ltr: false, index: 0, slot: 'center' })).toEqual({ inner: 1, outer: 0 })
    expect(spineUOf({ ...base, ltr: false, index: 7, slot: 'center' })).toEqual({ inner: 0, outer: 1 })
  })

  it('returns null for a centered non-spread page that is neither cover nor back cover', () => {
    expect(spineUOf({ ...base, index: 4, slot: 'center' })).toBeNull()
  })

  it('pins single-page mode to the seam side', () => {
    // 单页一页一面,缝在阅读方向一侧:LTR 左缘 / RTL 右缘
    const single = { ...base, displayedPages: 1 as const }
    expect(spineUOf({ ...single, index: 0, slot: 'center' })).toEqual({ inner: 0, outer: 1 })
    expect(spineUOf({ ...single, index: 3, slot: 'center' })).toEqual({ inner: 0, outer: 1 })
    expect(spineUOf({ ...single, ltr: false, index: 0, slot: 'center' })).toEqual({ inner: 1, outer: 0 })
    expect(spineUOf({ ...single, ltr: false, index: 3, slot: 'center' })).toEqual({ inner: 1, outer: 0 })
  })

  it('expands slot/spread from a StaticPlacement', () => {
    expect(
      spineUOfPlacement({ index: 2, slot: 'left' }, { displayedPages: 2, ltr: true, numPages: 8 }),
    ).toEqual({ inner: 1, outer: 0 })
    expect(
      spineUOfPlacement(
        { index: 4, slot: 'center', spread: true },
        { displayedPages: 2, ltr: true, numPages: 8 },
      ),
    ).toEqual({ inner: 0.5, outer: 'both' })
  })
})

describe('spineScaleOf', () => {
  it('scales sub-linearly with page count and caps at 1', () => {
    expect(spineScaleOf(0)).toBe(0)
    // sqrt 曲线：薄书仍有可感知的缝谷
    expect(spineScaleOf(16)).toBeCloseTo(Math.sqrt(0.2), 5)
    expect(spineScaleOf(40)).toBeCloseTo(Math.sqrt(0.5), 5)
    expect(spineScaleOf(80)).toBe(1)
    // 封顶：超过参考页数不再增长
    expect(spineScaleOf(400)).toBe(1)
  })

  it('grows monotonically', () => {
    let prev = 0
    for (const n of [4, 8, 16, 32, 64, 128, 256]) {
      const value = spineScaleOf(n)
      expect(value).toBeGreaterThanOrEqual(prev)
      prev = value
    }
  })
})
