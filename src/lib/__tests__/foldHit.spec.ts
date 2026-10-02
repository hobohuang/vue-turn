import { describe, expect, it } from 'vitest'

import { foldHitFromPick, foldSideOf, foldStripFromPick, FOLD_ZONE } from '@/lib/foldHit'
import type { PagePick } from '@/lib/TurnScene'

// 页宽（世界坐标）：aspect 0.75 → W = 2 × 0.75，与组件默认一致
const W = 1.5
const R = FOLD_ZONE * W

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

  it('treats the centered cover as foldable toward forward (LTR)', () => {
    // 封面（index 0，居中）：外缘在前进侧（LTR 世界右），只能前进翻开
    expect(foldSideOf(pick({ index: 0 }), placements, 'left')).toEqual({
      trigger: 'left',
      worldRight: true,
    })
  })

  it('treats the centered back cover as foldable toward backward', () => {
    // 封底（末索引，居中）：外缘在后退侧（LTR 世界左），只能后退翻回
    const back = [{ index: 5, slot: 'center' as const }]
    expect(foldSideOf(pick({ index: 5 }), back, 'left', 6)).toEqual({
      trigger: 'right',
      worldRight: false,
    })
  })

  it('mirrors centered cover/back edges for RTL reading', () => {
    // RTL：封面外缘在世界左（前进侧），封底外缘在世界右
    expect(foldSideOf(pick({ index: 0 }), placements, 'right')?.worldRight).toBe(false)
    const back = [{ index: 5, slot: 'center' as const }]
    expect(foldSideOf(pick({ index: 5 }), back, 'right', 6)?.worldRight).toBe(true)
  })

  it('returns null for other centered pages', () => {
    expect(foldSideOf(pick({ index: 3 }), [{ index: 3, slot: 'center' as const }], 'left', 6)).toBeNull()
  })

  it('folds the forward half of a single-page center page toward forward', () => {
    // 单页模式页缝固定在书脊侧：整页如"前进侧页"，仅前进半区可折前进
    const center = [{ index: 3, slot: 'center' as const }]
    expect(foldSideOf(pick({ index: 3, u: 0.8 }), center, 'left', 6, 1)).toEqual({
      trigger: 'left',
      worldRight: true,
    })
    // 后退半区不可折（走反向卷曲拖拽）
    expect(foldSideOf(pick({ index: 3, u: 0.3 }), center, 'left', 6, 1)).toBeNull()
    // RTL 镜像：缝在右缘，前进半区为 u < 0.5
    expect(foldSideOf(pick({ index: 3, u: 0.2 }), center, 'right', 6, 1)).toEqual({
      trigger: 'right',
      worldRight: false,
    })
    expect(foldSideOf(pick({ index: 3, u: 0.8 }), center, 'right', 6, 1)).toBeNull()
    // 封底页不可折前进
    expect(
      foldSideOf(pick({ index: 5, u: 0.8 }), [{ index: 5, slot: 'center' as const }], 'left', 6, 1),
    ).toBeNull()
  })

  it('splits merged spread meshes by uv', () => {
    expect(foldSideOf(pick({ spread: true, u: 0.8 }), [], 'left')?.worldRight).toBe(true)
    expect(foldSideOf(pick({ spread: true, u: 0.2 }), [], 'left')?.worldRight).toBe(false)
  })
})

