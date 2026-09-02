import type { PageSource } from '@/lib/pageMapping'
import type {
  FlipSpec,
  ForwardDirection,
  SheetGeometry,
  Slot,
  StaticPlacement,
} from '@/types/turn'

export const PAGE_HEIGHT = 2

export function pageWidth(pageAspect: number) {
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
}

export function computeFlipSpec(options: FlipSpecOptions): FlipSpec {
  const { currentPage, displayedPages, forwardDirection, backward, pageAspect, numPages } = options
  const ltr = forwardDirection === 'left'
  const advancing = !backward
  const geometry: SheetGeometry = advancing === ltr ? 'A' : 'B'
  const width = pageWidth(pageAspect)

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
        worldFromX: ltr ? width / 2 : -width / 2,
        worldToX: 0,
        fromFitWidth: width,
        toFitWidth: width * 2,
      }
    }
    const frontIndex = advancing ? currentPage + 1 : currentPage
    const backIndex = advancing ? currentPage + 2 : currentPage - 1
    const stay = advancing ? currentPage : currentPage + 1
    const reveal = advancing ? currentPage + 3 : currentPage - 2
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
      delta: advancing ? 2 : -2,
    }
  }

  const frontIndex = currentPage
  const backIndex = advancing ? currentPage + 1 : currentPage - 1
  return {
    geometry,
    hingeX: geometry === 'A' ? -width / 2 : width / 2,
    frontIndex,
    backIndex,
    staticPages: placement(backIndex, 'center', numPages),
    delta: advancing ? 1 : -1,
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

