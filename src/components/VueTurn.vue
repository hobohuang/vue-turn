<script lang="ts">
import { defineComponent, type PropType, type VNode } from 'vue'
import { cloneVNode } from 'vue'

// 稳定类型的渲染载体：按 vnode 实际结构做最小 diff，
// 避免父组件每次渲染都整体重建离屏页面 DOM
// 仅组件内部使用，不对外导出
const VnodeHolder = defineComponent({
  name: 'VnodeHolder',
  props: { vnode: { type: Object as PropType<VNode>, required: true } },
  setup(props) {
    return () => cloneVNode(props.vnode)
  },
})
</script>

<script setup lang="ts">
import {
  Comment,
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  onUpdated,
  ref,
  useSlots,
  watch,
} from 'vue'
import type * as THREE from 'three'

import TurnItem from '@/components/TurnItem.vue'
import { useBookState } from '@/composables/useBookState'
import { useTurnRenderer } from '@/composables/useTurnRenderer'
import type { PagePick } from '@/lib/TurnScene'
import { computeFlipSpec, pageWidth as pageWidthOf, spreadLayout } from '@/lib/flipSpec'
import {
  computeStackSides,
  pageAtFraction,
  stackThickness,
  type StackSide,
} from '@/lib/pageStack'
import { elementToTexture, waitForResources } from '@/lib/textureFactory'
import type {
  BeforeFlipContext,
  DisplayMode,
  EasingFn,
  FlipDirection,
  FlipSheetOptions,
  FlipSpec,
  PageRegion,
  StackVisual,
  StaticPlacement,
  TurnInstance,
  ViewportPoint,
} from '@/types/turn'

const props = withDefaults(
  defineProps<{
    /** 当前页码（从 1 开始），支持 v-model 双向绑定 */
    modelValue?: number
    /** 页面宽高比（宽 / 高） */
    pageAspect?: number
    /** 单次翻页动画时长（毫秒） */
    flipDuration?: number
    /** 初始页码（未提供 modelValue 时生效） */
    startPage?: number
    /** 翻页网格纵向分段数，越大卷曲越平滑 */
    nPolygons?: number
    /** 透视参考距离（像素），越小透视越强 */
    perspective?: number
    /** 环境光强度 */
    ambient?: number
    /** 方向光（纸张光泽）强度 */
    gloss?: number
    /** 卷曲幅度（0 为纯刚体旋转） */
    curl?: number
    /** 前进方向：left 为从左向右阅读 */
    forwardDirection?: FlipDirection
    /** 显示模式：auto 按容器宽高自动判定，1/2 强制单/双页 */
    displayedPages?: DisplayMode
    /** 离屏光栅化宽度（像素），控制纹理清晰度与内存占用 */
    pageWidth?: number
    /** 光栅化像素比 */
    pixelRatio?: number
    /** 页面底色（纹理背景） */
    pageBackground?: string
    /** 相机适配边距（视口外扩比例），越大留白越多 */
    fitMargin?: number
    /** 渲染像素比上限 */
    maxPixelRatio?: number
    /** 翻页进度缓动函数 */
    easing?: EasingFn
    /** 是否允许点击视口翻页（跟随阅读方向：LTR 右半前进，RTL 左半前进） */
    clickToFlip?: boolean
    /** 点击翻页中间死区宽度占比（0~0.5）：视口中轴该比例区域内的点击不翻页 */
    clickDeadZone?: number
    /** 是否允许键盘翻页（方向键/PageUp/PageDown/Space/Home/End，需先聚焦组件） */
    keyboard?: boolean
    /** 无障碍标签 */
    ariaLabel?: string
    /** 光栅化时是否给图片加破缓存参数 */
    cacheBust?: boolean
    /** 懒光栅化预取窗口：当前可见页前后各 N 页预生成纹理，窗口外释放 */
    prefetchWindow?: number
    /** 光栅化前资源等待超时（毫秒），超时后放弃等待直接光栅化 */
    resourceTimeout?: number
    /** 是否允许拖拽翻页（按住页面拖动，松手按位置/速度决定完成或回弹） */
    dragToFlip?: boolean
    /** 是否允许悬停折角提示（指针移入页面边缘时掀起页角） */
    peel?: boolean
    /** 折角提示区域宽度占视口宽度的比例（两侧边缘条带，0~0.5） */
    peelZone?: number
    /** 最大缩放倍数 */
    maxZoom?: number
    /** 是否允许滚轮缩放 */
    zoomEnabled?: boolean
    /** 是否允许双击切换缩放（开启后单击翻页会延迟约 260ms 以区分双击） */
    dblClickZoom?: boolean
    /** 是否显示书本左右两侧的纸叠（页层厚度条带，厚度随翻页变化，可悬停/点击跳页） */
    stack?: boolean
    /** 纸叠最大厚度占单页宽度的比例（0~0.5） */
    stackDepth?: number
  }>(),
  {
    pageAspect: 0.75,
    flipDuration: 900,
    startPage: 1,
    nPolygons: 64,
    perspective: 2400,
    ambient: 1,
    gloss: 0.35,
    curl: 0.8,
    forwardDirection: 'left',
    displayedPages: 'auto',
    pageWidth: 768,
    pixelRatio: 1,
    pageBackground: '#ffffff',
    clickToFlip: true,
    clickDeadZone: 0,
    keyboard: true,
    ariaLabel: '翻书',
    cacheBust: true,
    prefetchWindow: 4,
    resourceTimeout: 5000,
    dragToFlip: true,
    peel: true,
    peelZone: 0.12,
    maxZoom: 3,
    zoomEnabled: false,
    dblClickZoom: false,
    stack: true,
    stackDepth: 0.04,
  },
)

const emit = defineEmits<{
  'update:modelValue': [page: number]
  /** 方向无关的统一翻页开始事件 */
  'flip-start': [direction: FlipDirection]
  /** 方向无关的统一翻页结束事件（拖拽回弹取消也会触发） */
  'flip-end': [direction: FlipDirection]
  /** 页码变化（翻页提交与直接跳转均触发） */
  change: [page: number]
  /** 翻页/跳转前拦截，调用 context.preventDefault() 可取消 */
  'before-flip': [context: BeforeFlipContext]
  /** 翻到第一页 */
  first: []
  /** 翻到最后一页 */
  last: []
  /** 拖拽翻页按下（视口内坐标） */
  pressed: [point: ViewportPoint]
  /** 拖拽翻页松开（视口内坐标） */
  released: [point: ViewportPoint]
  /** 缩放级别变化 */
  'zoom-change': [level: number]
  /** 点击命中页面热区 */
  'region-tap': [page: number, region: PageRegion]
  /** 首次纹理就绪 */
  ready: []
  /** 单页光栅化失败 */
  'rasterize-error': [page: number, error: unknown]
  /** 悬停纸叠层（page 为 null 表示离开），point 为视口内坐标 */
  'stack-hover': [page: number | null, point?: ViewportPoint]
  /** 点击纸叠层跳转 */
  'stack-tap': [page: number]
}>()

