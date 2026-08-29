import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import type * as THREE from 'three'

import type { PagePick } from '@/lib/TurnScene'
import { PAGE_HEIGHT, pageWidth as pageWidthOf } from '@/lib/flipSpec'
import { pageAtFraction, type StackSide, type StackSides } from '@/lib/pageStack'
import type {
  FlipDirection,
  FlipSheetOptions,
  FlipSpec,
  PageRegion,
  StaticPlacement,
  ViewportPoint,
} from '@/types/turn'

import type { useBookState } from './useBookState'
import type { PageSource } from './usePageTextures'
import type { useTurnRenderer } from './useTurnRenderer'

// document 级键盘监听的多实例互斥：页面上有多个 vue-turn 时，
// 仅最近交互过的实例响应 document 级按键，避免一次方向键所有书同时翻页
let docKeyboardOwner: object | null = null
let turnInstanceCount = 0

// 折角条带：页面四边外缘（左右外缘条带 + 顶/底条带）
// （跨页合并网格左右按半宽折算）
const FOLD_ZONE = 0.22
// 整页轻卷悬停的最大进度
const PEEL_PROGRESS = 0.07
// 双击缩放开启时，单击翻页延迟判定的窗口期
const CLICK_DISAMBIGUATION_MS = 260

/** 交互层关注的 props 子集（值由编排层传入，保持响应式） */
export interface FlipInteractionProps {
  keyboard?: boolean
  clickToFlip?: boolean
  clickDeadZone?: number
  dblClickZoom?: boolean
  zoomEnabled?: boolean
  dragToFlip?: boolean
  peel?: boolean
  peelZone?: number
  stack?: boolean
  forwardDirection?: FlipDirection
}

/** 交互层派发的事件（与组件 emits 的对应签名子集） */
export interface FlipInteractionEmits {
  (event: 'flip-start', direction: FlipDirection): void
  (event: 'flip-end', direction: FlipDirection): void
  (event: 'pressed', point: ViewportPoint): void
  (event: 'released', point: ViewportPoint): void
  (event: 'region-tap', page: number, region: PageRegion): void
  (event: 'stack-hover', page: number | null, point?: ViewportPoint): void
  (event: 'stack-tap', page: number): void
  (event: 'zoom-change', level: number): void
}

export interface FlipInteractionOptions {
  props: FlipInteractionProps
  state: ReturnType<typeof useBookState>
  emit: FlipInteractionEmits
  renderer: ReturnType<typeof useTurnRenderer>
  textures: Map<number, THREE.Texture>
  pageCount: Ref<number>
  containerSize: { width: number; height: number }
  webglSupported: Ref<boolean>
  rootEl: Ref<HTMLElement | null>
  /** 本实例标识：多实例时最近交互过的实例获得 document 级键盘响应权 */
  instanceToken: object
  safePageAspect: number
  safeFlipDuration: ComputedRef<number>
  safePeelZone: ComputedRef<number>
  safeMaxZoom: ComputedRef<number>
  /** fold 交互是否启用（preset 解析结果，挂载期冻结） */
  foldEnabled: boolean
  foldBendWorld: number
  pageSources: ComputedRef<PageSource[]>
  /** item 索引 → 热区配置（无热区返回空数组） */
  regionsOf: (itemIndex: number) => PageRegion[]
  /** 最近一次静态布局（由编排层提供） */
  getLastPlacements: () => StaticPlacement[]
  /** 当前布局下的纸叠页面映射（悬停命中换算页码用） */
  currentStackSides: ComputedRef<StackSides>
  sheetOptions: (spec: FlipSpec) => FlipSheetOptions
  computeFlipSpecFor: (trigger: FlipDirection) => FlipSpec | null
  emitBeforeFlip: (direction: FlipDirection | null, from: number, to: number) => boolean
  next: () => void
  prev: () => void
  goToPage: (page: number) => boolean
  renderStatic: () => void
  applyStacksFlip: (spec: FlipSpec) => void
  rasterizeWindow: (force?: boolean) => Promise<void>
  releaseOutsideWindow: () => void
}

