import { computed, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'

import type { StackSides } from '../lib/pageStack'
import type { ViewportPoint } from '../types/turn'

/** 纸叠渲染器关注的能力子集（由 useTurnRenderer 提供） */
export interface StackHoverRenderer {
  pickStack: (clientX: number, clientY: number) => { side: 'left' | 'right'; fraction: number } | null
  setStackHover: (hover: { side: 'left' | 'right'; start: number; end: number } | null) => void
}

export interface StackHoverOptions {
  /** props.stack（响应式读取） */
  stackEnabled: () => boolean
  /** 交互禁用状态（响应式读取） */
  isDisabled: () => boolean
  isFlipping: Ref<boolean>
  webglSupported: Ref<boolean>
  renderer: StackHoverRenderer
  containerSize: { width: number }
  /** 当前布局下的纸叠页面映射（悬停命中换算页码用） */
  currentStackSides: ComputedRef<StackSides>
  emit: (event: 'stack-hover', page: number | null, point?: ViewportPoint) => void
}

/**
 * 纸叠悬停：命中层高亮 + 页码提示，点击跳转由调用方（点击处理）完成。
 */
export function useStackHover(options: StackHoverOptions) {
  const { stackEnabled, isDisabled, isFlipping, webglSupported, renderer, currentStackSides } =
    options

  const stackHover = ref<{ page: number; x: number; y: number } | null>(null)
  let lastStackHoverPage: number | null = null

  // 悬停层提示位置：跟随指针并钳制在视口内
  const stackTooltipStyle = computed(() => {
    const hover = stackHover.value
    if (!hover) return {}
    const x = Math.min(hover.x + 16, Math.max(0, options.containerSize.width - 84))
    return { left: `${x}px`, top: `${hover.y}px` }
  })

  // 命中比例 → 页索引与高亮条带（层过薄时保证最小可见宽度）
  function stackBand(side: { count: number; first: number; step: 1 | -1 }, fraction: number) {
    const layer = Math.min(side.count - 1, Math.max(0, Math.floor(fraction * side.count)))
    let start = layer / side.count
    let end = (layer + 1) / side.count
    const minBand = 0.12
    if (end - start < minBand) {
      const center = (start + end) / 2
      start = Math.max(0, center - minBand / 2)
      end = Math.min(1, center + minBand / 2)
    }
    return { page: side.first + side.step * layer, start, end }
  }

  /** 悬停纸叠：命中返回 true（调用方据此抑制折角悬停） */
  function updateStackHover(event: PointerEvent): boolean {
    if (!stackEnabled() || isDisabled() || isFlipping.value || !webglSupported.value) {
      clearStackHover()
      return false
    }
    const hit = renderer.pickStack(event.clientX, event.clientY)
    if (!hit) {
      clearStackHover()
      return false
    }
    const side = hit.side === 'left' ? currentStackSides.value.left : currentStackSides.value.right
    if (!side || side.count <= 0) {
      clearStackHover()
      return false
    }
    const band = stackBand(side, hit.fraction)
    const el = event.currentTarget as HTMLElement | null
    const rect = el?.getBoundingClientRect()
    const point: ViewportPoint = {
      x: rect ? event.clientX - rect.left : 0,
      y: rect ? event.clientY - rect.top : 0,
    }
    stackHover.value = { page: band.page + 1, x: point.x, y: point.y }
    renderer.setStackHover({ side: hit.side, start: band.start, end: band.end })
    // 仅在命中页变化时派发事件，避免高频触发
    if (lastStackHoverPage !== band.page + 1) {
      lastStackHoverPage = band.page + 1
      options.emit('stack-hover', band.page + 1, point)
    }
    return true
  }

  function clearStackHover() {
    if (!stackHover.value && lastStackHoverPage === null) return
    stackHover.value = null
    lastStackHoverPage = null
    renderer.setStackHover(null)
    options.emit('stack-hover', null)
  }

  return { stackHover, stackTooltipStyle, updateStackHover, clearStackHover }
}
