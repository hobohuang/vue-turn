/**
 * 页源映射：把"面"序列（turn-item 展开后的正/背面）映射到页索引空间。
 *
 * 双页模式规则（与真实书籍一致）：
 * - 封面是一张专用纸张：正面（索引 0）= 标注为 coverFront 的面或跨页封皮
 *   （coverSpread）内容的右半（未标注时兜底提升首个内容面），背面
 *   （索引 1）固定为空白纸页（与封面同纸，独立光照）
 * - 普通内容从索引 2（右页/阳面）开始占页；跨页项占 2 页（左右各半），
 *   未对齐到奇数索引时自动插入空白页补位（跨页必须从奇数索引即左页开始）
 * - 封底同样是一张专用纸张：外侧（末索引）= 标注为 backCoverFront 的面
 *   或跨页封皮内容的左半（未标注时兜底提升末个内容面），里侧
 *   （末索引-1）固定为空白纸页
 * - 内页区段计数为奇数时在封底纸张之前补一张空白页保证总页数为偶数：
 *   补在内页区段末尾不会破坏跨页的奇数起始对齐，且封底固定占据末索引，
 *   其合上动画（要求末索引为奇数）不受影响
 * - 空白纸页与封面/封底同纸，标记 cover（挂封面图层独立光照）
 *
 * 跨页封皮（jacket）：一张双倍宽度内容同时供给封面与封底——封面页取
 * 右半（region 'right'）、封底页取左半（region 'left'），两页在页索引空间
 * 相距很远且恒为居中单页（slot center），不会像内页跨页那样合并渲染。
 *
 * 单页模式规则（singlePage，一页只有一面，无左右配对，奇偶约定全部取消）：
 * - 不自动插入任何空白纸页：封面背面、封底里侧不占页——一页只有一面，
 *   翻页背面恒为空白纸页，它们没有任何显示机会
 * - 跨页封皮同样切半显示：封面显示右半、封底显示左半（书不能没有封面，
 *   不随内页跨页一起被忽略）
 * - 内页跨页项不支持跨页显示：自动忽略（不占页），并打印控制台警告
 */

/** 面的标注：由组件层按用户的 type 声明（usePageSources）生成 */
export type PageFaceKind =
  | 'content'
  | 'coverFront'
  | 'coverSpread'
  | 'backCoverFront'

/** 页源：页索引空间中一页的内容来源 */
export interface PageSource {
  /** 所属面索引；-1 为自动补位的空白页 */
  itemIndex: number
  /** 该页取面内容的区域：整页 / 跨页左半 / 跨页右半 */
  region: 'full' | 'left' | 'right'
  /** 自动补位的空白页（无内容，光栅化跳过） */
  blank: boolean
  /** 封面纸张页（封面/封面背面/封底里侧/封底）：按 coverPreset 观感渲染与翻页 */
  cover: boolean
}

/** buildPageSources 的输入：面的最小结构（spread 是否跨页、face 标注） */
export interface PageItemLike {
  spread: boolean
  face?: PageFaceKind
}

function blankSource(cover: boolean): PageSource {
  return { itemIndex: -1, region: 'full', blank: true, cover }
}

// 单页模式忽略跨页的警告只提示一次（与 usePageSources 的警告策略一致，
// 避免响应式重算/多实例刷屏）
let warnedSpreadSinglePage = false

/** buildPageSources 的选项 */
export interface BuildPageSourcesOptions {
  /** 单页模式：不自动补空白纸页，内页跨页项自动忽略 */
  singlePage?: boolean
}

/**
 * 把面序列映射为页源序列。纯函数：相同输入恒产生相同输出，
 * 空序列返回空数组（此时组件无书页可渲染）。
 * face 标注重复时首个生效、其余按内容处理；标注面缺失时按位置约定
 * 兜底（首面为封面、末面为封底）；仅有一个面时该面同时作封面与封底。
 */
