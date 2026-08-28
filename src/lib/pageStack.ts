import type { ForwardDirection } from '@/types/turn'

// 纸叠：书本左右两侧的页层厚度条带，贴在可见页面外缘。
// 厚度随翻页在两侧间转移；hover 按比例映射页码（与厚度解耦）。

/** 厚度饱和参考页数：总页数超过该值后纸叠厚度封顶，不再增长 */
export const STACK_SATURATE = 100

/** 纸叠一侧的页面映射描述 */
export interface StackSide {
  /** 贴近页面外缘的首层页索引 */
  first: number
  /** 层数 */
  count: number
  /** 由内向外每层的页索引步进 */
  step: 1 | -1
  /** 条带内侧贴合的页面外缘 x 坐标（相对书脊，世界单位） */
  edgeX: number
  /** 条带向外伸展方向（-1 向左 / +1 向右） */
  dir: 1 | -1
}

export interface StackSides {
  left: StackSide | null
  right: StackSide | null
}

export interface StackLayoutOptions {
  /** 当前页索引（0 起） */
  currentPage: number
  displayedPages: 1 | 2
  forwardDirection: ForwardDirection
  numPages: number
  /** 单页宽度（世界单位） */
  sheetWidth: number
}

// 计算某页状态下左右纸叠的页面映射。
// 合书状态（封面或封底朝上居中）内页被硬页完全盖住，不显示纸叠——
// 打开/合上硬页时纸叠随翻页动画从无到有生长/渐隐消失，不会提前出现。
// 单页显示模式为居中单页（条带贴合半页宽外缘），其余为跨页（贴合整页宽外缘）。
// LTR：已读页堆在左侧、剩余页在右侧；RTL 镜像。
export function computeStackSides(options: StackLayoutOptions): StackSides {
  const { currentPage, displayedPages, forwardDirection, numPages, sheetWidth } = options
  const closed =
    currentPage === 0 ||
    (currentPage === numPages - 1 && currentPage % 2 === 1)
  if (closed) return { left: null, right: null }
  const centered = displayedPages === 1
  const last = centered ? currentPage : Math.min(currentPage + 1, numPages - 1)
  const edge = centered ? sheetWidth / 2 : sheetWidth

  const read: StackSide = {
    first: currentPage - 1,
    count: currentPage,
    step: -1,
    edgeX: 0,
    dir: 1,
  }
  const remain: StackSide = {
    first: last + 1,
    count: numPages - 1 - last,
    step: 1,
    edgeX: 0,
    dir: 1,
  }
  const left = forwardDirection === 'left' ? read : remain
  const right = forwardDirection === 'left' ? remain : read
  left.edgeX = -edge
  left.dir = -1
  right.edgeX = edge
  right.dir = 1
  return {
    left: left.count > 0 ? left : null,
    right: right.count > 0 ? right : null,
  }
}

// 一侧纸叠厚度：按 min(总页数, 饱和参考值) 归一后封顶。
// 小书翻完全本正好到达最大厚度；超多页/无限加页时厚度饱和，条带不抖动。
export function stackThickness(count: number, numPages: number, maxDepth: number): number {
  if (count <= 0 || maxDepth <= 0) return 0
  const scale = Math.max(1, Math.min(numPages, STACK_SATURATE))
  return Math.min(1, count / scale) * maxDepth
}

// 悬停比例 → 页索引：fraction 为自条带内侧（贴合页面处）向外的比例 [0,1]
export function pageAtFraction(side: StackSide, fraction: number): number {
  if (side.count <= 0) return side.first
  const f = Number.isFinite(fraction) ? Math.min(Math.max(fraction, 0), 1) : 0
  const layer = Math.min(side.count - 1, Math.max(0, Math.floor(f * side.count)))
  return side.first + side.step * layer
}
