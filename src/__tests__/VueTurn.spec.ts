import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { h, reactive, ref } from 'vue'

import TurnItem from '@/components/TurnItem.vue'
import VueTurn from '@/components/VueTurn.vue'
import type { TurnSlotProps } from '@/types/turn'

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
}))

function toolbar(slotProps: TurnSlotProps) {
  return h('div', [
    h(
      'button',
      { id: 'prev', disabled: !slotProps.canFlipRight, onClick: slotProps.flipRight },
      'prev',
    ),
    h('span', { id: 'indicator' }, `${slotProps.page}/${slotProps.numPages}`),
    h(
      'button',
      { id: 'next', disabled: !slotProps.canFlipLeft, onClick: slotProps.flipLeft },
      'next',
    ),
    h('button', { id: 'jump', onClick: () => slotProps.goToPage(5) }, 'jump',
    ),
  ])
}

function pages(count: number) {
  return Array.from({ length: count }, (_, index) =>
    h(TurnItem, null, { default: () => [h('div', `page ${index + 1}`)] }),
  )
}

async function mountTurn(numPages = 6, extraProps: Record<string, unknown> = {}) {
  const wrapper = mount(VueTurn, {
    props: extraProps,
    slots: {
      default: () => pages(numPages),
      toolbar,
    },
  })
  await flushPromises()
  return wrapper
}

describe('VueTurn', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mocks.elementToTexture.mockResolvedValue({ dispose: vi.fn<() => void>() })
    mocks.startFlip.mockImplementation(() => undefined)
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

  it('jumps straight to a page through the slot api', async () => {
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

  it('emits update:modelValue when a flip commits', async () => {
    mocks.startFlip.mockImplementation((_spec, _front, _back, _duration, onDone) => onDone())
    const wrapper = await mountTurn()
    await wrapper.find('#next').trigger('click')
    await flushPromises()
    const emitted = wrapper.emitted('update:modelValue')
    expect(emitted?.[emitted.length - 1]).toEqual([2])
  })

  it('follows external modelValue changes', async () => {
    const wrapper = await mountTurn(6, { modelValue: 1 })
    await wrapper.setProps({ modelValue: 6 })
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
    const wrapper = mount(VueTurn, {
      slots: {
        default: () => pages(2),
        toolbar,
      },
    })
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
})
