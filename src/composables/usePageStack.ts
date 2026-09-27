import { computed, watch } from 'vue'
import type { Ref } from 'vue'

import { sheetWorldWidth } from '@/lib/flipSpec'
import {
  computeStackSides,
  isCenteredLayout,
  STACK_COMPACT,
  stackThickness,
  type StackSide,
  type StackSides,
} from '@/lib/pageStack'
import type { FlipDirection, FlipSpec, StackVisual } from '@/types/turn'

import type { useBookState } from './useBookState'

// 纸叠最大厚度占单页宽度的比例（内部常量，不对外暴露）
const STACK_DEPTH = 0.02

export interface PageStackOptions {
  state: ReturnType<typeof useBookState>
  pageCount: Ref<number>
  /** 校验后的页宽高比（挂载期冻结） */
  safePageAspect: number
  /** 纸叠开关（props.stack，响应式） */
  stackEnabled: () => boolean
  /** 阅读方向（props.forwardDirection，响应式） */
  forwardDirection: () => FlipDirection
  setStacks: (from: StackVisual | null, to?: StackVisual | null) => void
}

/**
 * 纸叠视觉计算：书本左右两侧页层厚度条带的渲染几何与翻页过渡。
 *
 * - stackSidesFor 是页面映射的统一计算入口：渲染几何（stackVisualFor）与
 *   悬停命中换算页码（currentStackSides）共用，避免两处参数漂移
 * - applyStacksIdle 空闲布局：纸叠吸附到当前页状态
 * - applyStacksFlip 翻页前置布局：纸叠随动画从当前状态过渡到目标状态；
 *   封底开合期间封底页在空中翻动不属于纸叠——它平躺时计入的那一层
 *   在 from/to 中清除，避免动画中悬浮细线
 */
export function usePageStack(options: PageStackOptions) {
  const { state, pageCount, safePageAspect, stackEnabled, forwardDirection } = options

  function stackSidesFor(pageIndex: number): StackSides {
    return computeStackSides({
      currentPage: pageIndex,
      displayedPages: state.displayedPages.value,
      forwardDirection: forwardDirection(),
      numPages: pageCount.value,
      sheetWidth: sheetWorldWidth(safePageAspect),
    })
  }

  // 某页状态下的纸叠渲染几何
  function stackVisualFor(pageIndex: number): StackVisual {
    const width = sheetWorldWidth(safePageAspect)
    const sides = stackSidesFor(pageIndex)
    const maxDepth = width * STACK_DEPTH
    // 合页（居中单页）状态书页全部压紧叠放，条带按压实系数收窄；
    // 翻开状态的纸叠页边微张，保持蓬松厚度
    const compact = isCenteredLayout(pageIndex, state.displayedPages.value, pageCount.value)
      ? STACK_COMPACT
      : 1
    const toVisual = (side: StackSide | null) =>
      side
        ? {
            edgeX: side.edgeX,
            dir: side.dir,
            thickness: stackThickness(side.count, pageCount.value, maxDepth) * compact,
            layers: side.count,
          }
        : null
    return { left: toVisual(sides.left), right: toVisual(sides.right) }
  }

  // 空闲布局：纸叠吸附到当前页状态
  function applyStacksIdle() {
    options.setStacks(stackEnabled() ? stackVisualFor(state.currentPage.value) : null)
  }

  // 翻页前置布局：纸叠随动画从当前状态过渡到目标状态
  function applyStacksFlip(spec: FlipSpec) {
    if (!stackEnabled()) {
      options.setStacks(null)
      return
    }
    const from = stackVisualFor(state.currentPage.value)
    const to = stackVisualFor(state.currentPage.value + spec.delta)
    const last = pageCount.value - 1
    if (spec.frontIndex === last || spec.backIndex === last) {
      const side = forwardDirection() === 'left' ? 'right' : 'left'
      from[side] = null
      to[side] = null
    }
    options.setStacks(from, to)
  }

  // 当前布局下的纸叠页面映射（悬停命中换算页码用）
  const currentStackSides = computed(() => stackSidesFor(state.currentPage.value))

  // 纸叠开关变化：空闲时立即生效（翻页中由结束后 renderStatic 收敛）
  watch(stackEnabled, () => {
    if (!state.isFlipping.value) applyStacksIdle()
  })

  return { applyStacksIdle, applyStacksFlip, currentStackSides }
}