export function buildPageSources(
  items: ReadonlyArray<PageItemLike>,
  options: BuildPageSourcesOptions = {},
): PageSource[] {
  const singlePage = options.singlePage ?? false
  const sources: PageSource[] = []
  if (items.length === 0) return sources

  // 按标注分拣：封面/封底各面（重复标注首个生效，其余视作内容面）
  let coverFront = -1
  let coverSpread = -1
  let backCoverFront = -1
  const content: number[] = []
  for (let index = 0; index < items.length; index++) {
    switch (items[index]!.face) {
      case 'coverFront':
        if (coverFront < 0) coverFront = index
        else content.push(index)
        break
      case 'coverSpread':
        if (coverSpread < 0) coverSpread = index
        else content.push(index)
        break
      case 'backCoverFront':
        if (backCoverFront < 0) backCoverFront = index
        else content.push(index)
        break
      default:
        content.push(index)
    }
  }
  // 封面来源优先级：coverFront 标注 > 跨页封皮右半 > 位置兜底（首个内容面）；
  // 封底来源优先级：backCoverFront 标注 > 跨页封皮左半 > 位置兜底（末个内容面）
  let cover = coverFront >= 0 ? coverFront : coverSpread
  if (cover < 0 && content.length > 0) cover = content.shift()!
  let back = backCoverFront >= 0 ? backCoverFront : coverSpread
  if (back < 0 && content.length > 0) back = content.pop()!
  // 退化：仅剩封面面（单 item 或只有封面标注）→ 该面同时作封底
  if (back < 0) back = cover

  // 封面纸张：正面 = 封面（跨页封皮时取右半，单双页模式一致）。
  // 单页模式一页只有一面，翻页背面恒为空白纸页，封面背面不占页
  sources.push({
    itemIndex: cover,
    region: coverFront < 0 && coverSpread >= 0 ? 'right' : 'full',
    blank: false,
    cover: true,
  })
  if (!singlePage) {
    // 封面纸张背面（翻开封面所见）：固定空白纸页（与封面同纸、独立光照）
    sources.push(blankSource(true))
  }

  // 内页内容：双页模式从索引 2（右页）开始，跨页需从奇数索引（左页）开始，
  // 落在偶数索引时插入空白页补位；单页模式无奇偶约定，跨页项自动忽略
  for (const itemIndex of content) {
    const item = items[itemIndex]!
    if (item.spread) {
      if (singlePage) {
        if (!warnedSpreadSinglePage) {
          warnedSpreadSinglePage = true
          console.warn(
            '[vue-turn] 单页模式不支持跨页显示（spread），已自动忽略跨页内容；' +
              '需要展示跨页请使用双页模式（displayedPages: 2）',
          )
        }
        continue
      }
      if (sources.length % 2 === 0) {
        sources.push(blankSource(false))
      }
      sources.push({ itemIndex, region: 'left', blank: false, cover: false })
      sources.push({ itemIndex, region: 'right', blank: false, cover: false })
    } else {
      sources.push({ itemIndex, region: 'full', blank: false, cover: false })
    }
  }
  // 内页区段计数为奇数（末页索引为偶数）时补空白页保证偶数；
  // 单页模式一页只有一面，无奇偶约定，不补
  if (!singlePage && sources.length % 2 === 1) {
    sources.push(blankSource(false))
  }

  // 封底纸张：外侧 = 封底（跨页封皮时取左半，单双页模式一致）。
  // 双页模式另有一张固定空白纸页与最后一页相对（封底里侧位置）
  if (!singlePage) {
    sources.push(blankSource(true))
  }
  sources.push({
    itemIndex: back,
    region: backCoverFront < 0 && coverSpread >= 0 ? 'left' : 'full',
    blank: false,
    cover: true,
  })

  return sources
}

/** 封面纸张页索引列表（挂封面图层独立光照用），按页索引升序 */
export function coverPageIndices(sources: ReadonlyArray<PageSource>): number[] {
  const indices: number[] = []
  for (let i = 0; i < sources.length; i++) {
    if (sources[i]?.cover) indices.push(i)
  }
  return indices
}
