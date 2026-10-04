import { beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, computed, ref, type Ref } from 'vue'

import TurnItem from '@/components/TurnItem.vue'
import VueTurn from '@/components/VueTurn.vue'
import type { TurnInstance } from '@/types/turn'

// 实例响应式 state：读取自动跟踪更新，无需事件回调手动强刷。
// 宿主不绑定任何事件，全部状态经 inst.state 在 computed 中读取。
enableAutoUnmount(beforeEach)

type FakeTexture = { dispose: () => void }

const mocks = vi.hoisted(() => {
  return {
    /** 最近一次翻页的收尾回调（stopFlip 的同步收尾模拟用） */
    lastDone: null as ((committed?: boolean) => void) | null,
    stopFlip: vi.fn<() => void>(() => {
      // 场景语义：stopFlip 同步触发在途纸张的 onDone
      mocks.lastDone?.(false)
      mocks.lastDone = null
    }),
    startFlip: vi.fn<
      (
        spec: unknown,
        front: FakeTexture | null,
        back: FakeTexture | null,
        duration: number,
        onDone: (committed?: boolean) => void,
      ) => void
    >(),
    setStaticPages: vi.fn<() => void>(),
    setSpineScale: vi.fn<(scale: number) => void>(),
    applyStaticTexture: vi.fn<() => void>(),
    setCoverPages: vi.fn<() => void>(),
    setStacks: vi.fn<() => void>(),
    setMaxZoom: vi.fn<(value: number) => void>(),
    getZoom: vi.fn<() => number>().mockReturnValue(1),
    setZoom: vi.fn<() => void>(),
    pickStack: vi.fn<() => null>().mockReturnValue(null),
    setStackHover: vi.fn<() => void>(),
    pickPage: vi.fn<() => null>().mockReturnValue(null),
  }
})

vi.mock('@/composables/useTurnRenderer', () => ({
  useTurnRenderer: () => ({
    container: ref(null),
    containerSize: { width: 900, height: 600 },
    webglSupported: ref(true),
    maxAnisotropy: ref(8),
    setStaticPages: mocks.setStaticPages,
    setSpineScale: mocks.setSpineScale,
    applyStaticTexture: mocks.applyStaticTexture,
    setCoverPages: mocks.setCoverPages,
    startFlip: mocks.startFlip,
    startFoldFlip: vi.fn<() => boolean>().mockReturnValue(false),
    beginDragFlip: vi.fn<() => boolean>().mockReturnValue(true),
    activateSheet: vi.fn<() => void>(),
    setDragProgress: vi.fn<() => void>(),
    endDragFlip: vi.fn<() => void>(),
    beginFoldDrag: vi.fn<() => boolean>().mockReturnValue(true),
    setFoldDragFromClient: vi.fn<() => number | null>().mockReturnValue(null),
    foldAnchorDistanceFromClient: vi.fn<() => number | null>().mockReturnValue(null),
    setFoldDragAt: vi.fn<() => number | null>().mockReturnValue(null),
    endFoldDrag: vi.fn<() => void>(),
    stopFlip: mocks.stopFlip,
    setZoom: mocks.setZoom,
    getZoom: mocks.getZoom,
    panBy: vi.fn<() => void>(),
    pickPage: mocks.pickPage,
    setStacks: mocks.setStacks,
    pickStack: mocks.pickStack,
    setStackHover: mocks.setStackHover,
    setMaxZoom: mocks.setMaxZoom,
  }),
}))

vi.mock('@/lib/textureFactory', () => ({
  elementToTexture: vi
    .fn<() => Promise<FakeTexture>>()
    .mockResolvedValue({ dispose: vi.fn<() => void>() }),
  // 空白补位页/空白衬页的纯色纸纹（无 DOM 可光栅化）
  solidColorTexture: vi
    .fn<() => FakeTexture>()
    .mockReturnValue({ dispose: vi.fn<() => void>() }),
  waitForResources: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}))

function pages(count: number) {
  return Array.from({ length: count }, (_, i) =>
    h(TurnItem, null, { default: () => [h('div', `page ${i + 1}`)] }),
  )
}

