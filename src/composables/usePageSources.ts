import { Comment, computed } from 'vue'
import type { Slots, VNode } from 'vue'

import TurnItem from '../components/TurnItem.vue'
import type { PageFaceKind } from '../lib/pageMapping'
import type { PageRegion, TurnItemType } from '../types/turn'

// 提示只提示一次（应用级单例，避免多实例/响应式重算刷屏）
let warnedInvalidChild = false
let erroredItemTypes = false

/** type prop 的合法取值 */
const ITEM_TYPES: ReadonlyArray<TurnItemType> = ['cover', 'back-cover', 'jacket']

interface PageItem {
  vnode: VNode
  spread: boolean
  regions: PageRegion[]
  /** type 标注原始值（未声明为 undefined）；合法性由 validateItemTypes 校验 */
  type: unknown
}

/** 面：turn-item 展开后的正/背面，页源映射（lib/pageMapping）的输入单位 */
export interface PageFace {
  vnode: VNode
  spread: boolean
  regions: PageRegion[]
  face: PageFaceKind
}

function isTruthyProp(value: unknown): boolean {
  return value !== undefined && value !== null && value !== false
}

/**
 * type 标注校验（纯函数，便于单测）：非法枚举值、同类型重复声明、
 * jacket 与 cover / back-cover 混用均视为整本书无效——调用方拒绝渲染。
 * 返回首个错误的描述，合法时返回 null。
 */
export function validateItemTypes(types: ReadonlyArray<unknown>): string | null {
  const seen = new Map<TurnItemType, number>()
  for (let index = 0; index < types.length; index++) {
    const type = types[index]
    if (type === undefined || type === null) continue
    const first = seen.get(type as TurnItemType)
    if (first !== undefined) {
      return `type="${String(type)}" 重复声明（第 ${first + 1} 与第 ${index + 1} 个 <turn-item>），同一类型只能声明一次`
    }
    if (!ITEM_TYPES.includes(type as TurnItemType)) {
      return `非法的 type="${String(type)}"（第 ${index + 1} 个 <turn-item>），可用值：${ITEM_TYPES.join(' / ')}`
    }
    seen.set(type as TurnItemType, index)
  }
  if (seen.has('jacket') && (seen.has('cover') || seen.has('back-cover'))) {
    return 'type="jacket" 已同时供给封面与封底，不能再与 cover / back-cover 混用'
  }
  return null
}

function collectPages(slots: Slots): PageItem[] {
  const root = slots.default?.() ?? []
  const result: PageItem[] = []
  const walk = (nodes: VNode[]) => {
    for (const node of nodes) {
      if (node.type === TurnItem) {
        // 模板无值属性编译为 ""，动态绑定为 true/false，均按真值判定
        const regions = node.props?.regions
        result.push({
          vnode: node,
          spread: isTruthyProp(node.props?.spread),
          regions: Array.isArray(regions) ? (regions as PageRegion[]) : [],
          type: node.props?.type,
        })
      } else if (Array.isArray(node.children)) {
        walk(node.children as VNode[])
      } else if (!warnedInvalidChild && node.type !== Comment && typeof node.type !== 'symbol') {
        warnedInvalidChild = true
        console.warn('[vue-turn] 默认插槽中仅支持 <turn-item>，其余子节点将被忽略')
      }
    }
  }
  walk(root)
  return result
}

/**
 * 页面收集与面映射：渲染期从默认插槽收集 turn-item（展平 v-for Fragment），
 * 并按 type 标注把 item 归类为面——cover → coverFront、back-cover →
 * backCoverFront、jacket → coverSpread（双倍宽度外皮，封面取右半、封底取
 * 左半）、未声明 → content。type 按面种类分拣归位、与声明位置无关；未声明
 * 任何封面/封底时由 buildPageSources（lib/pageMapping.ts）按位置约定兜底。
 * 标注非法（重复/混用/未知值）时整本书拒绝渲染（pageFaces 为空）。
 *
 * 必须在渲染函数内调用插槽（computed 内读取 slots.default），
 * 才能让父组件的内容变化正常触发本组件更新。
 */
export function usePageSources(slots: Slots) {
  const pageFaces = computed<PageFace[]>(() => {
    const items = collectPages(slots)
    const error = validateItemTypes(items.map((item) => item.type))
    if (error) {
      if (!erroredItemTypes) {
        erroredItemTypes = true
        console.error(`[vue-turn] ${error}；本书拒绝渲染`)
      }
      return []
    }
    return items.map((item): PageFace => {
      switch (item.type) {
        case 'cover':
          return { vnode: item.vnode, spread: false, regions: item.regions, face: 'coverFront' }
        case 'back-cover':
          return { vnode: item.vnode, spread: false, regions: item.regions, face: 'backCoverFront' }
        case 'jacket':
          return { vnode: item.vnode, spread: true, regions: item.regions, face: 'coverSpread' }
        default:
          return { vnode: item.vnode, spread: item.spread, regions: item.regions, face: 'content' }
      }
    })
  })

  return { pageFaces }
}
