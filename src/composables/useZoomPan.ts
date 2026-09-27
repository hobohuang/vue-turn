import type { ComputedRef, Ref } from 'vue'

/** 缩放级别判定容差：zoom 超过 1 + ZOOM_TOLERANCE 视为放大态 */
export const ZOOM_TOLERANCE = 0.01

/** 缩放/平移关注的渲染器能力子集（由 useTurnRenderer 提供） */
export interface ZoomPanRenderer {
  getZoom: () => number
  setZoom: (level: number, animate?: boolean, duration?: number) => void
  panBy: (dxPixels: number, dyPixels: number) => void
}

export interface ZoomPanOptions {
  /** props.zoomMode 是否含滚轮手势（响应式读取） */
  zoomEnabled: () => boolean
  /** props.zoomMode 是否含双击手势（响应式读取） */
  dblClickZoom: () => boolean
  /** 交互禁用状态（响应式读取） */
  isDisabled: () => boolean
  isFlipping: Ref<boolean>
  /** 拖拽/悬停预览占用场景时缩放让路（由主状态机提供） */
  isBusy: () => boolean
  renderer: ZoomPanRenderer
  safeMaxZoom: ComputedRef<number>
  emit: (event: 'zoom-change', level: number) => void
}

/**
 * 缩放控制：滚轮缩放、双击切换与实例方法（zoomIn/Out/toggle/setZoom）。
 * 放大后的平移手势由主指针状态机路由到 renderer.panBy。
 */
export function useZoomPan(options: ZoomPanOptions) {
  const { zoomEnabled, dblClickZoom, isDisabled, isFlipping, isBusy, renderer, safeMaxZoom, emit } =
    options

  function isZoomed() {
    return renderer.getZoom() > 1 + ZOOM_TOLERANCE
  }

  // 滚轮缩放：级别按指数随滚轮增量变化
  function onWheel(event: WheelEvent) {
    if (!zoomEnabled() || isDisabled()) return
    if (isFlipping.value || isBusy()) return
    event.preventDefault()
    applyZoom(renderer.getZoom() * Math.exp(-event.deltaY * 0.0016))
  }

  // 双击切换缩放（zoomMode 含 dblclick 时，单击翻页延迟判定避免误触）
  function onDblClick() {
    if (!dblClickZoom() || isDisabled()) return
    if (isFlipping.value) return
    applyZoom(isZoomed() ? 1 : safeMaxZoom.value)
  }

  function applyZoom(level: number, animate = true) {
    const value = Number.isFinite(level) ? level : 1
    const clamped = Math.min(Math.max(value, 1), safeMaxZoom.value)
    const before = renderer.getZoom()
    renderer.setZoom(clamped, animate)
    const after = renderer.getZoom()
    // 场景未执行（翻页/拖拽中或请求值即当前值）时不派发，
    // 避免 zoom-change 事件与实际缩放状态背离
    if (after !== before) emit('zoom-change', after)
  }

  // 缩放实例方法
  function zoomIn() {
    applyZoom(safeMaxZoom.value)
  }

  function zoomOut() {
    applyZoom(1)
  }

  function toggleZoom() {
    applyZoom(isZoomed() ? 1 : safeMaxZoom.value)
  }

  function setZoomLevel(level: number) {
    applyZoom(level)
  }

  return { isZoomed, onWheel, onDblClick, zoomIn, zoomOut, toggleZoom, setZoomLevel }
}
