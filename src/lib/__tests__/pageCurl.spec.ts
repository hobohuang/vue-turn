import { describe, expect, it } from 'vitest'

import { curledColumns, easeInOutCubic } from '@/lib/pageCurl'

describe('curledColumns', () => {
  const width = 1.5
  const columns = 64

  function at(arr: Float32Array, i: number) {
    return arr[i] ?? 0
  }

  function deviationFromHorizontal(cols: { xs: Float32Array; zs: Float32Array }, i: number) {
    const angle = Math.atan2(at(cols.zs, i + 1) - at(cols.zs, i), at(cols.xs, i + 1) - at(cols.xs, i))
    return Math.abs(Math.PI - angle)
  }

  it('degenerates to rigid rotation when amplitude is zero', () => {
    const theta = Math.PI / 3
    const cols = curledColumns(theta, 0, width, columns)
    expect(at(cols.xs, columns)).toBeCloseTo(width * Math.cos(theta), 6)
    expect(at(cols.zs, columns)).toBeCloseTo(width * Math.sin(theta), 6)
  })

  it('keeps the hinge pinned at the origin', () => {
    const cols = curledColumns(1.1, 0.8, width, columns)
    expect(at(cols.xs, 0)).toBeCloseTo(0, 10)
    expect(at(cols.zs, 0)).toBeCloseTo(0, 10)
  })

  it('preserves arc length', () => {
    const cols = curledColumns(Math.PI / 2, 0.8, width, columns)
    let length = 0
    for (let i = 1; i <= columns; i++) {
      length += Math.hypot(at(cols.xs, i) - at(cols.xs, i - 1), at(cols.zs, i) - at(cols.zs, i - 1))
    }
    expect(length).toBeCloseTo(width, 3)
  })

  it('flattens toward the free edge', () => {
    const cols = curledColumns(Math.PI / 2, 0.8, width, columns)
    const start = deviationFromHorizontal(cols, 0)
    const middle = deviationFromHorizontal(cols, 32)
    const end = deviationFromHorizontal(cols, columns - 1)
    expect(start).toBeGreaterThan(middle)
    expect(middle).toBeGreaterThan(end)
  })

  it('keeps the bulge on the viewer side at every stage', () => {
    for (const theta of [0.3, Math.PI / 2, 2.4]) {
      const cols = curledColumns(theta, 0.8 * Math.sin(theta), width, 32)
      for (const z of cols.zs) {
        expect(z).toBeGreaterThanOrEqual(-1e-9)
      }
    }
  })
})

describe('easing and animation curves', () => {
  it('maps easing endpoints and midpoint', () => {
    expect(easeInOutCubic(0)).toBeCloseTo(0, 10)
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 10)
    expect(easeInOutCubic(1)).toBeCloseTo(1, 10)
  })

  it('sweeps the flip angle from zero to pi', () => {
  })
})
