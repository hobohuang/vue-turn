/**
 * 页源映射：把 turn-item 序列映射到页索引空间。
 *
 * 规则（与真实书籍一致）：
 * - 首个 item 固定为封面，占第 0 页（居中单页），spread 标记不生效
 * - 普通项占 1 页；跨页项占 2 页（左右各半），未对齐到奇数索引时
 *   自动插入空白页补位（跨页必须从奇数索引即左页开始）
 * - 总页数为奇数时补一张空白页保证偶数：末项为跨页时补在书末
 *   （补在跨页前会破坏其奇数起始对齐）；否则补在末项之前，
 *   让用户的封底仍落在最后一个索引（视觉上如真实书籍的衬页），
 *   否则封底合上动画（要求末索引为奇数）退化为常规翻页
 * - 末个 item 视为封底：其占用的所有页标记为 cover（挂封面图层独立光照）
 */

/** 页源：页索引空间中一页的内容来源 */
export interface PageSource {
  /** 所属 turn-item 索引；-1 为自动补位的空白页 */
  itemIndex: number
  /** 该页取 item 内容的区域：整页 / 跨页左半 / 跨页右半 */
  region: 'full' | 'left' | 'right'
  /** 自动补位的空白页（无内容，光栅化跳过） */
  blank: boolean
  /** 封面/封底页：按 coverPreset 观感渲染与翻页（挂封面图层独立光照） */
  cover: boolean
}

/** buildPageSources 的输入：页面项的最小结构（spread 是否跨页） */
export interface PageItemLike {
  spread: boolean
}

/**
 * 把 item 序列映射为页源序列。纯函数：相同输入恒产生相同输出，
 * 空序列返回空数组（此时组件无书页可渲染）。
 */
export function buildPageSources(items: ReadonlyArray<PageItemLike>): PageSource[] {
  const sources: PageSource[] = []
  if (items.length === 0) return sources
  // 首个 item 视为封面，固定单页居中
  sources.push({ itemIndex: 0, region: 'full', blank: false, cover: true })
  let pageIndex = 1
  for (let itemIndex = 1; itemIndex < items.length; itemIndex++) {
    const item = items[itemIndex]
    if (!item) continue
    if (item.spread) {
      // 跨页需从奇数索引（左页）开始；落在偶数索引时插入空白页补位
      if (pageIndex % 2 === 0) {
        sources.push({ itemIndex: -1, region: 'full', blank: true, cover: false })
        pageIndex++
      }
      sources.push({ itemIndex, region: 'left', blank: false, cover: false })
      sources.push({ itemIndex, region: 'right', blank: false, cover: false })
      pageIndex += 2
    } else {
      sources.push({ itemIndex, region: 'full', blank: false, cover: false })
      pageIndex++
    }
  }
  // 总页数为奇数（末页索引为偶数）时补空白页保证偶数
  if (sources.length >= 3 && sources.length % 2 === 1) {
    const last = sources[sources.length - 1]!
    if (last.region === 'right') {
      sources.push({ itemIndex: -1, region: 'full', blank: true, cover: false })
    } else {
      const insertAt = sources.findIndex((s) => s.itemIndex === last.itemIndex)
      if (insertAt > 0) {
        sources.splice(insertAt, 0, { itemIndex: -1, region: 'full', blank: true, cover: false })
      }
    }
  }
  // 末个 item 视为封底：其占用的所有页标记为 cover
  const lastItemIndex = items.length - 1
  for (const source of sources) {
    if (source.itemIndex === lastItemIndex) source.cover = true
  }
  return sources
}

/** 封面/封底页索引列表（挂封面图层独立光照用），按页索引升序 */
export function coverPageIndices(sources: ReadonlyArray<PageSource>): number[] {
  const indices: number[] = []
  for (let i = 0; i < sources.length; i++) {
    if (sources[i]?.cover) indices.push(i)
  }
  return indices
}
