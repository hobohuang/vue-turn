import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, reactive, ref } from 'vue'

import TurnItem from '@/components/TurnItem.vue'
import VueTurn from '@/components/VueTurn.vue'
import type { TurnInstance } from '@/types/turn'

type FakeTexture = { dispose: () => void }

const mocks = vi.hoisted(() => {
  // 模拟真实 TurnScene 的同步收尾行为：
  // startFlip/beginDragFlip 记录回调，由 endDragFlip/stopFlip 触发
  const done = {
    flip: null as null | ((committed: boolean) => void),
    drag: null as null | ((committed: boolean) => void),
  }
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
    beginDragFlip: vi.fn<
      (
        spec: import('@/types/turn').FlipSpec,
        front: FakeTexture | null,
        back: FakeTexture | null,
        onDone: (committed?: boolean) => void,
        options?: import('@/types/turn').FlipSheetOptions,
      ) => boolean
    >(),
    endDragFlip: vi.fn<(commit: boolean, baseDuration: number) => void>(),
    stopFlip: vi.fn<() => void>(),
    setDragProgress: vi.fn<(progress: number) => void>(),
    setZoom: vi.fn<(level: number, animate?: boolean, duration?: number) => void>(),
    getZoom: vi.fn<() => number>(),
    panBy: vi.fn<(dx: number, dy: number) => void>(),
    pickPage: vi.fn<(x: number, y: number) => unknown>(),
    setStaticPages: vi.fn<(placements: unknown[], textureOf: (index: number) => unknown) => void>(),
    applyStaticTexture: vi.fn<(index: number, texture: FakeTexture) => void>(),
    setStacks: vi.fn<() => void>(),
    elementToTexture: vi.fn<(element: HTMLElement) => Promise<FakeTexture>>(),
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
    startFlip: mocks.startFlip,
    beginDragFlip: mocks.beginDragFlip,
    setDragProgress: mocks.setDragProgress,
    endDragFlip: mocks.endDragFlip,
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
  modelValue?: number
  defaultPages?: number
}

function createHost(props: HostProps = {}) {
  return defineComponent({
    name: 'TestHost',
    setup() {
      const turnRef = ref<TurnInstance | null>(null)
      const page = ref(props.modelValue ?? 1)
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
              default: () =>
                pages(props.defaultPages !== undefined ? props.defaultPages : total.value),
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
    modelValue?: number
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
    mocks.elementToTexture.mockResolvedValue({ dispose: vi.fn<() => void>() })
    // 默认：记录翻页回调但不调用（模拟翻页进行中）
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => {
      mocks.done.flip = onDone
    })
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
    mocks.getZoom.mockReturnValue(1)
    mocks.pickPage.mockReturnValue(null)
  })

  it('rasterizes every turn-item before first paint', async () => {
    await mountTurn()
    expect(mocks.elementToTexture).toHaveBeenCalledTimes(6)
    expect(mocks.applyStaticTexture).toHaveBeenCalledTimes(6)
  })

  it('shows the first spread and disables the back flip', async () => {
    const wrapper = await mountTurn()
    expect(wrapper.find('#indicator').text()).toBe('1/6')
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
    expect(wrapper.find('#indicator').text()).toBe('2/6')
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    expect(mocks.startFlip).toHaveBeenCalledTimes(2)
    expect(wrapper.find('#indicator').text()).toBe('4/6')
  })

  it('flips the cover sheet closed when going back from page two', async () => {
    const wrapper = await mountTurn()
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('2/6')
    await wrapper.find('#prev').trigger('click')
    await flushPromises()
    expect(mocks.startFlip).toHaveBeenCalledTimes(2)
    const closeSpec = mocks.startFlip.mock.calls[1]?.[0]
    expect(closeSpec?.frontIndex).toBe(1)
    expect(closeSpec?.backIndex).toBe(0)
    expect(closeSpec?.delta).toBe(-1)
    expect(wrapper.find('#indicator').text()).toBe('1/6')
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
    expect(wrapper.find('#indicator').text()).toBe('4/6')
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    const calls = mocks.startFlip.mock.calls
    const closeSpec = calls[calls.length - 1]?.[0]
    expect(closeSpec?.frontIndex).toBe(4)
    expect(closeSpec?.backIndex).toBe(5)
    expect(closeSpec?.delta).toBe(2)
    expect(closeSpec?.worldToX).toBeGreaterThan(0)
    expect(wrapper.find('#indicator').text()).toBe('6/6')
    expect(wrapper.find('#next').attributes('disabled')).toBeDefined()
  })

  it('opens the back cover with a real sheet when going back', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    const wrapper = await mountTurn()
    await wrapper.find('#jump').trigger('click')
    await flushPromises()
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('6/6')
    await wrapper.find('#prev').trigger('click')
    await flushPromises()
    const calls = mocks.startFlip.mock.calls
    const openSpec = calls[calls.length - 1]?.[0]
    expect(openSpec?.frontIndex).toBe(5)
    expect(openSpec?.backIndex).toBe(4)
    expect(openSpec?.delta).toBe(-2)
    expect(wrapper.find('#indicator').text()).toBe('4/6')
  })

  it('jumps straight to a page through the instance api', async () => {
    const wrapper = await mountTurn(6)
    await wrapper.find('#jump').trigger('click')
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('4/6')
  })

  it('ignores flips while an animation is in flight', async () => {
    const wrapper = await mountTurn()
    mocks.startFlip.mockImplementation(() => undefined)
    await wrapper.find('#next').trigger('click')
    await wrapper.find('#jump').trigger('click')
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('1/6')
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
              { default: () => pages(6) },
            ),
            h('span', { id: 'indicator' }, `${externalPage.value}/6`),
          ])
      },
    })
    const wrapper = mount(Host)
    await flushPromises()
    externalPage.value = 6
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('6/6')
  })

  it('keeps working when a page texture fails to rasterize', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mocks.elementToTexture.mockReset()
    mocks.elementToTexture
      .mockResolvedValueOnce({ dispose: vi.fn<() => void>() })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ dispose: vi.fn<() => void>() })
    const wrapper = await mountTurn()
    expect(wrapper.find('#indicator').text()).toBe('1/6')
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('2/6')
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
    expect(second.find('#indicator').text()).toBe('2/6')
    expect(first.find('#indicator').text()).toBe('1/6')
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
    expect(mocks.elementToTexture).toHaveBeenCalledTimes(1)
    content.value = 'updated'
    await flushPromises()
    expect(mocks.elementToTexture).toHaveBeenCalledTimes(2)
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
    count.value = 6
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('1/6')
    // 新增页也完成了光栅化
    expect(mocks.elementToTexture).toHaveBeenCalledTimes(10)
  })

  it('exposes next/prev and readonly state on the instance api', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    const wrapper = await mountTurn()
    const inst = wrapper.findComponent(VueTurn).vm as unknown as TurnInstance
    expect(inst.page).toBe(1)
    expect(inst.numPages).toBe(6)
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
    inst.goToPage(6)
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
    expect(errors?.[0]?.[0]).toBe(2)
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
    expect(wrapper.find('#indicator').text()).toBe('2/6')
  })

  it('does not flip on click when clickToFlip is disabled', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    const wrapper = await mountTurn(6, { clickToFlip: false })
    const viewport = wrapper.find('.viewport')
    const el = viewport.element as HTMLElement
    el.getBoundingClientRect = () => ({ left: 0, width: 900, height: 600 }) as DOMRect
    await viewport.trigger('click', { clientX: 700 })
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('1/6')
  })

  it('flips with arrow keys when focused', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    const wrapper = await mountTurn()
    const viewport = wrapper.find('.viewport')
    await viewport.trigger('keydown', { key: 'ArrowRight' })
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('2/6')
    // 回到封面后左键不再前进
    await viewport.trigger('keydown', { key: 'ArrowLeft' })
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('1/6')
  })

  it('supports PageDown, Space, PageUp, Home and End keys', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    const wrapper = await mountTurn()
    const viewport = wrapper.find('.viewport')
    // Space 前进（封面展开）
    await viewport.trigger('keydown', { key: ' ' })
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('2/6')
    // PageDown 常规翻页
    await viewport.trigger('keydown', { key: 'PageDown' })
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('4/6')
    // End 跳到末页（封底合上）
    await viewport.trigger('keydown', { key: 'End' })
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('6/6')
    // Home 跳回首页
    await viewport.trigger('keydown', { key: 'Home' })
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('1/6')
    // PageUp 在首页无效果
    await viewport.trigger('keydown', { key: 'PageUp' })
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('1/6')
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
            h('span', { id: 'indicator' }, `${page.value}/6`),
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
    expect(wrapper.find('#indicator').text()).toBe('1/6')
    // 死区外右半：前进
    await viewport.trigger('click', { clientX: 700 })
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('2/6')
  })

  it('exposes accessibility attributes on the viewport', async () => {
    const wrapper = await mountTurn()
    const viewport = wrapper.find('.viewport')
    expect(viewport.attributes('role')).toBe('group')
    expect(viewport.attributes('aria-label')).toBe('翻书')
    expect(viewport.attributes('tabindex')).toBe('0')
  })

  it('forces single page when displayedPages is 1', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    const wrapper = await mountTurn(6, { displayedPages: 1 })
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    // 单页模式每次只前进一页
    expect(wrapper.find('#indicator').text()).toBe('2/6')
    const spec = mocks.startFlip.mock.calls[0]?.[0]
    expect(spec?.delta).toBe(1)
  })

  it('forces double page when displayedPages is 2', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    const wrapper = await mountTurn(6, { displayedPages: 2 })
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('2/6')
  })

  it('only rasterizes pages within the prefetch window on mount', async () => {
    // 20 页、prefetchWindow=2、双页模式：初始窗口 [0, 0+2+2)=[0,4)，仅光栅化 4 页
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
    expect(mocks.elementToTexture).toHaveBeenCalledTimes(4)
  })

  it('prefetches missing pages after flipping into a new window', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    // 10 页、prefetchWindow=1、双页模式
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
    // 初始窗口 [0, 0+2+1)=[0,3)，光栅化 3 页
    expect(mocks.elementToTexture).toHaveBeenCalledTimes(3)
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    // 翻一次后 currentPage=1，窗口 [0, 1+2+1)=[0,4)，仅新增 index 3
    expect(mocks.elementToTexture).toHaveBeenCalledTimes(4)
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
    // 初始光栅化 6 页（窗口 [0,6) 覆盖全部）
    expect(disposes).toHaveLength(6)
    // 删掉后两页：触发 syncPageCount 释放 index >= 4 的纹理
    count.value = 4
    await flushPromises()
    // 被删除页（index 4、5）的纹理应被释放
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
    // 封面(0) + 跨页[1,2] + 两个普通页(3,4) = 5 页，奇数总数补 1 空白 = 6 页
    const wrapper = await mountItems(['full', 'spread', 'full', 'full'])
    expect(wrapper.find('#indicator').text()).toBe('1/6')
  })

  it('inserts a blank page when a spread would land on an even index', async () => {
    mocks.elementToTexture.mockReset()
    mocks.elementToTexture.mockImplementation(() => Promise.resolve(fakeTexture()))
    // 封面(0) + 普通(1) + 跨页(空白2 + [3,4]) + 普通(5) + 普通(6) = 7 页，奇数补 1 = 8 页
    const wrapper = await mountItems(['full', 'full', 'spread', 'full', 'full'])
    expect(wrapper.find('#indicator').text()).toBe('1/8')
  })

  it('renders a visible spread as one double-width centered placement', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    mocks.elementToTexture.mockReset()
    mocks.elementToTexture.mockImplementation(() => Promise.resolve(fakeTexture()))
    const wrapper = await mountItems(['full', 'spread', 'full', 'full'])
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('2/6')
    // 翻到跨页后：静态布局合并为单张居中跨页页（index 为起始页 1）
    const calls = mocks.setStaticPages.mock.calls
    const lastPlacements = calls[calls.length - 1]?.[0]
    expect(lastPlacements).toEqual([{ index: 1, slot: 'center', spread: true }])
  })

  it('flips through a spread with regular sheet flips', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    mocks.elementToTexture.mockReset()
    mocks.elementToTexture.mockImplementation(() => Promise.resolve(fakeTexture()))
    const wrapper = await mountItems(['full', 'spread', 'full', 'full'])
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('2/6')
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('4/6')
    // 离开跨页：front=2（跨页右半）、back=3，static 含跨页左半(1)
    const calls = mocks.startFlip.mock.calls
    const spec = calls[calls.length - 1]?.[0]
    expect(spec?.frontIndex).toBe(2)
    expect(spec?.backIndex).toBe(3)
    expect(spec?.staticPages).toEqual([
      { index: 1, slot: 'left' },
      { index: 4, slot: 'right' },
    ])
  })

  it('restores the initial page from modelValue on mount', async () => {
    // 回归：挂载时初始页码不能被 0 页状态钳制到封面（刷新恢复 /book/:page 场景）
    const wrapper = await mountTurn(6, { modelValue: 6 })
    expect(wrapper.find('#indicator').text()).toBe('6/6')
    const turn = wrapper.findComponent(VueTurn)
    expect((turn.vm as unknown as TurnInstance).page).toBe(6)
  })

  it('auto-inserts a blank page so odd-page books keep an even total', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    mocks.elementToTexture.mockReset()
    mocks.elementToTexture.mockImplementation(() => Promise.resolve(fakeTexture()))
    // 封面(0) + a(1) + back(2) = 3 页（奇数）→ 末项前补空白 = 4 页
    const wrapper = await mountItems(['full', 'full', 'full'])
    expect(wrapper.find('#indicator').text()).toBe('1/4')
    // 前进到 [1,2]（a + 空白）：再次前进应走封底合上分支（back=末页 3）
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('2/4')
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('4/4')
    const calls = mocks.startFlip.mock.calls
    const closeSpec = calls[calls.length - 1]?.[0]
    expect(closeSpec?.frontIndex).toBe(2)
    expect(closeSpec?.backIndex).toBe(3)
    expect(closeSpec?.delta).toBe(2)
  })

  it('rasterizes a spread base texture only once', async () => {
    mocks.elementToTexture.mockReset()
    mocks.elementToTexture.mockImplementation(() => Promise.resolve(fakeTexture()))
    // 5 个 item（跨页占 2 页 + 奇数补空白 = 6 页），跨页共享一次整页光栅化 → elementToTexture 共 4 次
    const wrapper = await mountItems(['full', 'spread', 'full', 'full'])
    expect(wrapper.find('#indicator').text()).toBe('1/6')
    expect(mocks.elementToTexture).toHaveBeenCalledTimes(4)
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

  it('flips hard pages as rigid sheets without curl', async () => {
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
                  h(TurnItem, { hard: true }, { default: () => [h('div', 'cover')] }),
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
    // 封面（硬页）：curl 覆盖为 0，整页刚体翻转
    expect(mocks.startFlip.mock.calls[0]?.[5]).toEqual({ curl: 0 })
    inst.next()
    await flushPromises()
    // 普通页：无卷曲覆盖
    expect(mocks.startFlip.mock.calls[1]?.[5]).toEqual({})
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

  it('emits first and last when navigating to the covers', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    const wrapper = await mountTurn()
    const turn = wrapper.findComponent(VueTurn)
    const inst = turn.vm as unknown as TurnInstance
    inst.goToPage(6)
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
    const wrapper = await mountTurn()
    const turn = wrapper.findComponent(VueTurn)
    stubViewportRect(wrapper)
    await fireViewportPointer(wrapper, 'pointerdown', { pointerId: 1, button: 0, clientX: 700, clientY: 300 })
    await fireViewportPointer(wrapper, 'pointermove', { pointerId: 1, clientX: 650, clientY: 300 })
    const inst = turn.vm as unknown as TurnInstance
    expect(inst.isFlipping).toBe(true)
    inst.stop()
    await flushPromises()
    expect(inst.isFlipping).toBe(false)
    expect(wrapper.find('#indicator').text()).toBe('1/6')
    expect(turn.emitted('flip-end')).toEqual([['left']])
  })

  it('drags a page across and commits on release', async () => {
    const wrapper = await mountTurn()
    const turn = wrapper.findComponent(VueTurn)
    stubViewportRect(wrapper)
    await fireViewportPointer(wrapper, 'pointerdown', { pointerId: 1, button: 0, clientX: 700, clientY: 300 })
    expect(mocks.beginDragFlip).toHaveBeenCalledTimes(1)
    expect(turn.emitted('flip-start')).toEqual([['left']])
    expect(turn.emitted('pressed')).toEqual([[{ x: 700, y: 300 }]])
    await fireViewportPointer(wrapper, 'pointermove', { pointerId: 1, clientX: 200, clientY: 300 })
    // 满程 = 视口 60% 宽 = 540px，拖动 500px → 进度 500/540
    expect(mocks.setDragProgress).toHaveBeenLastCalledWith(500 / 540)
    await fireViewportPointer(wrapper, 'pointerup', { pointerId: 1, clientX: 200, clientY: 300 })
    expect(mocks.endDragFlip).toHaveBeenCalledWith(true, 900)
    expect(turn.emitted('released')).toHaveLength(1)
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('2/6')
    expect(turn.emitted('flip-end')).toEqual([['left']])
  })

  it('springs back when the drag barely moves', async () => {
    const wrapper = await mountTurn()
    const turn = wrapper.findComponent(VueTurn)
    stubViewportRect(wrapper)
    await fireViewportPointer(wrapper, 'pointerdown', { pointerId: 1, button: 0, clientX: 700, clientY: 300 })
    await fireViewportPointer(wrapper, 'pointermove', { pointerId: 1, clientX: 690, clientY: 300 })
    await fireViewportPointer(wrapper, 'pointerup', { pointerId: 1, clientX: 690, clientY: 300 })
    // 进度 10/540 未过阈值：回弹取消
    expect(mocks.endDragFlip).toHaveBeenCalledWith(false, 900)
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('1/6')
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

  it('shows a peeled corner when hovering the page edge', async () => {
    const wrapper = await mountTurn(6, { peel: true })
    stubViewportRect(wrapper)
    const stacksCallsBefore = mocks.setStacks.mock.calls.length
    // LTR 前进边缘（右缘）悬停：掀起页角，强度随深度渐变（无阶跃跳变）
    await fireViewportPointer(wrapper, 'pointermove', { pointerId: 1, clientX: 870, clientY: 300, buttons: 0 })
    expect(mocks.beginDragFlip).toHaveBeenCalledTimes(1)
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
    expect(wrapper.find('#indicator').text()).toBe('1/6')
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
            h('span', { id: 'indicator' }, `${page.value}/6`),
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
    expect(wrapper.find('#indicator').text()).toBe('1/6')
    // 未命中热区时正常翻页
    mocks.pickPage.mockReturnValue({ index: 0, u: 0.05, v: 0.05, spread: false })
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    await viewport.trigger('click', { clientX: 700, clientY: 300 })
    await flushPromises()
    expect(wrapper.find('#indicator').text()).toBe('2/6')
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

  it('zooms with the mouse wheel when zoomEnabled', async () => {
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
                zoomEnabled: true,
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
                dblClickZoom: true,
                modelValue: page.value,
                'onUpdate:modelValue': (v: number) => {
                  page.value = v
                },
              },
              { default: () => pages(6) },
            ),
            h('span', { id: 'indicator' }, `${page.value}/6`),
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
    expect(wrapper.find('#indicator').text()).toBe('1/6')
  })

  it('delays single-click flip when dblClickZoom is enabled', async () => {
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
                  dblClickZoom: true,
                  modelValue: page.value,
                  'onUpdate:modelValue': (v: number) => {
                    page.value = v
                  },
                },
                { default: () => pages(6) },
              ),
              h('span', { id: 'indicator' }, `${page.value}/6`),
            ])
        },
      })
      const wrapper = mount(Host)
      await flushPromises()
      const viewport = stubViewportRect(wrapper)
      await viewport.trigger('click', { clientX: 700, clientY: 300 })
      // 判定窗口内不翻页
      expect(wrapper.find('#indicator').text()).toBe('1/6')
      vi.advanceTimersByTime(300)
      await flushPromises()
      // 无第二次点击：延迟执行翻页
      expect(wrapper.find('#indicator').text()).toBe('2/6')
    } finally {
      vi.useRealTimers()
    }
  })
})
