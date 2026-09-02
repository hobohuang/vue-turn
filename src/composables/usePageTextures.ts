import { nextTick, onBeforeUnmount, onMounted, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import type * as THREE from 'three'

import type { PageSource } from '@/lib/pageMapping'
import { elementToTexture, waitForResources } from '@/lib/textureFactory'
import type { StaticPlacement } from '@/types/turn'

export type { PageSource }

export interface PageTexturesOptions {
  pageSources: ComputedRef<PageSource[]>
  pageEls: Ref<HTMLElement[]>
  offscreenEl: Ref<HTMLElement | null>
  pageCount: Ref<number>
  currentPage: Ref<number>
  displayedPages: Ref<1 | 2>
  isFlipping: Ref<boolean>
  pixelRatio: ComputedRef<number>
  resourceTimeout: ComputedRef<number>
  prefetchWindow: ComputedRef<number>
  /** 读取当前 props（调用时求值，保持与组件状态一致） */
  pageBackground: () => string
  cacheBust: () => boolean
  maxAnisotropy: Ref<number>
  applyStaticTexture: (index: number, texture: THREE.Texture) => void
  /** 纹理就绪后重建静态布局（由编排层提供） */
  renderStatic: () => void
  /** 最近一次静态布局：跨页合并判断依据（由编排层提供） */
  getLastPlacements: () => StaticPlacement[]
  onReady: () => void
  onRasterizeError: (page: number, error: unknown) => void
}

/**
 * 纹理生命周期与光栅化调度：三张纹理 Map 的管理、懒光栅化窗口、
 * DOM 变化监听与定位刷新。纯逻辑层，不依赖指针/键盘交互。
 */
export function usePageTextures(options: PageTexturesOptions) {
  const textures = new Map<number, THREE.Texture>()
  // 跨页项整页纹理：key 为 item 索引（翻页中左右两页各用半图克隆）
  const spreadFullTextures = new Map<number, THREE.Texture>()
  // 跨页项整页纹理生成去重：仅同一光栅化批次（seq 相同）内并发请求共享
  // 同一 Promise（左右两页同时光栅化）；跨批次不复用——DOM 内容可能已
  // 变化，必须重新光栅化，否则 refresh/DOM 变化刷新会命中旧的 resolved
  // promise 拿回旧纹理
  const spreadBasePromises = new Map<number, { seq: number; promise: Promise<THREE.Texture> }>()
  let disposed = false
  let pendingRaster = false
  let rasterSeq = 0
  let rasterScheduled = false
  let readyEmitted = false
  let mutationObserver: MutationObserver | null = null

  // 懒光栅化窗口：覆盖当前可见页 [currentPage, currentPage+spread) 前后各 W 页
  function computeWindow(): [number, number] {
    const W = options.prefetchWindow.value
    const current = options.currentPage.value
    const spread = options.displayedPages.value
    const start = Math.max(0, current - W)
    const end = Math.min(options.pageCount.value, current + spread + W)
    return [start, end]
  }

  // 释放窗口外纹理，控制显存占用；翻页结束后调用，确保翻页用过的纹理已不再需要。
  // 跨页项的整页基准纹理在左右两页都离开窗口后才释放。
  function releaseOutsideWindow() {
    const [start, end] = computeWindow()
    for (const index of Array.from(textures.keys())) {
      if (index < start || index >= end) {
        textures.get(index)?.dispose()
        textures.delete(index)
      }
    }
    if (spreadFullTextures.size === 0) return
    // 先建一次 itemIndex → 页索引集合的索引，避免对每个跨页项全量扫描
    const pagesOfItem = new Map<number, number[]>()
    for (let index = 0; index < options.pageSources.value.length; index++) {
      const source = options.pageSources.value[index]
      if (!source || source.blank || source.itemIndex < 0) continue
      const pages = pagesOfItem.get(source.itemIndex)
      if (pages) pages.push(index)
      else pagesOfItem.set(source.itemIndex, [index])
    }
    for (const [itemIndex, pages] of pagesOfItem) {
      const inWindow = pages.some((index) => index >= start && index < end)
      if (!inWindow) {
        spreadFullTextures.get(itemIndex)?.dispose()
        spreadFullTextures.delete(itemIndex)
        spreadBasePromises.delete(itemIndex)
      }
    }
  }

  function syncPageCount() {
    const count = options.pageSources.value.length
    if (count < options.pageCount.value) {
      // 页数减少：立即释放被删除页的纹理，避免悬挂引用泄漏显存
      for (const index of Array.from(textures.keys())) {
        if (index >= count) {
          textures.get(index)?.dispose()
          textures.delete(index)
        }
      }
      for (const itemIndex of Array.from(spreadFullTextures.keys())) {
        if (!options.pageSources.value.some((source) => source.itemIndex === itemIndex)) {
          spreadFullTextures.get(itemIndex)?.dispose()
          spreadFullTextures.delete(itemIndex)
          spreadBasePromises.delete(itemIndex)
        }
      }
    }
    if (options.pageCount.value !== count) options.pageCount.value = count
  }

  // 光栅化单页：seq 过期（内容再次变化/卸载）时丢弃结果，旧纹理立即释放。
  // 跨页项：整页光栅化一次得到基准纹理，左右两页各持有半图克隆（共享 GPU 数据）。
  async function rasterizePage(index: number, seq: number, bust = false) {
    const source = options.pageSources.value[index]
    if (!source || source.blank) return
    const el = options.pageEls.value[source.itemIndex]
    if (!el) return
    try {
      // 等待页内图片/背景图与字体就绪，避免光栅化出缺图/缺字的纹理
      await waitForResources(el, options.resourceTimeout.value)
      if (disposed || seq !== rasterSeq) return
      if (source.region === 'full') {
        const texture = await elementToTexture(
          el,
          options.pixelRatio.value,
          options.pageBackground(),
          bust && options.cacheBust(),
          options.maxAnisotropy.value,
        )
        if (disposed || seq !== rasterSeq) {
          texture.dispose()
          return
        }
        textures.get(index)?.dispose()
        textures.set(index, texture)
        options.applyStaticTexture(index, texture)
        return
      }
      // 跨页半图：整页基准纹理同批次并发去重（左右两页共享同一 Promise）
      const itemIndex = source.itemIndex
      const cached = spreadBasePromises.get(itemIndex)
      let basePromise = cached && cached.seq === seq ? cached.promise : null
      if (!basePromise) {
        basePromise = elementToTexture(
          el,
          options.pixelRatio.value,
          options.pageBackground(),
          bust && options.cacheBust(),
          options.maxAnisotropy.value,
        )
        spreadBasePromises.set(itemIndex, { seq, promise: basePromise })
      }
      let base: THREE.Texture
      try {
        base = await basePromise
      } catch (error) {
        if (spreadBasePromises.get(itemIndex)?.promise === basePromise) {
          spreadBasePromises.delete(itemIndex)
        }
        throw error
      }
      if (disposed || seq !== rasterSeq) {
        if (spreadFullTextures.get(itemIndex) !== base) base.dispose()
        // 过期结果连同去重条目一并作废，避免后续批次复用已 dispose 的纹理
        if (spreadBasePromises.get(itemIndex)?.promise === basePromise) {
          spreadBasePromises.delete(itemIndex)
        }
        return
      }
      const half = base.clone()
      half.repeat.set(0.5, 1)
      half.offset.set(source.region === 'right' ? 0.5 : 0, 0)
      textures.get(index)?.dispose()
      textures.set(index, half)
      if (spreadFullTextures.get(itemIndex) !== base) {
        spreadFullTextures.get(itemIndex)?.dispose()
        spreadFullTextures.set(itemIndex, base)
      }
      // 当前布局为合并跨页时贴整图，否则贴半图（单页模式/翻页中）
      const merged = options
        .getLastPlacements()
        .find(
          (p) => p.spread && p.index === index - (source.region === 'right' ? 1 : 0),
        )
      if (merged) {
        options.applyStaticTexture(merged.index, base)
      } else {
        options.applyStaticTexture(index, half)
      }
    } catch (error) {
      if (disposed || seq !== rasterSeq) return
      console.warn(`[vue-turn] 第 ${index + 1} 页纹理生成失败`, error)
      options.onRasterizeError(index + 1, error)
    }
  }

  async function rasterizeAll(bust = false) {
    const seq = ++rasterSeq
    // 等待离屏 DOM 完成最新内容的 patch，避免光栅化到旧内容
    await nextTick()
    if (disposed || seq !== rasterSeq) return
    const total = options.pageSources.value.length
    await Promise.all(Array.from({ length: total }, (_, index) => rasterizePage(index, seq, bust)))
    if (disposed || seq !== rasterSeq) return
    options.renderStatic()
    if (!readyEmitted) {
      readyEmitted = true
      options.onReady()
    }
  }

  // 懒光栅化：仅生成窗口内缺失的纹理（force=true 时强制刷新窗口内全部页面）
  async function rasterizeWindow(force = false) {
    const seq = ++rasterSeq
    await nextTick()
    if (disposed || seq !== rasterSeq) return
    const [start, end] = computeWindow()
    const tasks: Promise<void>[] = []
    for (let i = start; i < end; i++) {
      if (force || !textures.has(i)) {
        tasks.push(rasterizePage(i, seq))
      }
    }
    await Promise.all(tasks)
    if (disposed || seq !== rasterSeq) return
    options.renderStatic()
    if (!readyEmitted) {
      readyEmitted = true
      options.onReady()
    }
  }

  // 手动重绘指定页面纹理（页码从 1 开始）；翻页中排队，结束后补刷
  async function refreshPage(page: number) {
    const index = Math.max(0, Math.round(page) - 1)
    if (index >= options.pageSources.value.length) return
    if (options.isFlipping.value) {
      pendingRaster = true
      return
    }
    const seq = rasterSeq
    await nextTick()
    if (disposed || seq !== rasterSeq) return
    await rasterizePage(index, seq, true)
    if (disposed || seq !== rasterSeq) return
    options.renderStatic()
  }

  // 定位 DOM 变化影响的页：沿变化节点向上找所属页元素，映射回页索引。
  // 无法定位（根级子项增删会改变页码映射、变化不属于任何页）时返回 null，
  // 调用方退化为整窗强制刷新
  function mutationsToPages(mutations: MutationRecord[]): Set<number> | null {
    const els = options.pageEls.value
    const root = options.offscreenEl.value
    if (!root || els.length === 0) return null
    const affectedItems = new Set<number>()
    for (const m of mutations) {
      if (m.type === 'childList' && m.target === root) return null
      let node: Node | null = m.target
      let matched = false
      while (node && node !== root) {
        const idx = els.indexOf(node as HTMLElement)
        if (idx >= 0) {
          affectedItems.add(idx)
          matched = true
          break
        }
        node = node.parentNode
      }
      if (!matched) return null
    }
    const pages = new Set<number>()
    for (const [index, source] of options.pageSources.value.entries()) {
      if (!source.blank && affectedItems.has(source.itemIndex)) pages.add(index)
    }
    return pages.size > 0 ? pages : null
  }

  // 强制重光栅化指定页集合（DOM 变化定位刷新）。
  // 窗口外且尚未生成过纹理的页跳过——它们本就按需生成，无需预刷
  async function rasterizePages(pages: Set<number>) {
    const seq = ++rasterSeq
    await nextTick()
    if (disposed || seq !== rasterSeq) return
    const [start, end] = computeWindow()
    const tasks: Promise<void>[] = []
    for (const index of pages) {
      if (
        index < options.pageSources.value.length &&
        (textures.has(index) || (index >= start && index < end))
      ) {
        tasks.push(rasterizePage(index, seq))
      }
    }
    await Promise.all(tasks)
    if (disposed || seq !== rasterSeq) return
    options.renderStatic()
  }

  // 离屏内容发生 DOM 变化时合并触发重光栅化：可定位的变化只刷新对应页，
  // 其余退化为窗口内强制刷新；翻页动画期间不打断，动画结束后补刷
  let pendingRasterPages: Set<number> | null = null

  function scheduleRaster(mutations: MutationRecord[]) {
    if (disposed) return
    if (options.isFlipping.value) {
      pendingRaster = true
      return
    }
    const pages = mutationsToPages(mutations)
    if (pages && pendingRasterPages) {
      for (const p of pages) pendingRasterPages.add(p)
    } else {
      // null（整窗）覆盖已收集的目标集；首个目标集直接采用
      pendingRasterPages = pages
    }
    if (rasterScheduled) return
    rasterScheduled = true
    void nextTick(() => {
      rasterScheduled = false
      if (disposed) return
      const pages = pendingRasterPages
      pendingRasterPages = null
      if (pages) void rasterizePages(pages)
      else void rasterizeWindow(true)
    })
  }

  // 翻页期间累积的内容变化，动画结束后补刷窗口内纹理
  watch(
    () => options.isFlipping.value,
    (flipping) => {
      if (flipping) return
      if (pendingRaster) {
        pendingRaster = false
        void rasterizeWindow(true)
      }
    },
  )

  onMounted(() => {
    const root = options.offscreenEl.value
    if (!root) return
    mutationObserver = new MutationObserver((mutations) => scheduleRaster(mutations))
    mutationObserver.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    })
  })

  onBeforeUnmount(() => {
    disposed = true
    rasterSeq++
    mutationObserver?.disconnect()
    mutationObserver = null
    for (const texture of textures.values()) {
      texture.dispose()
    }
    textures.clear()
    for (const texture of spreadFullTextures.values()) {
      texture.dispose()
    }
    spreadFullTextures.clear()
    spreadBasePromises.clear()
  })

  return {
    /** 单页纹理（key 为页索引）：翻页/拖拽取用，勿直接修改 */
    textures,
    /** 跨页整图基准纹理（key 为 itemIndex）：合并跨页静态网格取用 */
    getSpreadFullTexture: (itemIndex: number) => spreadFullTextures.get(itemIndex) ?? null,
    syncPageCount,
    rasterizeWindow,
    rasterizePages,
    releaseOutsideWindow,
    /** 手动重绘全部页面纹理（cacheBust 生效） */
    refresh: () => rasterizeAll(true),
    refreshPage,
    scheduleRaster,
  }
}
