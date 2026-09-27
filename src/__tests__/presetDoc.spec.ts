import { beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, reactive, ref } from 'vue'

import TurnItem from '@/components/TurnItem.vue'
import VueTurn from '@/components/VueTurn.vue'
import { sheetWorldWidth } from '@/lib/flipSpec'
import type { FlipSheetOptions, FlipSpec, LookOptions, TurnInstance, TurnPreset } from '@/types/turn'

// README「观感预设」与「封面与封底」两节的逐条对账：
// 档位基线、look/coverLook 逐项覆盖、非法值回退、封面纸张独立档。
enableAutoUnmount(beforeEach)

type FakeTexture = { dispose: () => void }

const mocks = vi.hoisted(() => {
  return {
    // 场景构造参数快照：preset / coverPreset 解析后的观感参数最终落到这里
    rendererOptions: null as Record<string, unknown> | null,
    startFlip: vi.fn<
      (
        spec: FlipSpec,
        front: FakeTexture | null,
        back: FakeTexture | null,
        duration: number,
        onDone: (committed?: boolean) => void,
        options?: FlipSheetOptions,
      ) => void
    >(),
    startFoldFlip: vi.fn<
      (
        spec: FlipSpec,
        front: FakeTexture | null,
        back: FakeTexture | null,
        duration: number,
        onDone: (committed?: boolean) => void,
        options?: FlipSheetOptions,
        bend?: number,
      ) => boolean
    >().mockReturnValue(false),
    setStaticPages: vi.fn<(placements: unknown[], textureOf: (index: number) => unknown) => void>(),
    applyStaticTexture: vi.fn<(index: number, texture: FakeTexture) => void>(),
    setCoverPages: vi.fn<(indices: number[]) => void>(),
    setStacks: vi.fn<() => void>(),
    pickStack: vi.fn<() => null>().mockReturnValue(null),
    setStackHover: vi.fn<() => void>(),
  }
})

vi.mock('@/composables/useTurnRenderer', () => ({
  // 捕获 useTurnRenderer 的入参（即组件解析出的档位值）
  useTurnRenderer: (options: Record<string, unknown>) => {
    mocks.rendererOptions = options
    return {
      container: ref(null),
      containerSize: reactive({ width: 900, height: 600 }),
      webglSupported: ref(true),
      maxAnisotropy: ref(8),
      setStaticPages: mocks.setStaticPages,
      applyStaticTexture: mocks.applyStaticTexture,
      setCoverPages: mocks.setCoverPages,
      startFlip: mocks.startFlip,
      startFoldFlip: mocks.startFoldFlip,
      beginDragFlip: vi.fn<() => boolean>().mockReturnValue(true),
      activateSheet: vi.fn<() => void>(),
      setDragProgress: vi.fn<() => void>(),
      endDragFlip: vi.fn<() => void>(),
      beginFoldDrag: vi.fn<() => boolean>().mockReturnValue(true),
      setFoldDragFromClient: vi.fn<() => number | null>().mockReturnValue(null),
      foldAnchorDistanceFromClient: vi.fn<() => number | null>().mockReturnValue(null),
      setFoldDragAt: vi.fn<() => number | null>().mockReturnValue(null),
      endFoldDrag: vi.fn<() => void>(),
      stopFlip: vi.fn<() => void>(),
      setZoom: vi.fn<() => void>(),
      getZoom: vi.fn<() => number>().mockReturnValue(1),
      panBy: vi.fn<() => void>(),
      pickPage: vi.fn<() => unknown>(),
      setStacks: mocks.setStacks,
      pickStack: mocks.pickStack,
      setStackHover: mocks.setStackHover,
      setMaxZoom: vi.fn<() => void>(),
    }
  },
}))

vi.mock('@/lib/textureFactory', () => ({
  elementToTexture: vi.fn<(el: HTMLElement) => Promise<FakeTexture>>().mockImplementation(() =>
    Promise.resolve({ dispose: vi.fn<() => void>() }),
  ),
  waitForResources: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}))

interface HostProps {
  preset?: TurnPreset
  coverPreset?: TurnPreset
  look?: LookOptions
  coverLook?: LookOptions
  pageAspect?: number
}

function createHost(props: HostProps = {}) {
  return defineComponent({
    name: 'PresetHost',
    setup() {
      const turnRef = ref<TurnInstance | null>(null)
      const page = ref(1)
      return () =>
        h('div', [
          h(
            VueTurn,
            {
              ref: turnRef,
              // 未传的 prop 保持 undefined，走组件默认值
              ...props,
              modelValue: page.value,
              'onUpdate:modelValue': (v: number) => {
                page.value = v
              },
            },
            {
              default: () => [
                h(TurnItem, { cover: true }, { default: () => [h('div', 'cover')] }),
                ...Array.from({ length: 4 }, (_, i) =>
                  h(TurnItem, null, { default: () => [h('div', `page ${i + 1}`)] }),
                ),
                h(TurnItem, { backCover: true }, { default: () => [h('div', 'back cover')] }),
              ],
            },
          ),
        ])
    },
  })
}

