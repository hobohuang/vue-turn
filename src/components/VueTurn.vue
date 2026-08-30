﻿<script lang="ts">
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
  onMounted,
  onUpdated,
  ref,
  useSlots,
  watch,
} from 'vue'

import TurnItem from '@/components/TurnItem.vue'
import { useBookState } from '@/composables/useBookState'
import { useFlipInteraction } from '@/composables/useFlipInteraction'
import { usePageTextures, type PageSource } from '@/composables/usePageTextures'
import { useTurnRenderer } from '@/composables/useTurnRenderer'
import { pageWidth as pageWidthOf, spreadLayout, computeFlipSpec } from '@/lib/flipSpec'
import { resolveFold, resolveLook } from '@/lib/presets'
import {
  computeStackSides,
  isCenteredLayout,
  STACK_COMPACT,
  stackThickness,
  type StackSide,
  type StackSides,
} from '@/lib/pageStack'
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
  TurnPreset,
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
    /** 观感预设（纸张类型）：soft 普通纸张哑光（默认）、hard 纸板刚体强光泽、custom 自定义；soft/hard 档位值最高优先级（下列专业参数不生效），仅 custom 档可逐项设置 */
    preset?: TurnPreset
    /** 封面/封底观感预设（默认 hard 纸板）：控制封面与封底的纸张（卷曲/折角/网格密度）与光影（独立灯光组）；perspective 为全局相机参数不按页生效 */
    coverPreset?: TurnPreset
    /** 翻页网格纵向分段数，越大卷曲越平滑（仅 preset="custom" 时生效，未传回退 custom 基线 64） */
    nPolygons?: number
    /** 透视参考距离（像素），越小透视越强（仅 preset="custom" 时生效，未传回退 2400） */
    perspective?: number
    /** 环境光强度（仅 preset="custom" 时生效，未传回退 1） */
    ambient?: number
    /** 方向光（纸张光泽）强度（仅 preset="custom" 时生效，未传回退 0.15） */
    gloss?: number
    /** 卷曲幅度（0 为纯刚体旋转）（仅 preset="custom" 时生效，未传回退 0.8） */
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
    /** 悬停预览总开关：开启后指针移入页面边缘显示预览——fold 开启时为四边折角预览，关闭时为视口边缘条带整页轻卷 */
    peel?: boolean
    /** 折角提示区域宽度占视口宽度的比例（两侧边缘条带，0~0.5，仅 fold 关闭时的整页卷曲预览使用） */
    peelZone?: number
    /** 折角交互（turn.js 4 风格）：开启时外缘条带悬停预览与按下拖拽均为真实折角变形；关闭时全部为整页卷曲（仅 preset="custom" 时生效，soft 开启 / hard 关闭） */
    fold?: boolean
    /** 折角柔软度：折线圆弧过渡宽度占页宽比例，越大越柔软（仅 preset="custom" 时生效，未传回退 0.16） */
    bend?: number
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
    preset: 'soft',
    coverPreset: 'hard',
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
    peel: false,
    peelZone: 0.12,
    /** 角点拖拽折角（turn.js 4 风格）：未传时取 preset 默认（soft 开启，hard 关闭） */
    fold: undefined,
    maxZoom: 3,
    zoomEnabled: false,
    dblClickZoom: false,
    stack: true,
    stackDepth: 0.02,
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
  pressed: [point: { x: number; y: number }]
  /** 拖拽翻页松开（视口内坐标） */
  released: [point: { x: number; y: number }]
  /** 缩放级别变化 */
  'zoom-change': [level: number]
  /** 点击命中页面热区 */
  'region-tap': [page: number, region: PageRegion]
  /** 首次纹理就绪 */
  ready: []
  /** 单页光栅化失败 */
  'rasterize-error': [page: number, error: unknown]
  /** 悬停纸叠层（page 为 null 表示离开），point 为视口内坐标 */
  'stack-hover': [page: number | null, point?: { x: number; y: number }]
  /** 点击纸叠层跳转 */
  'stack-tap': [page: number]
}>()

// 几何参数挂载时读取一次（运行时修改不生效）：pageAspect 需做 NaN/零/负值校验，
// 否则离屏页高度（safePageWidth / aspect）等派生值会得到 Infinity/NaN
const safePageAspect = Number.isFinite(props.pageAspect) && props.pageAspect > 0
  ? props.pageAspect
  : 0.75

const state = useBookState()

// 封面/封底观感：coverPreset 独立解析（挂载时读取一次）。soft/hard 取档位值；
// custom 档与内页共用同一组自定义参数。摄像头 perspective 为全局参数，
// 不按页生效，此处仅取光影与纸张参数
const coverLook = resolveLook(props.coverPreset, {
  nPolygons: props.nPolygons,
  perspective: props.perspective,
  ambient: props.ambient,
  gloss: props.gloss,
  curl: props.curl,
})

