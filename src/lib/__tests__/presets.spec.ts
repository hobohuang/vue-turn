import { describe, expect, it, vi } from 'vitest'

import { mergeLook, resolveFold, resolveLook, TURN_PRESETS } from '@/lib/presets'

describe('TURN_PRESETS', () => {
  it('soft 为普通纸张哑光，hard 为纸板刚体强光泽，custom 基线与 soft 一致', () => {
    expect(TURN_PRESETS.soft).toEqual({
      nPolygons: 64,
      perspective: 2400,
      ambient: 1,
      gloss: 0.15,
      curl: 0.8,
      enabled: true,
      bend: 0.04,
    })
    expect(TURN_PRESETS.hard.curl).toBe(0)
    expect(TURN_PRESETS.hard.gloss).toBeGreaterThan(TURN_PRESETS.soft.gloss)
    expect(TURN_PRESETS.hard.enabled).toBe(false)
    expect(TURN_PRESETS.custom).toEqual(TURN_PRESETS.soft)
  })
})

describe('resolveFold', () => {
  it('preset 档位为基线：soft 开启折角、hard 关闭', () => {
    expect(resolveFold('soft')).toEqual({ enabled: true, bend: 0.04 })
    expect(resolveFold('hard')).toEqual({ enabled: false, bend: 0 })
  })

  it('look.fold / look.bend 逐项覆盖任何档位（未传项回退基线）', () => {
    expect(resolveFold('soft', { fold: false })).toEqual({ enabled: false, bend: 0.04 })
    expect(resolveFold('soft', { bend: 0.3 })).toEqual({ enabled: true, bend: 0.3 })
    expect(resolveFold('hard', { fold: true })).toEqual({ enabled: true, bend: 0 })
    expect(resolveFold('hard', { fold: true, bend: 0 })).toEqual({ enabled: true, bend: 0 })
    expect(resolveFold('custom', { fold: false, bend: 0 })).toEqual({ enabled: false, bend: 0 })
  })

  it('look 中的 undefined 项不视为覆盖，回退基线', () => {
    expect(resolveFold('soft', { fold: undefined, bend: undefined })).toEqual({
      enabled: true,
      bend: 0.04,
    })
  })

  it('未传 preset 回退 soft', () => {
    expect(resolveFold(undefined)).toEqual({ enabled: true, bend: 0.04 })
    expect(resolveFold(undefined, { fold: false })).toEqual({ enabled: false, bend: 0.04 })
  })
})

describe('resolveLook', () => {
  it('preset 档位为基线，未传 look 时取档位值', () => {
    expect(resolveLook('soft')).toEqual({
      nPolygons: TURN_PRESETS.soft.nPolygons,
      perspective: TURN_PRESETS.soft.perspective,
      ambient: TURN_PRESETS.soft.ambient,
      gloss: TURN_PRESETS.soft.gloss,
      curl: TURN_PRESETS.soft.curl,
    })
    expect(resolveLook('hard')).toEqual({
      nPolygons: TURN_PRESETS.hard.nPolygons,
      perspective: TURN_PRESETS.hard.perspective,
      ambient: TURN_PRESETS.hard.ambient,
      gloss: TURN_PRESETS.hard.gloss,
      curl: TURN_PRESETS.hard.curl,
    })
  })

  it('look 逐项覆盖任何档位（未传项回退基线）', () => {
    expect(resolveLook('soft', { curl: 0.9, gloss: 0.5 })).toEqual({
      nPolygons: TURN_PRESETS.soft.nPolygons,
      perspective: TURN_PRESETS.soft.perspective,
      ambient: TURN_PRESETS.soft.ambient,
      gloss: 0.5,
      curl: 0.9,
    })
    expect(resolveLook('hard', { curl: 0.6 })).toEqual({
      nPolygons: TURN_PRESETS.hard.nPolygons,
      perspective: TURN_PRESETS.hard.perspective,
      ambient: TURN_PRESETS.hard.ambient,
      gloss: TURN_PRESETS.hard.gloss,
      curl: 0.6,
    })
  })

  it('look 中 undefined 项不视为覆盖，回退基线值', () => {
    expect(resolveLook('soft', { curl: undefined, nPolygons: undefined })).toEqual({
      nPolygons: TURN_PRESETS.soft.nPolygons,
      perspective: TURN_PRESETS.soft.perspective,
      ambient: TURN_PRESETS.soft.ambient,
      gloss: TURN_PRESETS.soft.gloss,
      curl: TURN_PRESETS.soft.curl,
    })
  })

  it('未传 preset 回退 soft', () => {
    expect(resolveLook(undefined, { curl: 0.9 }).curl).toBe(0.9)
  })

  it('非法 preset 回退 soft 并警告', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(resolveLook('fancy' as never, {}).curl).toBe(TURN_PRESETS.soft.curl)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('mergeLook', () => {
  it('coverLook 显式项覆盖 look，未传项保留 look', () => {
    expect(mergeLook({ nPolygons: 32, bend: 0.1 }, { nPolygons: 64, bend: 0.04, curl: 0.8 })).toEqual({
      nPolygons: 32,
      bend: 0.1,
      curl: 0.8,
    })
  })

  it('coverLook 中的 undefined 项不视为覆盖', () => {
    expect(mergeLook({ nPolygons: undefined }, { nPolygons: 64, curl: 0.8 })).toEqual({
      nPolygons: 64,
      curl: 0.8,
    })
  })

  it('coverLook 缺省时整体取 look；两者都缺省返回空对象', () => {
    expect(mergeLook(undefined, { curl: 0.8 })).toEqual({ curl: 0.8 })
    expect(mergeLook(undefined, undefined)).toEqual({})
  })

  it('look 缺省时整体取 coverLook', () => {
    expect(mergeLook({ curl: 0.2 }, undefined)).toEqual({ curl: 0.2 })
  })
})