async function mountBook(props: HostProps = {}) {
  const wrapper = mount(createHost(props))
  await flushPromises()
  const inst = wrapper.findComponent(VueTurn).vm as unknown as TurnInstance
  return { wrapper, inst }
}

/** 前进一次翻页，返回纸张覆盖参数（FlipSheetOptions） */
function flipOnce(inst: TurnInstance) {
  resetFlipCalls()
  inst.next()
  return mocks.startFlip.mock.calls[0]?.[5]
}

/** 折页路径可用且同步收尾：连续翻页时状态机不会卡在"翻页中" */
function stubFoldFlipCommitting() {
  mocks.startFoldFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => {
    onDone(true)
    return true
  })
}

function resetFlipCalls() {
  mocks.startFlip.mock.calls.length = 0
  mocks.startFoldFlip.mock.calls.length = 0
}

/** 先翻开封面，再前进一次内页翻页：返回内页的卷曲覆盖参数与是否走了折页 */
function flipInnerOnce(inst: TurnInstance) {
  inst.next()
  resetFlipCalls()
  inst.next()
  return {
    curl: mocks.startFlip.mock.calls[0]?.[5],
    folded: mocks.startFoldFlip.mock.calls.length > 0,
    bendWorld: mocks.startFoldFlip.mock.calls[0]?.[6] as number | undefined,
  }
}

describe('README：观感预设（preset）档位值', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.startFoldFlip.mockReturnValue(false)
    // 同步收尾：每次翻页立即提交，便于连续翻页逐次断言
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
  })

  it('不传 preset → soft 档成组值', async () => {
    await mountBook()
    expect(mocks.rendererOptions).toMatchObject({
      nPolygons: 64,
      perspective: 2400,
      ambient: 1,
      gloss: 0.15,
      curl: 0.8,
    })
  })

  it('preset="hard" → 纸板档成组值（32 段 / 零卷曲 / 强光泽）', async () => {
    await mountBook({ preset: 'hard' })
    expect(mocks.rendererOptions).toMatchObject({
      nPolygons: 32,
      perspective: 2400,
      ambient: 1,
      gloss: 0.8,
      curl: 0,
    })
  })

  it('look 逐项覆盖任何档位（未传项回退档位基线）', async () => {
    await mountBook({
      preset: 'hard',
      look: { curl: 0.6, gloss: 0.1, ambient: 3, nPolygons: 128, perspective: 800 },
    })
    expect(mocks.rendererOptions).toMatchObject({
      nPolygons: 128,
      perspective: 800,
      ambient: 3,
      gloss: 0.1,
      curl: 0.6,
    })
  })

  it('look 未传项回退档位基线', async () => {
    await mountBook({ preset: 'hard', look: { gloss: 0.42 } })
    expect(mocks.rendererOptions).toMatchObject({
      nPolygons: 32,
      perspective: 2400,
      ambient: 1,
      gloss: 0.42,
      curl: 0,
    })
  })

  it('look.fold 任何档位可设：soft 关闭折角、hard 开启折角', async () => {
    // 断言对象为内页翻页（封面另按 coverPreset 取档，见下方封面用例）
    stubFoldFlipCommitting()
    let host = await mountBook({ preset: 'soft', look: { fold: false } })
    expect(flipInnerOnce(host.inst).folded).toBe(false)
    expect(mocks.startFlip).toHaveBeenCalledTimes(1)

    stubFoldFlipCommitting()
    host = await mountBook({ preset: 'hard', look: { fold: true } })
    expect(flipInnerOnce(host.inst).folded).toBe(true)
  })

  it('look.bend 任何档位可设：折页动画收到 bend × 单页世界宽度', async () => {
    stubFoldFlipCommitting()
    const host = await mountBook({ preset: 'custom', look: { bend: 0.1 }, pageAspect: 0.75 })
    expect(flipInnerOnce(host.inst).bendWorld).toBeCloseTo(0.1 * sheetWorldWidth(0.75), 6)

    stubFoldFlipCommitting()
    const soft = await mountBook({ preset: 'soft', pageAspect: 0.75 })
    // 未传 look.bend 回退 soft 基线 0.04
    expect(flipInnerOnce(soft.inst).bendWorld).toBeCloseTo(0.04 * sheetWorldWidth(0.75), 6)
  })

  it('非法 preset → 回退 soft 并 console.warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await mountBook({ preset: 'fancy' as unknown as TurnPreset })
    expect(mocks.rendererOptions).toMatchObject({ curl: 0.8, gloss: 0.15, nPolygons: 64 })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('fancy'))
    warn.mockRestore()
  })
})