describe('foldHitFromPick（外角圆形判定）', () => {
  it('flags hits inside the corner circle as edge drag', () => {
    const hit = foldHitFromPick(pick({ index: 2, u: 0.99, v: 0.02 }), placements, 'left', W)
    expect(hit).toMatchObject({ edge: true, cornerV: -1, trigger: 'left' })
  })

  it('flags mid-page presses as fold drag (edge=false)', () => {
    const hit = foldHitFromPick(pick({ index: 2, u: 0.5, v: 0.5 }), placements, 'left', W)
    expect(hit).toMatchObject({ edge: false, cornerV: 1, v: 0.5 })
  })

  it('uses world distance: the corner circle excludes the strip corners of the old rectangle', () => {
    // 矩形条带角落（横向 0.1W、纵向 0.42 世界）：世界距离 ≈0.48 > R=0.33，
    // 圆形判定下不属于角区（原矩形判定会误判为角区）
    const hit = foldHitFromPick(pick({ index: 2, u: 0.9, v: 0.21 }), placements, 'left', W)
    expect(hit?.edge).toBe(false)
  })

  it('boundary is continuous along the diagonal (no corner/edge flapping)', () => {
    // 沿对角线扫描穿越圆边界：edge 单调切换一次，无抖动区
    let transitions = 0
    let prev: boolean | null = null
    for (let i = 0; i <= 40; i++) {
      const d = (i / 40) * (R * 1.2)
      const u = 1 - (d * 0.6) / W
      const v = (d * 0.8) / 2
      const hit = foldHitFromPick(pick({ index: 2, u, v }), placements, 'left', W)
      const edge = hit?.edge ?? null
      if (prev !== null && edge !== prev) transitions++
      prev = edge
    }
    expect(transitions).toBe(1)
  })

  it('scales the circle for merged spread meshes by real width', () => {
    // 跨页网格 uv 覆盖 2W：同世界距离下命中一致
    const halfZoneU = 1 - (R * 0.9) / (2 * W) // 世界 0.9R → uv 偏移按 2W 折算
    const inCircle = foldHitFromPick(
      pick({ spread: true, u: halfZoneU, v: 0.01 }),
      [],
      'left',
      W,
    )
    expect(inCircle?.edge).toBe(true)
    const outCircle = foldHitFromPick(
      pick({ spread: true, u: 1 - (R * 1.2) / (2 * W), v: 0.01 }),
      [],
      'left',
      W,
    )
    expect(outCircle?.edge).toBe(false)
  })

  it('hits the cover corner circle on the closed-book layout (forward open)', () => {
    // 封面居中、右下角圆内（LTR 外缘在右）：折角拖拽，方向前进
    const hit = foldHitFromPick(pick({ index: 0, u: 0.99, v: 0.02 }), placements, 'left', W, 6)
    expect(hit).toMatchObject({ edge: true, cornerV: -1, trigger: 'left' })
  })
})

describe('foldStripFromPick（外角圆形悬停判定）', () => {
  it('hits only inside the corner circle', () => {
    expect(
      foldStripFromPick(pick({ index: 2, u: 0.98, v: 0.03 }), placements, 'left', W),
    ).not.toBeNull()
    // 横向贴近外缘、纵向在中部：不在圆内
    expect(
      foldStripFromPick(pick({ index: 2, u: 0.98, v: 0.5 }), placements, 'left', W),
    ).toBeNull()
    // 纵向贴近顶边、横向在中部：不在圆内
    expect(
      foldStripFromPick(pick({ index: 2, u: 0.5, v: 0.03 }), placements, 'left', W),
    ).toBeNull()
  })

  it('reports corner direction and radial deepening strength', () => {
    const shallow = foldStripFromPick(
      pick({ index: 2, u: 1 - (R * 0.85) / W, v: (R * 0.1) / 2 }),
      placements,
      'left',
      W,
    )
    const deep = foldStripFromPick(pick({ index: 2, u: 0.995, v: 0.01 }), placements, 'left', W)
    expect(shallow!.t).toBeLessThan(deep!.t)
    expect(deep!.cornerV).toBe(-1)
  })

  it('does not hit the spine-side edge of the page (LTR right page)', () => {
    // 右页外缘在 u=1；u 小（贴书脊）不属于外角圆
    expect(foldStripFromPick(pick({ index: 2, u: 0.05, v: 0.05 }), placements, 'left', W)).toBeNull()
  })
})
