import type { PageSource } from './pageMapping'
import type {
  FlipSpec,
  ForwardDirection,
  SheetGeometry,
  Slot,
  StaticPlacement,
} from '../types/turn'

export const PAGE_HEIGHT = 2

/** 单页世界宽度（世界单位，页高恒为 PAGE_HEIGHT=2）。
 * 与组件的 pageWidth prop（离屏光栅化像素宽度）无关，命名已区分 */
export function sheetWorldWidth(pageAspect: number) {
  return PAGE_HEIGHT * pageAspect
}

function inRange(index: number, numPages: number) {
  return index >= 0 && index < numPages
}

function placement(index: number, slot: Slot, numPages: number): StaticPlacement[] {
  return inRange(index, numPages) ? [{ index, slot }] : []
}

export interface FlipSpecOptions {
  currentPage: number
  displayedPages: 1 | 2
  forwardDirection: ForwardDirection
  backward: boolean
  pageAspect: number
  numPages: number
  /** 一次翻过的纸张数（跳页扇形的合并大步），默认 1；仅内页分支支持跨距，边界步恒为 1 */
  leafSpan?: number
}

export function computeFlipSpec(options: FlipSpecOptions): FlipSpec {
  const { currentPage, displayedPages, forwardDirection, backward, pageAspect, numPages } = options
  const ltr = forwardDirection === 'left'
  const advancing = !backward
  const geometry: SheetGeometry = advancing === ltr ? 'A' : 'B'
  const width = sheetWorldWidth(pageAspect)

  if (displayedPages === 2) {
    const last = numPages - 1
    if (currentPage === 0 && advancing) {
      // 封面展开：纸张正面=封面、背面=第 1 页，从右向左翻过书脊；
      // 第 2 页从中心滑向右页，整体偏移让封面起始居中
      const staticPages: StaticPlacement[] = ltr
        ? [{ index: 2, slot: 'right' }]
        : [{ index: 2, slot: 'left' }]
      return {
        geometry,
        hingeX: 0,
        frontIndex: 0,
        backIndex: 1,
        staticPages,
        delta: 1,
        boundary: true,
        worldFromX: ltr ? -width / 2 : width / 2,
        worldToX: 0,
        fromFitWidth: width,
        toFitWidth: width * 2,
      }
    }
    if (currentPage === 1 && !advancing) {
      // 封面合上：纸张正面=第 1 页、背面=封面，从左向右翻回；
      // 第 2 页滑回中心被封面覆盖
      const staticPages: StaticPlacement[] = ltr
        ? [{ index: 2, slot: 'right' }]
        : [{ index: 2, slot: 'left' }]
      return {
        geometry,
        hingeX: 0,
        frontIndex: 1,
        backIndex: 0,
        staticPages,
        delta: -1,
        boundary: true,
        worldFromX: 0,
        worldToX: ltr ? -width / 2 : width / 2,
        fromFitWidth: width * 2,
        toFitWidth: width,
      }
    }
    if (currentPage === numPages - 3 && advancing && last % 2 === 1) {
      // 封底合上：纸张正面=末页、背面=封底，从右向左翻；
      // 左页滑向中心被纸张覆盖，封底最终居中
      const staticPages: StaticPlacement[] = ltr
        ? [{ index: last - 2, slot: 'left' }]
        : [{ index: last - 2, slot: 'right' }]
      return {
        geometry,
        hingeX: 0,
        frontIndex: last - 1,
        backIndex: last,
        staticPages,
        delta: 2,
        boundary: true,
        worldFromX: 0,
        worldToX: ltr ? width / 2 : -width / 2,
        fromFitWidth: width * 2,
        toFitWidth: width,
      }
    }
    if (currentPage === numPages - 1 && !advancing && last % 2 === 1) {
      // 封底展开：纸张正面=封底、背面=末页，从左向右翻回；
      // 左页从中心滑出
      const staticPages: StaticPlacement[] = ltr
        ? [{ index: last - 2, slot: 'left', fromSlot: 'center' }]
        : [{ index: last - 2, slot: 'right', fromSlot: 'center' }]
      return {
        geometry,
        hingeX: 0,
        frontIndex: last,
        backIndex: last - 1,
        staticPages,
        delta: -2,
        boundary: true,
        worldFromX: ltr ? width / 2 : -width / 2,
        worldToX: 0,
        fromFitWidth: width,
        toFitWidth: width * 2,
      }
    }
    // 跨距 k：一次翻过 k 张纸（跳页合并大步）。翻起的纸张正面仍是当前
    // 跨页外页，背面取落点跨页的左页（落定后盖住左侧），落点跨页右页
    // 在纸张下方露出——k=1 时与原逐张索引完全一致
    const span = Math.max(1, Math.floor(options.leafSpan ?? 1))
    const frontIndex = advancing ? currentPage + 1 : currentPage
    const backIndex = advancing ? currentPage + 2 * span : currentPage - (2 * span - 1)
    const stay = advancing ? currentPage : currentPage + 1
    const reveal = advancing ? currentPage + 2 * span + 1 : currentPage - 2 * span
    const staticPages: StaticPlacement[] = ltr
      ? [
          ...placement(advancing ? stay : reveal, 'left', numPages),
          ...placement(advancing ? reveal : stay, 'right', numPages),
        ]
      : [
          ...placement(advancing ? reveal : stay, 'left', numPages),
          ...placement(advancing ? stay : reveal, 'right', numPages),
        ]
    return {
      geometry,
      hingeX: 0,
      frontIndex,
      backIndex,
      staticPages,
      delta: advancing ? 2 * span : -2 * span,
    }
  }

  // 单页模式：页缝固定在阅读方向一侧（LTR 左缘 / RTL 右缘），前进时当前页
  // 绕缝翻出；后退为反向翻页（reverse）——目标页纸张从缝侧翻回放平、盖住
  // 仍显示的当前页，两个方向的铰链与翻入/翻出方向一致，符合"一页一面、
  // 页缝在一侧"的单页书观感。跨距 k 时前进一次翻出 k 页、后退一次翻入
  // k 页（反向翻页的 frontIndex 取落点页）
  const span = Math.max(1, Math.floor(options.leafSpan ?? 1))
  const ltrSeam = forwardDirection === 'left'
  const frontIndex = advancing ? currentPage : currentPage - span
  const backIndex = advancing ? currentPage + span : currentPage
  return {
    geometry: ltrSeam ? 'A' : 'B',
    hingeX: ltrSeam ? -width / 2 : width / 2,
    frontIndex,
    backIndex,
    staticPages: placement(advancing ? backIndex : currentPage, 'center', numPages),
    delta: advancing ? span : -span,
    reverse: !advancing,
  }
}

