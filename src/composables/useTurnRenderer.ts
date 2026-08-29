import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import type * as THREE from 'three'

import { TurnScene, type PagePick } from '@/lib/TurnScene'
import type {
  EasingFn,
  FlipSheetOptions,
  FlipSpec,
  StackHover,
  StackVisual,
  StaticPlacement,
} from '@/types/turn'

export interface TurnRendererOptions {
  pageAspect: number
  nPolygons: number
  perspective: number
  ambient: number
  gloss: number
  curl: number
  /** 封面/封底灯光组：环境光强度（与内页光影独立） */
  coverAmbient?: number
  /** 封面/封底灯光组：方向光强度 */
  coverGloss?: number
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

  // 封面/封底页索引：这些页挂封面图层，由封面灯光组照亮
  function setCoverPages(indices: number[]) {
    scene?.setCoverPages(indices)
  }

  // 纸叠：to 省略时吸附到 from（空闲布局），否则随翻页动画插值
  function setStacks(from: StackVisual | null, to?: StackVisual | null) {
    scene?.setStacks(from, to)
  }

  function pickStack(clientX: number, clientY: number) {
    return scene ? scene.pickStack(clientX, clientY) : null
  }

  function setStackHover(hover: StackHover | null) {
    scene?.setStackHover(hover)
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

  // 主动折页翻页（fold 开启时的点击/next/prev 动画路径）：
  // 场景可用返回 true，调用方据此决定是否回退卷曲动画
  function startFoldFlip(
    spec: FlipSpec,
    frontTexture: THREE.Texture | null,
    backTexture: THREE.Texture | null,
    duration: number,
    onDone: (committed: boolean) => void,
    options?: FlipSheetOptions,
    bend = 0,
  ): boolean {
    if (!scene) return false
    return scene.startFoldFlip(spec, frontTexture, backTexture, duration, onDone, options, bend)
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

  // 折角拖拽：场景可用返回 true；已有同方向拖拽纸张时直接接管
  function beginFoldDrag(
    spec: FlipSpec,
    frontTexture: THREE.Texture | null,
    backTexture: THREE.Texture | null,
    pickU: number,
    pickV: number,
    bend: number,
    onDone: (committed: boolean) => void,
    options?: FlipSheetOptions,
  ) {
    return scene
      ? scene.beginFoldDrag(spec, frontTexture, backTexture, pickU, pickV, bend, onDone, options)
      : false
  }

  // 折角拖点跟随指针：返回折角进度，无折角纸张时返回 null
  function setFoldDragFromClient(clientX: number, clientY: number) {
    return scene ? scene.setFoldDragFromClient(clientX, clientY) : null
  }

  // 直接以页宽坐标设置折角拖点（悬停预览用）
  function setFoldDragAt(qu: number, qv: number) {
    return scene ? scene.setFoldDragAt(qu, qv) : null
  }

  function endFoldDrag(commit: boolean, baseDuration: number) {
    scene?.endFoldDrag(commit, baseDuration)
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
    setCoverPages,
    setStacks,
    pickStack,
    setStackHover,
    startFlip,
    startFoldFlip,
    beginDragFlip,
    setDragProgress,
    endDragFlip,
    beginFoldDrag,
    setFoldDragFromClient,
    setFoldDragAt,
    endFoldDrag,
    stopFlip,
    setZoom,
    getZoom,
    panBy,
    pickPage,
  }
}
