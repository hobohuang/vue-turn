import { h } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import TurnItem from '@/components/TurnItem.vue'
import { usePageSources, validateItemTypes } from '@/composables/usePageSources'

const itemNode = (props: Record<string, unknown> = {}, text = 'page') =>
  h(TurnItem, props, { default: () => [h('div', text)] })

describe('validateItemTypes', () => {
  it('accepts undeclared and valid annotations', () => {
    expect(
      validateItemTypes([undefined, 'cover', 'cover-inside', 'back-cover', 'back-cover-inside']),
    ).toBeNull()
    // null 与 undefined 同样视为未声明
    expect(validateItemTypes([null])).toBeNull()
    expect(validateItemTypes([])).toBeNull()
  })

  it('rejects unknown enum values', () => {
    expect(validateItemTypes(['cover', 'front'])).toContain('非法的 type="front"')
  })

  it('rejects duplicate annotations of the same type', () => {
    expect(validateItemTypes(['cover', undefined, 'cover'])).toContain('重复声明')
    expect(validateItemTypes(['jacket', 'jacket'])).toContain('重复声明')
  })

  it('rejects jacket mixed with cover or back-cover', () => {
    expect(validateItemTypes(['jacket', 'cover'])).toContain('混用')
    expect(validateItemTypes(['back-cover', 'jacket'])).toContain('混用')
    // jacket 与两种衬页可共存
    expect(validateItemTypes(['jacket', 'cover-inside', 'back-cover-inside'])).toBeNull()
  })

  it('rejects orphan inside pages without a sheet to bind to', () => {
    expect(validateItemTypes(['cover-inside'])).toContain('cover-inside')
    expect(validateItemTypes(['back-cover-inside'])).toContain('back-cover-inside')
    expect(validateItemTypes(['cover-inside', 'back-cover'])).toContain('cover-inside')
    expect(validateItemTypes(['cover', 'back-cover-inside'])).toContain('back-cover-inside')
  })
})

describe('usePageSources', () => {
  const facesOf = (nodes: ReturnType<typeof h>[]) =>
    usePageSources({ default: () => nodes }).pageFaces

  it('maps declared types to face kinds regardless of position', () => {
    const faces = facesOf([
      itemNode({ type: 'cover' }, 'cover'),
      itemNode({ type: 'cover-inside' }, 'inside front'),
      itemNode({ type: 'back-cover-inside' }, 'inside back'),
      itemNode({ type: 'back-cover' }, 'back cover'),
    ])
    expect(faces.value.map((f) => f.face)).toEqual([
      'coverFront',
      'coverBack',
      'backCoverBack',
      'backCoverFront',
    ])
    expect(faces.value.every((f) => !f.spread)).toBe(true)
  })

  it('maps the jacket to a spread coverSpread face', () => {
    const faces = facesOf([itemNode({ type: 'jacket' }, 'jacket'), itemNode({}, 'plain')])
    expect(faces.value.map((f) => f.face)).toEqual(['coverSpread', 'content'])
    // jacket 面天然为跨页（双倍宽度光栅化）
    expect(faces.value[0]!.spread).toBe(true)
    expect(faces.value[1]!.spread).toBe(false)
  })

  it('maps undeclared items to content faces (spread prop still honored)', () => {
    const faces = facesOf([itemNode({ spread: true }, 'spread'), itemNode({}, 'plain')])
    expect(faces.value.map((f) => f.face)).toEqual(['content', 'content'])
    expect(faces.value[0]!.spread).toBe(true)
    expect(faces.value[1]!.spread).toBe(false)
  })

  it('refuses to render the book when annotations are invalid', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    // 非法枚举值：整本书拒绝渲染（pageFaces 为空）
    expect(facesOf([itemNode({ type: 'cover' }), itemNode({ type: 'foo' })]).value).toEqual([])
    expect(error).toHaveBeenCalledWith(expect.stringContaining('本书拒绝渲染'))
    // 重复声明与 jacket 混用同样拒绝渲染（单例提示只报一次，但结果一致）
    expect(facesOf([itemNode({ type: 'cover' }), itemNode({ type: 'cover' })]).value).toEqual([])
    expect(facesOf([itemNode({ type: 'jacket' }), itemNode({ type: 'back-cover' })]).value).toEqual(
      [],
    )
    error.mockRestore()
  })
})
