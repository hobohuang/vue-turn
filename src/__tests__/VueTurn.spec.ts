import { beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, reactive, ref } from 'vue'

import TurnItem from '@/components/TurnItem.vue'
import VueTurn from '@/components/VueTurn.vue'
import type { KeyboardMode, LookOptions, TurnInstance } from '@/types/turn'

// 组件卸载时会移除 document 级键盘监听并递减实例计数（多实例键盘互斥依赖
// 该计数），必须每个用例后自动卸载，否则泄漏实例会跨用例干扰互斥判定
enableAutoUnmount(beforeEach)

type FakeTexture = { dispose: () => void }

const mocks = vi.hoisted(() => {
  // 模拟真实 TurnScene 的同步收尾行为：
  // startFlip/beginDragFlip 记录回调，由 endDragFlip/stopFlip 触发
  const done = {
    flip: null as null | ((committed: boolean) => void),
    drag: null as null | ((committed: boolean) => void),
  }
  // 模拟场景缩放状态：setZoom 写入、getZoom 读出
  // （applyZoom 依赖 getZoom 返回真实值来决定是否派发 zoom-change）
  let zoomState = 1
  return {
    done,
    startFlip: vi.fn<
      (
        spec: import('@/types/turn').FlipSpec,
        front: FakeTexture | null,
        back: FakeTexture | null,
        duration: number,
        onDone: (committed?: boolean) => void,
        options?: import('@/types/turn').FlipSheetOptions,
      ) => void
    >(),
    startFoldFlip: vi.fn<
      (
        spec: import('@/types/turn').FlipSpec,
        front: FakeTexture | null,
        back: FakeTexture | null,
        duration: number,
        onDone: (committed?: boolean) => void,
        options?: import('@/types/turn').FlipSheetOptions,
        bend?: number,
      ) => boolean
    >().mockReturnValue(false),
    beginDragFlip: vi.fn<
      (
        spec: import('@/types/turn').FlipSpec,
        front: FakeTexture | null,
        back: FakeTexture | null,
        onDone: (committed?: boolean) => void,
        options?: import('@/types/turn').FlipSheetOptions,
        preview?: boolean,
      ) => boolean
    >(),
    endDragFlip: vi.fn<(commit: boolean, baseDuration: number) => void>(),
    activateSheet: vi.fn<() => void>(),
    stopFlip: vi.fn<() => void>(),
    setDragProgress: vi.fn<(progress: number) => void>(),
    beginFoldDrag: vi.fn<
      (
        spec: import('@/types/turn').FlipSpec,
        front: FakeTexture | null,
        back: FakeTexture | null,
        pickU: number,
        pickV: number,
        bend: number,
        onDone: (committed?: boolean) => void,
        options?: import('@/types/turn').FlipSheetOptions,
        preview?: boolean,
      ) => boolean
    >(),
    setFoldDragFromClient: vi.fn<(x: number, y: number, lockedV?: number) => number | null>(),
    foldAnchorDistanceFromClient: vi.fn<(x: number, y: number) => number | null>(),
    setFoldDragAt: vi.fn<(qu: number, qv: number) => number | null>(),
    endFoldDrag: vi.fn<(commit: boolean, baseDuration: number) => void>(),
    setZoom: vi.fn<(level: number, animate?: boolean, duration?: number) => void>(),
    getZoom: vi.fn<() => number>(),
    // 缩放状态访问器（测试内复位/写入，各用例独立）
    resetZoomState: () => {
      zoomState = 1
    },
    setZoomState: (value: number) => {
      zoomState = value
    },
    readZoomState: (): number => zoomState,
    panBy: vi.fn<(dx: number, dy: number) => void>(),
    pickPage: vi.fn<(x: number, y: number) => unknown>(),
    setStaticPages: vi.fn<(placements: unknown[], textureOf: (index: number) => unknown) => void>(),
    applyStaticTexture: vi.fn<(index: number, texture: FakeTexture) => void>(),
    setCoverPages: vi.fn<(indices: number[]) => void>(),
    setStacks: vi.fn<() => void>(),
    elementToTexture: vi.fn<(element: HTMLElement) => Promise<FakeTexture>>(),
    solidColorTexture: vi.fn<() => FakeTexture>(),
  }
})

vi.mock('@/composables/useTurnRenderer', () => ({
  useTurnRenderer: () => ({
    container: ref(null),
    containerSize: reactive({ width: 900, height: 600 }),
    webglSupported: ref(true),
    maxAnisotropy: ref(8),
    setStaticPages: mocks.setStaticPages,
    applyStaticTexture: mocks.applyStaticTexture,
    setCoverPages: mocks.setCoverPages,
    startFlip: mocks.startFlip,
    startFoldFlip: mocks.startFoldFlip,
    beginDragFlip: mocks.beginDragFlip,
    activateSheet: mocks.activateSheet,
    setDragProgress: mocks.setDragProgress,
    endDragFlip: mocks.endDragFlip,
    beginFoldDrag: mocks.beginFoldDrag,
    setFoldDragFromClient: mocks.setFoldDragFromClient,
    foldAnchorDistanceFromClient: mocks.foldAnchorDistanceFromClient,
    setFoldDragAt: mocks.setFoldDragAt,
    endFoldDrag: mocks.endFoldDrag,
    stopFlip: mocks.stopFlip,
    setZoom: mocks.setZoom,
    getZoom: mocks.getZoom,
    panBy: mocks.panBy,
    pickPage: mocks.pickPage,
    setStacks: mocks.setStacks,
    pickStack: vi.fn<() => null>().mockReturnValue(null),
    setStackHover: vi.fn<() => void>(),
  }),
}))

vi.mock('@/lib/textureFactory', () => ({
  elementToTexture: mocks.elementToTexture,
  solidColorTexture: mocks.solidColorTexture,
  waitForResources: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}))

function pages(count: number) {
  return Array.from({ length: count }, (_, index) =>
    h(TurnItem, null, { default: () => [h('div', `page ${index + 1}`)] }),
  )
}

// 外置工具栏宿主：通过 ref 调用实例方法、v-model 同步页码、事件驱动按钮状态。
// 模拟真实使用方"工具栏移到组件外面"的调用模式。
interface HostProps {
  numPages?: number
  pageWidth?: number
  displayedPages?: 'auto' | 1 | 2
  clickToFlip?: boolean
  peel?: boolean
  look?: LookOptions
  preset?: 'soft' | 'hard' | 'custom'
  coverPreset?: 'soft' | 'hard' | 'custom'
  modelValue?: number
  defaultPages?: number
  keyboard?: KeyboardMode
}

function createHost(props: HostProps = {}) {
  return defineComponent({
    name: 'TestHost',
    setup() {
      const turnRef = ref<TurnInstance | null>(null)
      const page = ref(props.modelValue ?? 1)
      // item 数固定驱动默认插槽；numPages（含空白衬页）由 onReady 回报，
      // 仅用于指示器展示，不能回写进插槽（否则 6 item → 8 页 → 8 item 反馈循环）
      const itemCount = props.numPages ?? 6
      const total = ref(props.numPages ?? 6)
      const flipping = ref(false)
      // canNext/canPrev 是实例 getter，非响应式；用 tick 在事件后强制重渲
      const tick = ref(0)
      const bump = () => {
        tick.value++
      }
      return () => {
        void tick.value
        const inst = turnRef.value
        const canNext = flipping.value ? false : (inst?.canNext ?? false)
        const canPrev = flipping.value ? false : (inst?.canPrev ?? false)
        return h('div', [
          h(
            VueTurn,
            {
              ref: turnRef,
              modelValue: page.value,
              displayedPages: props.displayedPages,
              clickToFlip: props.clickToFlip,
              peel: props.peel,
              look: props.look,
              preset: props.preset,
              coverPreset: props.coverPreset,
              keyboard: props.keyboard,
              'onUpdate:modelValue': (v: number) => {
                page.value = v
                bump()
              },
              onChange: (v: number) => {
                page.value = v
                bump()
              },
              onFlipStart: () => {
                flipping.value = true
                bump()
              },
              onFlipEnd: () => {
                flipping.value = false
                bump()
              },
              onReady: () => {
                total.value = inst?.numPages ?? total.value
                bump()
              },
            },
            {
              default: () => pages(props.defaultPages ?? itemCount),
            },
          ),
          h('div', { class: 'toolbar' }, [
            h(
              'button',
              {
                id: 'prev',
                disabled: !canPrev,
                onClick: () => inst?.prev(),
              },
              'prev',
            ),
            h('span', { id: 'indicator' }, `${page.value}/${total.value}`),
            h(
              'button',
              {
                id: 'next',
                disabled: !canNext,
                onClick: () => inst?.next(),
              },
              'next',
            ),
            h(
              'button',
              {
                id: 'jump',
                onClick: () => inst?.goToPage(5),
              },
              'jump',
            ),
          ]),
        ])
      }
    },
  })
}

async function mountTurn(
  numPages = 6,
  extraProps: {
    displayedPages?: 'auto' | 1 | 2
    clickToFlip?: boolean
    peel?: boolean
    look?: LookOptions
    preset?: 'soft' | 'hard' | 'custom'
    coverPreset?: 'soft' | 'hard' | 'custom'
    modelValue?: number
    keyboard?: KeyboardMode
  } = {},
) {
  const Host = createHost({ numPages, ...extraProps })
  const wrapper = mount(Host)
  await flushPromises()
  return wrapper
}

