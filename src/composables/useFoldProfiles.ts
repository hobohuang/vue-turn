import { sheetWorldWidth } from '../lib/flipSpec'
import type { FoldParams } from '../lib/presets'
import type { PageSource } from '../lib/pageMapping'
import type { FlipSpec, SheetFoldOptions } from '../types/turn'

function toSheetFold(params: FoldParams, pageAspect: number): SheetFoldOptions {
  return { enabled: params.enabled, bendWorld: params.bend * sheetWorldWidth(pageAspect) }
}

/**
 * 折页档位解析：内页与封面/封底纸张各取一档（已由调用方按 preset/look、
 * coverPreset/coverLook 解析为 FoldParams，此处只做世界单位换算与归属判定）。
 *
 * 封面/封底纸张不与内页共用档位：否则 hard 封面在 soft 内页下会被拖进
 * 折页形变路径（折页形变不读 curl，纸板的刚体观感就丢了）。
 * 一张纸的正反两面同档，按 frontIndex/backIndex 任一命中封面纸张判定。
 */
export function useFoldProfiles(options: {
  innerFold: FoldParams
  coverFold: FoldParams
  pageSources: () => PageSource[]
  pageAspect: number
}) {
  const inner = toSheetFold(options.innerFold, options.pageAspect)
  const cover = toSheetFold(options.coverFold, options.pageAspect)

  /** 页索引是否属于封面/封底专用纸张（一张纸正反两面同档） */
  function isCoverSheet(indices: (number | undefined)[]): boolean {
    return indices.some(
      (index) => index !== undefined && options.pageSources()[index]?.cover === true,
    )
  }

  /** 某次翻页所属纸张的折页参数 */
  function foldOfSpec(spec: FlipSpec): SheetFoldOptions {
    return isCoverSheet([spec.frontIndex, spec.backIndex]) ? cover : inner
  }

  /** 某个静态页（拾取命中）所属纸张的折页参数 */
  function foldOfPage(index: number | undefined): SheetFoldOptions {
    return isCoverSheet([index]) ? cover : inner
  }

  return { isCoverSheet, foldOfSpec, foldOfPage }
}
