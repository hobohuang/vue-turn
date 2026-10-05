import { afterEach, describe, expect, it, vi } from 'vitest'

import { TurnScene } from '../TurnScene'

// jsdom 没有 WebGL 实现：createRenderer 取不到上下文而返回 null，
// 正好覆盖组件降级到 fallback 文案的那条路径
describe('TurnScene 无渲染器（WebGL 不可用）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('构造后停帧，不满频空转', () => {
    const queue: FrameRequestCallback[] = []
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      queue.push(callback)
      return queue.length
    })
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined)
    const scene = new TurnScene({ container: document.createElement('div'), pageAspect: 0.75 })
    expect(scene.hasRenderer).toBe(false)
    // 驱动排帧队列：停帧后队列会排空，空转则每帧都重新排一帧
    let driven = 0
    let now = 0
    while (queue.length > 0 && driven < 60) {
      const callback = queue.shift()!
      now += 16
      callback(now)
      driven++
    }
    expect(driven).toBe(1)
    expect(queue).toHaveLength(0)
    scene.dispose()
  })

  it('状态写入唤醒的帧同样只跑一帧就停', () => {
    const queue: FrameRequestCallback[] = []
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      queue.push(callback)
      return queue.length
    })
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined)
    const scene = new TurnScene({ container: document.createElement('div'), pageAspect: 0.75 })
    const drain = () => {
      let driven = 0
      while (queue.length > 0 && driven < 60) {
        queue.shift()!(16)
        driven++
      }
      return driven
    }
    drain()
    // 布局重建会 markDirty → wake：允许它跑一帧把脏标记清掉，但不得自持循环
    scene.setStaticPages([], () => null)
    expect(drain()).toBe(1)
    expect(queue).toHaveLength(0)
    scene.dispose()
  })
})
