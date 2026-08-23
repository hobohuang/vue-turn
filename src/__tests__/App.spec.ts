import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { reactive, ref } from 'vue'

import App from '../App.vue'
import Flipbook from '../components/Flipbook.vue'
import BookView from '../views/BookView.vue'

type FakeTexture = { dispose: () => void }

const mocks = vi.hoisted(() => ({
  startFlip:
    vi.fn<
      (
        spec: import('@/types/flipbook').FlipSpec,
        front: FakeTexture | null,
        back: FakeTexture | null,
        duration: number,
        onDone: () => void,
      ) => void
    >(),
  startSlide: vi.fn<(duration: number, onDone: () => void) => void>(),
  setStaticPages: vi.fn<(placements: unknown[], textureOf: (index: number) => unknown) => void>(),
  applyStaticTexture: vi.fn<(index: number, texture: FakeTexture) => void>(),
  elementToTexture: vi.fn<(element: HTMLElement) => Promise<FakeTexture>>(),
}))

vi.mock('@/composables/useFlipbookRenderer', () => ({
  useFlipbookRenderer: () => ({
    container: ref(null),
    containerSize: reactive({ width: 900, height: 600 }),
    setStaticPages: mocks.setStaticPages,
    applyStaticTexture: mocks.applyStaticTexture,
    startFlip: mocks.startFlip,
    startSlide: mocks.startSlide,
  }),
}))

vi.mock('@/lib/textureFactory', () => ({
  elementToTexture: mocks.elementToTexture,
}))

describe('App', () => {
  it('renders the book view at /book', async () => {
    mocks.elementToTexture.mockResolvedValue({ dispose: vi.fn<() => void>() })
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', redirect: '/book' },
        { path: '/book/:page?', name: 'book', component: BookView },
      ],
    })
    const wrapper = mount(App, {
      global: { plugins: [createPinia(), router] },
    })
    router.push('/book')
    await flushPromises()
    expect(wrapper.findComponent(Flipbook).exists()).toBe(true)
    expect(wrapper.find('.indicator').text()).toBe('第 1 / 10 页')
  })
})
