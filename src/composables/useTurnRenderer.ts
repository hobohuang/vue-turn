import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import type * as THREE from 'three'

import { TurnScene, type PagePick } from '@/lib/TurnScene'
import type { EasingFn, FlipSheetOptions, FlipSpec, StaticPlacement } from '@/types/turn'

export interface TurnRendererOptions {
  pageAspect: number
  nPolygons: number
  perspective: number
  ambient: number
  gloss: number
  curl: number
  fitMargin?: number
  maxPixelRatio?: number
  maxZoom?: number
  easing?: EasingFn
  // WebGL 上下文恢复回调
  onContextRestored?: () => void
}

export function useTurnRenderer(options: TurnRendererOptions) {
  const container = ref<HTMLElement | null>(null)
  const containerSize = reactive({ width: 0, height: 0 })
  const webglSupported = ref(true)
  // 纹理各向异性上限：渲染器就绪后取实际能力，未就绪时保守取 1
  const maxAnisotropy = ref(1)
  let scene: TurnScene | null = null
  let observer: ResizeObserver | null = null

  onMounted(() => {
    const el = container.value
    if (!el) return
    scene = new TurnScene({ container: el, ...options })
    webglSupported.value = scene.hasRenderer
    maxAnisotropy.value = scene.hasRenderer ? scene.maxAnisotropy : 1
    const rect = el.getBoundingClientRect()
    containerSize.width = rect.width
    containerSize.height = rect.height
    scene.resize(rect.width, rect.height)
    observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry || !scene) return
      containerSize.width = entry.contentRect.width
      containerSize.height = entry.contentRect.height
      scene.resize(entry.contentRect.width, entry.contentRect.height)
    })
    observer.observe(el)
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    observer = null
    scene?.dispose()
    scene = null
  })

  function setStaticPages(
    placements: StaticPlacement[],
    textureOf: (index: number) => THREE.Texture | null,
    // false 表示翻页前置布局，相机由翻页动画接管
    refit = true,
  ) {
    scene?.setStaticPages(placements, textureOf, refit)
  }

  function applyStaticTexture(index: number, texture: THREE.Texture) {
    scene?.applyStaticTexture(index, texture)
  }

  function startFlip(
    spec: FlipSpec,
    frontTexture: THREE.Texture | null,
    backTexture: THREE.Texture | null,
    duration: number,
    onDone: (committed: boolean) => void,
    options?: FlipSheetOptions,
  ) {
    if (scene) {
      scene.startFlip(spec, frontTexture, backTexture, duration, onDone, options)
    } else {
      // 场景未建立时同步提交，避免翻页状态锁死
      onDone(true)
    }
  }

  // 拖拽翻页：场景可用返回 true，调用方据此进入拖拽状态
  function beginDragFlip(
    spec: FlipSpec,
    frontTexture: THREE.Texture | null,
    backTexture: THREE.Texture | null,
    onDone: (committed: boolean) => void,
    options?: FlipSheetOptions,
  ) {
    return scene ? scene.beginDragFlip(spec, frontTexture, backTexture, onDone, options) : false
  }

  function setDragProgress(progress: number) {
    scene?.setDragProgress(progress)
  }

  function endDragFlip(commit: boolean, baseDuration: number) {
    scene?.endDragFlip(commit, baseDuration)
  }

  function stopFlip() {
    scene?.stopFlip()
  }

  function setZoom(level: number, animate?: boolean, duration?: number) {
    scene?.setZoom(level, animate, duration)
  }

  function getZoom() {
    return scene ? scene.getZoom() : 1
  }

  function panBy(dxPixels: number, dyPixels: number) {
    scene?.panBy(dxPixels, dyPixels)
  }

  function pickPage(clientX: number, clientY: number): PagePick | null {
    return scene ? scene.pickPage(clientX, clientY) : null
  }

  return {
    container,
    containerSize,
    webglSupported,
    maxAnisotropy,
    setStaticPages,
    applyStaticTexture,
    startFlip,
    beginDragFlip,
    setDragProgress,
    endDragFlip,
    stopFlip,
    setZoom,
    getZoom,
    panBy,
    pickPage,
  }
}