const state = useBookState()

const {
  container,
  containerSize,
  webglSupported,
  maxAnisotropy,
  setStaticPages,
  applyStaticTexture,
  setStacks,
  pickStack,
  setStackHover,
  startFlip,
  beginDragFlip,
  setDragProgress,
  endDragFlip,
  stopFlip,
  setZoom: setRendererZoom,
  getZoom,
  panBy,
  pickPage,
} = useTurnRenderer({
  pageAspect: props.pageAspect,
  nPolygons: props.nPolygons,
  perspective: props.perspective,
  ambient: props.ambient,
  gloss: props.gloss,
  curl: props.curl,
  fitMargin: props.fitMargin,
  maxPixelRatio: props.maxPixelRatio,
  maxZoom: props.maxZoom,
  easing: props.easing,
  onContextRestored: () => {
    if (disposed) return
    // 上下文恢复后重建静态页并强制重光栅化窗口内纹理
    renderStatic()
    void rasterizeWindow(true)
  },
})

const slots = useSlots()

// 在模板渲染期收集 turn-item vnode（展平 v-for 产生的 Fragment），
// 非 turn-item 子节点忽略并提示。必须在渲染函数内调用插槽，
// 才能让父组件的内容变化正常触发本组件更新
let warnedInvalidChild = false
interface PageItem {
  vnode: VNode
  spread: boolean
  hard: boolean
  regions: PageRegion[]
}

