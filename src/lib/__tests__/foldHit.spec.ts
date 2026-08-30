import { describe, expect, it } from 'vitest'

import {
  foldHitFromPick,
  foldSideOf,
  foldStripFromPick,
  FOLD_ZONE,
} from '@/lib/foldHit'
import type { PagePick } from '@/lib/TurnScene'

const placements = [
  { index: 1, slot: 'left' as const },
  { index: 2, slot: 'right' as const },
  { index: 0, slot: 'center' as const },
]

const pick = (over: Partial<PagePick>): PagePick => ({
  index: 2,
  u: 0.5,
  v: 0.5,
  spread: false,
  ...over,
})

describe('foldSideOf', () => {
  it('maps the right page to forward for LTR reading', () => {
    expect(foldSideOf(pick({ index: 2 }), placements, 'left')).toEqual({
      trigger: 'left',
      worldRight: true,
    })
  })

  it('maps the left page to backward for LTR reading', () => {
    expect(foldSideOf(pick({ index: 1 }), placements, 'left')).toEqual({
      trigger: 'right',
      worldRight: false,
    })
  })

  it('mirrors direction for RTL reading', () => {
    // RTL：前进侧为世界左页（翻左页向右），右页为后退
    expect(foldSideOf(pick({ index: 2 }), placements, 'right')?.trigger).toBe('left')
    expect(foldSideOf(pick({ index: 1 }), placements, 'right')?.trigger).toBe('right')
  })

  it('returns null for centered pages (cover)', () => {
    expect(foldSideOf(pick({ index: 0 }), placements, 'left')).toBeNull()
  })

  it('splits merged spread meshes by uv', () => {
    expect(foldSideOf(pick({ spread: true, u: 0.8 }), [], 'left')?.worldRight).toBe(true)
    expect(foldSideOf(pick({ spread: true, u: 0.2 }), [], 'left')?.worldRight).toBe(false)
  })
})

describe('foldHitFromPick', () => {
  it('flags the outer corner zone as edge drag', () => {
    const hit = foldHitFromPick(
      pick({ index: 2, u: 0.99, v: 0.02 }),
      placements,
      'left',
    )
    expect(hit).toMatchObject({ edge: true, cornerV: -1, trigger: 'left' })
  })

  it('flags mid-page presses as fold drag (edge=false)', () => {
    const hit = foldHitFromPick(
      pick({ index: 2, u: 0.5, v: 0.5 }),
      placements,
      'left',
    )
    expect(hit).toMatchObject({ edge: false, cornerV: 1, v: 0.5 })
  })

  it('halves the strip width for merged spread meshes', () => {
    // 跨页网格：右半页 u>0.5，外缘条带为 [1-FOLD_ZONE/2, 1]
    const inHalfZone = foldHitFromPick(
      pick({ spread: true, u: 1 - FOLD_ZONE / 2 + 0.01, v: 0.01 }),
      [],
      'left',
    )
    expect(inHalfZone?.edge).toBe(true)
    const outHalfZone = foldHitFromPick(
      pick({ spread: true, u: 1 - FOLD_ZONE / 2 - 0.05, v: 0.01 }),
      [],
      'left',
    )
    expect(outHalfZone?.edge).toBe(false)
  })

  it('returns null for centered pages', () => {
    expect(foldHitFromPick(pick({ index: 0 }), placements, 'left')).toBeNull()
  })
})

describe('foldStripFromPick', () => {
  it('hits only when both axes are inside the corner strips', () => {
    expect(
      foldStripFromPick(pick({ index: 2, u: 0.98, v: 0.03 }), placements, 'left'),
    ).not.toBeNull()
    // 横向在条带内、纵向在中部：不命中
    expect(
      foldStripFromPick(pick({ index: 2, u: 0.98, v: 0.5 }), placements, 'left'),
    ).toBeNull()
    // 纵向在条带内、横向在中部：不命中
    expect(
      foldStripFromPick(pick({ index: 2, u: 0.5, v: 0.03 }), placements, 'left'),
    ).toBeNull()
  })

  it('reports corner direction and deepening strength', () => {
    const shallow = foldStripFromPick(
      pick({ index: 2, u: 1 - FOLD_ZONE * 0.9, v: 0.05 }),
      placements,
      'left',
    )
    const deep = foldStripFromPick(
      pick({ index: 2, u: 0.995, v: 0.01 }),
      placements,
      'left',
    )
    expect(shallow!.t).toBeLessThan(deep!.t)
    expect(deep!.cornerV).toBe(-1)
  })

  it('does not hit the left-edge middle for the right page (LTR)', () => {
    // 右页外缘在 u=1；u 小（贴书脊）不属于外缘条带
    expect(foldStripFromPick(pick({ index: 2, u: 0.05, v: 0.05 }), placements, 'left')).toBeNull()
  })
})