interface DragState {
  pointerId: number
  trigger: FlipDirection
  startX: number
  lastX: number
  lastT: number
  /** 沿翻页方向的速度（px/ms）；折角模式为进度变化速度（progress/ms） */
  velocity: number
  moved: number
  progress: number
  /** 折角拖拽：纸角跟随指针，折线随拖点实时变化 */
  fold?: boolean
}

interface PanState {
  pointerId: number
  lastX: number
  lastY: number
  moved: number
}

/**
 * 指针交互状态机：点击/拖拽/折角悬停/平移缩放、键盘翻页、纸叠悬停。
 * 编排层（VueTurn.vue）提供翻页编排回调（next/prev/goToPage/renderStatic 等），
 * 本层不感知 v-model 与路由。
 */
export function useFlipInteraction(options: FlipInteractionOptions) {
  const {
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
    foldEnabled,
    foldBendWorld,
    pageSources,
    regionsOf,
    getLastPlacements,
    currentStackSides,
    sheetOptions,
    computeFlipSpecFor,
    emitBeforeFlip,
    next,
    prev,
    goToPage,
    renderStatic,
    applyStacksFlip,
    rasterizeWindow,
    releaseOutsideWindow,
  } = options

  const disabledRef = ref(false)

  // sheetOwner：当前场景中拖拽纸张的归属（'drag' 需要状态机收尾，'peel' 仅折角悬停）。
  // peelState：悬停预览状态（方向/是否折角形变/当前角 +1 顶 -1 底），
  // 不变式 peelState !== null ⟺ sheetOwner === 'peel'，接管拖拽或收起时整体置 null
  let drag: DragState | null = null
  let pan: PanState | null = null
  let peelState: { trigger: FlipDirection; isFold: boolean; corner: number } | null = null
  let sheetOwner: 'drag' | 'peel' | null = null
  let suppressClick = false
  let clickTimer: ReturnType<typeof setTimeout> | null = null

  // ---------------------------------------------------------------------------
  // 纸叠悬停：命中层高亮 + 页码提示，点击跳转对应页
  // ---------------------------------------------------------------------------

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
    const hit = renderer.pickStack(event.clientX, event.clientY)
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
    renderer.setStackHover({ side: hit.side, start: band.start, end: band.end })
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
    renderer.setStackHover(null)
    emit('stack-hover', null)
  }

  // ---------------------------------------------------------------------------
  // 折角命中与热区
  // ---------------------------------------------------------------------------

  // 命中页的翻页方向与左右侧：折前进侧的页 = 前进（LTR 前进侧在世界右），
  // 折后退侧的页 = 后退。仅跨页左右页可折，居中页（封面等）返回 null
  function foldSideOf(pick: PagePick): { trigger: FlipDirection; worldRight: boolean } | null {
    const ltr = props.forwardDirection === 'left'
    let worldRight: boolean
    if (pick.spread) {
      // 跨页合并网格按 uv 一分为二
      worldRight = pick.u > 0.5
    } else {
      const placement = getLastPlacements().find((p) => p.index === pick.index)
      if (!placement || placement.slot === 'center') return null
      worldRight = placement.slot === 'right'
    }
    const advancing = ltr ? worldRight : !worldRight
    const trigger: FlipDirection = advancing ? (ltr ? 'left' : 'right') : ltr ? 'right' : 'left'
    return { trigger, worldRight }
  }

  // 折页命中（按下用）：fold 开启时命中可翻页的任意位置均返回命中信息。
  // edge=true（四角区）为折角拖拽：锚点取最近外角，斜折线；
  // edge=false 为折页拖拽：锚点取指针同高度的外页边缘点，竖直折线对折翻页
  function foldPageAt(
    clientX: number,
    clientY: number,
  ): { trigger: FlipDirection; cornerV: number; edge: boolean; v: number } | null {
    if (!foldEnabled) return null
    const pick = renderer.pickPage(clientX, clientY)
    if (!pick) return null
    const side = foldSideOf(pick)
    if (!side) return null
    const outerU = side.worldRight ? 1 - pick.u : pick.u
    const zoneU = pick.spread ? FOLD_ZONE / 2 : FOLD_ZONE
    const outerV = pick.v < 0.5 ? pick.v : 1 - pick.v
    return {
      trigger: side.trigger,
      cornerV: pick.v < 0.5 ? -1 : 1,
      edge: outerU <= zoneU && outerV <= FOLD_ZONE,
      v: pick.v,
    }
  }

  // 折角条带命中（悬停预览用）：返回翻页方向、最近外角（+1 顶 / -1 底）与
  // 深入强度 t（0=条带内缘，1=外缘；角区两轴叠加取更深值）
  function foldStripAt(
    clientX: number,
    clientY: number,
  ): { trigger: FlipDirection; cornerV: number; t: number } | null {
    if (!foldEnabled) return null
    const pick = renderer.pickPage(clientX, clientY)
    if (!pick) return null
    const side = foldSideOf(pick)
    if (!side) return null
    // 距外缘的深度：右页外缘在纹理 u=1，左页在 u=0；跨页合并网格按半宽折算
    const outerU = side.worldRight ? 1 - pick.u : pick.u
    const zoneU = pick.spread ? FOLD_ZONE / 2 : FOLD_ZONE
    // 纵向：pick.v ∈ [0,1]（1 为顶），距最近顶/底边的深度
    const outerV = pick.v < 0.5 ? pick.v : 1 - pick.v
    // 左右外缘条带与顶/底条带均触发折角；两轴同时命中（角区）取更深强度，
    // 保证条带→角区连续过渡
    const tU = outerU <= zoneU ? 1 - outerU / zoneU : 0
    const tV = outerV <= FOLD_ZONE ? 1 - outerV / FOLD_ZONE : 0
    const t = Math.max(tU, tV)
    if (t <= 0) return null
    return { trigger: side.trigger, cornerV: pick.v < 0.5 ? -1 : 1, t: Math.min(1, t) }
  }

  // 热区命中：把拾取到的纹理坐标换算为 item 内容坐标（左上角原点，0~1），
  // 半页网格（跨页左/右半）映射到整 item 的一半，跨页合并网格直接覆盖整 item
  function hitRegion(pick: PagePick): PageRegion | null {
    const source = pageSources.value[pick.index]
    if (!source || source.blank) return null
    const regions = regionsOf(source.itemIndex)
    if (regions.length === 0) return null
    let px = pick.u
    if (!pick.spread) {
      if (source.region === 'left') px = pick.u * 0.5
      else if (source.region === 'right') px = 0.5 + pick.u * 0.5
    }
    const py = 1 - pick.v
    for (const region of regions) {
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

  // ---------------------------------------------------------------------------
  // 点击翻页 / 键盘
  // ---------------------------------------------------------------------------

  function isZoomed() {
    return renderer.getZoom() > 1.01
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
      const hit = renderer.pickStack(event.clientX, event.clientY)
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
    const pick = renderer.pickPage(event.clientX, event.clientY)
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
    // 组件内按键即声明本实例为 document 键盘的响应者（多实例互斥）
    docKeyboardOwner = instanceToken
    handleKeydown(event)
  }

  // document 级键盘监听：焦点不在书页上（如点击了外部工具栏按钮）时
  // 方向键依然可翻页。组件内部目标已由 viewport 的 @keydown 处理，
  // 此处跳过避免重复；可交互元素（按钮/链接/输入框等）内的按键不劫持，
  // 保留其原生激活行为；多实例时仅最近交互过的实例响应
  function onDocKeydown(event: KeyboardEvent) {
    if (!props.keyboard || disabledRef.value) return
    if (turnInstanceCount > 1 && docKeyboardOwner !== instanceToken) return
    const target = event.target as Node | null
    if (target) {
      if (rootEl.value?.contains(target)) return
      const el = target as HTMLElement
      if (
        el.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A', 'SUMMARY'].includes(el.tagName)
      ) {
        return
      }
    }
    handleKeydown(event)
  }

  function handleKeydown(event: KeyboardEvent) {
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
  // 拖拽翻页 / 折角悬停
  // ---------------------------------------------------------------------------

  // 纸张完成/取消的统一收尾：拖拽提交或回弹后恢复状态机，折角悬停仅恢复布局。
  // 注意：onDone 读取的是调用时的 sheetOwner（而非创建回调时的快照），
  // 这让折角悬停（peel）→ 按下接管（drag）无需更换回调即可正确收尾
  function makeSheetDone(spec: FlipSpec, trigger: FlipDirection) {
    return (committed: boolean) => {
      const owner = sheetOwner
      sheetOwner = null
      peelState = null
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
      peelState = null
    }
  }

  // 立即收起折角悬停的纸张（同步触发取消收尾）
  function releasePeelNow() {
    if (sheetOwner !== 'peel' || !peelState) return
    const wasFold = peelState.isFold
    sheetOwner = null
    peelState = null
    if (wasFold) {
      renderer.endFoldDrag(false, safeFlipDuration.value)
    } else {
      renderer.endDragFlip(false, safeFlipDuration.value)
    }
  }

  // 旧版整页弯折条带（fold 关闭 + peel 开启时使用）：
  // t 为条带强度 [0,1]，乘以 PEEL_PROGRESS 得拖拽进度；同向重复悬停只更新
  // 进度，不重建纸张。悬停仅预览页角：不动相机、不改纸叠布局
  function ensurePeel(trigger: FlipDirection, t: number) {
    const progress = Math.min(1, Math.max(0, t)) * PEEL_PROGRESS
    if (peelState && peelState.trigger === trigger && !peelState.isFold) {
      renderer.setDragProgress(progress)
      return
    }
    releasePeelNow()
    const spec = computeFlipSpecFor(trigger)
    if (!spec) return
    // 翻页前置布局：折角悬停不动相机
    renderer.setStaticPages(spec.staticPages, (index) => textures.get(index) ?? null, false)
    const ok = renderer.beginDragFlip(
      spec,
      textures.get(spec.frontIndex) ?? null,
      textures.get(spec.backIndex) ?? null,
      makeSheetDone(spec, trigger),
      sheetOptions(spec),
    )
    if (!ok) return
    sheetOwner = 'peel'
    peelState = { trigger, isFold: false, corner: 0 }
    renderer.setDragProgress(progress)
  }

  function updatePeel(event: PointerEvent) {
    // peel 为悬停预览总开关：关闭时无论 fold 开关均无悬停预览
    if (!props.peel || disabledRef.value || state.isFlipping.value || isZoomed()) {
      releasePeelNow()
      return
    }
    // fold 开启：页面四边条带悬停为真实折角预览（turn.js 风格）——
    // 按深入强度折起最近外角
    if (foldEnabled) {
      const hit = foldStripAt(event.clientX, event.clientY)
      if (hit) {
        ensureFoldPreview(hit.trigger, 'corner', hit.t, hit.cornerV)
        return
      }
      releasePeelNow()
      return
    }
    // fold 关闭：视口边缘条带整页轻微卷曲（旧版 peel 行为）
    const el = event.currentTarget as HTMLElement | null
    const rect = el?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return
    const ratio = (event.clientX - rect.left) / rect.width
    const ltr = props.forwardDirection === 'left'
    const zone = safePeelZone.value
    const forwardTrigger: FlipDirection = ltr ? 'left' : 'right'
    const backwardTrigger: FlipDirection = ltr ? 'right' : 'left'
    // 指针距两侧外缘的深度（0=贴外缘，zone=条带内缘）：折角强度随深度渐变，
    // 消除进出条带时的阶跃跳变
    const fwdDepth = ltr ? 1 - ratio : ratio
    const backDepth = ltr ? ratio : 1 - ratio
    if (fwdDepth < zone && state.canGoForward.value) {
      ensurePeel(forwardTrigger, 1 - fwdDepth / zone)
    } else if (backDepth < zone && state.canGoBack.value) {
      ensurePeel(backwardTrigger, 1 - backDepth / zone)
    } else {
      releasePeelNow()
    }
  }

  // 折角悬停预览的当前角（+1 顶 / -1 底）由 peelState.corner 承载：
  // 同方向、同折角模式、同角的重复悬停只更新拖点，否则重建纸张

  // 折角悬停预览：命中四边条带（fold 开启）时按深入强度轻轻折起，提示可抓取。
  // mode 'corner' 锚点为最近外角（斜折线，cornerV 由调用方指定顶/底），
  // 'edge' 锚点为指针同高度的外页边缘点（竖直折线）。不动相机、不改纸叠布局
  // （真实翻页才过渡）
  function ensureFoldPreview(
    trigger: FlipDirection,
    mode: 'corner' | 'edge',
    t: number,
    cornerV: number,
  ) {
    const w = pageWidthOf(safePageAspect)
    const anchorV = mode === 'corner' ? cornerV : 0
    const pickV = (anchorV * PAGE_HEIGHT) / 2
    // 拖点自锚点向内偏移，t 越大折得越明显
    const qu = w - t * 0.16 * w
    const qv = mode === 'corner' ? pickV - t * cornerV * 0.1 * PAGE_HEIGHT : 0
    if (peelState && peelState.trigger === trigger && peelState.isFold && peelState.corner === cornerV) {
      renderer.setFoldDragAt(qu, qv)
      return
    }
    releasePeelNow()
    const spec = computeFlipSpecFor(trigger)
    if (!spec) return
    // 翻页前置布局：折角悬停不动相机
    renderer.setStaticPages(spec.staticPages, (index) => textures.get(index) ?? null, false)
    const ok = renderer.beginFoldDrag(
      spec,
      textures.get(spec.frontIndex) ?? null,
      textures.get(spec.backIndex) ?? null,
      w,
      pickV,
      foldBendWorld,
      makeSheetDone(spec, trigger),
      sheetOptions(spec),
    )
    if (!ok) return
    sheetOwner = 'peel'
    peelState = { trigger, isFold: true, corner: cornerV }
    renderer.setFoldDragAt(qu, qv)
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
    // 组件内按下即声明 document 键盘响应权（多实例互斥）
    docKeyboardOwner = instanceToken
    // 清掉上一手势可能残留的 suppressClick：pointercancel 后浏览器不派发
    // click，该标记不会被消费，残留会吞掉下一次正常点击
    suppressClick = false
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
    // 折页拖拽：fold 开启时命中页面任意位置（跨页左右页）均走折角变形——
    // 四角区为折角拖拽（锚点=最近外角，斜折线）；其余位置为折页拖拽
    // （锚点=指针同高度的外页边缘点，竖直折线对折翻页）；fold 关闭才走
    // 普通整页卷曲拖拽
    const foldHit = foldPageAt(event.clientX, event.clientY)
    if (foldHit) {
      const spec = computeFlipSpecFor(foldHit.trigger)
      if (!spec) return
      if (!emitBeforeFlip(foldHit.trigger, state.page.value, state.page.value + spec.delta)) return
      clearStackHover()
      state.startFlip()
      emit('flip-start', foldHit.trigger)
      emit('pressed', { x: event.clientX - rect.left, y: event.clientY - rect.top })
      const foldW = pageWidthOf(safePageAspect)
      // 折页拖拽锚点高度取指针 v（页高坐标 v=0 为中），折角拖拽取外角
      const pickV = foldHit.edge ? (foldHit.cornerV * PAGE_HEIGHT) / 2 : (foldHit.v - 0.5) * PAGE_HEIGHT
      // 同方向同模式折角悬停的纸张直接接管；其余情况收起后新建折角纸张
      const takeOver =
        peelState !== null &&
        peelState.trigger === foldHit.trigger &&
        peelState.isFold &&
        peelState.corner === (foldHit.edge ? foldHit.cornerV : 0)
      if (!takeOver) {
        if (sheetOwner === 'peel') releasePeelNow()
        // 翻页前置布局：相机不动，折角在页内完成
        renderer.setStaticPages(spec.staticPages, (index) => textures.get(index) ?? null, false)
      }
      const ok = renderer.beginFoldDrag(
        spec,
        textures.get(spec.frontIndex) ?? null,
        textures.get(spec.backIndex) ?? null,
        foldW,
        pickV,
        foldBendWorld,
        makeSheetDone(spec, foldHit.trigger),
        sheetOptions(spec),
      )
      if (!ok) {
        // 渲染不可用：立即回退状态，交互交由点击翻页兜底
        state.cancelFlip()
        emit('flip-end', foldHit.trigger)
        return
      }
      applyStacksFlip(spec)
      sheetOwner = 'drag'
      peelState = null
      drag = {
        pointerId: event.pointerId,
        trigger: foldHit.trigger,
        startX: event.clientX,
        lastX: event.clientX,
        lastT: event.timeStamp,
        velocity: 0,
        moved: 0,
        progress: 0,
        fold: true,
      }
      capturePointer(el, event.pointerId)
      return
    }
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
    // fold 开启：书页外（视口空白处）按下也走折页拖拽——方向按视口半区
    // 判定，锚点取外缘中部（竖直折线），拖点跟手
    if (foldEnabled) {
      // 同方向折边悬停的纸张直接接管；其余情况收起后新建
      const takeOver =
        peelState !== null && peelState.trigger === trigger && peelState.isFold && peelState.corner === 0
      if (!takeOver) {
        if (sheetOwner === 'peel') releasePeelNow()
        // 翻页前置布局：相机不动，折页在页内完成
        renderer.setStaticPages(spec.staticPages, (index) => textures.get(index) ?? null, false)
      }
      const ok = renderer.beginFoldDrag(
        spec,
        textures.get(spec.frontIndex) ?? null,
        textures.get(spec.backIndex) ?? null,
        pageWidthOf(safePageAspect),
        0,
        foldBendWorld,
        makeSheetDone(spec, trigger),
        sheetOptions(spec),
      )
      if (!ok) {
        // 渲染不可用：立即回退状态，交互交由点击翻页兜底
        state.cancelFlip()
        emit('flip-end', trigger)
        return
      }
      applyStacksFlip(spec)
      sheetOwner = 'drag'
      peelState = null
      drag = {
        pointerId: event.pointerId,
        trigger,
        startX: event.clientX,
        lastX: event.clientX,
        lastT: event.timeStamp,
        velocity: 0,
        moved: 0,
        progress: 0,
        fold: true,
      }
      capturePointer(el, event.pointerId)
      return
    }
    // 该方向的折角悬停已创建纸张：直接接管纸张，避免重建；
    // 纸叠过渡在此补设（悬停预览不动纸叠，真实翻页才过渡）
    if (!(sheetOwner === 'peel' && peelState?.trigger === trigger)) {
      // 翻页前置布局：相机由拖拽结束动画接管
      renderer.setStaticPages(spec.staticPages, (index) => textures.get(index) ?? null, false)
      const ok = renderer.beginDragFlip(
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
    applyStacksFlip(spec)
    sheetOwner = 'drag'
    peelState = null
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
      renderer.panBy(dx, dy)
      return
    }
    if (drag && event.pointerId === drag.pointerId) {
      const el = event.currentTarget as HTMLElement | null
      const rect = el?.getBoundingClientRect()
      if (!rect || rect.width <= 0) return
      const dt = Math.max(1, event.timeStamp - drag.lastT)
      const dx = event.clientX - drag.lastX
      if (drag.fold) {
        // 折角拖拽：拖点跟随指针，进度按拖点位置换算
        const prev = drag.progress
        const p = renderer.setFoldDragFromClient(event.clientX, event.clientY)
        if (p !== null) {
          drag.velocity = 0.75 * drag.velocity + 0.25 * ((p - prev) / dt)
          drag.progress = p
        }
      } else {
        // 沿翻页方向的速度：trigger 'left' 时向左为正
        const along = drag.trigger === 'left' ? -dx : dx
        drag.velocity = 0.75 * drag.velocity + 0.25 * (along / dt)
        drag.progress = dragProgressFrom(event.clientX, rect, drag)
        renderer.setDragProgress(drag.progress)
      }
      drag.lastX = event.clientX
      drag.lastT = event.timeStamp
      drag.moved += Math.abs(dx)
      return
    }
    // 无按键悬停：纸叠提示 > 边缘预览（peel 总控；fold 开启为四边折角，关闭为整页轻卷）
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
    if (dragState.fold) {
      // 折角：过阈值或快速甩动完成翻页，否则拖点收回展平
      const commit =
        dragState.progress > 0.45 || (dragState.velocity > 0.0025 && dragState.progress > 0.08)
      renderer.endFoldDrag(commit, safeFlipDuration.value)
      return
    }
    const progress = rect ? dragProgressFrom(event.clientX, rect, dragState) : dragState.progress
    // 超过阈值，或朝翻页方向的快速甩动，都视为完成翻页
    const commit = progress > 0.45 || (dragState.velocity > 0.5 && progress > 0.08)
    renderer.endDragFlip(commit, safeFlipDuration.value)
  }

  function onPointerCancel(event: PointerEvent) {
    if (pan && event.pointerId === pan.pointerId) {
      pan = null
      return
    }
    if (drag && event.pointerId === drag.pointerId) {
      const wasFold = drag.fold === true
      drag = null
      suppressClick = true
      if (wasFold) {
        renderer.endFoldDrag(false, safeFlipDuration.value)
      } else {
        renderer.endDragFlip(false, safeFlipDuration.value)
      }
    }
  }

  function onPointerLeave() {
    if (!drag && !pan) {
      releasePeelNow()
      clearStackHover()
    }
  }

  // ---------------------------------------------------------------------------
  // 缩放
  // ---------------------------------------------------------------------------

  // 滚轮缩放：级别按指数随滚轮增量变化
  function onWheel(event: WheelEvent) {
    if (!props.zoomEnabled || disabledRef.value) return
    if (state.isFlipping.value || drag || sheetOwner !== null) return
    event.preventDefault()
    applyZoom(renderer.getZoom() * Math.exp(-event.deltaY * 0.0016))
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
    renderer.setZoom(clamped, animate)
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

  // ---------------------------------------------------------------------------
  // 中断与禁用
  // ---------------------------------------------------------------------------

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
    renderer.stopFlip()
    if (sheetOwner === 'peel') {
      // 场景不可用导致未收尾时的兜底
      sheetOwner = null
      peelState = null
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

  onMounted(() => {
    turnInstanceCount++
    document.addEventListener('keydown', onDocKeydown)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('keydown', onDocKeydown)
    turnInstanceCount--
    if (docKeyboardOwner === instanceToken) docKeyboardOwner = null
    clearClickTimer()
  })

  return {
    /** 交互禁用状态（编排层的 flip/goToPage 亦据此守卫） */
    disabledRef,
    // 模板事件处理器
    onViewportClick,
    onDblClick,
    onWheel,
    onKeydown,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onPointerLeave,
    // 纸叠悬停提示
    stackHover,
    stackTooltipStyle,
    // 编排层调用的收尾/清理
    discardPeel,
    releasePeelNow,
    clearStackHover,
    // 实例方法
    stop,
    disable,
    zoomIn,
    zoomOut,
    toggleZoom,
    setZoomLevel,
  }
}
