import { describe, expect, it, vi } from 'vitest'

import { resolveFold, resolveLook, TURN_PRESETS } from '@/lib/presets'

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
  it('soft 开启折角、hard 关闭，fold/bend prop 不生效（档位值最高优先级）', () => {
    expect(resolveFold('soft')).toEqual({ enabled: true, bend: 0.04 })
    expect(resolveFold('hard')).toEqual({ enabled: false, bend: 0 })
    expect(resolveFold('soft', false, 0.3)).toEqual({ enabled: true, bend: 0.04 })
    expect(resolveFold('hard', true)).toEqual({ enabled: false, bend: 0 })
  })

  it('custom 档由 fold/bend prop 显式设置，未传回退基线', () => {
    expect(resolveFold('custom')).toEqual({ enabled: true, bend: 0.04 })
    expect(resolveFold('custom', false)).toEqual({ enabled: false, bend: 0.04 })
    expect(resolveFold('custom', undefined, 0.3)).toEqual({ enabled: true, bend: 0.3 })
    expect(resolveFold('custom', false, 0)).toEqual({ enabled: false, bend: 0 })
  })

  it('未传 preset 回退 soft', () => {
    expect(resolveFold(undefined)).toEqual({ enabled: true, bend: 0.04 })
  })
})

describe('resolveLook', () => {
  it('soft/hard 档位值最高优先级，显式传入的专业参数不生效', () => {
    expect(resolveLook('soft', { curl: 0.1, gloss: 0.9, nPolygons: 12 })).toEqual({
      nPolygons: TURN_PRESETS.soft.nPolygons,
      perspective: TURN_PRESETS.soft.perspective,
      ambient: TURN_PRESETS.soft.ambient,
      gloss: TURN_PRESETS.soft.gloss,
      curl: TURN_PRESETS.soft.curl,
    })
    expect(resolveLook('hard', { curl: 0.9 })).toEqual({
      nPolygons: TURN_PRESETS.hard.nPolygons,
      perspective: TURN_PRESETS.hard.perspective,
      ambient: TURN_PRESETS.hard.ambient,
      gloss: TURN_PRESETS.hard.gloss,
      curl: TURN_PRESETS.hard.curl,
    })
  })

  it('custom 档逐项采用显式参数，未传项回退基线', () => {
    expect(resolveLook('custom', { curl: 0.9, gloss: 0.5 })).toEqual({
      nPolygons: TURN_PRESETS.custom.nPolygons,
      perspective: TURN_PRESETS.custom.perspective,
      ambient: TURN_PRESETS.custom.ambient,
      gloss: 0.5,
      curl: 0.9,
    })
  })

  it('custom 档 undefined 覆盖不生效，回退基线值', () => {
    expect(resolveLook('custom', { curl: undefined, nPolygons: undefined })).toEqual({
      nPolygons: TURN_PRESETS.custom.nPolygons,
      perspective: TURN_PRESETS.custom.perspective,
      ambient: TURN_PRESETS.custom.ambient,
      gloss: TURN_PRESETS.custom.gloss,
      curl: TURN_PRESETS.custom.curl,
    })
  })

  it('未传 preset 回退 soft', () => {
    expect(resolveLook(undefined, { curl: 0.9 }).curl).toBe(TURN_PRESETS.soft.curl)
  })

  it('非法 preset 回退 soft 并警告', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(resolveLook('fancy' as never, {}).curl).toBe(TURN_PRESETS.soft.curl)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
