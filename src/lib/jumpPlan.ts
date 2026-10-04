import type { ForwardDirection } from '../types/turn'

import { computeFlipSpec } from './flipSpec'

/** 扇形翻页的最大纸张数：内页纸张超出后按比例合并成大步（封面/封底边界步不合并） */
export const MAX_JUMP_STEPS = 6

/** 扇形翻页每张纸分摊的总时长预算（毫秒）：总时长 = max(flipDuration, 张数 × 预算) */
export const FAN_SHEET_BUDGET = 280

/** 扇形翻页的单张纸计划（jumpPlan 的一步 = 扇形翻页的一张纸） */
export interface JumpPlanStep {
  /** 步起点页索引（即该张纸翻页动画的 currentPage 语义） */
  from: number
  /** 本张纸代表的纸张数（传给 computeFlipSpec 的 leafSpan） */
  span: number
  /** 本步页索引增量（= spec.delta，commitFlip 用） */
  delta: number
  /** 是否封面/封底边界步（spec.boundary，跨距固定 1） */
  boundary: boolean
}

export interface JumpPlanOptions {
  currentPage: number
  /** 目标页索引（须经 clampAndAlign 对齐后传入） */
  target: number
  displayedPages: 1 | 2
  forwardDirection: ForwardDirection
  numPages: number
  pageAspect: number
}

/**
 * 跳页扇形翻页规划：从当前页逐张模拟翻页走到目标页（computeFlipSpec 的
 * per-leaf delta 天然编码了封面/封底边界步的 ±1/±2 跨距），张数不超过
 * 上限时逐张翻；超出时边界步保持单张、连续内页段按递增块合并成大步。
 * 目标不可达（理论不可达，防御页码/页数竞态）时返回空数组，调用方退化为
 * 瞬间跳转。
 */
export function planJump(options: JumpPlanOptions): JumpPlanStep[] {
  const { currentPage, target, displayedPages, forwardDirection, numPages, pageAspect } = options
  if (target === currentPage) return []

  // 逐张模拟：每张纸的 delta 与是否边界步
  const backward = target < currentPage
  const leaves: { delta: number; boundary: boolean }[] = []
  let pos = currentPage
  while (pos !== target && leaves.length < numPages) {
    const spec = computeFlipSpec({
      currentPage: pos,
      displayedPages,
      forwardDirection,
      backward,
      pageAspect,
      numPages,
    })
    if (!Number.isInteger(spec.delta) || spec.delta === 0) return []
    leaves.push({ delta: spec.delta, boundary: spec.boundary === true })
    pos += spec.delta
  }
  if (pos !== target) return []

  const steps: JumpPlanStep[] = []
  // 页索引游标：每消耗一张纸推进一次
  let page = currentPage
  const pushChunk = (from: number, span: number, delta: number, boundary: boolean) => {
    steps.push({ from, span, delta, boundary })
    page += delta
  }
  const pushSingle = (leaf: { delta: number; boundary: boolean }) => {
    pushChunk(page, 1, leaf.delta, leaf.boundary)
  }

  if (leaves.length <= MAX_JUMP_STEPS) {
    for (const leaf of leaves) pushSingle(leaf)
  } else {
    const boundaryCount = leaves.filter((leaf) => leaf.boundary).length
    const innerCount = leaves.length - boundaryCount
    const budget = MAX_JUMP_STEPS - boundaryCount
    // 边界步（封面/封底开合）跨距固定，不参与合并；flipSpec 的边界只出现在
    // 起点（封面 0/1）与终点（封底 last-1/last-3），故连续内页段至多一段，
    // 合并块可整段顺序消耗递增尺寸；防御性出现多段时剩余纸张退化为逐张
    const sizes = innerCount > 0 && budget >= 1 && innerCount > budget
      ? rampSizes(innerCount, budget)
      : null
    let sizeIdx = 0
    let i = 0
    while (i < leaves.length) {
      const leaf = leaves[i]
      if (!leaf) break
      if (leaf.boundary) {
        pushSingle(leaf)
        i++
        continue
      }
      let runEnd = i
      while (runEnd < leaves.length) {
        const nextLeaf = leaves[runEnd]
        if (!nextLeaf || nextLeaf.boundary) break
        runEnd++
      }
      let consumed = 0
      while (consumed < runEnd - i) {
        const size = sizes?.[sizeIdx] ?? 1
        sizeIdx++
        const span = Math.min(size, runEnd - i - consumed)
        pushChunk(page, span, leaf.delta * span, false)
        consumed += span
      }
      i = runEnd
    }
  }
  return steps
}

/**
 * 递增分配 total 张纸到 parts 张（前小后大，模拟越翻越快的加速感）：
 * base 均分 + 余额补到末尾。调用方保证 total ≥ parts ≥ 1。
 */
function rampSizes(total: number, parts: number): number[] {
  const base = Math.floor(total / parts)
  const extra = total - base * parts
  return Array.from({ length: parts }, (_, i) => base + (i >= parts - extra ? 1 : 0))
}
