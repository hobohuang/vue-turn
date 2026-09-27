﻿﻿﻿﻿﻿﻿﻿﻿<script lang="ts">
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
  computed,
  nextTick,
  onMounted,
  onUpdated,
  reactive,
  readonly,
  ref,
  shallowRef,
  useSlots,
  watch,
} from 'vue'

import { useBookState } from '@/composables/useBookState'
import { useFlipInteraction } from '@/composables/useFlipInteraction'
import { useFoldProfiles } from '@/composables/useFoldProfiles'
import { usePageSources } from '@/composables/usePageSources'
import { usePageStack } from '@/composables/usePageStack'
import { usePageTextures } from '@/composables/usePageTextures'
import { useTurnRenderer } from '@/composables/useTurnRenderer'
import { ZOOM_TOLERANCE } from '@/composables/useZoomPan'
import { spreadLayout, computeFlipSpec, mergeSpreadPlacements } from '@/lib/flipSpec'
import { positive } from '@/lib/math'
import { buildPageSources, coverPageIndices } from '@/lib/pageMapping'
import { mergeLook, resolveFold, resolveLook } from '@/lib/presets'
import type {
  BeforeFlipContext,
  DisplayMode,
  FlipDirection,
  FlipSheetOptions,
  FlipSpec,
  LookOptions,
  PageRegion,
  SheetFoldOptions,
  StaticPlacement,
  TurnInstance,
  TurnPreset,
  ZoomMode,
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
    /** 观感预设（纸张类型）：为专业渲染参数提供成组基线——soft 普通纸张哑光（默认）、hard 纸板刚体强光泽、custom 自定义；look 可逐项覆盖 */
    preset?: TurnPreset
    /** 封面/封底观感预设（默认 hard 纸板）：控制封面与封底的纸张（卷曲/折角/网格密度）与光影（独立灯光组）；coverLook 可逐项覆盖 */
    coverPreset?: TurnPreset
    /** 内页观感与折页参数（逐项覆盖 preset 基线）。perspective 为全局相机参数，仅此处生效 */
    look?: LookOptions
    /** 封面/封底观感与折页参数（逐项覆盖 coverPreset 基线，未传项回退 look）；perspective 为全局参数在此无效 */
    coverLook?: LookOptions
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
    /** 是否允许点击视口翻页（跟随阅读方向：LTR 右半前进，RTL 左半前进） */
    clickToFlip?: boolean
    /** 点击翻页中间死区宽度占比（0~0.5）：视口中轴该比例区域内的点击不翻页 */
    clickDeadZone?: number
    /** 是否允许键盘翻页（方向键/PageUp/PageDown/Space/Home/End，需先聚焦组件） */
    keyboard?: boolean
    /** 全局键盘兜底：焦点不在组件内（如点击了外部工具栏）时也响应翻页键。
     *  开启后会在 document 级拦截方向键/空格等按键（影响宿主页面滚动），
     *  多实例时仅最近交互的实例响应；默认关闭，仅在确有需求时开启 */
    globalKeyboard?: boolean
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
    /** 悬停预览总开关：开启后显示悬停预览——fold 开启时为四角折角预览（仅页面四角区域），关闭时为视口边缘条带整页轻卷 */
    peel?: boolean
    /** 最大缩放倍数 */
    maxZoom?: number
    /** 缩放手势模式：'off' 关闭（默认）、'wheel' 滚轮步进、'dblclick' 双击切换
     *  （开启双击后单击翻页会延迟约 260ms 以区分双击）、'both' 两者都开。
     *  命名避开实例暴露的只读 zoom（当前缩放级别） */
    zoomMode?: ZoomMode
    /** 是否显示书本左右两侧的纸叠（页层厚度条带，厚度随翻页变化，可悬停/点击跳页） */
    stack?: boolean
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
    globalKeyboard: false,
    ariaLabel: '翻书',
    cacheBust: true,
    prefetchWindow: 4,
    resourceTimeout: 5000,
    dragToFlip: true,
    peel: false,
    maxZoom: 3,
    zoomMode: 'off',
    stack: true,
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

// 数值 prop 校验：非法值（NaN/非有限/非正）回退默认值（lib/math 共享实现）
const safeFlipDuration = computed(() => positive(props.flipDuration, 900))
const safePageWidth = computed(() => positive(props.pageWidth, 768))
const safePixelRatio = computed(() => positive(props.pixelRatio, 1))
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

const state = useBookState()

// 观感解析（挂载时读取一次）：preset/coverPreset 档位为基线，look/coverLook
// 逐项覆盖；封面未传项逐项回退内页 look
const innerLook = resolveLook(props.preset, props.look)
const coverLookOptions = mergeLook(props.coverLook, props.look)
const coverLook = resolveLook(props.coverPreset, coverLookOptions)

const renderer = useTurnRenderer({
  pageAspect: safePageAspect,
  // 内页观感参数：preset 基线 + look 覆盖
  ...innerLook,
  // 封面/封底光影：coverPreset 独立灯光组
  coverAmbient: coverLook.ambient,
  coverGloss: coverLook.gloss,
  fitMargin: props.fitMargin,
  // 传入校验后的值并 watch 同步：maxZoom 为交互参数（非挂载冻结的观感
  // 参数），运行时修改应生效，避免交互层钳制与场景钳制漂移
  maxZoom: safeMaxZoom.value,
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

// 页面收集与面映射（插槽 → turn-item → 正/背面序列）：
// 纯领域逻辑见 composables/usePageSources.ts
const { pageFaces } = usePageSources(slots)

// 页源映射：封面/封底各占专用纸张（背面=#back 内容或空白衬页）、跨页
// 奇数对齐补位、内页区段奇数补偶（纯函数实现见 lib/pageMapping.ts，含单测）
const pageSources = computed(() => buildPageSources(pageFaces.value))

const offscreenEl = ref<HTMLElement | null>(null)
// 组件根元素：document 键盘监听据此排除组件内部目标（已由 viewport 处理）
const rootEl = ref<HTMLElement | null>(null)
// 本实例标识：多实例时最近交互过的实例获得 document 级键盘响应权
const instanceToken: object = {}
// 缩放级别镜像：state.zoom 的响应式来源（级别本身存在场景内，非响应式源）。
// 全部变化来源（滚轮/双击/实例方法经交互层 onZoomChange、翻页复位、
// maxZoom 收敛）都汇入此 ref
const zoomLevel = ref(1)
const pageEls = ref<HTMLElement[]>([])
const pageCount = ref(0)
// v-model 跳转目标：翻页中推迟到动画结束
let pendingTarget: number | null = null

// maxZoom 运行时变化同步到场景（挂载时已传 safeMaxZoom 初始值）；
// 级别超出新上限时场景立即收敛，收敛不发 zoom-change，此处补镜像与事件
watch(safeMaxZoom, (value) => {
  renderer.setMaxZoom(value)
  const level = getZoom()
  if (zoomLevel.value !== level) {
    zoomLevel.value = level
    emit('zoom-change', level)
  }
})

// 开发期提示：观感/几何参数挂载时冻结（与场景初始化策略一致），运行时
// 修改不生效也不报错——业务方最容易踩的"改了没反应"静默坑
if (import.meta.env.DEV) {
  watch(
    () => [props.pageAspect, props.fitMargin, props.preset, props.coverPreset, props.look, props.coverLook],
    () => {
      console.warn(
        '[vue-turn] 观感/几何参数（preset/coverPreset/look/coverLook/pageAspect/fitMargin）' +
          '在挂载时冻结，运行时修改不生效；如需变更请用 key 重建组件',
      )
    },
  )
}

// 折页档位（内页按 preset/look、封面/封底纸张按 coverPreset/coverLook 各取一档，
// 挂载时读取一次）：解析与归属判定见 composables/useFoldProfiles.ts
const { isCoverSheet, foldOfSpec, foldOfPage } = useFoldProfiles({
  innerFold: resolveFold(props.preset, props.look),
  coverFold: resolveFold(props.coverPreset, coverLookOptions),
  pageSources: () => pageSources.value,
  pageAspect: safePageAspect,
})

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
  getLastPlacements: () => lastPlacements.value,
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

// 翻页/拖拽进行中收到的显示模式变化推迟到动画结束再应用：进行中翻页的
// spec 按旧模式计算，中途切换会让 clampAndAlign 与 delta 的页码语义错位
// （提交后落在错位跨页上）。与 v-model 跳转的 pendingTarget 同一策略；
// 应用时按最新容器尺寸重新解析，避免用到动画期间的过期快照
let pendingDisplayedPagesResolve = false

watch(
  () => [containerSize.width, containerSize.height, props.displayedPages] as const,
  () => {
    if (state.isFlipping.value) {
      pendingDisplayedPagesResolve = true
      return
    }
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
    // 动画期间积压的显示模式变化先应用（重排当前页），再执行积压的跳转
    if (pendingDisplayedPagesResolve) {
      pendingDisplayedPagesResolve = false
      state.setDisplayedPages(resolveDisplayedPages())
    }
    if (pendingTarget !== null) {
      const target = pendingTarget
      pendingTarget = null
      jumpTo(target)
    }
  },
)

// 最近一次静态布局：rasterizePage 完成后按此判断该把整图还是半图贴到
// 现有网格；消费方（纹理/交互层）在调用时点读取，不做响应式依赖
const lastPlacements = shallowRef<StaticPlacement[]>([])

// ---------------------------------------------------------------------------
// 纸叠：书本左右两侧的页层厚度条带（厚度随翻页在两侧间转移）
// （渲染几何与翻页过渡的计算见 composables/usePageStack.ts）
// ---------------------------------------------------------------------------

const { applyStacksIdle, applyStacksFlip, currentStackSides } = usePageStack({
  state,
  pageCount,
  safePageAspect,
  stackEnabled: () => props.stack,
  forwardDirection: () => props.forwardDirection,
  setStacks,
})

function renderStatic() {
  if (state.isFlipping.value) return
  const placements = spreadLayout({
    currentPage: state.currentPage.value,
    displayedPages: state.displayedPages.value,
    forwardDirection: props.forwardDirection,
    numPages: pageCount.value,
  })
  // 跨页合并：左右两页同属一个跨页项时渲染为一张双倍宽度的居中整页
  // （纯函数实现见 lib/flipSpec.ts，含单测）
  const merged = mergeSpreadPlacements(placements, pageSources.value)
  lastPlacements.value = merged
  // 跨页起始页索引集合：这些索引的静态网格用整页纹理
  const spreadStarts = new Set(merged.filter((p) => p.spread).map((p) => p.index))
  // 同步封面/封底索引：静态页与后续翻页纸张据此挂封面图层
  setCoverPages(coverPageIndices(pageSources.value))
  setStaticPages(merged, (index) => {
    if (spreadStarts.has(index)) {
      const source = pageSources.value[index]
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
  return isCoverSheet([spec.frontIndex, spec.backIndex])
    ? { curl: coverLook.curl, nPolygons: coverLook.nPolygons }
    : {}
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
  onZoomChange: (level) => {
    zoomLevel.value = level
  },
  renderer,
  query: {
    textures,
    pageCount,
    containerSize,
    webglSupported,
    rootEl,
    instanceToken,
    safePageAspect,
    safeFlipDuration,
    safeMaxZoom,
    pageSources,
    currentStackSides,
    getLastPlacements: () => lastPlacements.value,
    regionsOf: (itemIndex: number) => pageFaces.value[itemIndex]?.regions ?? [],
    foldOfSpec,
    foldOfPage,
    sheetOptions,
    computeFlipSpecFor,
  },
  actions: {
    emitBeforeFlip,
    next: () => next(),
    prev: () => prev(),
    goToPage: (page: number) => goToPage(page),
    renderStatic,
    applyStacksFlip,
    rasterizeWindow,
    releaseOutsideWindow,
  },
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
    if (prevZoom > 1 + ZOOM_TOLERANCE) {
      zoomLevel.value = 1
      emit('zoom-change', 1)
    }
    // 懒光栅化：翻页结束后预取新窗口内缺失纹理，再释放窗口外纹理控制显存
    void rasterizeWindow(false).then(() => releaseOutsideWindow())
  }
  // fold 开启时走折页动画（锚点外缘中部、竖直折线扫过整页），场景不可用
  // 或该纸张所属档位 fold 关闭（如 hard 封面）回退卷曲动画
  const fold = foldOfSpec(spec)
  if (
    !fold.enabled ||
    !startFoldFlip(
      spec,
      textures.get(spec.frontIndex) ?? null,
      textures.get(spec.backIndex) ?? null,
      safeFlipDuration.value,
      onDone,
      sheetOptions(spec),
      fold.bendWorld,
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
// 响应式状态快照：readonly 代理使运行时写入告警，getter 读取时触发依赖收集
const instanceState = readonly(
  reactive({
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
      return zoomLevel.value
    },
  }),
)

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
  state: instanceState,
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
      <!-- :key 必须保持位置索引：pageEls 数组按下标对齐 pageSources[itemIndex]，
           Vue 的 v-for ref 数组不保证顺序，仅位置键（增删只动尾部）下可靠 -->
      <div
        v-for="(face, index) in pageFaces"
        :key="index"
        ref="pageEls"
        class="page-source"
        :style="{
          width: `${face.spread ? safePageWidth * 2 : safePageWidth}px`,
          height: `${safePageWidth / safePageAspect}px`,
          background: props.pageBackground,
        }"
      >
        <VnodeHolder :vnode="face.vnode" />
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