export interface SpreadLayoutOptions {
  currentPage: number
  displayedPages: 1 | 2
  forwardDirection: ForwardDirection
  numPages: number
}

export function spreadLayout(options: SpreadLayoutOptions): StaticPlacement[] {
  const { currentPage, displayedPages, forwardDirection, numPages } = options
  if (displayedPages === 1 || currentPage === 0 || (currentPage === numPages - 1 && currentPage % 2 === 1)) {
    return placement(currentPage, 'center', numPages)
  }
  const ltr = forwardDirection === 'left'
  return [
    ...placement(ltr ? currentPage : currentPage + 1, 'left', numPages),
    ...placement(ltr ? currentPage + 1 : currentPage, 'right', numPages),
  ]
}

export interface FanLayoutOptions {
  currentPage: number
  /** 目标页索引（已对齐） */
  target: number
  displayedPages: 1 | 2
  forwardDirection: ForwardDirection
  numPages: number
}

/**
 * 扇形翻页的静态布局（翻页前置、整段动画共用一次）：多张纸并发翻动时，
 * 中间页从不展开——书面只呈现"翻动中不被飞纸遮挡"的两页：
 * - 留驻页：出发侧不被翻走的一页（前进时与飞纸相对的一侧），全程可见；
 * - 揭示页：落点侧被飞纸盖住的一页，首张纸起飞后露出。
 * 出发/落点为居中单页（封面/封底）时该侧页面就是飞纸本身，不留静态页；
 * 单页模式一页一面：前进揭示目标页、后退留驻当前页（反向翻页纸张从
 * 缝侧翻入盖住它）。
 */
export function fanStaticLayout(options: FanLayoutOptions): StaticPlacement[] {
  const { currentPage, target, displayedPages, forwardDirection, numPages } = options
  if (displayedPages === 1) {
    return placement(options.target > currentPage ? target : currentPage, 'center', numPages)
  }
  const ltr = forwardDirection === 'left'
  const last = numPages - 1
  const centered = (page: number) => page === 0 || (page === last && page % 2 === 1)
  const advancing = target > currentPage
  const fromCentered = centered(currentPage)
  const toCentered = centered(target)
  // 留驻页/揭示页索引不随方向镜像（页码恒定），只有槽位镜像：前进时
  // 留驻 = 当前跨页左页索引（LTR 在左槽 / RTL 在右槽），揭示 = 落点跨页
  // 右页索引；后退对调（留驻 = 当前+1、揭示 = 落点）
  const stayIndex = fromCentered ? null : advancing ? currentPage : currentPage + 1
  const revealIndex = toCentered ? null : advancing ? target + 1 : target
  const staySlot: Slot = ltr === advancing ? 'left' : 'right'
  const revealSlot: Slot = ltr === advancing ? 'right' : 'left'
  return [
    ...(stayIndex !== null ? placement(stayIndex, staySlot, numPages) : []),
    ...(revealIndex !== null ? placement(revealIndex, revealSlot, numPages) : []),
  ]
}

/**
 * 静态布局的跨页合并：左右两页同属一个跨页项时，合并为一张双倍宽度的
 * 居中整页（slot=center、spread=true）。配对不依赖具体槽位：LTR 左槽是
 * 起始页，RTL 左槽是后半页，均按同源（itemIndex）配对；空白页与居中
 * 单页不参与合并。
 */
export function mergeSpreadPlacements(
  placements: StaticPlacement[],
  sources: ReadonlyArray<PageSource>,
): StaticPlacement[] {
  const merged: StaticPlacement[] = []
  const consumed = new Set<number>()
  for (const p of placements) {
    if (consumed.has(p.index)) continue
    const src = p.slot !== 'center' ? sources[p.index] : undefined
    if (src && !src.blank && (src.region === 'left' || src.region === 'right')) {
      const partnerIdx = src.region === 'left' ? p.index + 1 : p.index - 1
      const partnerSrc = sources[partnerIdx]
      const partner = placements.find((q) => q.index === partnerIdx && q.slot !== p.slot)
      if (
        partner &&
        partnerSrc &&
        !partnerSrc.blank &&
        partnerSrc.itemIndex === src.itemIndex &&
        partner.slot !== 'center'
      ) {
        merged.push({ index: Math.min(p.index, partnerIdx), slot: 'center', spread: true })
        consumed.add(partnerIdx)
        continue
      }
    }
    merged.push(p)
  }
  return merged
}