const renderer = useTurnRenderer({
  pageAspect: safePageAspect,
  // 观感参数：soft/hard 取档位值（显式传入不生效），仅 custom 档采用显式参数
  ...resolveLook(props.preset, {
    nPolygons: props.nPolygons,
    perspective: props.perspective,
    ambient: props.ambient,
    gloss: props.gloss,
    curl: props.curl,
  }),
  // 封面/封底光影：coverPreset 独立灯光组
  coverAmbient: coverLook.ambient,
  coverGloss: coverLook.gloss,
  fitMargin: props.fitMargin,
  maxPixelRatio: props.maxPixelRatio,
  maxZoom: props.maxZoom,
  easing: props.easing,
  onContextRestored: () => {
    // 上下文恢复后重建静态页并强制重光栅化窗口内纹理
    renderStatic()
    void rasterizeWindow(true)
  },
})

const {
  container,
  containerSize,
  webglSupported,
  maxAnisotropy,
  setStaticPages,
  applyStaticTexture,
  setCoverPages,
  setStacks,
  startFlip,
  startFoldFlip,
  getZoom,
} = renderer

const slots = useSlots()

// 在模板渲染期收集 turn-item vnode（展平 v-for 产生的 Fragment），
// 非 turn-item 子节点忽略并提示。必须在渲染函数内调用插槽，
// 才能让父组件的内容变化正常触发本组件更新
let warnedInvalidChild = false
interface PageItem {
  vnode: VNode
  spread: boolean
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
        const regions = node.props?.regions
        result.push({
          vnode: node,
          spread: rawSpread !== undefined && rawSpread !== null && rawSpread !== false,
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
const pageSources = computed<PageSource[]>(() => {
  const sources: PageSource[] = []
  const items = pageItems.value
  if (items.length === 0) return sources
  // 首个 item 视为封面，固定单页居中
  sources.push({ itemIndex: 0, region: 'full', blank: false, cover: true })
  let pageIndex = 1
  for (let itemIndex = 1; itemIndex < items.length; itemIndex++) {
    const item = items[itemIndex]
    if (!item) continue
    if (item.spread) {
      // 跨页需从奇数索引（左页）开始；落在偶数索引时插入空白页补位
      if (pageIndex % 2 === 0) {
        sources.push({ itemIndex: -1, region: 'full', blank: true, cover: false })
        pageIndex++
      }
      sources.push({ itemIndex, region: 'left', blank: false, cover: false })
      sources.push({ itemIndex, region: 'right', blank: false, cover: false })
      pageIndex += 2
    } else {
      sources.push({ itemIndex, region: 'full', blank: false, cover: false })
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
      sources.push({ itemIndex: -1, region: 'full', blank: true, cover: false })
    } else {
      const insertAt = sources.findIndex((s) => s.itemIndex === last.itemIndex)
      if (insertAt > 0) {
        sources.splice(insertAt, 0, { itemIndex: -1, region: 'full', blank: true, cover: false })
      }
    }
  }
  // 末个 item 视为封底：其占用的所有页标记为 cover
  const lastItemIndex = items.length - 1
  for (const source of sources) {
    if (source.itemIndex === lastItemIndex) source.cover = true
  }
  return sources
})

const offscreenEl = ref<HTMLElement | null>(null)
// 组件根元素：document 键盘监听据此排除组件内部目标（已由 viewport 处理）
const rootEl = ref<HTMLElement | null>(null)
// 本实例标识：多实例时最近交互过的实例获得 document 级键盘响应权
const instanceToken: object = {}
const pageEls = ref<HTMLElement[]>([])
const pageCount = ref(0)
// v-model 跳转目标：翻页中推迟到动画结束
let pendingTarget: number | null = null

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
  // 非法值回退默认值 0.02（与 prop 默认值一致，而非任意常数）
  return Number.isFinite(value) && value > 0 ? Math.min(value, 0.5) : 0.02
})

// 折角（fold）参数挂载时读取一次（运行时修改不生效，与场景观感参数策略一致）：
// soft/hard 档取预设值；仅 custom 档由 fold/bend prop 设置。
// bend 为折线圆弧过渡占页宽比例
const foldParams = resolveFold(props.preset, props.fold, props.bend)
const foldBendWorld = foldParams.bend * pageWidthOf(safePageAspect)

// ---------------------------------------------------------------------------
// 纹理生命周期与光栅化调度（usePageTextures）
// ---------------------------------------------------------------------------

const {
  textures,
  getSpreadFullTexture,
  syncPageCount,
  rasterizeWindow,
  releaseOutsideWindow,
  refresh,
  refreshPage,
} = usePageTextures({
  pageSources,
  pageEls,
  offscreenEl,
  pageCount,
  currentPage: state.currentPage,
  displayedPages: state.displayedPages,
  isFlipping: state.isFlipping,
  pixelRatio: safePixelRatio,
  resourceTimeout: safeResourceTimeout,
  prefetchWindow: safePrefetchWindow,
  pageBackground: () => props.pageBackground,
  cacheBust: () => props.cacheBust,
  maxAnisotropy,
  applyStaticTexture,
  renderStatic,
  getLastPlacements: () => lastPlacements,
  onReady: () => emit('ready'),
  onRasterizeError: (page, error) => emit('rasterize-error', page, error),
})

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

// v-model：外部页码变化时跳转；翻页中则推迟到动画结束。
// 与 goToPage 一致走 before-flip 拦截，被取消时回写当前页码纠正外部状态
watch(
  () => props.modelValue,
  (value) => {
    if (value === undefined) return
    const target = Number.isFinite(value) ? Math.round(value) - 1 : 0
    if (target === state.currentPage.value) return
    if (!emitBeforeFlip(null, state.page.value, target + 1)) {
      emit('update:modelValue', state.page.value)
      return
    }
    if (state.isFlipping.value) {
      pendingTarget = target
    } else {
      jumpTo(target)
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
      jumpTo(target)
    }
  },
)

// 最近一次静态布局：rasterizePage 完成后按此判断该把整图还是半图贴到现有网格
let lastPlacements: StaticPlacement[] = []

// ---------------------------------------------------------------------------
// 纸叠：书本左右两侧的页层厚度条带（厚度随翻页在两侧间转移）
// ---------------------------------------------------------------------------

// 纸叠页面映射的统一计算入口：stackVisualFor（渲染几何）与
// currentStackSides（悬停命中换算页码）共用，避免两处参数漂移
function stackSidesFor(pageIndex: number): StackSides {
  return computeStackSides({
    currentPage: pageIndex,
    displayedPages: state.displayedPages.value,
    forwardDirection: props.forwardDirection,
    numPages: pageCount.value,
    sheetWidth: pageWidthOf(safePageAspect),
  })
}

// 某页状态下的纸叠渲染几何
function stackVisualFor(pageIndex: number): StackVisual {
  const width = pageWidthOf(safePageAspect)
  const sides = stackSidesFor(pageIndex)
  const maxDepth = width * safeStackDepth.value
  // 合页（居中单页）状态书页全部压紧叠放，条带按压实系数收窄；
  // 翻开状态的纸叠页边微张，保持蓬松厚度
  const compact = isCenteredLayout(pageIndex, state.displayedPages.value, pageCount.value)
    ? STACK_COMPACT
    : 1
  const toVisual = (side: StackSide | null) =>
    side
      ? {
          edgeX: side.edgeX,
          dir: side.dir,
          thickness: stackThickness(side.count, pageCount.value, maxDepth) * compact,
          layers: side.count,
        }
      : null
  return { left: toVisual(sides.left), right: toVisual(sides.right) }
}

// 空闲布局：纸叠吸附到当前页状态
function applyStacksIdle() {
  setStacks(props.stack ? stackVisualFor(state.currentPage.value) : null)
}

// 翻页前置布局：纸叠随动画从当前状态过渡到目标状态。
// 封底开合期间封底页在空中翻动，不属于纸叠——它平躺时计入的
// 那一层在 from/to 中清除，避免动画中右侧出现悬浮细线
function applyStacksFlip(spec: FlipSpec) {
  if (!props.stack) {
    setStacks(null)
    return
  }
  const from = stackVisualFor(state.currentPage.value)
  const to = stackVisualFor(state.currentPage.value + spec.delta)
  const last = pageCount.value - 1
  if (spec.frontIndex === last || spec.backIndex === last) {
    const side = props.forwardDirection === 'left' ? 'right' : 'left'
    from[side] = null
    to[side] = null
  }
  setStacks(from, to)
}

// 纸叠开关/厚度变化：空闲时立即生效（翻页中由结束后 renderStatic 收敛）
watch([() => props.stack, safeStackDepth], () => {
  if (!state.isFlipping.value) applyStacksIdle()
})

// 当前布局下的纸叠页面映射（悬停命中换算页码用）
const currentStackSides = computed(() => stackSidesFor(state.currentPage.value))

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
  // 同步封面/封底索引：静态页与后续翻页纸张据此挂封面图层
  setCoverPages(sources.reduce<number[]>((acc, s, i) => (s.cover ? [...acc, i] : acc), []))
  setStaticPages(merged, (index) => {
    if (spreadStarts.has(index)) {
      const source = sources[index]
      if (!source) return null
      // 跨页整图基准纹理以 itemIndex 为 key（与单页纹理的页索引 key 不同）
      return getSpreadFullTexture(source.itemIndex)
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

// 封面/封底按 coverPreset 翻页：正反任一为封面时采用封面档卷曲与网格密度；
// 光影由场景封面灯光组按面独立照亮，不在此处传递
function sheetOptions(spec: FlipSpec): FlipSheetOptions {
  const sources = pageSources.value
  const cover = [spec.frontIndex, spec.backIndex].some((index) => sources[index]?.cover)
  return cover ? { curl: coverLook.curl, nPolygons: coverLook.nPolygons } : {}
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
    pageAspect: safePageAspect,
    numPages: pageCount.value,
  })
}

// ---------------------------------------------------------------------------
// 指针交互状态机（useFlipInteraction）
// ---------------------------------------------------------------------------

const {
  disabledRef,
  onViewportClick,
  onDblClick,
  onWheel,
  onKeydown,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onPointerLeave,
  stackHover,
  stackTooltipStyle,
  discardPeel,
  releasePeelNow,
  clearStackHover,
  stop,
  disable,
  zoomIn,
  zoomOut,
  toggleZoom,
  setZoomLevel,
} = useFlipInteraction({
  props,
  state,
  emit,
  renderer,
  textures,
  pageCount,
  containerSize,
  webglSupported,
  rootEl,
  instanceToken,
  safePageAspect,
  safeFlipDuration,
  safePeelZone,
  safeMaxZoom,
  foldEnabled: foldParams.enabled,
  foldBendWorld,
  pageSources,
  regionsOf: (itemIndex) => pageItems.value[itemIndex]?.regions ?? [],
  getLastPlacements: () => lastPlacements,
  currentStackSides,
  sheetOptions,
  computeFlipSpecFor,
  emitBeforeFlip,
  next: () => next(),
  prev: () => prev(),
  goToPage: (page: number) => goToPage(page),
  renderStatic,
  applyStacksFlip,
  rasterizeWindow,
  releaseOutsideWindow,
})

// ---------------------------------------------------------------------------
// 翻页编排
// ---------------------------------------------------------------------------

function flip(trigger: FlipDirection) {
  if (disabledRef.value) return
  // 守卫与 spec 计算统一走 computeFlipSpecFor，避免与拖拽路径的判定漂移
  const spec = computeFlipSpecFor(trigger)
  if (!spec) return
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
  // fold 开启时走折页动画（锚点外缘中部、竖直折线扫过整页），场景不可用
  // 或 fold 关闭回退卷曲动画
  if (
    !foldParams.enabled ||
    !startFoldFlip(
      spec,
      textures.get(spec.frontIndex) ?? null,
      textures.get(spec.backIndex) ?? null,
      safeFlipDuration.value,
      onDone,
      sheetOptions(spec),
      foldBendWorld,
    )
  ) {
    startFlip(
      spec,
      textures.get(spec.frontIndex) ?? null,
      textures.get(spec.backIndex) ?? null,
      safeFlipDuration.value,
      onDone,
      sheetOptions(spec),
    )
  }
}

function next() {
  flip(props.forwardDirection)
}

function prev() {
  flip(props.forwardDirection === 'left' ? 'right' : 'left')
}

// 跳转统一出口：切页后目标页可能落在懒光栅化窗口外（静态布局拿到
// null 纹理而空白），须补生成窗口内纹理并释放窗口外显存
function jumpTo(target: number) {
  state.goToPage(target)
  void rasterizeWindow(false).then(() => releaseOutsideWindow())
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
  jumpTo(target)
  return true
}

// ---------------------------------------------------------------------------
// 生命周期
// ---------------------------------------------------------------------------

onMounted(async () => {
  state.setDisplayedPages(resolveDisplayedPages())
  // 先同步页数到状态机，再设置初始页：否则初始页码会被 0 页钳制到封面
  // （刷新页面带 /book/:page 深度链接时表现为回到第 1 页）
  syncPageCount()
  state.setNumPages(pageCount.value)
  const initial = props.modelValue ?? props.startPage
  state.goToPage((Number.isFinite(initial) ? Math.round(initial) : 1) - 1)
  await nextTick()
  // 初始页码同步完成后才允许 first/last 事件（避免挂载即触发）
  mountedDone = true
  // 懒光栅化：初始只生成当前窗口内纹理，缩短首屏耗时；窗口外按需预取
  await rasterizeWindow(false)
})

onUpdated(() => {
  syncPageCount()
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
  <div ref="rootEl" class="vue-turn">
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
          height: `${safePageWidth / safePageAspect}px`,
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
