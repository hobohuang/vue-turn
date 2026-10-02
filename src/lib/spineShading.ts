import type { Slot, StaticPlacement } from '../types/turn'

/** 静态页的书脊/外缘 U 定位：inner 为书脊所在 U，outer 为外缘所在 U
 * （'both' 为合并跨页——书脊在中线、两侧外缘对称） */
export interface SpineShadeU {
  inner: 0 | 0.5 | 1
  outer: 0 | 1 | 'both'
}

/**
 * 书脊阴影的 U 定位：算出一张静态页的书脊与外缘落在纹理 U 轴的哪个位置。
 *
 * 双页模式：左右页在书脊两侧对接——左页书脊在其右缘（u=1）、外缘在左缘；
 * 右页镜像；合并跨页（spread，宽 2W）书脊在纹理中线（u=0.5）、两侧外缘
 * 对称（outer 'both'）；居中单页只可能是合书态的封面（索引 0，书脊在阅读
 * 方向前缘）或封底（末索引，书脊在后缘）——LTR 封面书脊在左（u=0）、
 * 封底在右（u=1），RTL 镜像。
 *
 * 单页模式：一页一面、页缝固定在阅读方向一侧（flipSpec 的 ltrSeam），
 * 所有静态页居中，书脊（缝）恒在 LTR 左缘 / RTL 右缘。
 *
 * 返回 null 表示该页不渲染书脊阴影（双页模式下不应出现的居中非跨页页，
 * 防御分支）。
 */
export function spineUOf(options: {
  index: number
  slot: Slot
  spread?: boolean
  displayedPages: 1 | 2
  ltr: boolean
  numPages: number
}): SpineShadeU | null {
  const { index, slot, spread, displayedPages, ltr, numPages } = options
  if (displayedPages === 1) {
    return ltr ? { inner: 0, outer: 1 } : { inner: 1, outer: 0 }
  }
  if (slot === 'left') return { inner: 1, outer: 0 }
  if (slot === 'right') return { inner: 0, outer: 1 }
  if (spread) return { inner: 0.5, outer: 'both' }
  if (index === 0) return ltr ? { inner: 0, outer: 1 } : { inner: 1, outer: 0 }
  if (index === numPages - 1) return ltr ? { inner: 1, outer: 0 } : { inner: 0, outer: 1 }
  return null
}

/** spineUOf 的便捷入参：从 StaticPlacement 展开 slot/spread */
export function spineUOfPlacement(
  placement: StaticPlacement,
  options: { displayedPages: 1 | 2; ltr: boolean; numPages: number },
): SpineShadeU | null {
  return spineUOf({
    index: placement.index,
    slot: placement.slot,
    spread: placement.spread,
    ...options,
  })
}

// 页数缩放的参考页数：达到该页数时缝谷强度/宽度封顶到照片匹配值
const SPINE_SCALE_REF_PAGES = 80

/**
 * 书脊阴影随书页数量的缩放系数（0~1，封顶 1）：书越厚缝谷越深越宽——
 * 装订侧的曲面弧度与纸层堆叠都随页数增长。sqrt 曲线让薄书仍有可感知的
 * 缝谷（16 页 ≈ 0.45）、厚书（≥80 页）平滑封顶；系数乘在全部六个常量
 * （三组强度与宽度）上，上限即 scale=1 的照片匹配值。
 */
export function spineScaleOf(numPages: number): number {
  if (!(numPages > 0)) return 0
  return Math.min(Math.sqrt(numPages / SPINE_SCALE_REF_PAGES), 1)
}
