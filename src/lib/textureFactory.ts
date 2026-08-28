import * as THREE from 'three'
import { toCanvas } from 'html-to-image'

// 资源等待默认超时：超时后放弃等待直接光栅化，避免慢资源阻塞初始化
const DEFAULT_RESOURCE_TIMEOUT = 5000

function withTimeout(promise: Promise<unknown>, ms: number) {
  return Promise.race([
    promise,
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms)
    }),
  ])
}

// 提取元素计算样式里所有 background-image 的 url(...) 地址
function collectBackgroundUrls(root: Element): string[] {
  const urls: string[] = []
  const elements = [root, ...Array.from(root.querySelectorAll('*'))]
  for (const el of elements) {
    const style = getComputedStyle(el)
    for (const name of ['background-image', 'background']) {
      const value = style.getPropertyValue(name)
      if (!value || value === 'none') continue
      for (const match of value.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) {
        const url = match[2]
        if (url && !url.startsWith('data:')) urls.push(url)
      }
    }
  }
  return urls
}

// 等待任意 URL 图片解码完成（background-image 无原生 decode，用临时 img 触发同源请求）
function waitForUrl(url: string) {
  return new Promise<void>((resolve) => {
    const img = new Image()
    img.onload = () => resolve()
    img.onerror = () => resolve()
    img.src = url
  })
}

// 等待元素内资源就绪：<img>、CSS background-image、文档字体；
// lazy 图片先切为 eager 触发加载（离屏容器在视口外，lazy 不会发起请求）。
// 任何失败都静默降级为立即光栅化；超时（ms，默认 5000）后放弃等待。
export async function waitForResources(element: HTMLElement, timeout = DEFAULT_RESOURCE_TIMEOUT) {
  const imgs = Array.from(element.querySelectorAll('img'))
  for (const img of imgs) {
    if (img.loading === 'lazy') img.loading = 'eager'
  }
  const images = imgs.map((img) =>
    img.complete && img.naturalWidth > 0 ? Promise.resolve() : img.decode().catch(() => undefined),
  )
  const backgrounds = collectBackgroundUrls(element).map((url) => waitForUrl(url))
  const fonts =
    typeof document !== 'undefined' && document.fonts
      ? document.fonts.ready.catch(() => undefined)
      : Promise.resolve()
  await withTimeout(Promise.all([...images, ...backgrounds, fonts]), timeout)
}

// pixelRatio 默认 1，与组件 props 的 pixelRatio 默认值保持一致，避免两处默认不一致
export async function elementToTexture(
  element: HTMLElement,
  pixelRatio = 1,
  backgroundColor = '#ffffff',
  cacheBust = true,
  // 各向异性过滤等级：应由调用方按 renderer.capabilities.getMaxAnisotropy() 钳制后传入
  maxAnisotropy = 8,
) {
  const canvas = await toCanvas(element, {
    pixelRatio,
    backgroundColor,
    cacheBust,
  })
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = maxAnisotropy
  return texture
}
