import { describe, expect, it, vi } from 'vitest'

// html-to-image 由 textureFactory 按需动态加载：mock 掉后动态 import 仍会
// 解析到这里，用于验证未传自定义光栅化器时的内置路径
vi.mock('html-to-image', () => ({
  toCanvas: vi.fn<() => Promise<HTMLCanvasElement>>(async () =>
    document.createElement('canvas'),
  ),
}))

import { toCanvas } from 'html-to-image'
import { elementToTexture } from '../textureFactory'

// jsdom 可构造 CanvasTexture（无需 WebGL 上下文），足够验证自定义光栅化
// 器的接线与纹理包装
describe('elementToTexture 光栅化器选择', () => {
  it('传入自定义光栅化器时使用其画布结果，不调用内置实现', async () => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 2
    const rasterizer = vi.fn<() => Promise<HTMLCanvasElement>>(async () => canvas)
    const texture = await elementToTexture(
      document.createElement('div'),
      1,
      true,
      8,
      rasterizer,
    )
    expect(rasterizer).toHaveBeenCalledTimes(1)
    expect(vi.mocked(toCanvas)).not.toHaveBeenCalled()
    expect(texture.image).toBe(canvas)
    texture.dispose()
  })

  it('未传自定义光栅化器时走内置 html-to-image 路径', async () => {
    const texture = await elementToTexture(document.createElement('div'))
    expect(vi.mocked(toCanvas)).toHaveBeenCalledTimes(1)
    expect(texture.image).toBeTruthy()
    texture.dispose()
  })
})