function createHost(maxZoom: Ref<number>) {
  return defineComponent({
    name: 'StateHost',
    setup() {
      const turnRef = ref<TurnInstance | null>(null)
      const page = ref(1)
      // 全部经 inst.state 响应式读取：按钮状态随内部状态自动更新
      const state = computed(() => turnRef.value?.state)
      return () =>
        h('div', [
          h(
            VueTurn,
            {
              ref: turnRef,
              modelValue: page.value,
              maxZoom: maxZoom.value,
              // 既有用例依赖 goToPage 的瞬间跳转语义（扇形动画单独验证）
              jumpAnimation: false,
              'onUpdate:modelValue': (v: number) => {
                page.value = v
              },
            },
            { default: () => pages(6) },
          ),
          h('div', { class: 'indicator' }, [
            h('span', { id: 'page' }, String(state.value?.page ?? '')),
            h('span', { id: 'num-pages' }, String(state.value?.numPages ?? '')),
            h('span', { id: 'flipping' }, String(state.value?.isFlipping ?? '')),
            h('span', { id: 'can-next' }, String(state.value?.canNext ?? '')),
            h('span', { id: 'zoom' }, String(state.value?.zoom ?? '')),
          ]),
        ])
    },
  })
}

async function mountStateHost(maxZoom = ref(3)) {
  const wrapper = mount(createHost(maxZoom))
  await flushPromises()
  const inst = wrapper.findComponent(VueTurn).vm as unknown as TurnInstance
  const text = (id: string) => wrapper.find(`#${id}`).text()
  return { wrapper, inst, text }
}

describe('实例响应式 state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
  })

  it('page/numPages/canNext 无事件回调即自动跟踪', async () => {
    const { inst, text } = await mountStateHost()
    expect(text('page')).toBe('1')
    expect(text('num-pages')).toBe('8')
    expect(text('can-next')).toBe('true')

    inst.next()
    await flushPromises()
    // 封面翻页 delta=1：居中单页 → 跨页第 2 页
    expect(text('page')).toBe('2')
    expect(text('can-next')).toBe('true')

    // 翻到最后一页：canNext 归 false
    inst.goToPage(inst.numPages)
    await flushPromises()
    expect(text('page')).toBe('8')
    expect(text('can-next')).toBe('false')
  })

  it('isFlipping 跟随异步翻页动画', async () => {
    // 动画进行中不收尾：记录 onDone，交由 stop() 的同步收尾触发
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => {
      mocks.lastDone = onDone
    })
    const { inst, text } = await mountStateHost()
    expect(text('flipping')).toBe('false')
    inst.next()
    await flushPromises()
    expect(text('flipping')).toBe('true')
    inst.stop()
    await flushPromises()
    expect(text('flipping')).toBe('false')
  })

  it('zoom 经 zoom-change 镜像保持同步（实例方法路径）', async () => {
    mocks.getZoom.mockReturnValue(1)
    const { inst, text } = await mountStateHost()
    expect(text('zoom')).toBe('1')
    // useZoomPan.applyZoom：setZoom 后读取 getZoom 判定变化并派发 zoom-change
    mocks.getZoom.mockReturnValueOnce(1).mockReturnValue(3)
    inst.zoomIn()
    await flushPromises()
    expect(text('zoom')).toBe('3')

    mocks.getZoom.mockReturnValueOnce(3).mockReturnValue(1)
    inst.zoomOut()
    await flushPromises()
    expect(text('zoom')).toBe('1')
  })

  it('zoom 在 maxZoom 收敛时同步（收敛不发 zoom-change，由 watch 补镜像）', async () => {
    const maxZoom = ref(3)
    mocks.getZoom.mockReturnValue(1)
    const { text } = await mountStateHost(maxZoom)
    expect(text('zoom')).toBe('1')
    // 缩小 maxZoom：场景把当前级别收敛到新上限（getZoom 返回 2），
    // 组件 watch 补同步镜像
    mocks.getZoom.mockReturnValue(2)
    maxZoom.value = 2
    await flushPromises()
    expect(text('zoom')).toBe('2')
  })
})
