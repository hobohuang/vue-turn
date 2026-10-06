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

  it('applyLook 热更新灯光强度与卷曲参数，未给出的项保持不变', () => {
    const queue: FrameRequestCallback[] = []
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      queue.push(callback)
      return queue.length
    })
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined)
    const scene = new TurnScene({
      container: document.createElement('div'),
      pageAspect: 0.75,
      ambient: 1,
      gloss: 0.35,
      curl: 0.8,
      nPolygons: 64,
    })
    // 驱动排帧队列：让构造期的脏标记跑完，隔离 applyLook 的行为
    queue.shift()!(16)
    expect(queue).toHaveLength(0)

    scene.applyLook({ ambient: 1.5, curl: 0.4 })
    expect(scene.getLook()).toMatchObject({ ambient: 1.5, gloss: 0.35, curl: 0.4, nPolygons: 64 })

    // 封面灯光组独立更新，不回退内页值
    scene.applyLook({ coverAmbient: 0.9, coverGloss: 0.6, nPolygons: 48 })
    expect(scene.getLook()).toMatchObject({
      ambient: 1.5,
      coverAmbient: 0.9,
      coverGloss: 0.6,
      nPolygons: 48,
    })

    // nPolygons 走与构造函数同一钳制（round 后下限 2；0 会被 positive 回退为默认值）
    scene.applyLook({ nPolygons: 1 })
    expect(scene.getLook().nPolygons).toBe(2)
    scene.dispose()
  })
})