describe('README：封面与封底（coverPreset）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.startFoldFlip.mockReturnValue(false)
    // 同步收尾：每次翻页立即提交，便于连续翻页逐次断言
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
  })

  it('封面/封底独占纸张：页索引 0,1 与末两索引挂封面图层', async () => {
    // 7 面（封面 + 4 内页 + 封底），封面无 #back → 内页区段 4 页 + 补 1 空白
    const host = await mountBook()
    expect(mocks.setCoverPages).toHaveBeenLastCalledWith([0, 1, 6, 7])
    expect(host.inst.numPages).toBe(8)
  })

  it('默认 coverPreset="hard"：封面灯光组取 hard 档光影，内页仍 soft', async () => {
    await mountBook()
    expect(mocks.rendererOptions).toMatchObject({
      ambient: 1,
      gloss: 0.15,
      coverAmbient: 1,
      coverGloss: 0.8,
    })
  })

  it('coverPreset="soft"（软封面）：封面灯光组与卷曲档按 soft', async () => {
    await mountBook({ coverPreset: 'soft' })
    expect(mocks.rendererOptions).toMatchObject({ coverAmbient: 1, coverGloss: 0.15 })
  })

  it('preset="hard" + coverPreset="soft"：封面卷曲、内页刚体，互不干扰', async () => {
    const host = await mountBook({ preset: 'hard', coverPreset: 'soft' })
    // 封面纸张：curl/nPolygons 覆盖为 soft 档
    expect(flipOnce(host.inst)).toEqual({ curl: 0.8, nPolygons: 64 })
    // 内页：无覆盖，走 preset（hard）值
    expect(flipOnce(host.inst)).toEqual({})
    expect(flipOnce(host.inst)).toEqual({})
    // 封底纸张（索引 6,7）同样按封面档
    host.inst.goToPage(6)
    flipOnce(host.inst)
    expect(mocks.startFlip.mock.calls[0]?.[5]).toEqual({ curl: 0.8, nPolygons: 64 })
  })

  it('coverLook 可独立于内页设置：未传项回退 look', async () => {
    const host = await mountBook({
      preset: 'custom',
      coverPreset: 'custom',
      look: { curl: 0.5, gloss: 0.42, nPolygons: 20 },
      coverLook: { nPolygons: 40, gloss: 0.6 },
    })
    expect(mocks.rendererOptions).toMatchObject({
      curl: 0.5,
      gloss: 0.42,
      nPolygons: 20,
      coverAmbient: 1,
      coverGloss: 0.6,
    })
    // 封面纸张翻页：nPolygons 取 coverLook 覆盖值，curl 回退 look
    expect(flipOnce(host.inst)).toEqual({ curl: 0.5, nPolygons: 40 })
  })

  it('封面折页档按 coverPreset：hard 封面刚体翻转、soft 封面走折页', async () => {
    stubFoldFlipCommitting()
    // 默认组合（内页 soft + 封面 hard）：封面翻起为刚体卷曲（curl 0），内页仍折页
    const hard = await mountBook()
    expect(flipOnce(hard.inst)).toEqual({ curl: 0, nPolygons: 32 })
    expect(mocks.startFoldFlip).not.toHaveBeenCalled()
    expect(flipInnerOnce(hard.inst).folded).toBe(true)

    stubFoldFlipCommitting()
    // 软封面：封面与内页同样走折页动画，折缝取 soft 档 bend
    const soft = await mountBook({ coverPreset: 'soft' })
    flipOnce(soft.inst)
    expect(mocks.startFoldFlip).toHaveBeenCalledTimes(1)
    expect(mocks.startFoldFlip.mock.calls[0]?.[6]).toBeCloseTo(0.04 * sheetWorldWidth(0.75), 6)

    stubFoldFlipCommitting()
    // coverLook.bend 独立覆盖封面折缝
    const bent = await mountBook({ coverPreset: 'soft', coverLook: { bend: 0.12 } })
    flipOnce(bent.inst)
    expect(mocks.startFoldFlip.mock.calls[0]?.[6]).toBeCloseTo(0.12 * sheetWorldWidth(0.75), 6)
  })

  it('非法 coverPreset → 回退 soft 并 console.warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await mountBook({ coverPreset: 'leather' as unknown as TurnPreset })
    expect(mocks.rendererOptions).toMatchObject({ coverAmbient: 1, coverGloss: 0.15 })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('leather'))
    warn.mockRestore()
  })
})
