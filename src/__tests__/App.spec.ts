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
        onDone: () => void,
      ) => void
    >(),
  setStaticPages: vi.fn<(placements: unknown[], textureOf: (index: number) => unknown) => void>(),
  applyStaticTexture: vi.fn<(index: number, texture: FakeTexture) => void>(),
  elementToTexture: vi.fn<(element: HTMLElement) => Promise<FakeTexture>>(),
}))

vi.mock('@/composables/useTurnRenderer', () => ({
  useTurnRenderer: () => ({
    container: ref(null),
    containerSize: reactive({ width: 900, height: 600 }),
    webglSupported: ref(true),
    setStaticPages: mocks.setStaticPages,
    applyStaticTexture: mocks.applyStaticTexture,
    startFlip: mocks.startFlip,
  }),
}))

vi.mock('@/lib/textureFactory', () => ({
  elementToTexture: mocks.elementToTexture,
  waitForResources: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}))

describe('App', () => {
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
    mocks.elementToTexture.mockResolvedValue({ dispose: vi.fn<() => void>() })
    const router = createTestRouter()
    const wrapper = mount(App, {
      global: { plugins: [router] },
    })
    router.push('/book')
    await flushPromises()
    expect(wrapper.findComponent(VueTurn).exists()).toBe(true)
    expect(wrapper.find('.indicator').text()).toBe('第 1 / 10 页')
  })

  it('corrects an invalid route page back to page one', async () => {
    mocks.elementToTexture.mockResolvedValue({ dispose: vi.fn<() => void>() })
    const router = createTestRouter()
    mount(App, {
      global: { plugins: [router] },
    })
    router.push('/book/abc')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/book/1')
  })
})
