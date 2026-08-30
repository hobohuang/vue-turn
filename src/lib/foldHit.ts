import type { PagePick } from '@/lib/TurnScene'
import { PAGE_HEIGHT } from '@/lib/flipSpec'
import type { FlipDirection, StaticPlacement } from '@/types/turn'

// 角区捕获半径：距页面外角的距离占页宽的比例（世界坐标圆形判定）。
// 圆形判定相比矩形条带消除了角区内缘的抖动切换——同一位置按下
// 不会在折角（锚点=外角）与折页（锚点=页边）之间跳变；
// 跨页合并网格按 uv 半宽折算，世界距离天然统一
export const FOLD_ZONE = 0.22

/** 命中页的翻页方向与左右侧 */
export interface FoldSide {
  trigger: FlipDirection
  /** 命中页在世界坐标的右侧（RTL 阅读时语义相反） */
  worldRight: boolean
}

/**
 * 命中页的翻页方向与左右侧：折前进侧的页 = 前进（LTR 前进侧在世界右），
 * 折后退侧的页 = 后退。
 *
 * 居中页（书合着时唯一可见的单页）也可折：封面（index 0）只能前进翻开，
 * 封底（末索引）只能后退翻回——两者外缘均在"翻开会露出的那一侧"：
 * 封面外缘在前进侧（LTR 世界右）、封底外缘在后退侧（LTR 世界左）。
 * 其余居中显示的页（理论不存在）返回 null。
 */
export function foldSideOf(
  pick: PagePick,
  placements: ReadonlyArray<StaticPlacement>,
  forwardDirection: FlipDirection,
  numPages?: number,
): FoldSide | null {
  const ltr = forwardDirection === 'left'
  let worldRight: boolean
  if (pick.spread) {
    // 跨页合并网格按 uv 一分为二
    worldRight = pick.u > 0.5
  } else {
    const placement = placements.find((p) => p.index === pick.index)
    if (!placement) return null
    if (placement.slot === 'center') {
      // 居中页 = 合书态的封面/封底：按开合方向判定外缘
      if (pick.index === 0) worldRight = ltr
      else if (numPages !== undefined && pick.index === numPages - 1) worldRight = !ltr
      else return null
    } else {
      worldRight = placement.slot === 'right'
    }
  }
  const advancing = ltr ? worldRight : !worldRight
  const trigger: FlipDirection = advancing ? (ltr ? 'left' : 'right') : ltr ? 'right' : 'left'
  return { trigger, worldRight }
}

/** 命中点距最近外角的距离（世界坐标）：
 *  u 按网格实宽折算（跨页合并网格 uv 覆盖双倍宽度），v 按页高折算 */
function cornerDistance(
  pick: PagePick,
  worldRight: boolean,
  sheetWidth: number,
): number {
  const outerU = worldRight ? 1 - pick.u : pick.u
  const x = outerU * (pick.spread ? sheetWidth * 2 : sheetWidth)
  const outerV = pick.v < 0.5 ? pick.v : 1 - pick.v
  const y = outerV * PAGE_HEIGHT
  return Math.hypot(x, y)
}

/** 折页命中（按下拖拽用）：edge=true 为外角区折角，false 为页边折页 */
export interface FoldHit {
  trigger: FlipDirection
  /** 最近外角方向（+1 顶 / -1 底） */
  cornerV: number
  /** 是否命中外角区（折角拖拽，锚点=外角、拖点纵向自由）；
   *  否则为页边折页拖拽（锚点=按下高度的外页边缘点，拖点钉住同高） */
  edge: boolean
  /** 命中点纵向位置 [0,1]（1 为顶） */
  v: number
}

/**
 * 折页命中判定（按下用）：命中可翻页的任意位置均返回命中信息。
 * edge=true（外角圆内）为折角拖拽：锚点取最近外角，斜折线，拖点自由；
 * edge=false 为折页拖拽：锚点取指针同高度的外页边缘点，竖直折线对折。
 * 调用方先用 renderer.pickPage 取得 PagePick。
 */
export function foldHitFromPick(
  pick: PagePick,
  placements: ReadonlyArray<StaticPlacement>,
  forwardDirection: FlipDirection,
  sheetWidth: number,
  numPages?: number,
): FoldHit | null {
  const side = foldSideOf(pick, placements, forwardDirection, numPages)
  if (!side) return null
  const dist = cornerDistance(pick, side.worldRight, sheetWidth)
  return {
    trigger: side.trigger,
    cornerV: pick.v < 0.5 ? -1 : 1,
    edge: dist <= FOLD_ZONE * sheetWidth,
    v: pick.v,
  }
}

/** 折角条带命中（悬停预览用）：t 为深入强度（0=圆周内缘，1=角点） */
export interface FoldStripHit {
  trigger: FlipDirection
  cornerV: number
  t: number
}

/**
 * 折角条带命中（悬停预览用）：仅外角圆内触发（与按下折角拖拽的
 * 圆形判定一致）；页边中部、顶/底边中部不触发任何悬停预览。
 */
export function foldStripFromPick(
  pick: PagePick,
  placements: ReadonlyArray<StaticPlacement>,
  forwardDirection: FlipDirection,
  sheetWidth: number,
  numPages?: number,
): FoldStripHit | null {
  const side = foldSideOf(pick, placements, forwardDirection, numPages)
  if (!side) return null
  const dist = cornerDistance(pick, side.worldRight, sheetWidth)
  const radius = FOLD_ZONE * sheetWidth
  if (dist > radius) return null
  return {
    trigger: side.trigger,
    cornerV: pick.v < 0.5 ? -1 : 1,
    t: Math.min(1, Math.max(0, 1 - dist / radius)),
  }
}