function collectPages(): PageItem[] {
  const root = slots.default?.() ?? []
  const result: PageItem[] = []
  const walk = (nodes: VNode[]) => {
    for (const node of nodes) {
      if (node.type === TurnItem) {
        // 模板无值属性编译为 ""，动态绑定为 true/false，均按真值判定
        const rawSpread = node.props?.spread
        const rawHard = node.props?.hard
        const regions = node.props?.regions
        result.push({
          vnode: node,
          spread: rawSpread !== undefined && rawSpread !== null && rawSpread !== false,
          hard: rawHard !== undefined && rawHard !== null && rawHard !== false,
          regions: Array.isArray(regions) ? (regions as PageRegion[]) : [],
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

const pageItems = computed(collectPages)

// 页源：把 item 序列映射到页索引空间。
// 普通项占 1 页；跨页项占 2 页（左右各半），未对齐到奇数索引时自动插入空白页补位。
// 封面（首个 item）固定占第 0 页，spread 标记不生效。
interface PageSource {
  itemIndex: number
  region: 'full' | 'left' | 'right'
  blank: boolean
  /** 硬页（纸板页）：整页刚体翻转，无卷曲形变 */
  hard: boolean
}

const pageSources = computed<PageSource[]>(() => {
  const sources: PageSource[] = []
  const items = pageItems.value
  if (items.length === 0) return sources
  // 首个 item 视为封面，固定单页居中
  sources.push({ itemIndex: 0, region: 'full', blank: false, hard: items[0]?.hard ?? false })
  let pageIndex = 1
  for (let itemIndex = 1; itemIndex < items.length; itemIndex++) {
    const item = items[itemIndex]
    if (!item) continue
    if (item.spread) {
      // 跨页需从奇数索引（左页）开始；落在偶数索引时插入空白页补位
      if (pageIndex % 2 === 0) {
        sources.push({ itemIndex: -1, region: 'full', blank: true, hard: false })
        pageIndex++
      }
      sources.push({ itemIndex, region: 'left', blank: false, hard: item.hard })
      sources.push({ itemIndex, region: 'right', blank: false, hard: item.hard })
      pageIndex += 2
    } else {
      sources.push({ itemIndex, region: 'full', blank: false, hard: item.hard })
      pageIndex++
    }
  }
  // 总页数为奇数（末页索引为偶数）时补一张空白页保证总数为偶数，
  // 否则封底合上动画（要求末索引为奇数）退化为常规翻页：backIndex 越界、末页悬在左槽。
  // 末项为跨页时补在书末（补在跨页前会破坏其奇数起始对齐）；
  // 否则补在末项之前，让用户的封底仍落在最后一个索引（视觉上如真实书籍的衬页）。
  if (sources.length >= 3 && sources.length % 2 === 1) {
    const last = sources[sources.length - 1]!
    if (last.region === 'right') {
      sources.push({ itemIndex: -1, region: 'full', blank: true, hard: false })
    } else {
      const insertAt = sources.findIndex((s) => s.itemIndex === last.itemIndex)
      if (insertAt > 0) {
        sources.splice(insertAt, 0, { itemIndex: -1, region: 'full', blank: true, hard: false })
      }
    }
  }
  return sources
})

const offscreenEl = ref<HTMLElement | null>(null)
const pageEls = ref<HTMLElement[]>([])
const pageCount = ref(0)
const textures = new Map<number, THREE.Texture>()
// 跨页项整页纹理：key 为 item 索引（翻页中左右两页各用半图克隆）
const spreadFullTextures = new Map<number, THREE.Texture>()
// 跨页项整页纹理生成去重：并发请求共享同一 Promise
const spreadBasePromises = new Map<number, Promise<THREE.Texture>>()
let disposed = false
let pendingTarget: number | null = null
let pendingRaster = false
let rasterSeq = 0
let rasterScheduled = false
let readyEmitted = false
let mutationObserver: MutationObserver | null = null

const safeFlipDuration = computed(() =>
  Number.isFinite(props.flipDuration) && props.flipDuration > 0 ? props.flipDuration : 900,
)
const safePageWidth = computed(() =>
  Number.isFinite(props.pageWidth) && props.pageWidth > 0 ? props.pageWidth : 768,
)
const safePixelRatio = computed(() =>
  Number.isFinite(props.pixelRatio) && props.pixelRatio > 0 ? props.pixelRatio : 1,
)
const safePrefetchWindow = computed(() =>
  Number.isFinite(props.prefetchWindow) && props.prefetchWindow >= 0
    ? Math.floor(props.prefetchWindow)
    : 4,
)
const safeResourceTimeout = computed(() =>
  Number.isFinite(props.resourceTimeout) && props.resourceTimeout >= 0 ? props.resourceTimeout : 5000,
)
const safeMaxZoom = computed(() =>
  Number.isFinite(props.maxZoom) && props.maxZoom > 1 ? props.maxZoom : 3,
)
const safePeelZone = computed(() => {
  const value = Number(props.peelZone)
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 0.5) : 0.12
})
const safeStackDepth = computed(() => {
  const value = Number(props.stackDepth)
  return Number.isFinite(value) && value > 0 ? Math.min(value, 0.5) : 0.15
})

// 懒光栅化窗口：覆盖当前可见页 [currentPage, currentPage+spread) 前后各 W 页
function computeWindow(): [number, number] {
  const W = safePrefetchWindow.value
  const current = state.currentPage.value
  const spread = state.displayedPages.value
  const start = Math.max(0, current - W)
  const end = Math.min(pageCount.value, current + spread + W)
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
  for (const itemIndex of Array.from(spreadFullTextures.keys())) {
    // 找到该跨页项占用的页索引区间
    const pages = pageSources.value
      .map((source, index) => ({ source, index }))
      .filter(({ source }) => !source.blank && source.itemIndex === itemIndex)
    const inWindow = pages.some(({ index }) => index >= start && index < end)
    if (!inWindow && pages.length > 0) {
      spreadFullTextures.get(itemIndex)?.dispose()
      spreadFullTextures.delete(itemIndex)
      spreadBasePromises.delete(itemIndex)
    }
  }
}

function syncPageCount() {
  const count = pageSources.value.length
  if (count < pageCount.value) {
    // 页数减少：立即释放被删除页的纹理，避免悬挂引用泄漏显存
    for (const index of Array.from(textures.keys())) {
      if (index >= count) {
        textures.get(index)?.dispose()
        textures.delete(index)
      }
    }
    for (const itemIndex of Array.from(spreadFullTextures.keys())) {
      if (!pageSources.value.some((source) => source.itemIndex === itemIndex)) {
        spreadFullTextures.get(itemIndex)?.dispose()
        spreadFullTextures.delete(itemIndex)
        spreadBasePromises.delete(itemIndex)
      }
    }
  }
  if (pageCount.value !== count) pageCount.value = count
}

watch(
  () => [props.forwardDirection, pageCount.value] as const,
  ([direction, count]) => {
    state.setForwardDirection(direction)
    state.setNumPages(count)
  },
  { immediate: true },
)

// 显示模式解析：auto 按容器宽高判定，1/2 为强制值
function resolveDisplayedPages(): 1 | 2 {
  if (props.displayedPages === 1) return 1
  if (props.displayedPages === 2) return 2
  return containerSize.width > containerSize.height ? 2 : 1
}

watch(
  () => [containerSize.width, containerSize.height, props.displayedPages] as const,
  () => {
    state.setDisplayedPages(resolveDisplayedPages())
  },
  { immediate: true },
)

// v-model：外部页码变化时跳转；翻页中则推迟到动画结束
watch(
  () => props.modelValue,
  (value) => {
    if (value === undefined) return
    const target = Number.isFinite(value) ? Math.round(value) - 1 : 0
    if (target === state.currentPage.value) return
    if (state.isFlipping.value) {
      pendingTarget = target
    } else {
      state.goToPage(target)
    }
  },
)

watch(
  () => state.isFlipping.value,
  (flipping) => {
    if (flipping) return
    if (pendingTarget !== null) {
      const target = pendingTarget
      pendingTarget = null
      state.goToPage(target)
    }
    // 翻页期间累积的内容变化，动画结束后补刷窗口内纹理
    if (pendingRaster) {
      pendingRaster = false
      void rasterizeWindow(true)
    }
  },
)

// 最近一次静态布局：rasterizePage 完成后按此判断该把整图还是半图贴到现有网格
let lastPlacements: StaticPlacement[] = []

// ---------------------------------------------------------------------------
// 纸叠：书本左右两侧的页层厚度条带（厚度随翻页在两侧间转移）
// ---------------------------------------------------------------------------

// 某页状态下的纸叠渲染几何
function stackVisualFor(pageIndex: number): StackVisual {
  const width = pageWidthOf(props.pageAspect)
  const sides = computeStackSides({
    currentPage: pageIndex,
    displayedPages: state.displayedPages.value,
    forwardDirection: props.forwardDirection,
    numPages: pageCount.value,
    sheetWidth: width,
  })
  const maxDepth = width * safeStackDepth.value
  const toVisual = (side: StackSide | null) =>
    side
      ? {
          edgeX: side.edgeX,
          dir: side.dir,
          thickness: stackThickness(side.count, pageCount.value, maxDepth),
        }
      : null
  return { left: toVisual(sides.left), right: toVisual(sides.right) }
}

// 空闲布局：纸叠吸附到当前页状态
function applyStacksIdle() {
  setStacks(props.stack ? stackVisualFor(state.currentPage.value) : null)
}

// 翻页前置布局：纸叠随动画从当前状态过渡到目标状态。
// 封面/封底开合时合书侧由 computeStackSides 返回空，
// 纸叠自动从无到有生长/渐隐消失，不会在硬页落定前提前出现
function applyStacksFlip(spec: FlipSpec) {
  if (!props.stack) {
    setStacks(null)
    return
  }
  setStacks(
    stackVisualFor(state.currentPage.value),
    stackVisualFor(state.currentPage.value + spec.delta),
  )
}

// 纸叠开关/厚度变化：空闲时立即生效（翻页中由结束后 renderStatic 收敛）
watch([() => props.stack, safeStackDepth], () => {
  if (!state.isFlipping.value) applyStacksIdle()
})

function renderStatic() {
  if (state.isFlipping.value) return
  const placements = spreadLayout({
    currentPage: state.currentPage.value,
    displayedPages: state.displayedPages.value,
    forwardDirection: props.forwardDirection,
    numPages: pageCount.value,
  })
  // 跨页合并：左右两页同属一个跨页项时，渲染为一张双倍宽度的居中整页。
  // 配对不依赖具体槽位：LTR 左槽是起始页，RTL 左槽是后半页，均按同源配对。
  const sources = pageSources.value
  const merged: StaticPlacement[] = []
  const consumed = new Set<number>()
  for (const p of placements) {
    if (consumed.has(p.index)) continue
    const src = p.slot !== 'center' ? sources[p.index] : undefined
    if (src && !src.blank && (src.region === 'left' || src.region === 'right')) {
      const partnerIdx = src.region === 'left' ? p.index + 1 : p.index - 1
      const partnerSrc = sources[partnerIdx]
      const partner = placements.find((q) => q.index === partnerIdx && q.slot !== p.slot)
      if (
        partner &&
        partnerSrc &&
        !partnerSrc.blank &&
        partnerSrc.itemIndex === src.itemIndex &&
        partner.slot !== 'center'
      ) {
        merged.push({ index: Math.min(p.index, partnerIdx), slot: 'center', spread: true })
        consumed.add(partnerIdx)
        continue
      }
    }
    merged.push(p)
  }
  lastPlacements = merged
  // 跨页起始页索引集合：这些索引的静态网格用整页纹理
  const spreadStarts = new Set(merged.filter((p) => p.spread).map((p) => p.index))
  setStaticPages(merged, (index) => {
    if (spreadStarts.has(index)) {
      const source = sources[index]
      if (!source) return null
      return spreadFullTextures.get(source.itemIndex) ?? null
    }
    return textures.get(index) ?? null
  })
  applyStacksIdle()
}

watch([() => state.currentPage.value, () => state.displayedPages.value], () => {
  renderStatic()
})

// 页码变化统一出口：同步 v-model 并派发 change/first/last
// mountedDone：挂载初始页同步不触发 first/last（与 turn.js 语义一致：仅用户导航触发）
let mountedDone = false
watch(
  () => state.currentPage.value,
  () => {
    emit('update:modelValue', state.page.value)
    emit('change', state.page.value)
    if (!mountedDone) return
    if (state.page.value === 1) emit('first')
    if (pageCount.value > 0 && state.page.value === pageCount.value) emit('last')
  },
)

// 翻页前拦截：返回 false 表示被 before-flip 取消
function emitBeforeFlip(direction: FlipDirection | null, from: number, to: number): boolean {
  const ctx: BeforeFlipContext = {
    from,
    to,
    direction,
    prevented: false,
    preventDefault() {
      ctx.prevented = true
    },
  }
  emit('before-flip', ctx)
  return !ctx.prevented
}

// 纸张正反两面任一为硬页时按刚体翻转（无卷曲）
function sheetOptions(spec: FlipSpec): FlipSheetOptions {
  const sources = pageSources.value
  const hard = [spec.frontIndex, spec.backIndex].some((index) => sources[index]?.hard)
  return hard ? { curl: 0 } : {}
}

function computeFlipSpecFor(trigger: FlipDirection): FlipSpec | null {
  const ltr = props.forwardDirection === 'left'
  const advancing = ltr ? trigger === 'left' : trigger === 'right'
  if (advancing ? !state.canGoForward.value : !state.canGoBack.value) return null
  return computeFlipSpec({
    currentPage: state.currentPage.value,
    displayedPages: state.displayedPages.value,
    forwardDirection: props.forwardDirection,
    backward: !advancing,
    pageAspect: props.pageAspect,
    numPages: pageCount.value,
  })
}

function flip(trigger: FlipDirection) {
  if (disabledRef.value) return
  const ltr = props.forwardDirection === 'left'
  const advancing = ltr ? trigger === 'left' : trigger === 'right'
  if (advancing ? !state.canGoForward.value : !state.canGoBack.value) return
  const spec = computeFlipSpec({
    currentPage: state.currentPage.value,
    displayedPages: state.displayedPages.value,
    forwardDirection: props.forwardDirection,
    backward: !advancing,
    pageAspect: props.pageAspect,
    numPages: pageCount.value,
  })
  if (!emitBeforeFlip(trigger, state.page.value, state.page.value + spec.delta)) return
  // 折角悬停的纸张会被 startFlip 静默替换
  discardPeel()
  clearStackHover()
  const prevZoom = getZoom()
  state.startFlip()
  emit('flip-start', trigger)
  // 翻页前置布局：相机由翻页动画接管
  setStaticPages(spec.staticPages, (index) => textures.get(index) ?? null, false)
  applyStacksFlip(spec)
  const onDone = () => {
    state.commitFlip(spec.delta)
    renderStatic()
    emit('flip-end', trigger)
    // 翻页会将相机复位到适配距离，缩放级别随之归 1
    if (prevZoom > 1.01) emit('zoom-change', 1)
    // 懒光栅化：翻页结束后预取新窗口内缺失纹理，再释放窗口外纹理控制显存
    void rasterizeWindow(false).then(() => releaseOutsideWindow())
  }
  startFlip(
    spec,
    textures.get(spec.frontIndex) ?? null,
    textures.get(spec.backIndex) ?? null,
    safeFlipDuration.value,
    onDone,
    sheetOptions(spec),
  )
}

function next() {
  flip(props.forwardDirection)
}

function prev() {
  flip(props.forwardDirection === 'left' ? 'right' : 'left')
}

// 跳转到指定页：翻页中或页码越界时拒绝并返回 false，调用方可感知跳转是否生效
function goToPage(page: number): boolean {
  if (disabledRef.value) return false
  if (state.isFlipping.value) return false
  const target = Math.round(Number(page)) - 1
  if (!Number.isFinite(target) || target < 0 || target > pageCount.value - 1) return false
  if (target !== state.currentPage.value) {
    if (!emitBeforeFlip(null, state.page.value, target + 1)) return false
    // 跳转会重建静态布局，先收起折角悬停的纸张与纸叠悬停
    releasePeelNow()
    clearStackHover()
  }
  state.goToPage(target)
  return true
}

// 热区命中：把拾取到的纹理坐标换算为 item 内容坐标（左上角原点，0~1），
// 半页网格（跨页左/右半）映射到整 item 的一半，跨页合并网格直接覆盖整 item
function hitRegion(pick: PagePick): PageRegion | null {
  const source = pageSources.value[pick.index]
  if (!source || source.blank) return null
  const item = pageItems.value[source.itemIndex]
  if (!item || item.regions.length === 0) return null
  let px = pick.u
  if (!pick.spread) {
    if (source.region === 'left') px = pick.u * 0.5
    else if (source.region === 'right') px = 0.5 + pick.u * 0.5
  }
  const py = 1 - pick.v
  for (const region of item.regions) {
    if (
      region &&
      Number.isFinite(region.x) &&
      Number.isFinite(region.y) &&
      Number.isFinite(region.w) &&
      Number.isFinite(region.h) &&
      px >= region.x &&
      px < region.x + region.w &&
      py >= region.y &&
      py < region.y + region.h
    ) {
      return region
    }
  }
  return null
}

// 点击视口：优先命中热区；未命中时按阅读方向翻页（LTR 右半前进 / RTL 左半前进），
// 中轴 clickDeadZone 占比的死区内点击不翻页
function onViewportClick(event: MouseEvent) {
  if (suppressClick) {
    suppressClick = false
    clearClickTimer()
    return
  }
  if (disabledRef.value || state.isFlipping.value) return
  const target = event.currentTarget as HTMLElement | null
  if (!target) return
  // 纸叠点击：跳转到命中页（跳转会自动对齐到所属跨页）
  if (props.stack && webglSupported.value) {
    const hit = pickStack(event.clientX, event.clientY)
    if (hit) {
      const side =
        hit.side === 'left' ? currentStackSides.value.left : currentStackSides.value.right
      if (side && side.count > 0) {
        const page = pageAtFraction(side, hit.fraction) + 1
        emit('stack-tap', page)
        clearStackHover()
        goToPage(page)
        return
      }
    }
  }
  // 页面热区优先于翻页（含放大状态下的热区点击）
  const pick = pickPage(event.clientX, event.clientY)
  if (pick) {
    const region = hitRegion(pick)
    if (region) {
      emit('region-tap', pick.index + 1, region)
      return
    }
  }
  if (!props.clickToFlip) return
  // 放大状态下点击不翻页（避免误触；先复位缩放再导航）
  if (isZoomed()) return
  if (props.dblClickZoom) {
    // 双击缩放开启时延迟翻页，给第二次点击留出判定窗口
    if (clickTimer !== null) {
      clearClickTimer()
      return
    }
    const clientX = event.clientX
    clickTimer = setTimeout(() => {
      clickTimer = null
      applyClickFlip(clientX, target)
    }, CLICK_DISAMBIGUATION_MS)
    return
  }
  applyClickFlip(event.clientX, target)
}

function applyClickFlip(clientX: number, target: HTMLElement) {
  const rect = target.getBoundingClientRect()
  if (rect.width <= 0) return
  const ratio = (clientX - rect.left) / rect.width
  const dead = Math.min(Math.max(Number(props.clickDeadZone) || 0, 0), 0.5)
  if (ratio >= 0.5 - dead / 2 && ratio <= 0.5 + dead / 2) return
  const rightSide = ratio > 0.5
  const forward = props.forwardDirection === 'left' ? rightSide : !rightSide
  if (forward) {
    next()
  } else {
    prev()
  }
}

// 键盘翻页：方向键跟随阅读方向；PageUp/PageDown/Space 前进后退；Home/End 跳首末页
function onKeydown(event: KeyboardEvent) {
  if (!props.keyboard || disabledRef.value) return
  const forwardKey = props.forwardDirection === 'left' ? 'ArrowRight' : 'ArrowLeft'
  const backwardKey = props.forwardDirection === 'left' ? 'ArrowLeft' : 'ArrowRight'
  switch (event.key) {
    case forwardKey:
    case 'PageDown':
    case ' ':
      event.preventDefault()
      next()
      break
    case backwardKey:
    case 'PageUp':
      event.preventDefault()
      prev()
      break
    case 'Home':
      event.preventDefault()
      goToPage(1)
      break
    case 'End':
      event.preventDefault()
      goToPage(pageCount.value)
      break
    default:
      break
  }
}

// ---------------------------------------------------------------------------
// 拖拽翻页 / 折角悬停 / 缩放平移
// ---------------------------------------------------------------------------

const disabledRef = ref(false)

interface DragState {
  pointerId: number
  trigger: FlipDirection
  startX: number
  lastX: number
  lastT: number
  /** 沿翻页方向的速度（px/ms） */
  velocity: number
  moved: number
  progress: number
}

interface PanState {
  pointerId: number
  lastX: number
  lastY: number
  moved: number
}

// sheetOwner：当前场景中拖拽纸张的归属（'drag' 需要状态机收尾，'peel' 仅折角悬停）
let drag: DragState | null = null
let pan: PanState | null = null
let peelTrigger: FlipDirection | null = null
let sheetOwner: 'drag' | 'peel' | null = null
let suppressClick = false
let clickTimer: ReturnType<typeof setTimeout> | null = null

const PEEL_PROGRESS = 0.07
const CLICK_DISAMBIGUATION_MS = 260

// ---------------------------------------------------------------------------
// 纸叠悬停：命中层高亮 + 页码提示，点击跳转对应页
// ---------------------------------------------------------------------------

// 当前布局下的纸叠页面映射（悬停命中换算页码用）
const currentStackSides = computed(() =>
  computeStackSides({
    currentPage: state.currentPage.value,
    displayedPages: state.displayedPages.value,
    forwardDirection: props.forwardDirection,
    numPages: pageCount.value,
    sheetWidth: pageWidthOf(props.pageAspect),
  }),
)

const stackHover = ref<{ page: number; x: number; y: number } | null>(null)
let lastStackHoverPage: number | null = null

// 悬停层提示位置：跟随指针并钳制在视口内
const stackTooltipStyle = computed(() => {
  const hover = stackHover.value
  if (!hover) return {}
  const x = Math.min(hover.x + 16, Math.max(0, containerSize.width - 84))
  return { left: `${x}px`, top: `${hover.y}px` }
})

// 命中比例 → 页索引与高亮条带（层过薄时保证最小可见宽度）
function stackBand(side: StackSide, fraction: number) {
  const layer = Math.min(side.count - 1, Math.max(0, Math.floor(fraction * side.count)))
  let start = layer / side.count
  let end = (layer + 1) / side.count
  const minBand = 0.12
  if (end - start < minBand) {
    const center = (start + end) / 2
    start = Math.max(0, center - minBand / 2)
    end = Math.min(1, center + minBand / 2)
  }
  return { page: side.first + side.step * layer, start, end }
}

// 悬停纸叠：命中返回 true（调用方据此抑制折角悬停）
function updateStackHover(event: PointerEvent): boolean {
  if (!props.stack || disabledRef.value || state.isFlipping.value || !webglSupported.value) {
    clearStackHover()
    return false
  }
  const hit = pickStack(event.clientX, event.clientY)
  if (!hit) {
    clearStackHover()
    return false
  }
  const side = hit.side === 'left' ? currentStackSides.value.left : currentStackSides.value.right
  if (!side || side.count <= 0) {
    clearStackHover()
    return false
  }
  const band = stackBand(side, hit.fraction)
  const el = event.currentTarget as HTMLElement | null
  const rect = el?.getBoundingClientRect()
  const point: ViewportPoint = {
    x: rect ? event.clientX - rect.left : 0,
    y: rect ? event.clientY - rect.top : 0,
  }
  stackHover.value = { page: band.page + 1, x: point.x, y: point.y }
  setStackHover({ side: hit.side, start: band.start, end: band.end })
  // 仅在命中页变化时派发事件，避免高频触发
  if (lastStackHoverPage !== band.page + 1) {
    lastStackHoverPage = band.page + 1
    emit('stack-hover', band.page + 1, point)
  }
  return true
}

function clearStackHover() {
  if (!stackHover.value && lastStackHoverPage === null) return
  stackHover.value = null
  lastStackHoverPage = null
  setStackHover(null)
  emit('stack-hover', null)
}

function isZoomed() {
  return getZoom() > 1.01
}

function clearClickTimer() {
  if (clickTimer !== null) {
    clearTimeout(clickTimer)
    clickTimer = null
  }
}

function capturePointer(el: HTMLElement, pointerId: number) {
  try {
    el.setPointerCapture?.(pointerId)
  } catch {
    // 不支持指针捕获的环境退化为元素内拖动
  }
}

// 纸张完成/取消的统一收尾：拖拽提交或回弹后恢复状态机，折角悬停仅恢复布局
function makeSheetDone(spec: FlipSpec, trigger: FlipDirection) {
  return (committed: boolean) => {
    const owner = sheetOwner
    sheetOwner = null
    peelTrigger = null
    if (owner === 'drag') {
      if (committed) state.commitFlip(spec.delta)
      else state.cancelFlip()
      renderStatic()
      emit('flip-end', trigger)
      void rasterizeWindow(false).then(() => releaseOutsideWindow())
    } else {
      // 折角悬停收起：恢复静态布局
      renderStatic()
    }
  }
}

// 丢弃折角悬停（不触发收尾动画，供 startFlip 即将静默替换纸张时使用）
function discardPeel() {
  if (sheetOwner === 'peel') {
    sheetOwner = null
    peelTrigger = null
  }
}

// 立即收起折角悬停的纸张（同步触发取消收尾）
function releasePeelNow() {
  if (sheetOwner !== 'peel') return
  sheetOwner = null
  peelTrigger = null
  endDragFlip(false, safeFlipDuration.value)
}

function ensurePeel(trigger: FlipDirection) {
  if (sheetOwner === 'peel' && peelTrigger === trigger) return
  releasePeelNow()
  const spec = computeFlipSpecFor(trigger)
  if (!spec) return
  // 翻页前置布局：折角悬停不动相机
  setStaticPages(spec.staticPages, (index) => textures.get(index) ?? null, false)
  applyStacksFlip(spec)
  const ok = beginDragFlip(
    spec,
    textures.get(spec.frontIndex) ?? null,
    textures.get(spec.backIndex) ?? null,
    makeSheetDone(spec, trigger),
    sheetOptions(spec),
  )
  if (!ok) return
  sheetOwner = 'peel'
  peelTrigger = trigger
  setDragProgress(PEEL_PROGRESS)
}

function updatePeel(event: PointerEvent) {
  if (!props.peel || disabledRef.value || state.isFlipping.value || isZoomed()) {
    releasePeelNow()
    return
  }
  const el = event.currentTarget as HTMLElement | null
  const rect = el?.getBoundingClientRect()
  if (!rect || rect.width <= 0) return
  const ratio = (event.clientX - rect.left) / rect.width
  const ltr = props.forwardDirection === 'left'
  const zone = safePeelZone.value
  const forwardTrigger: FlipDirection = ltr ? 'left' : 'right'
  const backwardTrigger: FlipDirection = ltr ? 'right' : 'left'
  const inForwardZone = ltr ? ratio > 1 - zone : ratio < zone
  const inBackwardZone = ltr ? ratio < zone : ratio > 1 - zone
  if (inForwardZone && state.canGoForward.value) {
    ensurePeel(forwardTrigger)
  } else if (inBackwardZone && state.canGoBack.value) {
    ensurePeel(backwardTrigger)
  } else {
    releasePeelNow()
  }
}

// 拖拽进度：按下点起算的位移占视口 60% 宽度为满程（trigger 'left' 指针向左拖）
function dragProgressFrom(clientX: number, rect: DOMRect, dragState: DragState): number {
  const scale = Math.max(1, rect.width * 0.6)
  const raw =
    dragState.trigger === 'left' ? dragState.startX - clientX : clientX - dragState.startX
  return Math.min(1, Math.max(0, raw / scale))
}

function onPointerDown(event: PointerEvent) {
  if (disabledRef.value || event.button !== 0) return
  const el = event.currentTarget as HTMLElement | null
  if (!el) return
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0) return
  // 放大状态：按住拖动为平移
  if (isZoomed()) {
    pan = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, moved: 0 }
    capturePointer(el, event.pointerId)
    return
  }
  if (!props.dragToFlip || state.isFlipping.value || sheetOwner === 'drag') return
  const ratio = (event.clientX - rect.left) / rect.width
  const ltr = props.forwardDirection === 'left'
  // 与点击翻页一致：LTR 右半前进、左半后退；RTL 相反
  const trigger: FlipDirection = ratio > 0.5 ? (ltr ? 'left' : 'right') : (ltr ? 'right' : 'left')
  const spec = computeFlipSpecFor(trigger)
  if (!spec) return
  if (!emitBeforeFlip(trigger, state.page.value, state.page.value + spec.delta)) return
  clearStackHover()
  state.startFlip()
  emit('flip-start', trigger)
  emit('pressed', { x: event.clientX - rect.left, y: event.clientY - rect.top })
  // 该方向的折角悬停已创建纸张：直接接管，避免重建
  if (!(sheetOwner === 'peel' && peelTrigger === trigger)) {
    // 翻页前置布局：相机由拖拽结束动画接管
    setStaticPages(spec.staticPages, (index) => textures.get(index) ?? null, false)
    applyStacksFlip(spec)
    const ok = beginDragFlip(
      spec,
      textures.get(spec.frontIndex) ?? null,
      textures.get(spec.backIndex) ?? null,
      makeSheetDone(spec, trigger),
      sheetOptions(spec),
    )
    if (!ok) {
      // 渲染不可用：立即回退状态，交互交由点击翻页兜底
      state.cancelFlip()
      emit('flip-end', trigger)
      return
    }
  }
  sheetOwner = 'drag'
  peelTrigger = null
  drag = {
    pointerId: event.pointerId,
    trigger,
    startX: event.clientX,
    lastX: event.clientX,
    lastT: event.timeStamp,
    velocity: 0,
    moved: 0,
    progress: 0,
  }
  capturePointer(el, event.pointerId)
}

function onPointerMove(event: PointerEvent) {
  if (pan && event.pointerId === pan.pointerId) {
    const dx = event.clientX - pan.lastX
    const dy = event.clientY - pan.lastY
    pan.lastX = event.clientX
    pan.lastY = event.clientY
    pan.moved += Math.abs(dx) + Math.abs(dy)
    if (pan.moved > 6) suppressClick = true
    panBy(dx, dy)
    return
  }
  if (drag && event.pointerId === drag.pointerId) {
    const el = event.currentTarget as HTMLElement | null
    const rect = el?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return
    const dt = Math.max(1, event.timeStamp - drag.lastT)
    const dx = event.clientX - drag.lastX
    // 沿翻页方向的速度：trigger 'left' 时向左为正
    const along = drag.trigger === 'left' ? -dx : dx
    drag.velocity = 0.75 * drag.velocity + 0.25 * (along / dt)
    drag.lastX = event.clientX
    drag.lastT = event.timeStamp
    drag.moved += Math.abs(dx)
    drag.progress = dragProgressFrom(event.clientX, rect, drag)
    setDragProgress(drag.progress)
    return
  }
  // 无按键悬停：纸叠提示优先于折角提示（两者都在视口边缘区域）
  if (event.buttons !== 0) return
  if (updateStackHover(event)) {
    releasePeelNow()
    return
  }
  updatePeel(event)
}

function onPointerUp(event: PointerEvent) {
  if (pan && event.pointerId === pan.pointerId) {
    pan = null
    return
  }
  const dragState = drag
  if (!dragState || event.pointerId !== dragState.pointerId) return
  const el = event.currentTarget as HTMLElement | null
  const rect = el?.getBoundingClientRect()
  drag = null
  if (dragState.moved > 6) suppressClick = true
  if (rect) {
    emit('released', { x: event.clientX - rect.left, y: event.clientY - rect.top })
  }
  const progress = rect ? dragProgressFrom(event.clientX, rect, dragState) : dragState.progress
  // 超过阈值，或朝翻页方向的快速甩动，都视为完成翻页
  const commit = progress > 0.45 || (dragState.velocity > 0.5 && progress > 0.08)
  endDragFlip(commit, safeFlipDuration.value)
}

function onPointerCancel(event: PointerEvent) {
  if (pan && event.pointerId === pan.pointerId) {
    pan = null
    return
  }
  if (drag && event.pointerId === drag.pointerId) {
    drag = null
    suppressClick = true
    endDragFlip(false, safeFlipDuration.value)
  }
}

function onPointerLeave() {
  if (!drag && !pan) {
    releasePeelNow()
    clearStackHover()
  }
}

// 滚轮缩放：级别按指数随滚轮增量变化
function onWheel(event: WheelEvent) {
  if (!props.zoomEnabled || disabledRef.value) return
  if (state.isFlipping.value || drag || sheetOwner !== null) return
  event.preventDefault()
  applyZoom(getZoom() * Math.exp(-event.deltaY * 0.0016))
}

// 双击切换缩放（dblClickZoom 开启时，单击翻页延迟判定避免误触）
function onDblClick() {
  if (!props.dblClickZoom || disabledRef.value) return
  clearClickTimer()
  if (state.isFlipping.value) return
  applyZoom(isZoomed() ? 1 : safeMaxZoom.value)
}

function applyZoom(level: number, animate = true) {
  const value = Number.isFinite(level) ? level : 1
  const clamped = Math.min(Math.max(value, 1), safeMaxZoom.value)
  setRendererZoom(clamped, animate)
  emit('zoom-change', clamped)
}

// 缩放实例方法
function zoomIn() {
  applyZoom(safeMaxZoom.value)
}

function zoomOut() {
  applyZoom(1)
}

function toggleZoom() {
  applyZoom(isZoomed() ? 1 : safeMaxZoom.value)
}

function setZoomLevel(level: number) {
  applyZoom(level)
}

// 中断当前翻页并立即收尾：拖拽按最近端点，动画按终点提交
function stop() {
  const wasDrag = drag !== null
  const wasPan = pan !== null
  drag = null
  pan = null
  if (wasDrag || wasPan) suppressClick = true
  clearClickTimer()
  clearStackHover()
  // stopFlip 同步触发 onDone 完成收尾（含缩放相机复位）
  stopFlip()
  if (sheetOwner === 'peel') {
    // 场景不可用导致未收尾时的兜底
    sheetOwner = null
    peelTrigger = null
    renderStatic()
  }
}

// 禁用/启用组件交互与翻页
function disable(value = true) {
  disabledRef.value = value !== false
  if (disabledRef.value) {
    // 收起折角悬停，避免禁用后残留掀起的页角
    releasePeelNow()
    clearClickTimer()
  }
}

// 光栅化单页：seq 过期（内容再次变化/卸载）时丢弃结果，旧纹理立即释放。
// 跨页项：整页光栅化一次得到基准纹理，左右两页各持有半图克隆（共享 GPU 数据）。
async function rasterizePage(index: number, seq: number) {
  const source = pageSources.value[index]
  if (!source || source.blank) return
  const el = pageEls.value[source.itemIndex]
  if (!el) return
  try {
    // 等待页内图片/背景图与字体就绪，避免光栅化出缺图/缺字的纹理
    await waitForResources(el, safeResourceTimeout.value)
    if (disposed || seq !== rasterSeq) return
    if (source.region === 'full') {
      const texture = await elementToTexture(
        el,
        safePixelRatio.value,
        props.pageBackground,
        props.cacheBust,
        maxAnisotropy.value,
      )
      if (disposed || seq !== rasterSeq) {
        texture.dispose()
        return
      }
      textures.get(index)?.dispose()
      textures.set(index, texture)
      applyStaticTexture(index, texture)
      return
    }
    // 跨页半图：整页基准纹理并发去重（左右两页共享同一 Promise）
    const itemIndex = source.itemIndex
    let basePromise = spreadBasePromises.get(itemIndex)
    if (!basePromise) {
      basePromise = elementToTexture(
        el,
        safePixelRatio.value,
        props.pageBackground,
        props.cacheBust,
        maxAnisotropy.value,
      )
      spreadBasePromises.set(itemIndex, basePromise)
    }
    let base: THREE.Texture
    try {
      base = await basePromise
    } catch (error) {
      spreadBasePromises.delete(itemIndex)
      throw error
    }
    if (disposed || seq !== rasterSeq) {
      if (spreadFullTextures.get(itemIndex) !== base) base.dispose()
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
    const merged = lastPlacements.find((p) => p.spread && p.index === index - (source.region === 'right' ? 1 : 0))
    if (merged) {
      applyStaticTexture(merged.index, base)
    } else {
      applyStaticTexture(index, half)
    }
  } catch (error) {
    if (disposed || seq !== rasterSeq) return
    console.warn(`[vue-turn] 第 ${index + 1} 页纹理生成失败`, error)
    emit('rasterize-error', index + 1, error)
  }
}

async function rasterizeAll() {
  const seq = ++rasterSeq
  // 等待离屏 DOM 完成最新内容的 patch，避免光栅化到旧内容
  await nextTick()
  if (disposed || seq !== rasterSeq) return
  const total = pageSources.value.length
  await Promise.all(Array.from({ length: total }, (_, index) => rasterizePage(index, seq)))
  if (disposed || seq !== rasterSeq) return
  renderStatic()
  if (!readyEmitted) {
    readyEmitted = true
    emit('ready')
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
  renderStatic()
  if (!readyEmitted) {
    readyEmitted = true
    emit('ready')
  }
}

// 手动重绘全部页面纹理（内容含异步资源时可在资源就绪后调用）
function refresh() {
  return rasterizeAll()
}

// 手动重绘指定页面纹理（页码从 1 开始）；翻页中排队，结束后补刷
async function refreshPage(page: number) {
  const index = Math.max(0, Math.round(page) - 1)
  if (index >= pageSources.value.length) return
  if (state.isFlipping.value) {
    pendingRaster = true
    return
  }
  const seq = rasterSeq
  await nextTick()
  if (disposed || seq !== rasterSeq) return
  await rasterizePage(index, seq)
  if (disposed || seq !== rasterSeq) return
  renderStatic()
}

// 离屏内容发生 DOM 变化时合并触发一次窗口内重光栅化；
// 翻页动画期间不打断，动画结束后补刷
function scheduleRaster() {
  if (disposed) return
  if (state.isFlipping.value) {
    pendingRaster = true
    return
  }
  if (rasterScheduled) return
  rasterScheduled = true
  void nextTick(() => {
    rasterScheduled = false
    if (!disposed) void rasterizeWindow(true)
  })
}

onMounted(async () => {
  state.setDisplayedPages(resolveDisplayedPages())
  // 先同步页数到状态机，再设置初始页：否则初始页码会被 0 页钳制到封面
  // （刷新页面带 /book/:page 深度链接时表现为回到第 1 页）
  syncPageCount()
  state.setNumPages(pageCount.value)
  const initial = props.modelValue ?? props.startPage
  state.goToPage((Number.isFinite(initial) ? Math.round(initial) : 1) - 1)
  if (offscreenEl.value) {
    mutationObserver = new MutationObserver(scheduleRaster)
    mutationObserver.observe(offscreenEl.value, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    })
  }
  await nextTick()
  // 初始页码同步完成后才允许 first/last 事件（避免挂载即触发）
  mountedDone = true
  // 懒光栅化：初始只生成当前窗口内纹理，缩短首屏耗时；窗口外按需预取
  await rasterizeWindow(false)
})

onUpdated(() => {
  syncPageCount()
})

onBeforeUnmount(() => {
  disposed = true
  rasterSeq++
  clearClickTimer()
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

// satisfies 约束：实例 API 与 TurnInstance 接口保持一致，防止两者漂移
defineExpose({
  flipLeft: () => flip('left'),
  flipRight: () => flip('right'),
  next,
  prev,
  goToPage,
  stop,
  disable,
  refresh,
  refreshPage,
  zoomIn,
  zoomOut,
  toggleZoom,
  setZoom: setZoomLevel,
  get page() {
    return state.page.value
  },
  get numPages() {
    return pageCount.value
  },
  get isFlipping() {
    return state.isFlipping.value
  },
  get canNext() {
    return state.canGoForward.value
  },
  get canPrev() {
    return state.canGoBack.value
  },
  get disabled() {
    return disabledRef.value
  },
  get zoom() {
    return getZoom()
  },
} satisfies TurnInstance)
</script>

<template>
  <div class="vue-turn">
    <div v-if="!webglSupported" class="webgl-fallback">
      <slot name="fallback">当前环境不支持 WebGL，无法展示 3D 翻页效果。</slot>
    </div>
    <div
      v-show="webglSupported"
      ref="container"
      class="viewport"
      role="group"
      :aria-label="ariaLabel"
      :tabindex="keyboard ? 0 : undefined"
      @click="onViewportClick"
      @dblclick="onDblClick"
      @wheel="onWheel"
      @keydown="onKeydown"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerCancel"
      @pointerleave="onPointerLeave"
    ></div>
    <div v-if="stackHover" class="stack-tooltip" :style="stackTooltipStyle" aria-hidden="true">
      {{ stackHover.page }}
    </div>
    <div ref="offscreenEl" class="offscreen-pages" aria-hidden="true">
      <div
        v-for="(item, index) in pageItems"
        :key="index"
        ref="pageEls"
        class="page-source"
        :style="{
          width: `${item.spread ? safePageWidth * 2 : safePageWidth}px`,
          height: `${safePageWidth / props.pageAspect}px`,
          background: props.pageBackground,
        }"
      >
        <VnodeHolder :vnode="item.vnode" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.vue-turn {
  position: relative;
  width: 100%;
  height: 100%;
  /* 父级未提供确定高度时按书本跨页比例兜底，避免组件塌陷；
     父级有确定高度时 height:100% 优先生效；比例可用 CSS 变量覆盖 */
  aspect-ratio: var(--vue-turn-ratio, 3 / 2);
}

.viewport {
  position: absolute;
  inset: 0;
  overflow: hidden;
  /* 指针拖拽翻页/平移时避免触摸滚动的干扰 */
  touch-action: none;
}

.viewport:focus-visible {
  outline: 2px solid rgba(96, 165, 250, 0.9);
  outline-offset: -2px;
}

.viewport :deep(canvas) {
  display: block;
  width: 100%;
  height: 100%;
}

.webgl-fallback {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  text-align: center;
  color: #e8ecf4;
  background: rgba(20, 24, 33, 0.6);
  font-size: 15px;
}

.stack-tooltip {
  position: absolute;
  z-index: 2;
  padding: 2px 8px;
  border-radius: 4px;
  color: #e8ecf4;
  background: rgba(20, 24, 33, 0.82);
  font-size: 12px;
  line-height: 18px;
  pointer-events: none;
  white-space: nowrap;
  transform: translateY(-50%);
}

.offscreen-pages {
  position: fixed;
  top: 0;
  left: -100000px;
  pointer-events: none;
}

.page-source {
  overflow: hidden;
}
</style>
