import type { PagePick } from '@/lib/TurnScene'
import type { FlipDirection, StaticPlacement } from '@/types/turn'

// 折角条带：页面四边外缘（左右外缘条带 + 顶/底条带）
// （跨页合并网格左右按半宽折算）
export const FOLD_ZONE = 0.22

/** 命中页的翻页方向与左右侧 */
export interface FoldSide {
  trigger: FlipDirection
  /** 命中页在世界坐标的右侧（RTL 阅读时语义相反） */
  worldRight: boolean
}

/**
 * 命中页的翻页方向与左右侧：折前进侧的页 = 前进（LTR 前进侧在世界右），
 * 折后退侧的页 = 后退。仅跨页左右页可折，居中页（封面等）返回 null。
 * 纯函数：由拾取结果、静态布局与阅读方向决定。
 */
export function foldSideOf(
  pick: PagePick,
  placements: ReadonlyArray<StaticPlacement>,
  forwardDirection: FlipDirection,
): FoldSide | null {
  const ltr = forwardDirection === 'left'
  let worldRight: boolean
  if (pick.spread) {
    // 跨页合并网格按 uv 一分为二
    worldRight = pick.u > 0.5
  } else {
    const placement = placements.find((p) => p.index === pick.index)
    if (!placement || placement.slot === 'center') return null
    worldRight = placement.slot === 'right'
  }
  const advancing = ltr ? worldRight : !worldRight
  const trigger: FlipDirection = advancing ? (ltr ? 'left' : 'right') : ltr ? 'right' : 'left'
  return { trigger, worldRight }
}

/** 折页命中（按下拖拽用）：edge=true 为四角区折角，false 为竖直折线折页 */
export interface FoldHit {
  trigger: FlipDirection
  /** 最近外角方向（+1 顶 / -1 底） */
  cornerV: number
  /** 是否命中四角区（折角拖拽）；否则为边缘中部折页拖拽 */
  edge: boolean
  /** 命中点纵向位置 [0,1]（1 为顶） */
  v: number
}

/**
 * 折页命中判定（按下用）：命中可翻页的任意位置均返回命中信息。
 * edge=true（四角区）为折角拖拽：锚点取最近外角，斜折线；
 * edge=false 为折页拖拽：锚点取指针同高度的外页边缘点，竖直折线对折翻页。
 * 调用方先用 renderer.pickPage 取得 PagePick。
 */
export function foldHitFromPick(
  pick: PagePick,
  placements: ReadonlyArray<StaticPlacement>,
  forwardDirection: FlipDirection,
): FoldHit | null {
  const side = foldSideOf(pick, placements, forwardDirection)
  if (!side) return null
  const outerU = side.worldRight ? 1 - pick.u : pick.u
  const zoneU = pick.spread ? FOLD_ZONE / 2 : FOLD_ZONE
  const outerV = pick.v < 0.5 ? pick.v : 1 - pick.v
  return {
    trigger: side.trigger,
    cornerV: pick.v < 0.5 ? -1 : 1,
    edge: outerU <= zoneU && outerV <= FOLD_ZONE,
    v: pick.v,
  }
}

/** 折角条带命中（悬停预览用）：t 为深入强度（0=角区内缘，1=角点） */
export interface FoldStripHit {
  trigger: FlipDirection
  cornerV: number
  t: number
}

/**
 * 折角条带命中（悬停预览用）：仅四角区域触发——横向与纵向同时进入
 * 外缘条带（与按下折角拖拽的角区判定一致）；边缘中部、顶/底边中部
 * 不触发任何悬停预览。
 */
export function foldStripFromPick(
  pick: PagePick,
  placements: ReadonlyArray<StaticPlacement>,
  forwardDirection: FlipDirection,
): FoldStripHit | null {
  const side = foldSideOf(pick, placements, forwardDirection)
  if (!side) return null
  // 距外缘的深度：右页外缘在纹理 u=1，左页在 u=0；跨页合并网格按半宽折算
  const outerU = side.worldRight ? 1 - pick.u : pick.u
  const zoneU = pick.spread ? FOLD_ZONE / 2 : FOLD_ZONE
  // 纵向：pick.v ∈ [0,1]（1 为顶），距最近顶/底边的深度
  const outerV = pick.v < 0.5 ? pick.v : 1 - pick.v
  // 仅角区命中：两轴都在条带内
  if (outerU > zoneU || outerV > FOLD_ZONE) return null
  const tU = 1 - outerU / zoneU
  const tV = 1 - outerV / FOLD_ZONE
  return {
    trigger: side.trigger,
    cornerV: pick.v < 0.5 ? -1 : 1,
    t: Math.min(1, Math.max(tU, tV)),
  }
}
