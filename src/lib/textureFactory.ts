import * as THREE from 'three'
import { toCanvas } from 'html-to-image'

// 资源等待超时：超时后放弃等待直接光栅化，避免慢资源阻塞初始化
const RESOURCE_TIMEOUT = 5000

function withTimeout(promise: Promise<unknown>, ms: number) {
  return Promise.race([
    promise,
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms)
    }),
  ])
}

// 等待元素内图片解码与文档字体加载完成，
// 避免光栅化出缺图/缺字的纹理；任何失败都静默降级为立即光栅化
export async function waitForResources(element: HTMLElement) {
  const images = Array.from(element.querySelectorAll('img')).map((img) =>
    img.complete && img.naturalWidth > 0
      ? Promise.resolve()
      : img.decode().catch(() => undefined),
  )
  const fonts =
    typeof document !== 'undefined' && document.fonts
      ? document.fonts.ready.catch(() => undefined)
      : Promise.resolve()
  await withTimeout(Promise.all([...images, fonts]), RESOURCE_TIMEOUT)
}

export async function elementToTexture(
  element: HTMLElement,
  pixelRatio = 2,
  backgroundColor = '#ffffff',
) {
  const canvas = await toCanvas(element, {
    pixelRatio,
    backgroundColor,
    cacheBust: true,
  })
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}
