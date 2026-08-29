import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { reactive, ref } from 'vue'

import App from '../App.vue'
import VueTurn from '../components/VueTurn.vue'
import BookView from '../views/BookView.vue'

type FakeTexture = { dispose: () => void }

const mocks = vi.hoisted(() => ({
  startFlip:
    vi.fn<
      (
        spec: import('@/types/turn').FlipSpec,
        front: FakeTexture | null,
        back: FakeTexture | null,
        duration: number,
        onDone: (committed?: boolean) => void,
        options?: import('@/types/turn').FlipSheetOptions,
      ) => void
    >(),
  beginDragFlip:
    vi.fn<
      (
        spec: import('@/types/turn').FlipSpec,
        front: FakeTexture | null,
        back: FakeTexture | null,
        onDone: (committed?: boolean) => void,
        options?: import('@/types/turn').FlipSheetOptions,
      ) => boolean
    >().mockReturnValue(true),
  endDragFlip: vi.fn<(commit: boolean, baseDuration: number) => void>(),
  stopFlip: vi.fn<() => void>(),
  setDragProgress: vi.fn<(progress: number) => void>(),
  beginFoldDrag:
    vi.fn<
      (
        spec: import('@/types/turn').FlipSpec,
        front: FakeTexture | null,
        back: FakeTexture | null,
        pickU: number,
        pickV: number,
        bend: number,
        onDone: (committed?: boolean) => void,
        options?: import('@/types/turn').FlipSheetOptions,
      ) => boolean
    >().mockReturnValue(true),
  setFoldDragFromClient: vi.fn<(x: number, y: number) => number | null>().mockReturnValue(null),
  setFoldDragAt: vi.fn<(qu: number, qv: number) => number | null>().mockReturnValue(null),
  endFoldDrag: vi.fn<(commit: boolean, baseDuration: number) => void>(),
  startFoldFlip:
    vi.fn<
      (
        spec: import('@/types/turn').FlipSpec,
        front: FakeTexture | null,
        back: FakeTexture | null,
        duration: number,
        onDone: (committed?: boolean) => void,
        options?: import('@/types/turn').FlipSheetOptions,
        bend?: number,
      ) => boolean
    >().mockReturnValue(true),
  setZoom: vi.fn<(level: number, animate?: boolean, duration?: number) => void>(),
  getZoom: vi.fn<() => number>().mockReturnValue(1),
  panBy: vi.fn<(dx: number, dy: number) => void>(),
  pickPage: vi.fn<(x: number, y: number) => unknown>().mockReturnValue(null),
  setStaticPages: vi.fn<(placements: unknown[], textureOf: (index: number) => unknown) => void>(),
  applyStaticTexture: vi.fn<(index: number, texture: FakeTexture) => void>(),
  setCoverPages: vi.fn<(indices: number[]) => void>(),
  elementToTexture: vi.fn<(element: HTMLElement) => Promise<FakeTexture>>(),
}))

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
    setDragProgress: mocks.setDragProgress,
    endDragFlip: mocks.endDragFlip,
    beginFoldDrag: mocks.beginFoldDrag,
    setFoldDragFromClient: mocks.setFoldDragFromClient,
    setFoldDragAt: mocks.setFoldDragAt,
    endFoldDrag: mocks.endFoldDrag,
    stopFlip: mocks.stopFlip,
    setZoom: mocks.setZoom,
    getZoom: mocks.getZoom,
    panBy: mocks.panBy,
    pickPage: mocks.pickPage,
    setStacks: vi.fn<() => void>(),
    pickStack: vi.fn<() => null>().mockReturnValue(null),
    setStackHover: vi.fn<() => void>(),
  }),
}))

vi.mock('@/lib/textureFactory', () => ({
  elementToTexture: mocks.elementToTexture,
  waitForResources: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}))

describe('App', () => {
  // 可克隆的假纹理：demo 书含跨页项，需要 clone/repeat/offset
  function fakeTexture(): FakeTexture & {
    repeat: { set: () => void }
    offset: { set: () => void }
    clone: () => ReturnType<typeof fakeTexture>
  } {
    return {
      dispose: vi.fn<() => void>(),
      repeat: { set: vi.fn<() => void>() },
      offset: { set: vi.fn<() => void>() },
      clone: fakeTexture,
    }
  }

  function createTestRouter() {
    return createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', redirect: '/book' },
        { path: '/book/:page?', name: 'book', component: BookView },
      ],
    })
  }

  it('renders the book view at /book', async () => {
    mocks.elementToTexture.mockImplementation(() => Promise.resolve(fakeTexture()))
    const router = createTestRouter()
    const wrapper = mount(App, {
      global: { plugins: [router] },
    })
    router.push('/book')
    await flushPromises()
    expect(wrapper.findComponent(VueTurn).exists()).toBe(true)
    expect(wrapper.find('.indicator').text()).toBe('第 1 / 12 页')
  })

  it('corrects an invalid route page back to page one', async () => {
    mocks.elementToTexture.mockImplementation(() => Promise.resolve(fakeTexture()))
    const router = createTestRouter()
    mount(App, {
      global: { plugins: [router] },
    })
    router.push('/book/abc')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/book/1')
  })
})
