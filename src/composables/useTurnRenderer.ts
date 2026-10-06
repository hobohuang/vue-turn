import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import type * as THREE from 'three'

import { TurnScene, type PagePick, type SceneLookOptions } from '../lib/TurnScene'
import type { SpineShadeU } from '../lib/spineShading'
import type {
  FlipSheetOptions,
  FlipSpec,
  StackHover,
  StackVisual,
  StaticPlacement,
} from '../types/turn'

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
  /** 书脊内阴影开关（挂载时冻结） */
  spineShadow?: boolean
  fitMargin?: number
  maxZoom?: number
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
    // 书脊内阴影 U 定位回调（书脊阴影关闭时由调用方省略）
    spineOf?: (index: number, placement: StaticPlacement) => SpineShadeU | null,
  ) {
    scene?.setStaticPages(placements, textureOf, refit, spineOf)
  }

  // 书脊内阴影的页数缩放系数（spineScaleOf，随页数变化实时更新）
  function setSpineScale(scale: number) {
    scene?.setSpineScale(scale)
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

  // 扇形翻页（多页跳转）：多张纸错峰并发翻动，全部落定后触发整体 onDone。
  // 场景可用返回 true，调用方据此回退（瞬间跳转）
  function startFanFlip(
    plans: Parameters<TurnScene['startFanFlip']>[0],
    fanOptions: Parameters<TurnScene['startFanFlip']>[1],
  ): boolean {
    if (!scene) return false
    return scene.startFanFlip(plans, fanOptions)
  }

  // 拖拽翻页：场景可用返回 true，调用方据此进入拖拽状态。
  // preview=true 为悬停预览：书体/静态页/纸叠钉在起始态
  function beginDragFlip(
    spec: FlipSpec,
    frontTexture: THREE.Texture | null,
    backTexture: THREE.Texture | null,
    onDone: (committed: boolean) => void,
    options?: FlipSheetOptions,
    preview = false,
  ) {
    return scene
      ? scene.beginDragFlip(spec, frontTexture, backTexture, onDone, options, preview)
      : false
  }

  // 悬停预览纸张转为真实交互（按下接管且不重建纸张时调用）；
  // spec 给出时补齐布局切换的世界偏移（调用方已重设静态布局）
  function activateSheet(spec?: FlipSpec) {
    scene?.activateSheet(spec)
  }

  function setDragProgress(progress: number) {
    scene?.setDragProgress(progress)
  }

  function endDragFlip(commit: boolean, baseDuration: number) {
    scene?.endDragFlip(commit, baseDuration)
  }

  // 折角拖拽：场景可用返回 true；已有同方向拖拽纸张时直接接管。
  // preview=true 为折角悬停预览：静态页由调用方先重设为翻开前置布局
  // （底页呈现下一页），书体平移/纸叠/相机钉在起始态
  function beginFoldDrag(
    spec: FlipSpec,
    frontTexture: THREE.Texture | null,
    backTexture: THREE.Texture | null,
    pickU: number,
    pickV: number,
    bend: number,
    onDone: (committed: boolean) => void,
    options?: FlipSheetOptions,
    preview = false,
  ) {
    return scene
      ? scene.beginFoldDrag(
          spec,
          frontTexture,
          backTexture,
          pickU,
          pickV,
          bend,
          onDone,
          options,
          preview,
        )
      : false
  }

  // 折角拖点跟随指针：返回折角进度，无折角纸张时返回 null。
  // lockedV 给出时拖点纵向钉在该高度（折页拖拽锁定按下高度）
  function setFoldDragFromClient(clientX: number, clientY: number, lockedV?: number) {
    return scene ? scene.setFoldDragFromClient(clientX, clientY, lockedV) : null
  }

  // 指针到当前折角锚点（外角）的世界距离：折角预览激活期间的角区进出
  // 判定用（此时静态布局是翻开前置布局，pickPage 命中的是底页不可依赖）
  function foldAnchorDistanceFromClient(clientX: number, clientY: number) {
    return scene ? scene.foldAnchorDistanceFromClient(clientX, clientY) : null
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

  // 运行时更新最大缩放倍数（交互参数，非挂载冻结）
  function setMaxZoom(value: number) {
    scene?.setMaxZoom(value)
  }

  // 运行时热更新观感参数（灯光强度/卷曲幅度/翻页网格分段）
  function applyLook(look: SceneLookOptions) {
    scene?.applyLook(look)
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
    setSpineScale,
    applyStaticTexture,
    setCoverPages,
    setStacks,
    pickStack,
    setStackHover,
    startFlip,
    startFoldFlip,
    startFanFlip,
    beginDragFlip,
    activateSheet,
    setDragProgress,
    endDragFlip,
    beginFoldDrag,
    setFoldDragFromClient,
    foldAnchorDistanceFromClient,
    setFoldDragAt,
    endFoldDrag,
    stopFlip,
    setZoom,
    setMaxZoom,
    applyLook,
    getZoom,
    panBy,
    pickPage,
  }
}
