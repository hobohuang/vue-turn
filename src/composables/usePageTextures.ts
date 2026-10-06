import { nextTick, onBeforeUnmount, onMounted, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import type * as THREE from 'three'

import type { PageSource } from '../lib/pageMapping'
import type { PageRasterizer } from '../types/turn'
import { elementToTexture, solidColorTexture, waitForResources } from '../lib/textureFactory'
import type { FlipSpec, StaticPlacement } from '../types/turn'

export type { PageSource }

export interface PageTexturesOptions {
  pageSources: ComputedRef<PageSource[]>
  pageEls: Ref<HTMLElement[]>
  offscreenEl: Ref<HTMLElement | null>
  /** 总页数（状态机的 numPages，全书唯一真值；本层只读） */
  numPages: Ref<number>
  /** 页数变化时写入状态机（内部会重钳当前页，不可直接改 numPages） */
  setNumPages: (count: number) => void
  currentPage: Ref<number>
  displayedPages: Ref<1 | 2>
  isFlipping: Ref<boolean>
  pixelRatio: ComputedRef<number>
  resourceTimeout: ComputedRef<number>
  prefetchWindow: ComputedRef<number>
  cacheBust: () => boolean
  maxAnisotropy: Ref<number>
  /** 自定义光栅化器（未传时走内置 html-to-image 按需加载路径） */
  rasterizer: () => PageRasterizer | undefined
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
  // 跨页项左右半图克隆：key 为 item 索引。两侧常备（共享基准纹理的图像数据），
  // 供拆分态按「屏幕侧」解析半图用——RTL 的镜像页码配对会让某页在屏幕上
  // 呈现另一侧半图（见 textureAtSide）
  const spreadHalves = new Map<number, { left: THREE.Texture; right: THREE.Texture }>()
  // 跨页项整页纹理生成去重：仅同一光栅化批次（batch 相同）内并发请求共享
  // 同一 Promise（左右两页同时光栅化）；跨批次不复用——DOM 内容可能已
  // 变化，必须重新光栅化，否则 refresh/DOM 变化刷新会命中旧的 resolved
  // promise 拿回旧纹理。pending 为尚未收尾的消费者数（左右两半各一），
  // 归零时才允许释放基准纹理
  const spreadBasePromises = new Map<
    number,
    { batch: number; promise: Promise<THREE.Texture>; pending: number }
  >()
  let disposed = false
  let pendingRaster = false
  // 排队补刷是否需要破缓存（refreshPage 的 cacheBust 意图跨翻页保留）
  let pendingRasterBust = false
  // 三层代际，各管一类作废：
  // - bookEpoch 整书作废（卸载、显示模式迁移）：页索引语义已变，在途结果全不可信
  // - pageEpoch 单页代际：只有「同一页的更新请求」才作废该页的在途任务
  // - batchId 批次号：仅供跨页基准纹理的同批去重，不参与作废判定
  // 旧实现三者共用一个全局序号，于是任一页的定向重刷（DOM 变化）会把整批在途
  // 结果全部丢弃，而重刷只覆盖变化的那一页——其余页要等到下一次翻页才有纹理
  let bookEpoch = 0
  let batchId = 0
  const pageEpoch = new Map<number, number>()
  let rasterScheduled = false
  let readyEmitted = false
  let mutationObserver: MutationObserver | null = null

  // 空白纸页的纯色纸纹：全书共用一张（空白补位页、封面底/封底里的缺省衬页、
  // 单页模式翻页纸张背面、跳页扇形的骨架占位纸）。它们无内容、颜色一致，
  // 逐页各建一张 1×1 纹理只是无谓的 canvas 分配与显存上传，且窗口滑动时
  // 反复创建/释放。共享实例不参与按页的释放路径——只在本组件卸载时 dispose
  let sharedBlank: THREE.Texture | null = null
  function blankTexture(): THREE.Texture {
    if (!sharedBlank) sharedBlank = solidColorTexture()
    return sharedBlank
  }
  function isSharedBlank(texture: THREE.Texture): boolean {
    return texture === sharedBlank
  }

  // 释放某一页当前挂着的纹理（替换内容或页被移除时）。共享纸纹不能被
  // 任何按页路径释放——否则其他仍在用它的页会拿到已 dispose 的纹理
  function releasePageTexture(index: number) {
    const texture = textures.get(index)
    if (!texture || isSharedBlank(texture)) return
    texture.dispose()
  }

  // 懒光栅化窗口：覆盖当前可见页 [currentPage, currentPage+spread) 前后各 W 页
  function computeWindow(): [number, number] {
    const W = options.prefetchWindow.value
    const current = options.currentPage.value
    const spread = options.displayedPages.value
    const start = Math.max(0, current - W)
    const end = Math.min(options.numPages.value, current + spread + W)
    return [start, end]
  }

  // 释放窗口外纹理，控制显存占用；翻页结束后调用，确保翻页用过的纹理已不再需要。
  // 跨页项的整页基准纹理在左右两页都离开窗口后才释放。
  function releaseOutsideWindow() {
    const [start, end] = computeWindow()
    for (const index of Array.from(textures.keys())) {
      if (index < start || index >= end) {
        releasePageTexture(index)
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
        spreadHalves.get(itemIndex)?.left.dispose()
        spreadHalves.get(itemIndex)?.right.dispose()
        spreadHalves.delete(itemIndex)
        spreadBasePromises.delete(itemIndex)
      }
    }
  }

  function syncPageCount() {
    const count = options.pageSources.value.length
    if (count < options.numPages.value) {
      // 页数减少：立即释放被删除页的纹理，避免悬挂引用泄漏显存
      for (const index of Array.from(textures.keys())) {
        if (index >= count) {
          releasePageTexture(index)
          textures.delete(index)
        }
      }
      for (const itemIndex of Array.from(spreadFullTextures.keys())) {
        if (!options.pageSources.value.some((source) => source.itemIndex === itemIndex)) {
          spreadFullTextures.get(itemIndex)?.dispose()
          spreadFullTextures.delete(itemIndex)
          spreadHalves.get(itemIndex)?.left.dispose()
          spreadHalves.get(itemIndex)?.right.dispose()
          spreadHalves.delete(itemIndex)
          spreadBasePromises.delete(itemIndex)
        }
      }
    }
    if (options.numPages.value !== count) options.setNumPages(count)
  }

  // 跨页基准纹理的去重条目：消费者离开时递减计数。
  // 成功落地只递减、保留条目——同批次的兄弟半页仍可复用这个已 resolved 的
  // Promise（并发闸下两半可能先后而非同时执行，删早了会让整页被光栅化两次）；
  // 条目由换批覆盖、离窗释放或整书作废清理。
  // 失败/过期路径在计数归零时删条目，过期还要释放纹理（左右两半共享同一
  // Promise，先到的那个直接 dispose 会让兄弟半页拿到已释放的纹理；base 已被
  // spreadFullTextures 接管时不释放）
  interface SpreadBaseEntry {
    batch: number
    promise: Promise<THREE.Texture>
    pending: number
  }

  function dropSpreadBase(itemIndex: number, entry: SpreadBaseEntry, base?: THREE.Texture) {
    entry.pending--
    if (entry.pending > 0) return
    if (spreadBasePromises.get(itemIndex) === entry) spreadBasePromises.delete(itemIndex)
    if (base && spreadFullTextures.get(itemIndex) !== base) base.dispose()
  }

  // 光栅化并发上限：elementToTexture 走 html-to-image（克隆整棵子树、逐节点读
  // computed style、图片转 dataURL），是主线程重活。不设闸时 refresh() 会对
  // 全书每一页同时发起一次——厚书直接卡死主线程甚至崩掉标签页
  const RASTER_CONCURRENCY = 2

  // 按并发上限跑完一批任务：任务以工厂形式传入，未被取用时不启动
  async function runGated(tasks: Array<() => Promise<void>>) {
    let cursor = 0
    const workers = Array.from({ length: Math.min(RASTER_CONCURRENCY, tasks.length) }, async () => {
      while (cursor < tasks.length) {
        const task = tasks[cursor++]
        if (task) await task()
      }
    })
    await Promise.all(workers)
  }

  // 光栅化单页：本页被更新的请求取代、或整书作废（模式迁移/卸载）时丢弃结果，
  // 旧纹理立即释放。其他页的在途任务不受影响（各自独立代际）。
  // 跨页项：整页光栅化一次得到基准纹理，左右两页各持有半图克隆（共享 GPU 数据）。
  async function rasterizePage(index: number, batch: number, bust = false) {
    const source = options.pageSources.value[index]
    if (!source) return
    const epoch = bookEpoch
    const generation = (pageEpoch.get(index) ?? 0) + 1
    pageEpoch.set(index, generation)
    const stale = () => disposed || epoch !== bookEpoch || pageEpoch.get(index) !== generation
    try {
      // 空白页无 DOM 可光栅化：贴统一纸色的纯色纸纹（否则材质落为无纹理
      // 的白色，与内容页纸色不一致）。纯同步路径，无代际过期问题
      if (source.blank) {
        const texture = blankTexture()
        // 共享纸纹已挂在本页键位上就无需重复贴图（窗口反复进出会走到这里）
        if (textures.get(index) !== texture) {
          releasePageTexture(index)
          textures.set(index, texture)
          options.applyStaticTexture(index, texture)
        }
        return
      }
      const el = options.pageEls.value[source.itemIndex]
      if (!el) return
      // 等待页内图片/背景图与字体就绪，避免光栅化出缺图/缺字的纹理
      await waitForResources(el, options.resourceTimeout.value)
      if (stale()) return
      if (source.region === 'full') {
        const texture = await elementToTexture(
          el,
          options.pixelRatio.value,
          bust && options.cacheBust(),
          options.maxAnisotropy.value,
          options.rasterizer(),
        )
        if (stale()) {
          texture.dispose()
          return
        }
        releasePageTexture(index)
        textures.set(index, texture)
        options.applyStaticTexture(index, texture)
        return
      }
      // 跨页半图：整页基准纹理同批次并发去重（左右两页共享同一 Promise）
      const itemIndex = source.itemIndex
      const cached = spreadBasePromises.get(itemIndex)
      const entry =
        cached && cached.batch === batch
          ? cached
          : {
              batch,
              promise: elementToTexture(
                el,
                options.pixelRatio.value,
                bust && options.cacheBust(),
                options.maxAnisotropy.value,
                options.rasterizer(),
              ),
              pending: 0,
            }
      if (cached !== entry) spreadBasePromises.set(itemIndex, entry)
      entry.pending++
      const basePromise = entry.promise
      let base: THREE.Texture
      try {
        base = await basePromise
      } catch (error) {
        dropSpreadBase(itemIndex, entry)
        throw error
      }
      if (stale()) {
        // 过期结果连同去重条目一并作废，避免后续批次复用已 dispose 的纹理
        dropSpreadBase(itemIndex, entry, base)
        return
      }
      // 两侧半图克隆重建（共享基准纹理图像数据，克隆开销可忽略）；
      // 旧克隆先释放，避免 refresh 重光栅化后残留旧内容的引用
      const oldHalves = spreadHalves.get(itemIndex)
      if (oldHalves) {
        oldHalves.left.dispose()
        oldHalves.right.dispose()
      }
      const leftHalf = base.clone()
      leftHalf.repeat.set(0.5, 1)
      const rightHalf = base.clone()
      rightHalf.repeat.set(0.5, 1)
      rightHalf.offset.set(0.5, 0)
      spreadHalves.set(itemIndex, { left: leftHalf, right: rightHalf })
      releasePageTexture(index)
      textures.set(index, source.region === 'right' ? rightHalf : leftHalf)
      if (spreadFullTextures.get(itemIndex) !== base) {
        spreadFullTextures.get(itemIndex)?.dispose()
        spreadFullTextures.set(itemIndex, base)
      }
      // 基准纹理已由 spreadFullTextures 接管；条目保留给同批次的兄弟半页复用
      entry.pending--
      // 当前布局为合并跨页时贴整图，否则贴半图（单页模式/翻页中）
      const merged = options
        .getLastPlacements()
        .find(
          (p) => p.spread && p.index === index - (source.region === 'right' ? 1 : 0),
        )
      if (merged) {
        options.applyStaticTexture(merged.index, base)
      } else {
        options.applyStaticTexture(index, source.region === 'right' ? rightHalf : leftHalf)
      }
    } catch (error) {
      if (stale()) return
      console.warn(`[vue-turn] 第 ${index + 1} 页纹理生成失败`, error)
      options.onRasterizeError(index + 1, error)
    }
  }

  async function rasterizeAll(bust = false) {
    const epoch = bookEpoch
    const batch = ++batchId
    // 等待离屏 DOM 完成最新内容的 patch，避免光栅化到旧内容
    await nextTick()
    if (disposed || epoch !== bookEpoch) return
    const total = options.pageSources.value.length
    await runGated(
      Array.from({ length: total }, (_, index) => () => rasterizePage(index, batch, bust)),
    )
    if (disposed || epoch !== bookEpoch) return
    options.renderStatic()
    if (!readyEmitted) {
      readyEmitted = true
      options.onReady()
    }
  }

  // 懒光栅化：仅生成窗口内缺失的纹理（force=true 时强制刷新窗口内全部页面，
  // bust=true 时强制刷新附带破缓存——refreshPage 翻页中排队的补刷路径）
  async function rasterizeWindow(force = false, bust = false) {
    const epoch = bookEpoch
    const batch = ++batchId
    await nextTick()
    if (disposed || epoch !== bookEpoch) return
    const [start, end] = computeWindow()
    const tasks: Array<() => Promise<void>> = []
    for (let i = start; i < end; i++) {
      if (force || !textures.has(i)) {
        tasks.push(() => rasterizePage(i, batch, bust))
      }
    }
    await runGated(tasks)
    if (disposed || epoch !== bookEpoch) return
    options.renderStatic()
    if (!readyEmitted) {
      readyEmitted = true
      options.onReady()
    }
  }

  // 显式范围光栅化（跳页扇形预取）：[start, end) 内补生成缺失纹理。
  // 不重建静态布局、不发 ready——预取结果只服务即将开始的扇形翻页，
  // 慢页由步骤推进中的 rasterizeWindow 跟进补齐。按页代际下预取不再作废
  // 其他批次：期间发生的模式切换（整书作废）仍会作废本批结果
  async function rasterizeRange(start: number, end: number) {
    const epoch = bookEpoch
    const batch = ++batchId
    await nextTick()
    if (disposed || epoch !== bookEpoch) return
    const from = Math.max(0, Math.floor(start))
    const to = Math.min(options.pageSources.value.length, Math.ceil(end))
    const tasks: Array<() => Promise<void>> = []
    for (let i = from; i < to; i++) {
      if (!textures.has(i)) tasks.push(() => rasterizePage(i, batch))
    }
    await runGated(tasks)
  }

  // 手动重绘指定页面纹理（页码从 1 开始）；翻页中排队，结束后补刷。
  // 跨页半图两半共刷：重光栅化会为 item 生成新基准纹理，只刷一半会让
  // 左右两半出自不同基准（一半新内容一半旧内容）
  async function refreshPage(page: number) {
    const index = Math.max(0, Math.round(page) - 1)
    if (index >= options.pageSources.value.length) return
    if (options.isFlipping.value) {
      pendingRaster = true
      pendingRasterBust = true
      return
    }
    const epoch = bookEpoch
    // 独占批次号：沿用上一批的批次号会命中跨页基准纹理的已 resolved 缓存，
    // 「重绘」拿回旧内容
    const batch = ++batchId
    await nextTick()
    if (disposed || epoch !== bookEpoch) return
    const source = options.pageSources.value[index]
    const targets: number[] = [index]
    if (source && !source.blank && source.itemIndex >= 0) {
      for (const [i, s] of options.pageSources.value.entries()) {
        if (i !== index && s.itemIndex === source.itemIndex && !s.blank) targets.push(i)
      }
    }
    await runGated(targets.map((i) => () => rasterizePage(i, batch, true)))
    if (disposed || epoch !== bookEpoch) return
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
    const epoch = bookEpoch
    const batch = ++batchId
    await nextTick()
    if (disposed || epoch !== bookEpoch) return
    const [start, end] = computeWindow()
    const tasks: Array<() => Promise<void>> = []
    for (const index of pages) {
      if (
        index < options.pageSources.value.length &&
        (textures.has(index) || (index >= start && index < end))
      ) {
        tasks.push(() => rasterizePage(index, batch))
      }
    }
    await runGated(tasks)
    if (disposed || epoch !== bookEpoch) return
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
        const bust = pendingRasterBust
        pendingRasterBust = false
        void rasterizeWindow(true, bust)
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

  // 按屏幕侧解析页面纹理：跨页半页取「屏幕侧」对应的半图克隆（图像左半
  // 恒在屏幕左、右半恒在右，与阅读方向无关）。RTL 的镜像页码配对
  // （flipSpec：左槽 = 起始页 +1）会让按页码取半图的拆分态左右互换——
  // 静止合并整页是方向无关的（左半恒在左），拆分态统一按屏幕侧解析即可
  // 在翻起/落下的瞬间与合并态无缝衔接。side='center'（合并整页、单页
  // 模式）或非跨页页取页面自身纹理。
  // 例外：跨页封皮页（封面/封底纸张）的半图身份固定（右半=封面、左半=
  // 封底），恒取自身区域的半图、与屏幕侧无关——它们是永久单侧半页面，
  // 不参与内页跨页的合并/拆分态切换；RTL 翻页若按屏幕侧解析，封面纸张
  // 会错拿封底半图导致翻页中内容跳变
  function textureAtSide(
    index: number,
    side: 'left' | 'right' | 'center',
  ): THREE.Texture | null {
    if (side !== 'center') {
      const source = options.pageSources.value[index]
      if (source && !source.blank && source.region !== 'full') {
        const half = source.cover ? source.region : side
        return spreadHalves.get(source.itemIndex)?.[half] ?? textures.get(index) ?? null
      }
    }
    return textures.get(index) ?? null
  }

  // 翻页纸张正/背面纹理：双页模式下正面静止于翻起前的屏幕侧、背面落向
  // 对侧（几何 A 的正面起于右侧、B 起于左侧，方向与进退已编码在 geometry
  // 中），半图按屏幕侧解析；单页模式一页只有一面内容，背面统一为空白
  // 纸页（贴统一纸色纸纹，与自动补位的空白页观感一致）
  function sheetTextures(spec: FlipSpec): {
    front: THREE.Texture | null
    back: THREE.Texture | null
  } {
    if (options.displayedPages.value === 1) {
      return {
        front: textures.get(spec.frontIndex) ?? null,
        back: blankTexture(),
      }
    }
    const frontSide = spec.geometry === 'A' ? 'right' : 'left'
    return {
      front: textureAtSide(spec.frontIndex, frontSide),
      back: textureAtSide(spec.backIndex, frontSide === 'right' ? 'left' : 'right'),
    }
  }

  // 翻页前置静态布局的纹理回调：静态跨页半页按所在槽位（屏幕侧）解析，
  // 其余页取自身纹理；单页模式布局无左右半页，直接取自身纹理
  function staticTextures(spec: FlipSpec): (index: number) => THREE.Texture | null {
    if (options.displayedPages.value === 1) {
      return (index) => textures.get(index) ?? null
    }
    return (index) => {
      const slot = spec.staticPages.find((p) => p.index === index)?.slot ?? 'center'
      return textureAtSide(index, slot)
    }
  }

  // 显示模式切换后的纹理迁移：页索引语义随页源映射变化（单页无补位页/
  // 衬页、跨页被忽略），按内容源（itemIndex）把整页面纹理迁移到新键位——
  // 已光栅化的内容页不重做栅格化；迁移不掉的（空白页纸纹、旧键位残留）
  // 直接释放，在途光栅化结果全部作废，缺失页由调用方 rasterizeWindow 补生成
  function remapModeTextures(oldSources: PageSource[], newSources: PageSource[]) {
    // 页索引语义整体改变：整书作废，在途结果一律不可信
    bookEpoch++
    pageEpoch.clear()
    const oldFullByItem = new Map<number, number>()
    for (const [index, source] of oldSources.entries()) {
      if (!source.blank && source.itemIndex >= 0 && source.region === 'full') {
        oldFullByItem.set(source.itemIndex, index)
      }
    }
    const migrated = new Map<number, THREE.Texture>()
    for (const [index, source] of newSources.entries()) {
      if (source.blank || source.itemIndex < 0 || source.region !== 'full') continue
      const oldIndex = oldFullByItem.get(source.itemIndex)
      const texture = oldIndex === undefined ? undefined : textures.get(oldIndex)
      if (texture) migrated.set(index, texture)
    }
    const kept = new Set(migrated.values())
    for (const texture of textures.values()) {
      if (!kept.has(texture) && !isSharedBlank(texture)) texture.dispose()
    }
    textures.clear()
    for (const [index, texture] of migrated) {
      textures.set(index, texture)
    }
    // 跨页半图克隆按旧页索引入表，键位语义已变：作废克隆与在途去重条目，
    // 整图基准纹理（itemIndex 为 key，与页索引无关）保留供合并跨页复用
    for (const halves of spreadHalves.values()) {
      halves.left.dispose()
      halves.right.dispose()
    }
    spreadHalves.clear()
    spreadBasePromises.clear()
  }

  onBeforeUnmount(() => {
    disposed = true
    bookEpoch++
    pageEpoch.clear()
    mutationObserver?.disconnect()
    mutationObserver = null
    for (const texture of textures.values()) {
      // 共享纸纹在下方统一释放，此处跳过避免二次 dispose
      if (isSharedBlank(texture)) continue
      texture.dispose()
    }
    textures.clear()
    for (const texture of spreadFullTextures.values()) {
      texture.dispose()
    }
    spreadFullTextures.clear()
    sharedBlank?.dispose()
    sharedBlank = null
    for (const halves of spreadHalves.values()) {
      halves.left.dispose()
      halves.right.dispose()
    }
    spreadHalves.clear()
    spreadBasePromises.clear()
  })

  return {
    /** 单页纹理（key 为页索引）：翻页/拖拽取用，勿直接修改 */
    textures,
    /** 跨页整图基准纹理（key 为 itemIndex）：合并跨页静态网格取用 */
    getSpreadFullTexture: (itemIndex: number) => spreadFullTextures.get(itemIndex) ?? null,
    /** 按屏幕侧解析页面纹理（跨页半图用，见函数注释） */
    textureAtSide,
    /** 翻页纸张正/背面纹理（跨页半图按屏幕侧解析） */
    sheetTextures,
    /** 空白纸页纹理（跳页扇形翻页的骨架占位纸用，懒创建共享实例） */
    blankTexture,
    /** 翻页前置静态布局的纹理回调（静态跨页半页按槽位解析） */
    staticTextures,
    syncPageCount,
    /** 显示模式切换后的纹理迁移（按内容源迁移键位，不重做栅格化） */
    remapModeTextures,
    rasterizeWindow,
    /** 显式范围光栅化（跳页扇形预取）：[start, end) 内补生成缺失纹理 */
    rasterizeRange,
    releaseOutsideWindow,
    /** 手动重绘全部页面纹理（cacheBust 生效） */
    refresh: () => rasterizeAll(true),
    refreshPage,
  }
}
