import { describe, expect, it, vi } from 'vitest'

import { resolveFold, resolveLook, TURN_PRESETS } from '@/lib/presets'

describe('TURN_PRESETS', () => {
  it('soft 为普通纸张哑光，hard 为纸板刚体强光泽', () => {
    expect(TURN_PRESETS.soft).toEqual({
      nPolygons: 64,
      perspective: 2400,
      ambient: 1,
      gloss: 0.15,
      curl: 0.8,
      enabled: true,
      bend: 0.16,
    })
    expect(TURN_PRESETS.hard.curl).toBe(0)
    expect(TURN_PRESETS.hard.gloss).toBeGreaterThan(TURN_PRESETS.soft.gloss)
    expect(TURN_PRESETS.hard.enabled).toBe(false)
  })
})

describe('resolveFold', () => {
  it('soft 开启折角，hard 关闭折角', () => {
    expect(resolveFold('soft')).toEqual({ enabled: true, bend: 0.16 })
    expect(resolveFold('hard')).toEqual({ enabled: false, bend: 0 })
  })

  it('顶层 fold prop 显式覆盖预设开关，bend 仍取预设', () => {
    expect(resolveFold('soft', false)).toEqual({ enabled: false, bend: 0.16 })
    expect(resolveFold('hard', true).enabled).toBe(true)
  })

  it('未传 preset 回退 soft', () => {
    expect(resolveFold(undefined)).toEqual({ enabled: true, bend: 0.16 })
  })
})

describe('resolveLook', () => {
  it('无覆盖时返回 preset 成组默认值', () => {
    expect(resolveLook('hard', {})).toEqual({
      nPolygons: TURN_PRESETS.hard.nPolygons,
      perspective: TURN_PRESETS.hard.perspective,
      ambient: TURN_PRESETS.hard.ambient,
      gloss: TURN_PRESETS.hard.gloss,
      curl: TURN_PRESETS.hard.curl,
    })
  })

  it('显式传入的专业参数逐项覆盖 preset', () => {
    expect(resolveLook('hard', { curl: 0.9, gloss: 0.5 })).toEqual({
      nPolygons: TURN_PRESETS.hard.nPolygons,
      perspective: TURN_PRESETS.hard.perspective,
      ambient: TURN_PRESETS.hard.ambient,
      gloss: 0.5,
      curl: 0.9,
    })
  })

  it('undefined 覆盖不生效，回退 preset 值', () => {
    const soft = {
      nPolygons: TURN_PRESETS.soft.nPolygons,
      perspective: TURN_PRESETS.soft.perspective,
      ambient: TURN_PRESETS.soft.ambient,
      gloss: TURN_PRESETS.soft.gloss,
      curl: TURN_PRESETS.soft.curl,
    }
    expect(resolveLook('soft', { curl: undefined, nPolygons: undefined })).toEqual(soft)
  })

  it('未传 preset 回退 soft', () => {
    expect(resolveLook(undefined, {})).toEqual({
      nPolygons: TURN_PRESETS.soft.nPolygons,
      perspective: TURN_PRESETS.soft.perspective,
      ambient: TURN_PRESETS.soft.ambient,
      gloss: TURN_PRESETS.soft.gloss,
      curl: TURN_PRESETS.soft.curl,
    })
  })

  it('非法 preset 回退 soft 并警告', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(resolveLook('fancy' as never, {}).curl).toBe(TURN_PRESETS.soft.curl)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