describe('VueTurn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.done.flip = null
    mocks.done.drag = null
    // 缩放 mock 有状态：setZoom 写入 / getZoom 读出（applyZoom 据此判断
    // 场景是否真的执行了缩放，未执行时不派发 zoom-change）
    mocks.resetZoomState()
    mocks.setZoom.mockImplementation((level: number) => {
      mocks.setZoomState(level)
    })
    mocks.getZoom.mockImplementation(() => mocks.readZoomState())
    mocks.elementToTexture.mockResolvedValue({ dispose: vi.fn<() => void>() })
    // 空白补位页的纯色纸纹（与内容页光栅化路径分离）
    mocks.solidColorTexture.mockImplementation(() => ({ dispose: vi.fn<() => void>() }))
    // 默认：记录翻页回调但不调用（模拟翻页进行中）
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => {
      mocks.done.flip = onDone
    })
    // 默认：折页动画路径不可用（回退卷曲 startFlip），个别用例按需覆盖
    mocks.startFoldFlip.mockImplementation(() => false)
    // 默认：拖拽翻页可用，记录回调供 endDragFlip/stopFlip 触发
    mocks.beginDragFlip.mockImplementation((_spec, _front, _back, onDone) => {
      mocks.done.drag = onDone
      return true
    })
    mocks.endDragFlip.mockImplementation((commit: boolean) => {
      const cb = mocks.done.drag
      mocks.done.drag = null
      cb?.(commit)
    })
    mocks.stopFlip.mockImplementation(() => {
      // 模拟真实场景 stop 的同步收尾：优先拖拽（按取消），否则翻页动画（按提交）
      if (mocks.done.drag) {
        const cb = mocks.done.drag
        mocks.done.drag = null
        cb(false)
        return
      }
      const cb = mocks.done.flip
      mocks.done.flip = null
      cb?.(true)
    })
    // getZoom 默认读有状态 zoomState（初始 1）；此处不再 mockReturnValue
    // 固定值，否则 applyZoom 的前后对比恒等，zoom-change 永不派发
    mocks.pickPage.mockReturnValue(null)
    // 折角预览激活期间的角区进出判定：默认无折角纸张（预览未激活）
    mocks.foldAnchorDistanceFromClient.mockReset()
  })

  it('rasterizes every turn-item before first paint', async () => {
    await mountTurn()
    // 6 item → 8 页（封面/封底专用纸张各带一张空白衬页）；
    // 挂载窗口 [0,6) 命中页 0,2,3,4,5 的 DOM 光栅化（页 1 空白无 DOM）→ 5 次，
    // 另有空白衬页 1 的纯色纸纹一次，合计 6 次贴图
    expect(mocks.elementToTexture).toHaveBeenCalledTimes(5)
    expect(mocks.applyStaticTexture).toHaveBeenCalledTimes(6)
  })

  it('shows the first spread and disables the back flip', async () => {
    const wrapper = await mountTurn()
    expect(wrapper.find('#indicator').text()).toBe('1/8')
    expect(wrapper.find('#prev').attributes('disabled')).toBeDefined()
    expect(wrapper.find('#next').attributes('disabled')).toBeUndefined()
  })

  it('flips the cover sheet open before regular flips', async () => {
    const wrapper = await mountTurn()
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    expect(mocks.startFlip).toHaveBeenCalledTimes(1)
    const coverSpec = mocks.startFlip.mock.calls[0]?.[0]
    expect(coverSpec?.frontIndex).toBe(0)
    expect(coverSpec?.backIndex).toBe(1)
    expect(coverSpec?.worldFromX).toBeLessThan(0)
    expect(wrapper.find('#indicator').text()).toBe('2/8')
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    expect(mocks.startFlip).toHaveBeenCalledTimes(2)
    expect(wrapper.find('#indicator').text()).toBe('4/8')
  })

  it('flips the cover sheet closed when going back from page two', async () => {
    const wrapper = await mountTurn()
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('2/8')
    await wrapper.find('#prev').trigger('click')
    await flushPromises()
    expect(mocks.startFlip).toHaveBeenCalledTimes(2)
    const closeSpec = mocks.startFlip.mock.calls[1]?.[0]
    expect(closeSpec?.frontIndex).toBe(1)
    expect(closeSpec?.backIndex).toBe(0)
    expect(closeSpec?.delta).toBe(-1)
    expect(wrapper.find('#indicator').text()).toBe('1/8')
  })

  it('passes the correct sheet textures to the renderer', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    const wrapper = await mountTurn()
    await wrapper.find('#next').trigger('click')
    await wrapper.find('#next').trigger('click')
    const calls = mocks.startFlip.mock.calls
    const spec = calls[calls.length - 1]?.[0]
    expect(spec?.frontIndex).toBe(2)
    expect(spec?.backIndex).toBe(3)
    expect(spec?.staticPages).toEqual([
      { index: 1, slot: 'left' },
      { index: 4, slot: 'right' },
    ])
  })

  it('closes the back cover with a real sheet from the last spread', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    const wrapper = await mountTurn()
    await wrapper.find('#jump').trigger('click')
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('4/8')
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('6/8')
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    const calls = mocks.startFlip.mock.calls
    const closeSpec = calls[calls.length - 1]?.[0]
    expect(closeSpec?.frontIndex).toBe(6)
    expect(closeSpec?.backIndex).toBe(7)
    expect(closeSpec?.delta).toBe(2)
    expect(closeSpec?.worldToX).toBeGreaterThan(0)
    expect(wrapper.find('#indicator').text()).toBe('8/8')
    expect(wrapper.find('#next').attributes('disabled')).toBeDefined()
  })

  it('opens the back cover with a real sheet when going back', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    const wrapper = await mountTurn()
    await wrapper.find('#jump').trigger('click')
    await flushPromises()
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('8/8')
    await wrapper.find('#prev').trigger('click')
    await flushPromises()
    const calls = mocks.startFlip.mock.calls
    const openSpec = calls[calls.length - 1]?.[0]
    expect(openSpec?.frontIndex).toBe(7)
    expect(openSpec?.backIndex).toBe(6)
    expect(openSpec?.delta).toBe(-2)
    expect(wrapper.find('#indicator').text()).toBe('6/8')
  })

  it('jumps straight to a page through the instance api', async () => {
    const wrapper = await mountTurn(6)
    await wrapper.find('#jump').trigger('click')
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('4/8')
  })

  it('ignores flips while an animation is in flight', async () => {
    const wrapper = await mountTurn()
    mocks.startFlip.mockImplementation(() => undefined)
    await wrapper.find('#next').trigger('click')
    await wrapper.find('#jump').trigger('click')
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('1/8')
  })

  it('emits update:modelValue and change when a flip commits', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    const wrapper = await mountTurn()
    // 宿主消费 update:modelValue，所以直接断言 VueTurn 子组件发出的事件
    const turn = wrapper.findComponent(VueTurn)
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    const emitted = turn.emitted('update:modelValue')
    expect(emitted?.[emitted.length - 1]).toEqual([2])
    const changes = turn.emitted('change')
    expect(changes?.[changes.length - 1]).toEqual([2])
  })

  it('uses the fold animation for active flips when fold is enabled (soft default)', async () => {
    // fold 开启（soft 默认）：点击/next/prev 的主动翻页走折页动画而非卷曲。
    // 封面按 coverPreset 取档（默认 hard 为刚体卷曲），故传 soft 封面测折页路径
    mocks.startFoldFlip.mockImplementation(
      (_spec, _front, _back, _duration, onDone) => {
        onDone(true)
        return true
      },
    )
    const wrapper = await mountTurn(6, { coverPreset: 'soft' })
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    expect(mocks.startFoldFlip).toHaveBeenCalledTimes(1)
    expect(mocks.startFlip).not.toHaveBeenCalled()
    // 页码正常提交
    const turn = wrapper.findComponent(VueTurn)
    const emitted = turn.emitted('update:modelValue')
    expect(emitted?.[emitted.length - 1]).toEqual([2])
  })

  it('falls back to the curl animation for active flips when fold is disabled', async () => {
    // custom 档 + fold=false：主动翻页回退卷曲动画
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    const wrapper = await mountTurn(6, { preset: 'custom', look: { fold: false } })
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    expect(mocks.startFlip).toHaveBeenCalledTimes(1)
    expect(mocks.startFoldFlip).not.toHaveBeenCalled()
  })

  it('emits change on direct jumps too', async () => {
    const wrapper = await mountTurn()
    const turn = wrapper.findComponent(VueTurn)
    await wrapper.find('#jump').trigger('click')
    await flushPromises()
    const changes = turn.emitted('change')
    expect(changes?.[changes.length - 1]).toEqual([4])
  })

  it('emits unified flip-start and flip-end with direction', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    const wrapper = await mountTurn()
    const turn = wrapper.findComponent(VueTurn)
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    expect(turn.emitted('flip-start')).toEqual([['left']])
    expect(turn.emitted('flip-end')).toEqual([['left']])
  })

  it('emits ready once after the first rasterization', async () => {
    const wrapper = await mountTurn()
    const turn = wrapper.findComponent(VueTurn)
    expect(turn.emitted('ready')).toHaveLength(1)
    await wrapper.vm.$nextTick()
    await turn.vm.refresh()
    await flushPromises()
    expect(turn.emitted('ready')).toHaveLength(1)
  })

  it('follows external modelValue changes', async () => {
    const externalPage = ref(1)
    const Host = defineComponent({
      setup() {
        const turnRef = ref<TurnInstance | null>(null)
        return () =>
          h('div', [
            h(
              VueTurn,
              {
                ref: turnRef,
                modelValue: externalPage.value,
                'onUpdate:modelValue': (v: number) => {
                  externalPage.value = v
                },
              },
              { default: () => pages(12) },
            ),
            h('span', { id: 'indicator' }, `${externalPage.value}/12`),
          ])
      },
    })
    const wrapper = mount(Host)
    await flushPromises()
    // 挂载窗口只覆盖当前页附近；远跳后须补生成目标窗口内缺失的纹理，
    // 否则懒光栅化下目标页拿不到纹理而空白
    mocks.elementToTexture.mockClear()
    externalPage.value = 12
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('12/12')
    expect(mocks.elementToTexture).toHaveBeenCalled()
  })

  it('keeps working when a page texture fails to rasterize', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mocks.elementToTexture.mockReset()
    mocks.elementToTexture
      .mockResolvedValueOnce({ dispose: vi.fn<() => void>() })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ dispose: vi.fn<() => void>() })
    const wrapper = await mountTurn()
    expect(wrapper.find('#indicator').text()).toBe('1/8')
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('2/8')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('disposes textures that resolve after unmount', async () => {
    const dispose = vi.fn<() => void>()
    const resolvers: Array<() => void> = []
    mocks.elementToTexture.mockReset()
    mocks.elementToTexture.mockImplementation(
      () =>
        new Promise<FakeTexture>((resolve) => {
          resolvers.push(() => resolve({ dispose }))
        }),
    )
    const Host = createHost({ numPages: 2 })
    const wrapper = mount(Host)
    await flushPromises()
    wrapper.unmount()
    resolvers.forEach((resolve) => resolve())
    await flushPromises()
    expect(dispose).toHaveBeenCalledTimes(2)
  })

  it('isolates flip state between two instances', async () => {
    mocks.startFlip.mockImplementation(() => undefined)
    const first = await mountTurn()
    const second = await mountTurn()
    await first.find('#next').trigger('click')
    await flushPromises()
    // 第一个实例翻页中，第二个实例不受影响
    expect(first.find('#next').attributes('disabled')).toBeDefined()
    expect(second.find('#next').attributes('disabled')).toBeUndefined()
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    await second.find('#next').trigger('click')
    await flushPromises()
    expect(second.find('#indicator').text()).toBe('2/8')
    expect(first.find('#indicator').text()).toBe('1/8')
  })

  it('re-rasterizes when page content changes', async () => {
    const content = ref('initial')
    const Host = defineComponent({
      setup() {
        const turnRef = ref<TurnInstance | null>(null)
        const page = ref(1)
        return () =>
          h('div', [
            h(
              VueTurn,
              {
                ref: turnRef,
                modelValue: page.value,
                'onUpdate:modelValue': (v: number) => {
                  page.value = v
                },
              },
              {
                default: () => [
                  h(TurnItem, null, { default: () => [h('div', content.value)] }),
                ],
              },
            ),
          ])
      },
    })
    const wrapper = mount(Host)
    await flushPromises()
    // 单 item → 4 页（封面+空白衬页+空白衬页+封底同源）：
    // 窗口 [0,4) 内页 0、2、3 需要纹理（页 1 空白跳过），页 0/3 同源各光栅化一次
    expect(mocks.elementToTexture).toHaveBeenCalledTimes(2)
    content.value = 'updated'
    await flushPromises()
    // 内容变化映射到页 0 与页 3，两页都重光栅化
    expect(mocks.elementToTexture).toHaveBeenCalledTimes(4)
    expect(wrapper.findComponent(VueTurn).vm.page).toBe(1)
  })

  it('keeps navigation consistent when pages are added dynamically', async () => {
    const count = ref(4)
    const Host = defineComponent({
      setup() {
        const turnRef = ref<TurnInstance | null>(null)
        const page = ref(1)
        const flipping = ref(false)
        const tick = ref(0)
        const bump = () => {
          tick.value++
        }
        return () => {
          void tick.value
          return h('div', [
            h(
              VueTurn,
              {
                ref: turnRef,
                modelValue: page.value,
                'onUpdate:modelValue': (v: number) => {
                  page.value = v
                  bump()
                },
                onChange: (v: number) => {
                  page.value = v
                  bump()
                },
                onFlipStart: () => {
                  flipping.value = true
                  bump()
                },
                onFlipEnd: () => {
                  flipping.value = false
                  bump()
                },
              },
              {
                default: () => pages(count.value),
              },
            ),
            h('div', { class: 'toolbar' }, [
              h('span', { id: 'indicator' }, `${page.value}/${count.value}`),
            ]),
          ])
        }
      },
    })
    const wrapper = mount(Host)
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('1/4')
    // 4 item → 6 页（窗口 [0,6) 内页 0,2,3,5 需要纹理，页 1/4 空白跳过）
    expect(mocks.elementToTexture).toHaveBeenCalledTimes(4)
    count.value = 6
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe(`1/${count.value}`)
    // 新增两页触发整窗强制重光栅化：窗口 [0,6) 内页 0,2,3,4,5 全部重光栅化
    // （页 1/6 空白跳过）→ 4 + 5 = 9
    expect(mocks.elementToTexture).toHaveBeenCalledTimes(9)
  })

  it('exposes next/prev and readonly state on the instance api', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    const wrapper = await mountTurn()
    const inst = wrapper.findComponent(VueTurn).vm as unknown as TurnInstance
    expect(inst.page).toBe(1)
    expect(inst.numPages).toBe(8)
    expect(inst.isFlipping).toBe(false)
    inst.next()
    await flushPromises()
    expect(inst.page).toBe(2)
    inst.prev()
    await flushPromises()
    expect(inst.page).toBe(1)
  })

  it('exposes canNext/canPrev on the instance api', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    const wrapper = await mountTurn()
    const inst = wrapper.findComponent(VueTurn).vm as unknown as TurnInstance
    // 封面：可前进、不可后退
    expect(inst.canNext).toBe(true)
    expect(inst.canPrev).toBe(false)
    // 跳到末页
    inst.goToPage(8)
    await flushPromises()
    expect(inst.canNext).toBe(false)
    expect(inst.canPrev).toBe(true)
  })

  it('refreshPage re-rasterizes only the targeted page', async () => {
    const wrapper = await mountTurn()
    mocks.elementToTexture.mockClear()
    const inst = wrapper.findComponent(VueTurn).vm as unknown as TurnInstance
    await inst.refreshPage(3)
    await flushPromises()
    expect(mocks.elementToTexture).toHaveBeenCalledTimes(1)
  })

  it('emits rasterize-error when a page fails to rasterize', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mocks.elementToTexture.mockReset()
    mocks.elementToTexture
      .mockResolvedValueOnce({ dispose: vi.fn<() => void>() })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ dispose: vi.fn<() => void>() })
    const wrapper = await mountTurn()
    const turn = wrapper.findComponent(VueTurn)
    const errors = turn.emitted('rasterize-error')
    // 窗口内第 2 个光栅化的内容页（页索引 2，1 起页码 3）失败
    expect(errors?.[0]?.[0]).toBe(3)
    warn.mockRestore()
  })

  it('flips forward when clicking the right half of the viewport', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    const wrapper = await mountTurn()
    const viewport = wrapper.find('.viewport')
    // 模拟点击右半区：clientX 取元素右缘
    const el = viewport.element as HTMLElement
    el.getBoundingClientRect = () => ({ left: 0, width: 900, height: 600 }) as DOMRect
    await viewport.trigger('click', { clientX: 700 })
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('2/8')
  })

  it('does not flip on click when clickToFlip is disabled', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    const wrapper = await mountTurn(6, { clickToFlip: false })
    const viewport = wrapper.find('.viewport')
    const el = viewport.element as HTMLElement
    el.getBoundingClientRect = () => ({ left: 0, width: 900, height: 600 }) as DOMRect
    await viewport.trigger('click', { clientX: 700 })
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('1/8')
  })

  it('flips with arrow keys when focused', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    const wrapper = await mountTurn()
    const viewport = wrapper.find('.viewport')
    await viewport.trigger('keydown', { key: 'ArrowRight' })
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('2/8')
    // 回到封面后左键不再前进
    await viewport.trigger('keydown', { key: 'ArrowLeft' })
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('1/8')
  })

  it('supports PageDown, Space, PageUp, Home and End keys', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    const wrapper = await mountTurn()
    const viewport = wrapper.find('.viewport')
    // Space 前进（封面展开）
    await viewport.trigger('keydown', { key: ' ' })
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('2/8')
    // PageDown 常规翻页
    await viewport.trigger('keydown', { key: 'PageDown' })
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('4/8')
    // End 跳到末页（封底合上）
    await viewport.trigger('keydown', { key: 'End' })
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('8/8')
    // Home 跳回首页
    await viewport.trigger('keydown', { key: 'Home' })
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('1/8')
    // PageUp 在首页无效果
    await viewport.trigger('keydown', { key: 'PageUp' })
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('1/8')
  })

  it('flips via document keydown when focus is outside the component (keyboard global mode)', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    const wrapper = await mountTurn(6, { keyboard: 'global' })
    // 焦点在组件外（document/body）：点击工具栏按钮后按键的场景
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('2/8')
    // 组件内部目标的 keydown 已由 viewport 处理，document 层不重复翻页
    await wrapper.find('.viewport').trigger('keydown', { key: 'ArrowRight' })
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('4/8')
  })

  it('does not hijack keydown from editable elements outside the component', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    const wrapper = await mountTurn(6, { keyboard: 'global' })
    const input = document.createElement('input')
    document.body.appendChild(input)
    try {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      await flushPromises()
      // 输入框内的方向键不触发翻页
      expect(wrapper.find('#indicator').text()).toBe('1/8')
    } finally {
      input.remove()
    }
  })

  it('only lets the most recently interacted instance respond to document keydown (multi-instance mutex)', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    const first = await mountTurn(6, { keyboard: 'global' })
    const second = await mountTurn(6, { keyboard: 'global' })
    // 多实例并存且尚无交互归属：document 按键一律不翻页，避免实例间抢键盘
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await flushPromises()
    expect(first.find('#indicator').text()).toBe('1/8')
    expect(second.find('#indicator').text()).toBe('1/8')
    // 在第二个实例的书页内按键：键盘归属转移给它
    await second.find('.viewport').trigger('keydown', { key: 'ArrowRight' })
    await flushPromises()
    expect(second.find('#indicator').text()).toBe('2/8')
    expect(first.find('#indicator').text()).toBe('1/8')
    // 此后 document 按键只驱动第二个实例
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await flushPromises()
    expect(second.find('#indicator').text()).toBe('4/8')
    expect(first.find('#indicator').text()).toBe('1/8')
  })

  it('does not respond to document keydown by default (keyboard focus default)', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    // 默认（keyboard='focus'）：document 级兜底关闭，焦点在组件外按键不翻页
    const wrapper = await mountTurn()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('1/8')
    // 视口聚焦通道不受影响
    await wrapper.find('.viewport').trigger('keydown', { key: 'ArrowRight' })
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('2/8')
    // document 按键依旧不翻页
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('2/8')
  })

  it('goToPage returns false when rejected and true when applied', async () => {
    const wrapper = await mountTurn()
    const inst = wrapper.findComponent(VueTurn).vm as unknown as TurnInstance
    // 越界页码拒绝
    expect(inst.goToPage(0)).toBe(false)
    expect(inst.goToPage(99)).toBe(false)
    expect(inst.goToPage(NaN)).toBe(false)
    // 有效页码生效
    expect(inst.goToPage(5)).toBe(true)
    await flushPromises()
    expect(inst.page).toBe(4)
    // 翻页中拒绝
    mocks.startFlip.mockImplementation(() => undefined)
    inst.next()
    expect(inst.goToPage(2)).toBe(false)
  })

  it('ignores clicks within the central dead zone', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    const Host = defineComponent({
      setup() {
        const turnRef = ref<TurnInstance | null>(null)
        const page = ref(1)
        return () =>
          h('div', [
            h(
              VueTurn,
              {
                ref: turnRef,
                modelValue: page.value,
                clickDeadZone: 0.2,
                'onUpdate:modelValue': (v: number) => {
                  page.value = v
                },
              },
              { default: () => pages(6) },
            ),
            h('span', { id: 'indicator' }, `${page.value}/8`),
          ])
      },
    })
    const wrapper = mount(Host)
    await flushPromises()
    const viewport = wrapper.find('.viewport')
    const el = viewport.element as HTMLElement
    el.getBoundingClientRect = () => ({ left: 0, width: 900, height: 600 }) as DOMRect
    // 死区中轴（0.5±0.1）：点击不翻页
    await viewport.trigger('click', { clientX: 450 })
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('1/8')
    // 死区外右半：前进
    await viewport.trigger('click', { clientX: 700 })
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('2/8')
  })

  it('makes the viewport focusable for keyboard mode', async () => {
    const wrapper = await mountTurn()
    const viewport = wrapper.find('.viewport')
    expect(viewport.attributes('tabindex')).toBe('0')
  })

  it('forces single page when displayedPages is 1', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    const wrapper = await mountTurn(6, { displayedPages: 1 })
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    // 单页模式每次只前进一页；且不补空白页/衬页：6 item = 6 页
    // （封面 + 4 内容页 + 封底）
    expect(wrapper.find('#indicator').text()).toBe('2/6')
    const spec = mocks.startFlip.mock.calls[0]?.[0]
    expect(spec?.delta).toBe(1)
  })

  it('gives the flipping sheet a blank paper back in single-page mode', async () => {
    // 单页一页只有一面内容：翻页纸张背面统一贴空白纸纹，
    // 不再显示下一页内容（避免与静态底页重复的"影子页"）
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    mocks.elementToTexture.mockReset()
    mocks.elementToTexture.mockImplementation(() => Promise.resolve(fakeTexture()))
    mocks.solidColorTexture.mockClear()
    const wrapper = await mountTurn(6, { displayedPages: 1 })
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    const call = mocks.startFlip.mock.calls[0]
    const spec = call?.[0]
    expect(spec?.frontIndex).toBe(0)
    expect(spec?.backIndex).toBe(1)
    // 正面=封面页纹理、背面=统一纸色空白纸纹（solidColorTexture 产物）
    const coverTexture = await mocks.elementToTexture.mock.results[0]?.value
    expect(call?.[1]).toBe(coverTexture)
    expect(call?.[2]).toBe(mocks.solidColorTexture.mock.results[0]?.value)
  })

  it('returns to the cover when switching display modes', async () => {
    // 单双页页码语义不同（页源映射/翻页停靠均不一致），切换后统一回到封面；
    // 页数按新模式重算（单页无补位页/衬页）
    const Host = defineComponent({
      setup() {
        const turnRef = ref<TurnInstance | null>(null)
        const mode = ref<'auto' | 1 | 2>(2)
        return () =>
          h('div', [
            h(
              VueTurn,
              {
                ref: turnRef,
                modelValue: 1,
                displayedPages: mode.value,
              },
              { default: () => pages(6) },
            ),
            h('button', { id: 'jump', onClick: () => turnRef.value?.goToPage(4) }, 'jump'),
            h(
              'button',
              { id: 'toggle', onClick: () => (mode.value = mode.value === 2 ? 1 : 2) },
              'toggle',
            ),
          ])
      },
    })
    const wrapper = mount(Host)
    await flushPromises()
    const vm = () => wrapper.findComponent(VueTurn).vm as unknown as TurnInstance
    // 双页：6 item → 8 页；跳到第 4 页
    await wrapper.find('#jump').trigger('click')
    await flushPromises()
    expect(vm().numPages).toBe(8)
    expect(vm().page).toBe(4)
    // 切单页：6 item → 6 页，回到封面
    await wrapper.find('#toggle').trigger('click')
    await flushPromises()
    expect(vm().numPages).toBe(6)
    expect(vm().page).toBe(1)
    // 切回双页：仍回到封面
    await wrapper.find('#toggle').trigger('click')
    await flushPromises()
    expect(vm().numPages).toBe(8)
    expect(vm().page).toBe(1)
  })

  it('flips backward in single-page mode with a reversed sheet from the seam side', async () => {
    // 单页页缝固定在阅读方向一侧：后退为反向翻页（reverse）——目标页纸张
    // 从缝侧翻回放平盖住当前页，spec 标记 reverse 且 staticPages 为当前页
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    mocks.elementToTexture.mockReset()
    mocks.elementToTexture.mockImplementation(() => Promise.resolve(fakeTexture()))
    const wrapper = await mountTurn(6, { displayedPages: 1 })
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    await wrapper.find('#prev').trigger('click')
    await flushPromises()
    const spec = mocks.startFlip.mock.calls[mocks.startFlip.mock.calls.length - 1]?.[0]
    expect(spec?.delta).toBe(-1)
    expect(spec?.reverse).toBe(true)
    // 正面 = 目标页（封面），staticPages = 被盖住的当前页（第 2 页）
    expect(spec?.frontIndex).toBe(0)
    expect(spec?.staticPages).toEqual([{ index: 1, slot: 'center' }])
    expect(spec?.hingeX).toBeLessThan(0)
  })

  it('disables the backward drag in single-page mode', async () => {
    // 单页后退纸张从缝外翻入，静止时不在页面上、无从抓取：后退拖拽禁用
    // （前进拖拽保留）。后退导航只走点击/键盘/实例方法
    const wrapper = await mountTurn(6, {
      displayedPages: 1,
      preset: 'custom',
      look: { fold: false },
    })
    const turn = wrapper.findComponent(VueTurn)
    stubViewportRect(wrapper)
    // 左半区按下（后退）拖动：不进入拖拽、无翻页事件
    await fireViewportPointer(wrapper, 'pointerdown', { pointerId: 1, button: 0, clientX: 200, clientY: 300 })
    await fireViewportPointer(wrapper, 'pointermove', { pointerId: 1, clientX: 350, clientY: 300 })
    await fireViewportPointer(wrapper, 'pointerup', { pointerId: 1, clientX: 420, clientY: 300 })
    await flushPromises()
    expect(mocks.beginDragFlip).not.toHaveBeenCalled()
    expect(turn.emitted('flip-start')).toBeUndefined()
    // 右半区按下（前进）拖动：正常进入拖拽
    await fireViewportPointer(wrapper, 'pointerdown', { pointerId: 2, button: 0, clientX: 700, clientY: 300 })
    expect(mocks.beginDragFlip).toHaveBeenCalledTimes(1)
  })

  it('plays soft back-flips as the reversed fold animation in single-page mode', async () => {
    // 回归：soft 内页后退必须沿用折页动画（与下一页同一条形变路径），
    // 由场景按 spec.reverse 反放（拖点从对侧镜像位收回外缘），
    // 而不是退化成 hard 形式的整页卷曲
    mocks.startFoldFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => {
      onDone()
      return true
    })
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    const wrapper = await mountTurn(6, { displayedPages: 1 })
    // 1→2：封面纸张（hard 档 fold 关闭）→ 卷曲
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    // 2→3：soft 内页前进 → 折页动画
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    expect(mocks.startFoldFlip).toHaveBeenCalledTimes(1)
    expect(mocks.startFoldFlip.mock.calls[0]?.[0]?.reverse).toBe(false)
    // 3→2：soft 内页后退 → 仍走折页动画，规格带 reverse
    await wrapper.find('#prev').trigger('click')
    await flushPromises()
    expect(mocks.startFoldFlip).toHaveBeenCalledTimes(2)
    const spec = mocks.startFoldFlip.mock.calls[1]?.[0]
    expect(spec?.reverse).toBe(true)
    expect(spec?.delta).toBe(-1)
  })

  it('migrates rasterized textures by content when switching modes', async () => {
    // 回归：模式切换后页索引语义变化，纹理缓存若仍按旧键位复用，会把旧
    // 模式该索引的内容（如补位空白页）贴到新模式的页面上。切换须按内容源
    // （itemIndex）迁移纹理——已光栅化的内容页不重做栅格化，且新索引下
    // 取到正确内容
    mocks.elementToTexture.mockReset()
    mocks.elementToTexture.mockImplementation((el) =>
      Promise.resolve({ ...fakeTexture(), tag: el.textContent ?? '' }),
    )
    const Host = defineComponent({
      setup() {
        const turnRef = ref<TurnInstance | null>(null)
        const mode = ref<'auto' | 1 | 2>(2)
        return () =>
          h('div', [
            h(
              VueTurn,
              {
                ref: turnRef,
                modelValue: 1,
                displayedPages: mode.value,
                prefetchWindow: 10,
              },
              { default: () => pages(6) },
            ),
            h(
              'button',
              { id: 'toggle', onClick: () => (mode.value = mode.value === 2 ? 1 : 2) },
              'toggle',
            ),
          ])
      },
    })
    const wrapper = mount(Host)
    await flushPromises()
    // 双页 6 item → 8 页，prefetchWindow=10 全窗口光栅化（页 1、6 为空白走纯色纹理）
    const rasterCount = mocks.elementToTexture.mock.calls.length
    expect(rasterCount).toBe(6)
    await wrapper.find('#toggle').trigger('click')
    await flushPromises()
    // 切单页：6 页全部由旧纹理按 itemIndex 迁移复用，无一次重光栅化
    expect(mocks.elementToTexture.mock.calls.length).toBe(rasterCount)
    // 新索引下静态网格取到正确内容：单页索引 4 = 第 5 个 item（双页旧键位 5）
    const calls = mocks.setStaticPages.mock.calls
    const textureOf = calls[calls.length - 1]![1] as (index: number) => { tag?: string }
    expect(textureOf(4)).toMatchObject({ tag: 'page 5' })
  })

  it('forces double page when displayedPages is 2', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    const wrapper = await mountTurn(6, { displayedPages: 2 })
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('2/8')
  })

  it('only rasterizes pages within the prefetch window on mount', async () => {
    // 20 item → 22 页、prefetchWindow=2、双页模式：初始窗口 [0, 0+2+2)=[0,4)，
    // 页 1 为空白衬页跳过 → 仅光栅化 3 页
    const Host = defineComponent({
      setup() {
        const turnRef = ref<TurnInstance | null>(null)
        const page = ref(1)
        return () =>
          h('div', [
            h(
              VueTurn,
              {
                ref: turnRef,
                modelValue: page.value,
                prefetchWindow: 2,
                'onUpdate:modelValue': (v: number) => {
                  page.value = v
                },
              },
              { default: () => pages(20) },
            ),
          ])
      },
    })
    mount(Host)
    await flushPromises()
    expect(mocks.elementToTexture).toHaveBeenCalledTimes(3)
  })

  it('prefetches missing pages after flipping into a new window', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    // 10 item → 12 页、prefetchWindow=1、双页模式
    const Host = defineComponent({
      setup() {
        const turnRef = ref<TurnInstance | null>(null)
        const page = ref(1)
        return () =>
          h('div', [
            h(
              VueTurn,
              {
                ref: turnRef,
                modelValue: page.value,
                prefetchWindow: 1,
                'onUpdate:modelValue': (v: number) => {
                  page.value = v
                },
              },
              { default: () => pages(10) },
            ),
            h('button', { id: 'next', onClick: () => turnRef.value?.next() }, 'next'),
          ])
      },
    })
    const wrapper = mount(Host)
    await flushPromises()
    // 初始窗口 [0, 0+2+1)=[0,3)，页 1 空白跳过 → 光栅化 2 页
    expect(mocks.elementToTexture).toHaveBeenCalledTimes(2)
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    // 翻一次后 currentPage=1，窗口 [0, 1+2+1)=[0,4)，仅新增 index 3
    expect(mocks.elementToTexture).toHaveBeenCalledTimes(3)
  })

  it('disposes textures of removed pages to avoid leaks', async () => {
    // 追踪每页纹理的 dispose spy
    const disposes: Array<ReturnType<typeof vi.fn>> = []
    mocks.elementToTexture.mockReset()
    mocks.elementToTexture.mockImplementation(() => {
      const d = vi.fn<() => void>()
      disposes.push(d)
      return Promise.resolve({ dispose: d })
    })
    const count = ref(6)
    const Host = defineComponent({
      setup() {
        const turnRef = ref<TurnInstance | null>(null)
        const page = ref(1)
        const tick = ref(0)
        return () => {
          void tick.value
          return h('div', [
            h(
              VueTurn,
              {
                ref: turnRef,
                modelValue: page.value,
                // 大窗口：挂载即光栅化全部页面，便于构造"删页释放"场景
                prefetchWindow: 99,
                'onUpdate:modelValue': (v: number) => {
                  page.value = v
                },
                onChange: () => {
                  tick.value++
                },
              },
              { default: () => pages(count.value) },
            ),
          ])
        }
      },
    })
    const wrapper = mount(Host)
    await flushPromises()
    // 初始光栅化 6 页：6 item → 8 页，页 0,2,3,4,5,7 需要纹理（1/6 空白跳过）
    expect(disposes).toHaveLength(6)
    // 删掉后两页：触发 syncPageCount 释放 index >= 6 的纹理
    count.value = 4
    await flushPromises()
    // 被删除页（页 5、页 7 → 第 5、6 个纹理）应被释放
    expect(disposes[4]).toHaveBeenCalled()
    expect(disposes[5]).toHaveBeenCalled()
    wrapper.unmount()
  })

  // 可克隆的假纹理：跨页半图克隆需要 clone/repeat/offset
  function fakeTexture() {
    return {
      dispose: vi.fn<() => void>(),
      repeat: { set: vi.fn<() => void>() },
      offset: { set: vi.fn<() => void>() },
      clone: () => fakeTexture(),
    }
  }

  function spreadItems(items: Array<'full' | 'spread' | 'full'> | string[]) {
    return items.map((kind, index) =>
      h(
        TurnItem,
        kind === 'spread' ? { spread: true } : {},
        { default: () => [h('div', `item ${index + 1}`)] },
      ),
    )
  }

  function mountItems(items: string[], extraProps: Record<string, unknown> = {}) {
    const Host = defineComponent({
      setup() {
        const turnRef = ref<TurnInstance | null>(null)
        const page = ref(1)
        const total = ref(items.length)
        const tick = ref(0)
        const bump = () => {
          tick.value++
        }
        return () => {
          void tick.value
          const inst = turnRef.value
          const flipping = page.value === -1
          return h('div', [
            h(
              VueTurn,
              {
                ref: turnRef,
                modelValue: page.value,
                ...extraProps,
                'onUpdate:modelValue': (v: number) => {
                  page.value = v
                  bump()
                },
                onReady: () => {
                  total.value = inst?.numPages ?? total.value
                  bump()
                },
              },
              { default: () => spreadItems(items) },
            ),
            h('span', { id: 'indicator' }, `${page.value}/${total.value}`),
            h('button', { id: 'next', disabled: flipping, onClick: () => inst?.next() }, 'next'),
          ])
        }
      },
    })
    const wrapper = mount(Host)
    return flushPromises().then(() => wrapper)
  }

  it('maps a spread item to two page indices', async () => {
    mocks.elementToTexture.mockReset()
    mocks.elementToTexture.mockImplementation(() => Promise.resolve(fakeTexture()))
    // 封面纸(0,1) + 跨页[3,4]（p2 补位）+ 普通页(5) + 补偶空白(6)?……
    // 内容区段 = 补位(2) + 跨页(3,4) + 普通(5) 共 4 页为偶 → 封底纸(6,7) = 8 页
    const wrapper = await mountItems(['full', 'spread', 'full', 'full'])
    expect(wrapper.find('#indicator').text()).toBe('1/8')
  })

  it('ignores spread items with a console warning in single-page mode', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.elementToTexture.mockReset()
    mocks.elementToTexture.mockImplementation(() => Promise.resolve(fakeTexture()))
    // 单页不支持跨页显示：跨页项自动忽略不占页，并打印警告。
    // 封面(0) + 普通内容(1) + 封底(2) = 3 页
    const wrapper = await mountItems(['full', 'spread', 'full', 'full'], { displayedPages: 1 })
    expect(wrapper.find('#indicator').text()).toBe('1/3')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('跨页'))
    warn.mockRestore()
  })

  it('inserts a blank page when a spread would land on an even index', async () => {
    mocks.elementToTexture.mockReset()
    mocks.elementToTexture.mockImplementation(() => Promise.resolve(fakeTexture()))
    // 封面(0) + 普通(1) + 跨页(空白2 + [3,4]) + 普通(5) + 普通(6) = 7 页，奇数补 1 = 8 页
    const wrapper = await mountItems(['full', 'full', 'spread', 'full', 'full'])
    expect(wrapper.find('#indicator').text()).toBe('1/8')
  })

  it('gives inserted blank pages a solid paper texture instead of bare white', async () => {
    // 回归：空白补位页无 DOM 可光栅化，此前无纹理落为材质白色，与内容页
    // 纸色（内容自绘背景）不一致；应改贴统一纸色的纯色纸纹
    mocks.elementToTexture.mockReset()
    mocks.elementToTexture.mockImplementation(() => Promise.resolve(fakeTexture()))
    mocks.solidColorTexture.mockClear()
    // 封面(0) + 空白衬页(1) + 普通(2) + 跨页[3,4]：空白页 1 在挂载窗口内
    await mountItems(['full', 'full', 'spread', 'full', 'full'])
    expect(mocks.solidColorTexture).toHaveBeenCalled()
    // 空白页不走进 DOM 光栅化路径
    const blankCalls = mocks.applyStaticTexture.mock.calls.filter(([index]) => index === 1)
    expect(blankCalls.length).toBeGreaterThan(0)
    expect(blankCalls[0]?.[1]).toBe(mocks.solidColorTexture.mock.results[0]?.value)
  })

  it('renders a visible spread as one double-width centered placement', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    mocks.elementToTexture.mockReset()
    mocks.elementToTexture.mockImplementation(() => Promise.resolve(fakeTexture()))
    const wrapper = await mountItems(['full', 'spread', 'full', 'full'])
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('2/8')
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('4/8')
    // 翻到跨页后：静态布局合并为单张居中跨页页（index 为起始页 3）
    const calls = mocks.setStaticPages.mock.calls
    const lastPlacements = calls[calls.length - 1]?.[0]
    expect(lastPlacements).toEqual([{ index: 3, slot: 'center', spread: true }])
  })

  it('uses the spread base texture for the merged static mesh', async () => {
    // 回归：合并跨页网格的纹理应取 spreadFullTextures（itemIndex 为 key）的整图，
    // 而不是 textures（页索引为 key）里的半图——否则跨页显示半图/闪烁
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    mocks.elementToTexture.mockReset()
    // 按元素内容标记纹理，便于断言 textureOf 取到的是跨页项的整图基准纹理
    mocks.elementToTexture.mockImplementation((el) =>
      Promise.resolve({ ...fakeTexture(), tag: el.textContent ?? '' }),
    )
    const wrapper = await mountItems(['full', 'spread', 'full', 'full'])
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    const spreadCalls = mocks.setStaticPages.mock.calls.filter(([placements]) =>
      (placements as Array<{ spread?: boolean }>).some((p) => p.spread),
    )
    expect(spreadCalls.length).toBeGreaterThan(0)
    const textureOf = spreadCalls[spreadCalls.length - 1]![1] as (index: number) => {
      tag?: string
    }
    // 跨页项是第 2 个 item（"item 2"），合并网格应贴它的整图；
    // 新映射下跨页起始页为 3（face 2）
    expect(textureOf(3)).toMatchObject({ tag: 'item 2' })
  })

  it('flips through a spread with regular sheet flips', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    mocks.elementToTexture.mockReset()
    mocks.elementToTexture.mockImplementation(() => Promise.resolve(fakeTexture()))
    const wrapper = await mountItems(['full', 'spread', 'full', 'full'])
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('2/8')
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('4/8')
    // 离开普通页：front=2（普通页）、back=3（跨页左半），static 含空白衬页(1)与跨页右半(4)
    const calls = mocks.startFlip.mock.calls
    const spec = calls[calls.length - 1]?.[0]
    expect(spec?.frontIndex).toBe(2)
    expect(spec?.backIndex).toBe(3)
    expect(spec?.staticPages).toEqual([
      { index: 1, slot: 'left' },
      { index: 4, slot: 'right' },
    ])
  })

  it('clamps flipDuration below the 500ms floor', async () => {
    // 回归：过短的翻页动画在低帧率环境下只剩寥寥数帧，落页换帧易被感知
    // 为闪烁——时长统一钳制到 500ms 下限（回弹/收尾等派生动画同源生效）
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    mocks.elementToTexture.mockReset()
    mocks.elementToTexture.mockImplementation(() => Promise.resolve(fakeTexture()))
    const wrapper = await mountItems(['full', 'full', 'full', 'full'], { flipDuration: 200 })
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    expect(mocks.startFlip.mock.calls[mocks.startFlip.mock.calls.length - 1]?.[3]).toBe(500)
  })

  it('keeps flipDuration values above the floor unchanged', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    mocks.elementToTexture.mockReset()
    mocks.elementToTexture.mockImplementation(() => Promise.resolve(fakeTexture()))
    const wrapper = await mountItems(['full', 'full', 'full', 'full'], { flipDuration: 1200 })
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    expect(mocks.startFlip.mock.calls[mocks.startFlip.mock.calls.length - 1]?.[3]).toBe(1200)
  })

  it('resolves split spread halves by screen side in RTL flips', async () => {
    // 回归：RTL（右翻书）下跨页的页码配对是镜像的（左槽=起始页+1），
    // 翻页中按页码取半图会让拆分态与静止合并整页（方向无关、图像左半恒在
    // 屏幕左）左右互换——翻起瞬间跨页内容交叉错乱，翻完合并才恢复。
    // 拆分态（翻页纸张正背面与前置静态半页）必须按「屏幕侧」取半图。
    // 可记录 uv 变换的纹理替身：半图克隆 repeat.x=0.5，offset.x 区分左右半
    function recordingTexture(tag: string): {
      tag: string
      dispose: ReturnType<typeof vi.fn<() => void>>
      repeat: { x: number; y: number; set: (x: number, y: number) => void }
      offset: { x: number; y: number; set: (x: number, y: number) => void }
      clone: () => ReturnType<typeof recordingTexture>
    } {
      const texture = {
        tag,
        dispose: vi.fn<() => void>(),
        repeat: {
          x: 0,
          y: 0,
          set(x: number, y: number) {
            texture.repeat.x = x
            texture.repeat.y = y
          },
        },
        offset: {
          x: 0,
          y: 0,
          set(x: number, y: number) {
            texture.offset.x = x
            texture.offset.y = y
          },
        },
        clone: () => recordingTexture(tag),
      }
      return texture
    }
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    mocks.elementToTexture.mockReset()
    mocks.elementToTexture.mockImplementation((el) =>
      Promise.resolve(recordingTexture(el.textContent ?? '')),
    )
    // 页映射：封面(0)+衬页(1)+补位(2)+跨页[3,4]+普通(5)+封底纸(6,7)
    const wrapper = await mountItems(['full', 'spread', 'full', 'full'], {
      forwardDirection: 'right',
    })
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('2/8')
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('4/8')
    mocks.startFlip.mockClear()
    mocks.setStaticPages.mockClear()
    // RTL 前进（向右）：翻离跨页。翻页纸张 front=4（跨页右半页，翻起前静止
    // 于屏幕左侧）、back=5；stay=3（跨页左半页）静态钉在右槽
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('6/8')
    const spec = mocks.startFlip.mock.calls[mocks.startFlip.mock.calls.length - 1]?.[0]
    expect(spec?.frontIndex).toBe(4)
    expect(spec?.backIndex).toBe(5)
    expect(spec?.staticPages).toEqual([
      { index: 6, slot: 'left' },
      { index: 3, slot: 'right' },
    ])
    // 正面翻起前在屏幕左侧 → 取图像左半（offset.x=0），
    // 与翻起前合并整页左侧显示的左半衔接
    const front = mocks.startFlip.mock.calls[mocks.startFlip.mock.calls.length - 1]?.[1] as
      | undefined
      | {
          tag?: string
          repeat: { x: number }
          offset: { x: number }
        }
    expect(front?.tag).toBe('item 2')
    expect(front?.repeat.x).toBe(0.5)
    expect(front?.offset.x).toBe(0)
    // 静态右槽的跨页左半页（index 3）→ 取图像右半（offset.x=0.5），
    // 与合并整页右侧显示的右半衔接
    const spreadStatic = mocks.setStaticPages.mock.calls.filter(([placements]) =>
      (placements as Array<{ index?: number }>).some((p) => p.index === 3),
    )
    expect(spreadStatic.length).toBeGreaterThan(0)
    const textureOf = spreadStatic[spreadStatic.length - 1]![1] as unknown as (index: number) => {
      tag?: string
      offset: { x: number }
    }
    expect(textureOf(3)?.tag).toBe('item 2')
    expect(textureOf(3)?.offset.x).toBe(0.5)
  })

  it('restores the initial page from modelValue on mount', async () => {
    // 回归：挂载时初始页码不能被 0 页状态钳制到封面（刷新恢复 /book/:page 场景）
    const wrapper = await mountTurn(6, { modelValue: 6 })
    expect(wrapper.find('#indicator').text()).toBe('6/8')
    const turn = wrapper.findComponent(VueTurn)
    expect((turn.vm as unknown as TurnInstance).page).toBe(6)
  })

  it('auto-inserts a blank page so odd-page books keep an even total', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    mocks.elementToTexture.mockReset()
    mocks.elementToTexture.mockImplementation(() => Promise.resolve(fakeTexture()))
    // 封面纸(0,1) + a(2) + 内页区段奇数补偶空白(3) + 封底纸(4,5) = 6 页
    const wrapper = await mountItems(['full', 'full', 'full'])
    expect(wrapper.find('#indicator').text()).toBe('1/6')
    // 前进到 [2,3]（a + 补偶空白）：再次前进应走封底合上分支（back=末页 5）
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('2/6')
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('4/6')
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('6/6')
    const calls = mocks.startFlip.mock.calls
    const closeSpec = calls[calls.length - 1]?.[0]
    expect(closeSpec?.frontIndex).toBe(4)
    expect(closeSpec?.backIndex).toBe(5)
    expect(closeSpec?.delta).toBe(2)
  })

  it('rasterizes a spread base texture only once', async () => {
    mocks.elementToTexture.mockReset()
    mocks.elementToTexture.mockImplementation(() => Promise.resolve(fakeTexture()))
    // 4 item（封面纸+补位+跨页+普通+补偶 → 8 页），窗口 [0,5) 内需要
    // 纹理的页：0(封面)、2(普通)、3(跨页左半，整页光栅化)、4(右半克隆共享)
    // → elementToTexture 共 3 次
    const wrapper = await mountItems(['full', 'spread', 'full', 'full'])
    expect(wrapper.find('#indicator').text()).toBe('1/8')
    expect(mocks.elementToTexture).toHaveBeenCalledTimes(3)
  })

  it('passes resourceTimeout to waitForResources', async () => {
    const wrapper = await mountItems(['full', 'full'], { resourceTimeout: 1200 })
    const { waitForResources } = await import('@/lib/textureFactory')
    expect(vi.mocked(waitForResources)).toHaveBeenCalledWith(expect.anything(), 1200)
    wrapper.unmount()
  })

  // ---------------------------------------------------------------------------
  // 硬页 / before-flip 拦截 / stop / disable / first/last / 缩放 / 拖拽 / 折角 / 热区
  // ---------------------------------------------------------------------------

  function stubViewportRect(wrapper: ReturnType<typeof mount>, width = 900, height = 600) {
    const viewport = wrapper.find('.viewport')
    const el = viewport.element as HTMLElement
    el.getBoundingClientRect = () => ({ left: 0, top: 0, width, height }) as DOMRect
    return viewport
  }

  // jsdom 中 PointerEvent 原型缺少 button/clientX 等可写描述符，
  // trigger() 的属性后置赋值会抛错；这里用原生构造器（init 字典）派发
  async function fireViewportPointer(
    wrapper: ReturnType<typeof mount>,
    type: string,
    options: PointerEventInit = {},
  ) {
    const el = wrapper.find('.viewport').element as HTMLElement
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, ...options }))
    await nextTick()
  }

  it('flips cover/back-cover by coverPreset as rigid sheets (default hard)', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    const Host = defineComponent({
      setup() {
        const turnRef = ref<TurnInstance | null>(null)
        const page = ref(1)
        return () =>
          h('div', [
            h(
              VueTurn,
              {
                ref: turnRef,
                modelValue: page.value,
                'onUpdate:modelValue': (v: number) => {
                  page.value = v
                },
              },
              {
                default: () => [
                  h(TurnItem, null, { default: () => [h('div', 'cover')] }),
                  ...Array.from({ length: 4 }, (_, i) =>
                    h(TurnItem, null, { default: () => [h('div', `page ${i + 1}`)] }),
                  ),
                ],
              },
            ),
          ])
      },
    })
    const wrapper = mount(Host)
    await flushPromises()
    const inst = wrapper.findComponent(VueTurn).vm as unknown as TurnInstance
    // 封面纸张索引 0,1、封底纸张索引 6,7（5 item → 8 页）
    expect(mocks.setCoverPages).toHaveBeenCalledWith([0, 1, 6, 7])
    inst.next()
    await flushPromises()
    // 封面：默认 coverPreset=hard，curl 0 刚体翻转 + 封面档网格密度
    expect(mocks.startFlip.mock.calls[0]?.[5]).toEqual({ curl: 0, nPolygons: 32 })
    inst.next()
    await flushPromises()
    // 普通内页：无覆盖
    expect(mocks.startFlip.mock.calls[1]?.[5]).toEqual({})
  })

  it('supports declared cover/back-cover sheets via type annotations', async () => {
    mocks.elementToTexture.mockReset()
    mocks.elementToTexture.mockImplementation((el) =>
      Promise.resolve({ ...fakeTexture(), tag: el.textContent ?? '' }),
    )
    const Host = defineComponent({
      setup() {
        const turnRef = ref<TurnInstance | null>(null)
        const page = ref(1)
        return () =>
          h('div', [
            h(
              VueTurn,
              {
                ref: turnRef,
                modelValue: page.value,
                'onUpdate:modelValue': (v: number) => {
                  page.value = v
                },
              },
              {
                default: () => [
                  // 封面 + 封底各独占一张专用纸张，中间两个内容页；
                  // 封面纸张背面/封底里侧为固定空白纸页（无独立内容面）
                  h(TurnItem, { type: 'cover' }, { default: () => [h('div', 'cover')] }),
                  h(TurnItem, null, { default: () => [h('div', 'page 1')] }),
                  h(TurnItem, null, { default: () => [h('div', 'page 2')] }),
                  h(TurnItem, { type: 'back-cover' }, { default: () => [h('div', 'back cover')] }),
                ],
              },
            ),
          ])
      },
    })
    const wrapper = mount(Host)
    await flushPromises()
    // 封面纸(0,1) + 内容(2,3) + 封底纸(4,5) = 6 页，无补位空白
    expect(mocks.setCoverPages).toHaveBeenCalledWith([0, 1, 4, 5])
    // 4 个内容面全部光栅化（空白纸页走纯色纸纹，不光栅化）
    expect(mocks.elementToTexture).toHaveBeenCalledTimes(4)
    const calls = mocks.setStaticPages.mock.calls
    const lastCall = calls[calls.length - 1]?.[0]
    // 合书态：封面居中单页
    expect(lastCall).toEqual([{ index: 0, slot: 'center' }])
    wrapper.unmount()
  })

  it('renders a jacket as one double-width face split into cover/back halves', async () => {
    mocks.elementToTexture.mockReset()
    mocks.elementToTexture.mockImplementation(() => Promise.resolve(fakeTexture()))
    const Host = defineComponent({
      setup() {
        const turnRef = ref<TurnInstance | null>(null)
        const page = ref(1)
        return () =>
          h('div', [
            h(
              VueTurn,
              {
                ref: turnRef,
                modelValue: page.value,
                'onUpdate:modelValue': (v: number) => {
                  page.value = v
                },
              },
              {
                default: () => [
                  h(TurnItem, { type: 'jacket' }, { default: () => [h('div', 'jacket')] }),
                  h(TurnItem, null, { default: () => [h('div', 'page 1')] }),
                ],
              },
            ),
          ])
      },
    })
    const wrapper = mount(Host)
    await flushPromises()
    // jacket 是唯一的双倍宽度离屏面（右半封面 / 左半封底）
    const faces = wrapper.findAll('.page-source')
    expect(faces).toHaveLength(2)
    const widthOf = (el: Element) => Number.parseInt((el as HTMLElement).style.width, 10)
    expect(widthOf(faces[0]!.element)).toBe(widthOf(faces[1]!.element) * 2)
    // 封面页(0)=jacket 右半、空白纸页(1)、内容(2)、补偶(3)、封底里(4)、封底(5)=jacket 左半
    expect(mocks.setCoverPages).toHaveBeenCalledWith([0, 1, 4, 5])
    wrapper.unmount()
  })

  it('refuses to render the book when item type annotations are invalid', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.elementToTexture.mockReset()
    mocks.elementToTexture.mockImplementation(() => Promise.resolve(fakeTexture()))
    const Host = defineComponent({
      setup() {
        return () =>
          h('div', [
            h(VueTurn, {}, {
              default: () => [
                h(TurnItem, { type: 'cover' }, { default: () => [h('div', 'cover')] }),
                h(TurnItem, { type: 'cover' }, { default: () => [h('div', 'dup')] }),
                h(TurnItem, null, { default: () => [h('div', 'page')] }),
              ],
            }),
          ])
      },
    })
    const wrapper = mount(Host)
    await flushPromises()
    // 重复 type 声明：整本书拒绝渲染（无页、无光栅化），控制台报错
    expect(wrapper.findAll('.page-source')).toHaveLength(0)
    expect(mocks.elementToTexture).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(expect.stringContaining('本书拒绝渲染'))
    error.mockRestore()
    wrapper.unmount()
  })

  it('coverPreset=soft makes covers curl like soft paper', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    const Host = defineComponent({
      setup() {
        const turnRef = ref<TurnInstance | null>(null)
        const page = ref(1)
        return () =>
          h('div', [
            h(
              VueTurn,
              {
                ref: turnRef,
                coverPreset: 'soft',
                modelValue: page.value,
                'onUpdate:modelValue': (v: number) => {
                  page.value = v
                },
              },
              {
                default: () => [
                  h(TurnItem, null, { default: () => [h('div', 'cover')] }),
                  ...Array.from({ length: 4 }, (_, i) =>
                    h(TurnItem, null, { default: () => [h('div', `page ${i + 1}`)] }),
                  ),
                ],
              },
            ),
          ])
      },
    })
    const wrapper = mount(Host)
    await flushPromises()
    const inst = wrapper.findComponent(VueTurn).vm as unknown as TurnInstance
    inst.next()
    await flushPromises()
    // 封面：soft 档卷曲与网格密度
    expect(mocks.startFlip.mock.calls[0]?.[5]).toEqual({ curl: 0.8, nPolygons: 64 })
  })

  it('cancels flips and jumps when before-flip calls preventDefault', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    const contexts: Array<import('@/types/turn').BeforeFlipContext> = []
    const Host = defineComponent({
      setup() {
        const turnRef = ref<TurnInstance | null>(null)
        const page = ref(1)
        return () =>
          h('div', [
            h(
              VueTurn,
              {
                ref: turnRef,
                modelValue: page.value,
                'onUpdate:modelValue': (v: number) => {
                  page.value = v
                },
                onBeforeFlip: (ctx: import('@/types/turn').BeforeFlipContext) => {
                  contexts.push(ctx)
                  ctx.preventDefault()
                },
              },
              { default: () => pages(6) },
            ),
            h('button', { id: 'next', onClick: () => turnRef.value?.next() }, 'next'),
          ])
      },
    })
    const wrapper = mount(Host)
    await flushPromises()
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    const inst = wrapper.findComponent(VueTurn).vm as unknown as TurnInstance
    expect(inst.page).toBe(1)
    expect(mocks.startFlip).not.toHaveBeenCalled()
    // 拦截信息完整
    expect(contexts[0]?.from).toBe(1)
    expect(contexts[0]?.to).toBe(2)
    expect(contexts[0]?.direction).toBe('left')
    // 直接跳转同样可被拦截
    expect(inst.goToPage(5)).toBe(false)
    expect(inst.page).toBe(1)
  })

  it('syncs the current page back when an external modelValue jump is intercepted', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    const externalPage = ref(1)
    const updates: number[] = []
    const Host = defineComponent({
      setup() {
        return () =>
          h('div', [
            h(
              VueTurn,
              {
                modelValue: externalPage.value,
                'onUpdate:modelValue': (v: number) => {
                  externalPage.value = v
                  updates.push(v)
                },
                onBeforeFlip: (ctx: import('@/types/turn').BeforeFlipContext) => {
                  ctx.preventDefault()
                },
              },
              { default: () => pages(6) },
            ),
            h('span', { id: 'indicator' }, `${externalPage.value}/8`),
          ])
      },
    })
    const wrapper = mount(Host)
    await flushPromises()
    // 外部把页码改成 5：被 before-flip 拦截，书页停在原地
    externalPage.value = 5
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('1/8')
    // 组件回写当前页，把被拒绝的外部页码拉回同步（避免外部残留非法状态）
    expect(updates).toEqual([1])
  })

  it('emits first and last when navigating to the covers', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    const wrapper = await mountTurn()
    const turn = wrapper.findComponent(VueTurn)
    const inst = turn.vm as unknown as TurnInstance
    inst.goToPage(8)
    await flushPromises()
    expect(turn.emitted('last')).toHaveLength(1)
    expect(turn.emitted('first')).toBeUndefined()
    inst.goToPage(1)
    await flushPromises()
    expect(turn.emitted('first')).toHaveLength(1)
  })

  it('disable blocks flips and interactions until re-enabled', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    const wrapper = await mountTurn()
    const inst = wrapper.findComponent(VueTurn).vm as unknown as TurnInstance
    inst.disable()
    expect(inst.disabled).toBe(true)
    inst.next()
    await flushPromises()
    expect(inst.page).toBe(1)
    expect(inst.goToPage(3)).toBe(false)
    const viewport = stubViewportRect(wrapper)
    await viewport.trigger('click', { clientX: 700, clientY: 300 })
    await flushPromises()
    expect(inst.page).toBe(1)
    inst.disable(false)
    expect(inst.disabled).toBe(false)
    inst.next()
    await flushPromises()
    expect(inst.page).toBe(2)
  })

  it('stop completes an in-flight flip immediately', async () => {
    const wrapper = await mountTurn()
    const turn = wrapper.findComponent(VueTurn)
    const inst = turn.vm as unknown as TurnInstance
    inst.next()
    await flushPromises()
    expect(inst.isFlipping).toBe(true)
    inst.stop()
    await flushPromises()
    expect(inst.isFlipping).toBe(false)
    expect(inst.page).toBe(2)
    expect(turn.emitted('flip-end')).toEqual([['left']])
  })

  it('stop cancels an in-flight drag at the nearest end', async () => {
    // custom 档关闭折页：测普通卷曲拖拽路径
    const wrapper = await mountTurn(6, { preset: 'custom', look: { fold: false } })
    const turn = wrapper.findComponent(VueTurn)
    stubViewportRect(wrapper)
    await fireViewportPointer(wrapper, 'pointerdown', { pointerId: 1, button: 0, clientX: 700, clientY: 300 })
    await fireViewportPointer(wrapper, 'pointermove', { pointerId: 1, clientX: 650, clientY: 300 })
    const inst = turn.vm as unknown as TurnInstance
    expect(inst.isFlipping).toBe(true)
    inst.stop()
    await flushPromises()
    expect(inst.isFlipping).toBe(false)
    expect(wrapper.find('#indicator').text()).toBe('1/8')
    expect(turn.emitted('flip-end')).toEqual([['left']])
  })

  it('drags a page across and commits on release', async () => {
    // custom 档关闭折页：测普通卷曲拖拽路径
    const wrapper = await mountTurn(6, { preset: 'custom', look: { fold: false } })
    const turn = wrapper.findComponent(VueTurn)
    stubViewportRect(wrapper)
    await fireViewportPointer(wrapper, 'pointerdown', { pointerId: 1, button: 0, clientX: 700, clientY: 300 })
    expect(mocks.beginDragFlip).toHaveBeenCalledTimes(1)
    // 真实拖拽不是悬停预览：书体/纸叠随进度联动（preview 非 true）
    expect(mocks.beginDragFlip.mock.calls[0]?.[5]).not.toBe(true)
    expect(turn.emitted('flip-start')).toEqual([['left']])
    expect(turn.emitted('pressed')).toEqual([[{ x: 700, y: 300 }]])
    await fireViewportPointer(wrapper, 'pointermove', { pointerId: 1, clientX: 200, clientY: 300 })
    // 满程 = 视口 60% 宽 = 540px，拖动 500px → 进度 500/540
    expect(mocks.setDragProgress).toHaveBeenLastCalledWith(500 / 540)
    await fireViewportPointer(wrapper, 'pointerup', { pointerId: 1, clientX: 200, clientY: 300 })
    expect(mocks.endDragFlip).toHaveBeenCalledWith(true, 900)
    expect(turn.emitted('released')).toHaveLength(1)
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('2/8')
    expect(turn.emitted('flip-end')).toEqual([['left']])
  })

  it('springs back when the drag barely moves', async () => {
    // custom 档关闭折页：测普通卷曲拖拽路径
    const wrapper = await mountTurn(6, { preset: 'custom', look: { fold: false } })
    const turn = wrapper.findComponent(VueTurn)
    stubViewportRect(wrapper)
    await fireViewportPointer(wrapper, 'pointerdown', { pointerId: 1, button: 0, clientX: 700, clientY: 300 })
    await fireViewportPointer(wrapper, 'pointermove', { pointerId: 1, clientX: 690, clientY: 300 })
    await fireViewportPointer(wrapper, 'pointerup', { pointerId: 1, clientX: 690, clientY: 300 })
    // 进度 10/540 未过阈值：回弹取消
    expect(mocks.endDragFlip).toHaveBeenCalledWith(false, 900)
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('1/8')
    expect(turn.emitted('flip-end')).toEqual([['left']])
  })

  it('does not start drag when dragToFlip is disabled', async () => {
    const Host = defineComponent({
      setup() {
        const turnRef = ref<TurnInstance | null>(null)
        const page = ref(1)
        return () =>
          h('div', [
            h(
              VueTurn,
              {
                ref: turnRef,
                dragToFlip: false,
                modelValue: page.value,
                'onUpdate:modelValue': (v: number) => {
                  page.value = v
                },
              },
              { default: () => pages(6) },
            ),
          ])
      },
    })
    const wrapper = mount(Host)
    await flushPromises()
    stubViewportRect(wrapper)
    await fireViewportPointer(wrapper, 'pointerdown', { pointerId: 1, button: 0, clientX: 700, clientY: 300 })
    expect(mocks.beginDragFlip).not.toHaveBeenCalled()
    expect(wrapper.findComponent(VueTurn).emitted('flip-start')).toBeUndefined()
  })

  it('shows a peeled corner when hovering the page edge (legacy peel, fold off)', async () => {
    // custom 档 + fold=false：fold prop 仅在 custom 档生效，关闭折角走旧版整页轻卷
    const wrapper = await mountTurn(6, { peel: true, preset: 'custom', look: { fold: false } })
    stubViewportRect(wrapper)
    const stacksCallsBefore = mocks.setStacks.mock.calls.length
    // LTR 前进边缘（右缘）悬停：掀起页角，强度随深度渐变（无阶跃跳变）
    await fireViewportPointer(wrapper, 'pointermove', { pointerId: 1, clientX: 870, clientY: 300, buttons: 0 })
    expect(mocks.beginDragFlip).toHaveBeenCalledTimes(1)
    // 悬停预览（preview=true）：书体/静态页/纸叠钉在起始态，只预览卷曲形变，
    // 避免封面开合等场景悬停时整本书随指针抖动。
    // 封面纸张背面 = 空白封面底（页 1）→ back 传统一纸色纯色纸纹
    expect(mocks.beginDragFlip).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      mocks.solidColorTexture.mock.results[0]?.value,
      expect.anything(),
      expect.anything(),
      true,
    )
    // ratio=870/900，深度 0.0333/0.12 → 强度 0.722 × 0.07 ≈ 0.0506
    const calls = mocks.setDragProgress.mock.calls
    const progress = calls[calls.length - 1]?.[0] as number
    expect(progress).toBeCloseTo(0.0506, 3)
    // 悬停预览不改纸叠布局（纸叠只在真实翻页时过渡）
    expect(mocks.setStacks.mock.calls.length).toBe(stacksCallsBefore)
    // 越靠近外缘翘得越高
    await fireViewportPointer(wrapper, 'pointermove', { pointerId: 1, clientX: 895, clientY: 300, buttons: 0 })
    const callsAfter = mocks.setDragProgress.mock.calls
    const stronger = callsAfter[callsAfter.length - 1]?.[0] as number
    expect(stronger).toBeGreaterThan(progress)
    // 移到中部：折角收回
    await fireViewportPointer(wrapper, 'pointermove', { pointerId: 1, clientX: 450, clientY: 300, buttons: 0 })
    expect(mocks.endDragFlip).toHaveBeenCalledWith(false, 900)
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('1/8')
  })

  it('folds the nearest page corner when hovering the corner zone with fold enabled', async () => {
    mocks.beginFoldDrag.mockReturnValue(true)
    const wrapper = await mountTurn(6, { peel: true })
    stubViewportRect(wrapper)
    // 右下角区（u 贴右外缘、v 贴底边）：折起底角
    mocks.pickPage.mockReturnValue({ index: 2, u: 0.95, v: 0.1, spread: true })
    await fireViewportPointer(wrapper, 'pointermove', { pointerId: 1, clientX: 870, clientY: 480, buttons: 0 })
    expect(mocks.beginFoldDrag).toHaveBeenCalledTimes(1)
    // 悬停预览（preview=true）：书体/静态页/纸叠钉在起始态，只预览折角形变；
    // 封面纸张背面 = 空白封面底（页 1）→ back 传统一纸色纯色纸纹
    expect(mocks.beginFoldDrag).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      mocks.solidColorTexture.mock.results[0]?.value,
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      true,
    )
    expect(mocks.beginDragFlip).not.toHaveBeenCalled()
    // 折点跟随指针（与折角拖拽同入口）
    expect(mocks.setFoldDragFromClient).toHaveBeenCalledWith(870, 480)
    // 预览与拖拽同一份翻页前置布局（底页呈现翻开布局）
    expect(mocks.setStaticPages).toHaveBeenCalledWith(
      [{ index: 2, slot: 'right' }],
      expect.anything(),
      false,
    )
    // 同角深入：同一张纸仅更新拖点（跟随指针），不重建纸张
    mocks.foldAnchorDistanceFromClient.mockReturnValue(0.01)
    await fireViewportPointer(wrapper, 'pointermove', { pointerId: 1, clientX: 890, clientY: 480, buttons: 0 })
    expect(mocks.beginFoldDrag).toHaveBeenCalledTimes(1)
    expect(mocks.setFoldDragFromClient).toHaveBeenLastCalledWith(890, 480)
    // 移入页面中部（角区外）：折角收回
    mocks.foldAnchorDistanceFromClient.mockReturnValue(1000)
    await fireViewportPointer(wrapper, 'pointermove', { pointerId: 1, clientX: 450, clientY: 260, buttons: 0 })
    expect(mocks.endFoldDrag).toHaveBeenCalledWith(false, 900)
  })

  it('shows no preview when hovering the edge middle with fold enabled (corner-only zones)', async () => {
    // soft 时只要四角折角预览：边缘中部/顶底边中部不触发任何悬停预览
    mocks.beginFoldDrag.mockReturnValue(true)
    const wrapper = await mountTurn(6, { peel: true })
    stubViewportRect(wrapper)
    // 右缘中部（横向在条带内、纵向在中部）：无预览
    mocks.pickPage.mockReturnValue({ index: 2, u: 0.95, v: 0.45, spread: true })
    await fireViewportPointer(wrapper, 'pointermove', { pointerId: 1, clientX: 870, clientY: 300, buttons: 0 })
    expect(mocks.beginFoldDrag).not.toHaveBeenCalled()
    expect(mocks.beginDragFlip).not.toHaveBeenCalled()
    // 顶边中部（纵向在条带内、横向在中部）：无预览
    mocks.pickPage.mockReturnValue({ index: 2, u: 0.7, v: 0.95, spread: true })
    await fireViewportPointer(wrapper, 'pointermove', { pointerId: 1, clientX: 650, clientY: 60, buttons: 0 })
    expect(mocks.beginFoldDrag).not.toHaveBeenCalled()
    expect(mocks.beginDragFlip).not.toHaveBeenCalled()
  })

  it('folds the top corner when hovering the top corner zone with fold enabled', async () => {
    mocks.beginFoldDrag.mockReturnValue(true)
    const wrapper = await mountTurn(6, { peel: true })
    stubViewportRect(wrapper)
    // 右上角区（u 贴右外缘、v 贴顶边）：折起顶角
    mocks.pickPage.mockReturnValue({ index: 2, u: 0.95, v: 0.95, spread: true })
    await fireViewportPointer(wrapper, 'pointermove', { pointerId: 1, clientX: 870, clientY: 60, buttons: 0 })
    expect(mocks.beginFoldDrag).toHaveBeenCalledTimes(1)
    // 顶角（cornerV 由 beginFoldDrag 的 pickV 参数传入，+PAGE_HEIGHT/2 为顶）
    const pickV = mocks.beginFoldDrag.mock.calls[0]?.[4] as number
    expect(pickV).toBeGreaterThan(0)
    // 折点跟随指针
    expect(mocks.setFoldDragFromClient).toHaveBeenCalledWith(870, 60)
    // 移到页面中部（角区外）：折角收回
    mocks.foldAnchorDistanceFromClient.mockReturnValue(1000)
    await fireViewportPointer(wrapper, 'pointermove', { pointerId: 1, clientX: 650, clientY: 300, buttons: 0 })
    expect(mocks.endFoldDrag).toHaveBeenCalledWith(false, 900)
  })

  it('previews the cover corner on hover with the flip-start static layout', async () => {
    // 软封面（coverPreset=soft，合书态居中）悬停角区：预览与折角拖拽共用同一份
    // 翻页前置布局——底页呈现翻开布局（折角下方露出的是下一页而非封面）；
    // preview=true 使书体平移/纸叠/相机钉在起始态，收起时 renderStatic 恢复空闲布局
    mocks.beginFoldDrag.mockReturnValue(true)
    const wrapper = await mountTurn(6, { peel: true, modelValue: 1, coverPreset: 'soft' })
    stubViewportRect(wrapper)
    mocks.setStaticPages.mockClear()
    // 封面居中、右下角圆内（LTR 封面外缘在右）：折角预览，方向前进
    mocks.pickPage.mockReturnValue({ index: 0, u: 0.95, v: 0.1, spread: false })
    await fireViewportPointer(wrapper, 'pointermove', { pointerId: 1, clientX: 520, clientY: 480, buttons: 0 })
    expect(mocks.beginFoldDrag).toHaveBeenCalledTimes(1)
    // 悬停预览：preview=true（第 9 参）
    expect(mocks.beginFoldDrag.mock.calls[0]?.[8]).toBe(true)
    // 预览与拖拽同一份翻页前置布局：封面翻开的底页 = 第 2 页右页
    expect(mocks.setStaticPages).toHaveBeenCalledWith(
      [{ index: 2, slot: 'right' }],
      expect.anything(),
      false,
    )
    // 折点跟随指针（与折角拖拽同入口）
    expect(mocks.setFoldDragFromClient).toHaveBeenCalledWith(520, 480)
    // 同角深入：仅更新拖点，不重建
    mocks.foldAnchorDistanceFromClient.mockReturnValue(0.01)
    await fireViewportPointer(wrapper, 'pointermove', { pointerId: 1, clientX: 545, clientY: 480, buttons: 0 })
    expect(mocks.beginFoldDrag).toHaveBeenCalledTimes(1)
    expect(mocks.setFoldDragFromClient).toHaveBeenLastCalledWith(545, 480)
    // 移出角圆：折角收回
    mocks.foldAnchorDistanceFromClient.mockReturnValue(1000)
    await fireViewportPointer(wrapper, 'pointermove', { pointerId: 1, clientX: 400, clientY: 260, buttons: 0 })
    expect(mocks.endFoldDrag).toHaveBeenCalledWith(false, 900)
  })

  it('keeps the default hard cover rigid: no corner fold preview and no fold drag', async () => {
    // 封面折页档按 coverPreset 判定：默认 hard 为纸板档，角区悬停/按下都不走折角
    // 形变（折页形变不读 curl，纸板刚体观感会丢），回到条带轻卷与整页卷曲拖拽
    mocks.beginFoldDrag.mockReturnValue(true)
    const wrapper = await mountTurn(6, { peel: true, modelValue: 1 })
    stubViewportRect(wrapper)
    // 封面右下角区（index 0 属封面纸张）
    mocks.pickPage.mockReturnValue({ index: 0, u: 0.95, v: 0.1, spread: false })
    await fireViewportPointer(wrapper, 'pointermove', { pointerId: 1, clientX: 850, clientY: 300, buttons: 0 })
    expect(mocks.beginFoldDrag).not.toHaveBeenCalled()
    expect(mocks.beginDragFlip).toHaveBeenCalledTimes(1)
    // 条带轻卷预览纸张按封面档取观感：curl 0 的刚体微抬，preview=true
    expect(mocks.beginDragFlip.mock.calls[0]?.[4]).toEqual({ curl: 0, nPolygons: 32 })
    expect(mocks.beginDragFlip.mock.calls[0]?.[5]).toBe(true)
    // 按下同样不接管折角：走整页卷曲拖拽路径
    await fireViewportPointer(wrapper, 'pointerdown', { pointerId: 1, button: 0, clientX: 850, clientY: 300 })
    expect(mocks.beginFoldDrag).not.toHaveBeenCalled()
  })

  it('does not show fold hover preview when peel is off (fold still enabled)', async () => {
    mocks.beginFoldDrag.mockReturnValue(true)
    const wrapper = await mountTurn(6)
    stubViewportRect(wrapper)
    // peel 默认关闭：无任何悬停预览（折角拖拽本身不受影响）
    mocks.pickPage.mockReturnValue({ index: 2, u: 0.95, v: 0.3, spread: true })
    await fireViewportPointer(wrapper, 'pointermove', { pointerId: 1, clientX: 870, clientY: 260, buttons: 0 })
    expect(mocks.beginFoldDrag).not.toHaveBeenCalled()
    expect(mocks.beginDragFlip).not.toHaveBeenCalled()
  })

  it('starts a fold drag (height locked) when pressing the edge strip outside the corner circle', async () => {
    mocks.beginFoldDrag.mockReturnValue(true)
    const wrapper = await mountTurn(6)
    stubViewportRect(wrapper)
    // 跨页右页外缘条带、纵向中部（外角圆外）：折页拖拽而非整页卷曲
    mocks.pickPage.mockReturnValue({ index: 2, u: 0.95, v: 0.3, spread: true })
    await fireViewportPointer(wrapper, 'pointerdown', { pointerId: 1, button: 0, clientX: 870, clientY: 260 })
    expect(mocks.beginFoldDrag).toHaveBeenCalledTimes(1)
    // 锚点高度 = 指针 v 换算的页高坐标：(0.3-0.5)*PAGE_HEIGHT(2) = -0.4
    expect(mocks.beginFoldDrag.mock.calls[0]?.[4]).toBeCloseTo(-0.4, 5)
    // 真实拖拽不是悬停预览（preview 非 true）：书体/纸叠随进度联动
    expect(mocks.beginFoldDrag.mock.calls[0]?.[8]).not.toBe(true)
    expect(mocks.beginDragFlip).not.toHaveBeenCalled()
    expect(wrapper.findComponent(VueTurn).emitted('flip-start')).toHaveLength(1)
    // 拖拽中：折角跟随指针，拖点纵向钉在按下高度（lockedV=-0.4），非整页进度
    await fireViewportPointer(wrapper, 'pointermove', { pointerId: 1, clientX: 820, clientY: 240 })
    expect(mocks.setFoldDragFromClient).toHaveBeenCalledWith(820, 240, -0.4)
    expect(mocks.setDragProgress).not.toHaveBeenCalled()
    // 松手：按折角路径收尾
    await fireViewportPointer(wrapper, 'pointerup', { pointerId: 1, clientX: 820, clientY: 240 })
    expect(mocks.endFoldDrag).toHaveBeenCalledWith(false, 900)
  })

  it('starts a fold drag when pressing the middle of the page with fold enabled', async () => {
    mocks.beginFoldDrag.mockReturnValue(true)
    const wrapper = await mountTurn(6)
    stubViewportRect(wrapper)
    // 跨页右页中部（v=0.75 非角区）：折页拖拽——锚点为指针同高度的外页边缘点
    mocks.pickPage.mockReturnValue({ index: 2, u: 0.55, v: 0.75, spread: true })
    await fireViewportPointer(wrapper, 'pointerdown', { pointerId: 1, button: 0, clientX: 520, clientY: 150 })
    expect(mocks.beginFoldDrag).toHaveBeenCalledTimes(1)
    expect(mocks.beginDragFlip).not.toHaveBeenCalled()
    expect(wrapper.findComponent(VueTurn).emitted('flip-start')).toEqual([['left']])
    // 锚点高度 = 指针 v 换算的页高坐标：(0.75-0.5)*PAGE_HEIGHT(2) = 0.5
    expect(mocks.beginFoldDrag.mock.calls[0]?.[4]).toBeCloseTo(0.5, 5)
  })

  it('anchors at the outer corner when pressing the corner zone', async () => {
    mocks.beginFoldDrag.mockReturnValue(true)
    const wrapper = await mountTurn(6)
    stubViewportRect(wrapper)
    // 右页右下角区：折角拖拽——锚点取外角（cornerV=-1 → -PAGE_HEIGHT/2 = -1）
    mocks.pickPage.mockReturnValue({ index: 2, u: 0.95, v: 0.05, spread: true })
    await fireViewportPointer(wrapper, 'pointerdown', { pointerId: 1, button: 0, clientX: 870, clientY: 570 })
    expect(mocks.beginFoldDrag).toHaveBeenCalledTimes(1)
    expect(mocks.beginFoldDrag.mock.calls[0]?.[4]).toBeCloseTo(-1, 5)
  })

  it('starts a normal curl drag from the page middle when fold is disabled', async () => {
    // custom 档 + fold=false：中部按下回到普通整页卷曲拖拽（微曲翻页）
    const wrapper = await mountTurn(6, { preset: 'custom', look: { fold: false } })
    stubViewportRect(wrapper)
    mocks.pickPage.mockReturnValue({ index: 2, u: 0.55, v: 0.5, spread: true })
    await fireViewportPointer(wrapper, 'pointerdown', { pointerId: 1, button: 0, clientX: 520, clientY: 300 })
    expect(mocks.beginDragFlip).toHaveBeenCalledTimes(1)
    expect(mocks.beginFoldDrag).not.toHaveBeenCalled()
  })

  it('starts a fold drag when pressing outside the pages with fold enabled', async () => {
    // 软封面：合书态下书页外按下翻起的是封面纸张，仍走折页拖拽
    mocks.beginFoldDrag.mockReturnValue(true)
    const wrapper = await mountTurn(6, { coverPreset: 'soft' })
    stubViewportRect(wrapper)
    // 书页外（视口空白处）按下：pickPage 未命中，仍走折页拖拽（非条带卷曲）
    mocks.pickPage.mockReturnValue(null)
    await fireViewportPointer(wrapper, 'pointerdown', { pointerId: 1, button: 0, clientX: 700, clientY: 550 })
    expect(mocks.beginFoldDrag).toHaveBeenCalledTimes(1)
    expect(mocks.beginDragFlip).not.toHaveBeenCalled()
    // 锚点取外缘中部（pickV=0），方向按视口半区（右半 → 前进）
    expect(mocks.beginFoldDrag.mock.calls[0]?.[4]).toBe(0)
    expect(wrapper.findComponent(VueTurn).emitted('flip-start')).toEqual([['left']])
    // 拖动跟手（拖点钉在外缘中部高度 lockedV=0），松手走折角收尾
    await fireViewportPointer(wrapper, 'pointermove', { pointerId: 1, clientX: 560, clientY: 400 })
    expect(mocks.setFoldDragFromClient).toHaveBeenCalledWith(560, 400, 0)
    await fireViewportPointer(wrapper, 'pointerup', { pointerId: 1, clientX: 560, clientY: 400 })
    expect(mocks.endFoldDrag).toHaveBeenCalledWith(false, 900)
  })

  it('does not peel on hover by default', async () => {
    const wrapper = await mountTurn()
    stubViewportRect(wrapper)
    await fireViewportPointer(wrapper, 'pointermove', { pointerId: 1, clientX: 870, clientY: 300, buttons: 0 })
    expect(mocks.beginDragFlip).not.toHaveBeenCalled()
  })

  it('does not peel when peel is disabled', async () => {
    const Host = defineComponent({
      setup() {
        const turnRef = ref<TurnInstance | null>(null)
        const page = ref(1)
        return () =>
          h('div', [
            h(
              VueTurn,
              {
                ref: turnRef,
                peel: false,
                modelValue: page.value,
                'onUpdate:modelValue': (v: number) => {
                  page.value = v
                },
              },
              { default: () => pages(6) },
            ),
          ])
      },
    })
    const wrapper = mount(Host)
    await flushPromises()
    stubViewportRect(wrapper)
    await fireViewportPointer(wrapper, 'pointermove', { pointerId: 1, clientX: 870, clientY: 300, buttons: 0 })
    expect(mocks.beginDragFlip).not.toHaveBeenCalled()
  })

  it('emits region-tap when clicking a page region', async () => {
    const region = { x: 0.2, y: 0.2, w: 0.3, h: 0.3, data: 'chapter-2' }
    const Host = defineComponent({
      setup() {
        const turnRef = ref<TurnInstance | null>(null)
        const page = ref(1)
        return () =>
          h('div', [
            h(
              VueTurn,
              {
                ref: turnRef,
                modelValue: page.value,
                'onUpdate:modelValue': (v: number) => {
                  page.value = v
                },
              },
              {
                default: () => [
                  h(TurnItem, { regions: [region] }, { default: () => [h('div', 'cover')] }),
                  ...Array.from({ length: 4 }, (_, i) =>
                    h(TurnItem, null, { default: () => [h('div', `page ${i + 1}`)] }),
                  ),
                ],
              },
            ),
            h('span', { id: 'indicator' }, `${page.value}/8`),
          ])
      },
    })
    const wrapper = mount(Host)
    await flushPromises()
    // 命中点：u=0.3 → px=0.3；v=0.6 → py=0.4（左上原点），落在热区 (0.2,0.2,0.3,0.3) 内
    mocks.pickPage.mockReturnValue({ index: 0, u: 0.3, v: 0.6, spread: false })
    const viewport = stubViewportRect(wrapper)
    await viewport.trigger('click', { clientX: 700, clientY: 300 })
    const turn = wrapper.findComponent(VueTurn)
    expect(turn.emitted('region-tap')).toEqual([[1, region]])
    // 命中热区时不翻页
    expect(wrapper.find('#indicator').text()).toBe('1/8')
    // 未命中热区时正常翻页
    mocks.pickPage.mockReturnValue({ index: 0, u: 0.05, v: 0.05, spread: false })
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    await viewport.trigger('click', { clientX: 700, clientY: 300 })
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('2/8')
  })

  it('exposes zoom methods and emits zoom-change', async () => {
    const wrapper = await mountTurn()
    const turn = wrapper.findComponent(VueTurn)
    const inst = turn.vm as unknown as TurnInstance
    inst.setZoom(2)
    expect(mocks.setZoom).toHaveBeenCalledWith(2, true)
    expect(turn.emitted('zoom-change')).toEqual([[2]])
    inst.zoomIn()
    expect(mocks.setZoom).toHaveBeenLastCalledWith(3, true)
    inst.zoomOut()
    expect(mocks.setZoom).toHaveBeenLastCalledWith(1, true)
    // 超出 maxZoom 的级别被钳制
    inst.setZoom(99)
    expect(mocks.setZoom).toHaveBeenLastCalledWith(3, true)
  })

  it('zooms with the mouse wheel when zoomMode is wheel', async () => {
    const Host = defineComponent({
      setup() {
        const turnRef = ref<TurnInstance | null>(null)
        const page = ref(1)
        return () =>
          h('div', [
            h(
              VueTurn,
              {
                ref: turnRef,
                zoomMode: 'wheel',
                modelValue: page.value,
                'onUpdate:modelValue': (v: number) => {
                  page.value = v
                },
              },
              { default: () => pages(6) },
            ),
          ])
      },
    })
    const wrapper = mount(Host)
    await flushPromises()
    const viewport = stubViewportRect(wrapper)
    await viewport.trigger('wheel', { deltaY: -100 })
    expect(mocks.setZoom).toHaveBeenCalledTimes(1)
    const level = mocks.setZoom.mock.calls[0]?.[0]
    expect(level).toBeCloseTo(Math.exp(0.16), 5)
    const turn = wrapper.findComponent(VueTurn)
    expect(turn.emitted('zoom-change')).toHaveLength(1)
  })

  it('responds to both wheel and double click when zoomMode is both', async () => {
    const Host = defineComponent({
      setup() {
        const turnRef = ref<TurnInstance | null>(null)
        const page = ref(1)
        return () =>
          h('div', [
            h(
              VueTurn,
              {
                ref: turnRef,
                zoomMode: 'both',
                modelValue: page.value,
                'onUpdate:modelValue': (v: number) => {
                  page.value = v
                },
              },
              { default: () => pages(6) },
            ),
          ])
      },
    })
    const wrapper = mount(Host)
    await flushPromises()
    const viewport = stubViewportRect(wrapper)
    await viewport.trigger('wheel', { deltaY: -100 })
    expect(mocks.setZoom).toHaveBeenCalledTimes(1)
    expect(mocks.setZoom).toHaveBeenCalledTimes(1)
    // 双击为切换：当前已放大（滚轮那一步）→ 复位到 1
    await viewport.trigger('dblclick', { clientX: 700, clientY: 300 })
    expect(mocks.setZoom).toHaveBeenCalledTimes(2)
    expect(mocks.setZoom).toHaveBeenLastCalledWith(1, true)
  })

  it('ignores wheel and double click gestures by default (zoomMode off)', async () => {
    const wrapper = await mountTurn(6)
    const viewport = stubViewportRect(wrapper)
    await viewport.trigger('wheel', { deltaY: -100 })
    await viewport.trigger('dblclick', { clientX: 700, clientY: 300 })
    expect(mocks.setZoom).not.toHaveBeenCalled()
  })

  it('toggles zoom on double click without flipping pages', async () => {
    const Host = defineComponent({
      setup() {
        const turnRef = ref<TurnInstance | null>(null)
        const page = ref(1)
        return () =>
          h('div', [
            h(
              VueTurn,
              {
                ref: turnRef,
                zoomMode: 'dblclick',
                modelValue: page.value,
                'onUpdate:modelValue': (v: number) => {
                  page.value = v
                },
              },
              { default: () => pages(6) },
            ),
            h('span', { id: 'indicator' }, `${page.value}/8`),
          ])
      },
    })
    const wrapper = mount(Host)
    await flushPromises()
    const viewport = stubViewportRect(wrapper)
    // 双击：第一次点击进入延迟判定，第二次取消翻页，双击触发缩放
    await viewport.trigger('click', { clientX: 700, clientY: 300 })
    await viewport.trigger('click', { clientX: 700, clientY: 300 })
    await viewport.trigger('dblclick', { clientX: 700, clientY: 300 })
    await flushPromises()
    expect(mocks.setZoom).toHaveBeenLastCalledWith(3, true)
    expect(mocks.startFlip).not.toHaveBeenCalled()
    expect(wrapper.find('#indicator').text()).toBe('1/8')
  })

  it('delays single-click flip when zoomMode includes dblclick', async () => {
    vi.useFakeTimers()
    try {
      mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
      const Host = defineComponent({
        setup() {
          const turnRef = ref<TurnInstance | null>(null)
          const page = ref(1)
          return () =>
            h('div', [
              h(
                VueTurn,
                {
                  ref: turnRef,
                  zoomMode: 'dblclick',
                  modelValue: page.value,
                  'onUpdate:modelValue': (v: number) => {
                    page.value = v
                  },
                },
                { default: () => pages(6) },
              ),
              h('span', { id: 'indicator' }, `${page.value}/8`),
            ])
        },
      })
      const wrapper = mount(Host)
      await flushPromises()
      const viewport = stubViewportRect(wrapper)
      await viewport.trigger('click', { clientX: 700, clientY: 300 })
      // 判定窗口内不翻页
      expect(wrapper.find('#indicator').text()).toBe('1/8')
      vi.advanceTimersByTime(300)
      await flushPromises()
      // 无第二次点击：延迟执行翻页
      expect(wrapper.find('#indicator').text()).toBe('2/8')
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels the delayed click flip when a drag gesture follows the click (zoomMode dblclick)', async () => {
    vi.useFakeTimers()
    try {
      const Host = defineComponent({
        setup() {
          const turnRef = ref<TurnInstance | null>(null)
          const page = ref(1)
          return () =>
            h('div', [
              h(
                VueTurn,
                {
                  ref: turnRef,
                  zoomMode: 'dblclick',
                  modelValue: page.value,
                  'onUpdate:modelValue': (v: number) => {
                    page.value = v
                  },
                },
                { default: () => pages(6) },
              ),
              h('span', { id: 'indicator' }, `${page.value}/8`),
            ])
        },
      })
      const wrapper = mount(Host)
      await flushPromises()
      const viewport = stubViewportRect(wrapper)
      // 单击进入延迟判定，随即开始新手势（拖拽/再次按下）：
      // 新手势应作废延迟翻页 timer，拖拽结束后不得再触发翻页
      await viewport.trigger('click', { clientX: 700, clientY: 300 })
      await fireViewportPointer(wrapper, 'pointerdown', {
        clientX: 700,
        clientY: 300,
        button: 0,
        pointerId: 1,
      })
      await fireViewportPointer(wrapper, 'pointermove', {
        clientX: 660,
        clientY: 300,
        pointerId: 1,
        buttons: 1,
      })
      await fireViewportPointer(wrapper, 'pointerup', { clientX: 660, clientY: 300, pointerId: 1 })
      vi.advanceTimersByTime(400)
      await flushPromises()
      expect(mocks.startFlip).not.toHaveBeenCalled()
      expect(wrapper.find('#indicator').text()).toBe('1/8')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not emit zoom-change when the scene cannot apply the zoom', async () => {
    const wrapper = await mountTurn()
    const turn = wrapper.findComponent(VueTurn)
    const inst = turn.vm as unknown as TurnInstance
    // 模拟翻页/拖拽进行中：场景忽略 setZoom，级别保持 1
    mocks.setZoom.mockImplementation(() => {})
    mocks.getZoom.mockImplementation(() => 1)
    inst.zoomIn()
    inst.setZoom(2.5)
    expect(turn.emitted('zoom-change')).toBeUndefined()
    expect(inst.zoom).toBe(1)
  })

  it('re-rasterizes spread pages on refresh instead of reusing the stale promise', async () => {
    const items = [
      h(TurnItem, null, { default: () => [h('div', 'cover')] }),
      h(TurnItem, null, { default: () => [h('div', 'p1')] }),
      h(TurnItem, { spread: true }, { default: () => [h('div', 'spread')] }),
      h(TurnItem, null, { default: () => [h('div', 'back')] }),
    ]
    const Host = defineComponent({
      setup() {
        const turnRef = ref<TurnInstance | null>(null)
        const page = ref(1)
        return () =>
          h(
            VueTurn,
            {
              ref: turnRef,
              modelValue: page.value,
              'onUpdate:modelValue': (v: number) => {
                page.value = v
              },
            },
            { default: () => items },
          )
      },
    })
    const wrapper = mount(Host)
    await flushPromises()
    const turn = wrapper.findComponent(VueTurn)
    const inst = turn.vm as unknown as TurnInstance
    // 跨页项（第 3 个 item）对应的离屏页元素
    const spreadEl = wrapper.findAll('.page-source')[2]?.element as HTMLElement
    expect(spreadEl).toBeTruthy()
    const callsFor = (el: HTMLElement) =>
      mocks.elementToTexture.mock.calls.filter(([arg]) => arg === el).length
    // 初始批次：左右两页共享同一次整页光栅化
    expect(callsFor(spreadEl)).toBe(1)
    await inst.refresh()
    await flushPromises()
    // refresh 为新批次：必须重新光栅化，不得复用旧的 resolved promise
    expect(callsFor(spreadEl)).toBe(2)
  })
})
