import { describe, expect, it, vi } from 'vitest'

import { buildPageSources, coverPageIndices } from '@/lib/pageMapping'
import type { PageItemLike } from '@/lib/pageMapping'

const item = (spread = false, face?: PageItemLike['face']): PageItemLike => ({ spread, face })

describe('buildPageSources', () => {
  it('returns empty for no items', () => {
    expect(buildPageSources([])).toEqual([])
  })

  it('marks the first item as the cover front regardless of spread', () => {
    const sources = buildPageSources([item(true), item(), item()])
    expect(sources[0]).toMatchObject({ itemIndex: 0, region: 'full', blank: false, cover: true })
    // 封面内容面的 spread 标记不生效：占 1 页而非左右两半（跨页封面请用 jacket）
    expect(sources[1]).toMatchObject({ cover: true, blank: true })
  })

  it('reserves a dedicated sheet for the cover with a blank inside face', () => {
    // 封面纸张背面恒为空白纸页：p0=封面、p1=空白（同纸，cover），内容从 p2 起
    const sources = buildPageSources([item(), item(), item()])
    expect(sources[0]).toMatchObject({ itemIndex: 0, cover: true, blank: false })
    expect(sources[1]).toMatchObject({ itemIndex: -1, cover: true, blank: true })
    expect(sources[2]).toMatchObject({ itemIndex: 1, cover: false, blank: false })
  })

  it('reserves a dedicated sheet for the back cover with a blank inside face', () => {
    // 封底纸张里侧恒为空白纸页：末索引=封底、末索引-1=空白（同纸，cover）
    // 封面纸(0,1) + 内容(2) + 补偶(3) + 封底纸(4,5)
    const sources = buildPageSources([item(), item(), item()])
    expect(sources[5]).toMatchObject({ itemIndex: 2, cover: true, blank: false })
    expect(sources[4]).toMatchObject({ itemIndex: -1, cover: true, blank: true })
  })

  it('places declared cover inside content on the cover sheet inside face', () => {
    const sources = buildPageSources([
      item(false, 'coverFront'),
      item(false, 'coverBack'),
      item(),
      item(),
    ])
    expect(sources[0]).toMatchObject({ itemIndex: 0, cover: true })
    expect(sources[1]).toMatchObject({ itemIndex: 1, cover: true, blank: false })
    expect(sources[2]).toMatchObject({ itemIndex: 2, cover: false })
  })

  it('places declared back cover inside content on the back sheet front face', () => {
    const sources = buildPageSources([
      item(),
      item(false, 'backCoverBack'),
      item(false, 'backCoverFront'),
    ])
    expect(sources[2]).toMatchObject({ itemIndex: 1, cover: true, blank: false })
    expect(sources[3]).toMatchObject({ itemIndex: 2, cover: true, blank: false })
  })

  it('binds the inside face even when cover and back cover are promoted positionally', () => {
    // 只声明封面底、未声明封面/封底(孤儿标注由上层拦截,此处测纯函数兜底):
    // 首个/末个内容面按位置提升为封面/封底,里侧仍绑定为封面底
    const sources = buildPageSources([item(false, 'coverBack'), item(), item()])
    expect(sources[0]).toMatchObject({ itemIndex: 1, cover: true, blank: false })
    expect(sources[1]).toMatchObject({ itemIndex: 0, cover: true, blank: false })
    expect(sources[3]).toMatchObject({ itemIndex: 2, cover: true, blank: false })
  })

  it('maps plain items one page each starting at index 2', () => {
    const sources = buildPageSources([item(), item(), item(), item(), item()])
    // 封面纸(0,1) + 内容(2,3,4) + 补偶空白(5) + 封底纸(6,7)
    expect(sources).toHaveLength(8)
    expect(sources.slice(2, 5).every((s) => s.region === 'full' && !s.blank && !s.cover)).toBe(true)
    expect(sources[5]).toMatchObject({ blank: true, cover: false })
  })

  it('pads a blank page when a spread lands on an even index', () => {
    // 封面纸(0,1) + 内容从 p2（偶）开始：跨页前补位空白(p2)，
    // 左页(p3)右页(p4)，内页区段奇数补偶空白(p5)，封底纸(6,7)
    const sources = buildPageSources([item(), item(true), item()])
    expect(sources).toHaveLength(8)
    expect(sources[2]).toMatchObject({ blank: true, cover: false })
    expect(sources[3]).toMatchObject({ itemIndex: 1, region: 'left' })
    expect(sources[4]).toMatchObject({ itemIndex: 1, region: 'right' })
  })

  it('pads before the inside back cover when the inner run is odd', () => {
    // 封面纸(0,1) + 2 内容页(2,3) → 内页区段偶数不补……改 3 内容页：
    // 内页区段(2,3,4)奇数 → 补空白(p5)，封底纸(6,7)；封底固定落末索引
    const sources = buildPageSources([item(), item(), item(), item(), item()])
    expect(sources).toHaveLength(8)
    expect(sources[5]).toMatchObject({ blank: true, cover: false })
    expect(sources[6]).toMatchObject({ itemIndex: -1, cover: true, blank: true })
    expect(sources[7]).toMatchObject({ itemIndex: 4, cover: true })
  })

  it('never pads inside a spread or before it when it starts odd', () => {
    // 封面纸(0,1) + 普通(p2) + 跨页(p3,p4) + 内页区段奇数补偶空白(p5)
    // + 封底纸(6,7)：跨页对齐补位只发生在跨页前，区段末尾补位独立进行
    const sources = buildPageSources([item(), item(), item(true), item()])
    expect(sources).toHaveLength(8)
    expect(sources[2]).toMatchObject({ region: 'full', blank: false })
    expect(sources[3]).toMatchObject({ region: 'left' })
    expect(sources[4]).toMatchObject({ region: 'right' })
    expect(sources[5]).toMatchObject({ blank: true, cover: false })
    expect(sources[6]).toMatchObject({ cover: true, blank: true })
  })

  it('keeps total page count even for all plain/spread combinations', () => {
    // 遍历多种 item 组合，断言补位后总页数为偶数
    for (let plain = 0; plain <= 3; plain++) {
      for (let spreadCount = 0; spreadCount <= 2; spreadCount++) {
        const items = [
          item(),
          ...Array.from({ length: plain }, () => item()),
          ...Array.from({ length: spreadCount }, () => item(true)),
        ]
        const sources = buildPageSources(items)
        expect(sources.length % 2).toBe(0)
      }
    }
  })

  it('keeps spread starts on odd indices for all combinations', () => {
    const violations: string[] = []
    for (let plain = 0; plain <= 3; plain++) {
      for (let spreadCount = 0; spreadCount <= 2; spreadCount++) {
        const items = [
          item(),
          ...Array.from({ length: plain }, () => item()),
          ...Array.from({ length: spreadCount }, () => item(true)),
        ]
        const sources = buildPageSources(items)
        for (let i = 0; i < sources.length; i++) {
          const source = sources[i]!
          if (source.region === 'left' && i % 2 !== 1) violations.push(`left@${i}`)
          if (source.region === 'right' && i % 2 !== 0) violations.push(`right@${i}`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('treats a single item as both cover and back cover', () => {
    const sources = buildPageSources([item()])
    // 封面纸(0,1) + 封底纸(2,3)：同一 item 同源出现在两端
    expect(sources).toHaveLength(4)
    expect(sources[0]).toMatchObject({ itemIndex: 0, cover: true })
    expect(sources[3]).toMatchObject({ itemIndex: 0, cover: true })
    expect(sources[1]).toMatchObject({ blank: true, cover: true })
    expect(sources[2]).toMatchObject({ blank: true, cover: true })
  })

  it('ignores duplicate face annotations by keeping the first and treating the rest as content', () => {
    const sources = buildPageSources([item(false, 'coverFront'), item(false, 'coverFront'), item()])
    // 第二个 coverFront 标注按内容面处理
    expect(sources[0]).toMatchObject({ itemIndex: 0, cover: true })
    expect(sources[2]).toMatchObject({ itemIndex: 1, cover: false })
  })

  it('promotes faces positionally when annotations are partial', () => {
    // 只标注封底：首个内容面兜底为封面
    // 封面纸(0,1) + 内容(2) + 补偶(3) + 封底纸(4,5)
    const sources = buildPageSources([item(), item(), item(false, 'backCoverFront')])
    expect(sources[0]).toMatchObject({ itemIndex: 0, cover: true })
    expect(sources[5]).toMatchObject({ itemIndex: 2, cover: true })
    // 只标注封面：末个内容面兜底为封底
    const onlyCover = buildPageSources([item(false, 'coverFront'), item(), item()])
    expect(onlyCover[0]).toMatchObject({ itemIndex: 0 })
    expect(onlyCover[5]).toMatchObject({ itemIndex: 2, cover: true })
  })
})

describe('buildPageSources with a jacket (coverSpread)', () => {
  it('splits the jacket content into cover right half and back cover left half', () => {
    // 封面纸(0,1) + 内容(2,3,4) + 补偶(5) + 封底纸(6,7)：
    // 封面页取 jacket 右半、封底页取 jacket 左半，同源（itemIndex 0）
    const sources = buildPageSources([item(false, 'coverSpread'), item(), item(), item()])
    expect(sources).toHaveLength(8)
    expect(sources[0]).toMatchObject({ itemIndex: 0, region: 'right', blank: false, cover: true })
    expect(sources[7]).toMatchObject({ itemIndex: 0, region: 'left', blank: false, cover: true })
    expect(sources.slice(2, 5).every((s) => s.itemIndex !== 0 && !s.cover)).toBe(true)
  })

  it('keeps the jacket halves as dedicated sheets even with content items', () => {
    // jacket 已供给封面与封底：内容项不再被位置兜底提升，全部保持普通页
    const sources = buildPageSources([
      item(false, 'coverSpread'),
      item(),
      item(false, 'backCoverFront'),
    ])
    expect(sources[0]).toMatchObject({ itemIndex: 0, region: 'right', cover: true })
    expect(sources[2]).toMatchObject({ itemIndex: 1, region: 'full', cover: false })
    expect(sources[5]).toMatchObject({ itemIndex: 2, region: 'full', cover: true })
  })

  it('maps a jacket-only book to two half pages around blank inside faces', () => {
    const sources = buildPageSources([item(false, 'coverSpread')])
    expect(sources).toHaveLength(4)
    expect(sources[0]).toMatchObject({ itemIndex: 0, region: 'right', cover: true })
    expect(sources[1]).toMatchObject({ blank: true, cover: true })
    expect(sources[2]).toMatchObject({ blank: true, cover: true })
    expect(sources[3]).toMatchObject({ itemIndex: 0, region: 'left', cover: true })
  })

  it('splits the jacket halves in single-page mode too (no ignoring, no blanks)', () => {
    // 单页模式书不能没有封面：封面显示右半、封底显示左半，无空白纸页
    const sources = buildPageSources([item(false, 'coverSpread'), item(), item()], {
      singlePage: true,
    })
    expect(sources).toHaveLength(4)
    expect(sources[0]).toMatchObject({ itemIndex: 0, region: 'right', cover: true })
    expect(sources[1]).toMatchObject({ itemIndex: 1, region: 'full', cover: false })
    expect(sources[2]).toMatchObject({ itemIndex: 2, region: 'full', cover: false })
    expect(sources[3]).toMatchObject({ itemIndex: 0, region: 'left', cover: true })
  })

  it('resolves a defensive coverSpread + coverFront conflict deterministically', () => {
    // 上层校验已拒绝 jacket 与 cover 混用；纯函数兜底为 coverFront 作封面、
    // coverSpread 左半作封底（首个标注生效）
    const sources = buildPageSources([item(false, 'coverFront'), item(false, 'coverSpread')])
    expect(sources[0]).toMatchObject({ itemIndex: 0, region: 'full', cover: true })
    expect(sources[3]).toMatchObject({ itemIndex: 1, region: 'left', cover: true })
  })

  it('lists the jacket sheets in coverPageIndices', () => {
    const sources = buildPageSources([item(false, 'coverSpread'), item(), item()])
    // 封面纸(0,1) + 内容(2,3) + 封底纸(4,5)
    expect(coverPageIndices(sources)).toEqual([0, 1, 4, 5])
  })
})

describe('buildPageSources in single-page mode', () => {
  it('adds no blank endpapers or parity blanks', () => {
    // 封面(0) + 内容(1,2,3) + 封底(4)：无空白纸页/补位页，总页数不再保证偶数
    const sources = buildPageSources([item(), item(), item(), item(), item()], { singlePage: true })
    expect(sources).toHaveLength(5)
    expect(sources.every((s) => !s.blank)).toBe(true)
    expect(sources.map((s) => s.itemIndex)).toEqual([0, 1, 2, 3, 4])
  })

  it('drops declared inside faces in single-page mode', () => {
    // 一页只有一面：封面底/封底里依附于纸张里侧，单页翻页背面恒为空白，
    // 它们没有任何显示机会——声明的内容不占页
    const sources = buildPageSources(
      [
        item(false, 'coverFront'),
        item(false, 'coverBack'),
        item(),
        item(false, 'backCoverBack'),
        item(false, 'backCoverFront'),
      ],
      { singlePage: true },
    )
    expect(sources.map((s) => s.itemIndex)).toEqual([0, 2, 4])
    expect(sources.every((s) => !s.blank)).toBe(true)
    expect(sources[0]).toMatchObject({ cover: true })
    expect(sources[1]).toMatchObject({ cover: false })
    expect(sources[2]).toMatchObject({ cover: true })
  })

  it('ignores spread items and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // 跨页项不支持跨页显示：不占页（封面0 + 内容2 + 封底4）
    const sources = buildPageSources([item(), item(true), item(), item(true), item()], {
      singlePage: true,
    })
    expect(sources).toHaveLength(3)
    expect(sources.map((s) => s.itemIndex)).toEqual([0, 2, 4])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('跨页'))
    warn.mockRestore()
  })

  it('still maps spreads as two aligned pages when not in single-page mode', () => {
    // 回归：singlePage 选项不影响默认（双页）映射
    const sources = buildPageSources([item(), item(true), item()])
    expect(sources).toHaveLength(8)
    expect(sources[3]).toMatchObject({ itemIndex: 1, region: 'left' })
    expect(sources[4]).toMatchObject({ itemIndex: 1, region: 'right' })
  })
})

describe('coverPageIndices', () => {
  it('lists the four cover-sheet pages in order', () => {
    // 封面纸(0,1) + 内容(2) + 补偶(3) + 封底纸(4,5)
    const sources = buildPageSources([item(), item(), item()])
    expect(coverPageIndices(sources)).toEqual([0, 1, 4, 5])
  })

  it('returns the cover-sheet pages when the book has one item', () => {
    expect(coverPageIndices(buildPageSources([item()]))).toEqual([0, 1, 2, 3])
  })

  it('returns empty for no pages', () => {
    expect(coverPageIndices([])).toEqual([])
  })
})
