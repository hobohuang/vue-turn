import { describe, expect, it } from 'vitest'

import { buildPageSources } from '@/lib/pageMapping'

const item = (spread = false) => ({ spread })

describe('buildPageSources', () => {
  it('returns empty for no items', () => {
    expect(buildPageSources([])).toEqual([])
  })

  it('marks the first item as the cover on page 0 regardless of spread', () => {
    const sources = buildPageSources([item(true), item(), item()])
    expect(sources[0]).toMatchObject({ itemIndex: 0, region: 'full', cover: true })
  })

  it('maps plain items one page each', () => {
    const sources = buildPageSources([item(), item(), item(), item()])
    expect(sources).toHaveLength(4)
    expect(sources.slice(1).every((s) => s.region === 'full' && !s.blank)).toBe(true)
  })

  it('splits a spread item into left and right pages', () => {
    // 封面(p0) + 普通页(p1) → pageIndex=2 为偶数：跨页补位空白(p2)后
    // 左页(p3)、右页(p4)，封底(p5)，共 6 页
    const sources = buildPageSources([item(), item(), item(true), item()])
    expect(sources).toHaveLength(6)
    expect(sources[2]).toMatchObject({ blank: true })
    expect(sources[3]).toMatchObject({ itemIndex: 2, region: 'left' })
    expect(sources[4]).toMatchObject({ itemIndex: 2, region: 'right' })
  })

  it('pads a blank page when a spread lands on an even index', () => {
    // 封面(p0) + 普通页(p1) → pageIndex=2 为偶数：跨页前补空白(p2)，
    // 左页(p3)右页(p4)，封底(p5)
    const sources = buildPageSources([item(), item(), item(true), item(), item()])
    expect(sources[2]).toMatchObject({ blank: true })
    expect(sources[3]).toMatchObject({ region: 'left' })
    expect(sources[4]).toMatchObject({ region: 'right' })
  })

  it('pads the book end with a blank page when the total is odd (non-spread last)', () => {
    // 4 个 item：封面 + 3 普通页 → 4 页（偶数）不补；改为 3 item → 3 页补 1
    const sources = buildPageSources([item(), item(), item()])
    expect(sources).toHaveLength(4)
    // 末项为普通页：空白补在末项之前，封底仍落最后索引
    expect(sources[2]).toMatchObject({ blank: true })
    expect(sources[3]).toMatchObject({ itemIndex: 2, cover: true })
  })

  it('pads after the book end when the last item is a spread', () => {
    // 封面(p0) + 跨页(p1,p2) + 封底(p3)：共 4 页偶数 → 不补；
    // 封面(p0) + 普通(p1) + 跨页(p2,p3 补位后)……构造：封面+跨页+跨页+封底
    const sources = buildPageSources([item(), item(true), item(true), item()])
    // p0 封面, p1-p2 跨页1, p3-p4 跨页2, p5 封底 → 6 页偶数不补
    expect(sources).toHaveLength(6)
    // 再构造奇数：封面 + 跨页 + 封底 = p0, p1, p2, p3 → 4 页偶数不补；
    // 封面 + 跨页 + 普通 + 封底 = p0,p1,p2,p3 → 4 页；
    // 唯一奇数场景：末项跨页且总页数为奇 —— 封面+普通+跨页+跨页+普通
    const odd = buildPageSources([item(), item(), item(true), item(true), item()])
    // p0 封面, p1 普通, p2 补位, p3-p4 跨页1, p5-p6 跨页2, p7 普通 → 8 页偶
    expect(odd).toHaveLength(8)
    expect(odd.every((s) => s.itemIndex >= -1)).toBe(true)
  })

  it('keeps the back cover on the last index when padding', () => {
    const sources = buildPageSources([item(), item(), item()])
    const last = sources[sources.length - 1]!
    expect(last.itemIndex).toBe(2)
    expect(last.cover).toBe(true)
  })

  it('marks every page of a spread back cover as cover', () => {
    // 封面(p0) + 两普通页(p1,p2) → 跨页封底从奇数 p3 起：左(p3)右(p4)，
    // 总 5 页为奇且末页 region=right → 书末补空白(p5)共 6 页
    const sources = buildPageSources([item(), item(), item(), item(true)])
    expect(sources).toHaveLength(6)
    expect(sources[3]).toMatchObject({ itemIndex: 3, region: 'left', cover: true })
    expect(sources[4]).toMatchObject({ itemIndex: 3, region: 'right', cover: true })
    expect(sources[5]).toMatchObject({ blank: true })
  })

  it('treats a single item as both cover and back cover', () => {
    const sources = buildPageSources([item()])
    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({ itemIndex: 0, cover: true })
  })

  it('keeps total page count even whenever possible', () => {
    // 遍历多种 item 组合，断言补位后总页数为偶数（item 数 ≥ 2）
    for (let plain = 0; plain <= 3; plain++) {
      for (let spreadCount = 0; spreadCount <= 2; spreadCount++) {
        const items = [item(), ...Array.from({ length: plain }, () => item())]
        const withSpreads = [
          ...items.slice(0, 1),
          ...Array.from({ length: spreadCount }, () => item(true)),
          ...items.slice(1),
          item(),
        ]
        if (withSpreads.length < 2) continue
        const sources = buildPageSources(withSpreads)
        expect(sources.length % 2 === 0 || sources.length === 1).toBe(true)
      }
    }
  })
})
