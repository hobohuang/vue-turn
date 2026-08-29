import { describe, expect, it, vi } from 'vitest'

import { resolveLook, TURN_PRESETS } from '@/lib/presets'

describe('TURN_PRESETS', () => {
  it('realistic 等于历史默认值，未传 preset 的老用法行为不变', () => {
    expect(TURN_PRESETS.realistic).toEqual({
      nPolygons: 64,
      perspective: 2400,
      ambient: 1,
      gloss: 0.35,
      curl: 0.8,
    })
  })

  it('crisp 低卷曲弱光泽，soft 高卷曲平光影', () => {
    expect(TURN_PRESETS.crisp.curl).toBeLessThan(TURN_PRESETS.realistic.curl)
    expect(TURN_PRESETS.crisp.gloss).toBeLessThan(TURN_PRESETS.realistic.gloss)
    expect(TURN_PRESETS.soft.curl).toBeGreaterThan(TURN_PRESETS.realistic.curl)
    expect(TURN_PRESETS.soft.perspective).toBeGreaterThan(TURN_PRESETS.realistic.perspective)
  })
})

describe('resolveLook', () => {
  it('无覆盖时返回 preset 成组默认值', () => {
    expect(resolveLook('crisp', {})).toEqual(TURN_PRESETS.crisp)
    expect(resolveLook('soft', {})).toEqual(TURN_PRESETS.soft)
  })

  it('显式传入的专业参数逐项覆盖 preset', () => {
    expect(resolveLook('crisp', { curl: 0.9, gloss: 0.5 })).toEqual({
      ...TURN_PRESETS.crisp,
      curl: 0.9,
      gloss: 0.5,
    })
  })

  it('undefined 覆盖不生效，回退 preset 值', () => {
    expect(resolveLook('soft', { curl: undefined, nPolygons: undefined })).toEqual(
      TURN_PRESETS.soft,
    )
  })

  it('未传 preset 回退 realistic', () => {
    expect(resolveLook(undefined, {})).toEqual(TURN_PRESETS.realistic)
  })

  it('非法 preset 回退 realistic 并在开发环境警告', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(resolveLook('fancy' as never, {})).toEqual(TURN_PRESETS.realistic)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
