import { Comment, computed, Fragment, h } from 'vue'
import type { Slots, VNode } from 'vue'

import TurnItem from '@/components/TurnItem.vue'
import type { PageFaceKind } from '@/lib/pageMapping'
import type { PageRegion } from '@/types/turn'

// 警告只提示一次（应用级单例，避免多实例/响应式重算刷屏）
let warnedInvalidChild = false
let warnedFacePlacement = false

interface PageItem {
  vnode: VNode
  spread: boolean
  regions: PageRegion[]
  cover: boolean
  backCover: boolean
  /** #back 插槽内容（封面底/封底里），未定义或为空则为 null */
  backVnode: VNode | null
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

// 模板属性以原始大小写落在 vnode.props 上（如 back-cover），
// 驼峰键读不到时回退 kebab-case 键
function readItemProp(node: VNode, key: string): unknown {
  const props = node.props
  if (!props) return undefined
  if (props[key] !== undefined) return props[key]
  const kebab = key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
  return props[kebab]
}

// 提取 turn-item 的 #back 插槽内容为单个可渲染 vnode（空内容返回 null）
function extractBackVnode(node: VNode): VNode | null {
  const children = node.children
  if (!children || typeof children !== 'object' || Array.isArray(children)) return null
  const back = (children as Record<string, unknown>).back
  if (typeof back !== 'function') return null
  const rendered = (back as () => VNode | VNode[])()
  const list = (Array.isArray(rendered) ? rendered : [rendered]).filter(
    (child) => child && child.type !== Comment,
  )
  if (list.length === 0) return null
  return list.length === 1 ? list[0]! : h(Fragment, null, list)
}

function collectPages(slots: Slots): PageItem[] {
  const root = slots.default?.() ?? []
  const result: PageItem[] = []
  const walk = (nodes: VNode[]) => {
    for (const node of nodes) {
      if (node.type === TurnItem) {
        // 模板无值属性编译为 ""，动态绑定为 true/false，均按真值判定
        const regions = readItemProp(node, 'regions')
        result.push({
          vnode: node,
          spread: isTruthyProp(readItemProp(node, 'spread')),
          regions: Array.isArray(regions) ? (regions as PageRegion[]) : [],
          cover: isTruthyProp(readItemProp(node, 'cover')),
          backCover: isTruthyProp(readItemProp(node, 'backCover')),
          backVnode: extractBackVnode(node),
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
 * 并把 item 展开为"面"序列——封面/封底各占一张专用纸张，#back 插槽内容
 * 作为同一张纸的背面面；未声明 cover/backCover 时由 buildPageSources
 * （lib/pageMapping.ts）按位置约定兜底。
 *
 * 必须在渲染函数内调用插槽（computed 内读取 slots.default），
 * 才能让父组件的内容变化正常触发本组件更新。
 */
export function usePageSources(slots: Slots) {
  const pageFaces = computed<PageFace[]>(() => {
    const items = collectPages(slots)
    const single = items.length === 1
    const faces: PageFace[] = []
    const pushBackFace = (
      item: PageItem,
      kind: Extract<PageFaceKind, 'coverBack' | 'backCoverBack'>,
    ) => {
      if (item.backVnode) faces.push({ vnode: item.backVnode, spread: false, regions: [], face: kind })
    }
    items.forEach((item, index) => {
      const coverHere = item.cover && (index === 0 || single)
      const backHere = item.backCover && (index === items.length - 1 || single)
      if (item.cover && !coverHere && !warnedFacePlacement) {
        warnedFacePlacement = true
        console.warn('[vue-turn] cover 仅在首个 <turn-item> 上生效，其余项按普通页处理')
      }
      if (item.backCover && !backHere && !warnedFacePlacement) {
        warnedFacePlacement = true
        console.warn('[vue-turn] back-cover 仅在末个 <turn-item> 上生效，其余项按普通页处理')
      }
      // 同时声明 cover 与 back-cover 时按位置取其一（单 item 书两者兼用）
      if (coverHere && backHere && !single && !warnedFacePlacement) {
        warnedFacePlacement = true
        console.warn('[vue-turn] 同一 <turn-item> 不能同时声明 cover 与 back-cover，已按位置取其一')
      }
      if (coverHere) {
        faces.push({ vnode: item.vnode, spread: false, regions: item.regions, face: 'coverFront' })
        pushBackFace(item, 'coverBack')
        return
      }
      if (backHere) {
        pushBackFace(item, 'backCoverBack')
        faces.push({ vnode: item.vnode, spread: false, regions: item.regions, face: 'backCoverFront' })
        return
      }
      if (item.backVnode && !warnedFacePlacement) {
        warnedFacePlacement = true
        console.warn('[vue-turn] #back 插槽仅在 cover / back-cover 项上生效，已忽略')
      }
      faces.push({ vnode: item.vnode, spread: item.spread, regions: item.regions, face: 'content' })
    })
    return faces
  })

  return { pageFaces }
}
