import { onBeforeUnmount, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import type * as THREE from 'three'

import type { PagePick } from '@/lib/TurnScene'
import { foldHitFromPick } from '@/lib/foldHit'
import { pageWidth as pageWidthOf } from '@/lib/flipSpec'
import { PAGE_HEIGHT } from '@/lib/flipSpec'
import { pageAtFraction } from '@/lib/pageStack'
import type { PageSource } from '@/lib/pageMapping'
import type { StackSides } from '@/lib/pageStack'
import type {
  FlipDirection,
  FlipSheetOptions,
  FlipSpec,
  PageRegion,
  StaticPlacement,
  ViewportPoint,
} from '@/types/turn'

import type { useBookState } from './useBookState'
import { useKeyboardNav } from './useKeyboardNav'
import { usePeelPreview, type PeelState } from './usePeelPreview'
import { useStackHover } from './useStackHover'
import type { useTurnRenderer } from './useTurnRenderer'
import { useZoomPan } from './useZoomPan'

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
  containerSize: { width: number }
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
 * 指针交互状态机：点击/拖拽翻页与手势路由的编排层。
 * 键盘翻页（useKeyboardNav）、纸叠悬停（useStackHover）、缩放控制
 * （useZoomPan）与悬停预览（usePeelPreview）为独立子模块，经此处装配；
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
    goToPage,
    renderStatic,
    applyStacksFlip,
    rasterizeWindow,
    releaseOutsideWindow,
  } = options

  const disabledRef = ref(false)
  const isDisabled = () => disabledRef.value

  // sheetOwner：当前场景中拖拽纸张的归属（'drag' 需要状态机收尾，'peel' 仅悬停预览）。
  // 不变式：peel 预览激活 ⟺ sheetOwner === 'peel'（peel 状态由 usePeelPreview 持有）
  let drag: DragState | null = null
  let pan: PanState | null = null
  let sheetOwner: 'drag' | 'peel' | null = null
  let suppressClick = false
  let clickTimer: ReturnType<typeof setTimeout> | null = null

  // ---------------------------------------------------------------------------
  // 子模块装配：键盘 / 纸叠悬停 / 缩放 / 悬停预览
  // ---------------------------------------------------------------------------

  const { onKeydown, claimKeyboardOwnership } = useKeyboardNav({
    keyboardEnabled: () => props.keyboard === true,
    isDisabled,
    forwardDirection: () => props.forwardDirection ?? 'left',
    rootEl,
    instanceToken,
    pageCount,
    next: options.next,
    prev: options.prev,
    goToPage,
  })

  const { stackHover, stackTooltipStyle, updateStackHover, clearStackHover } = useStackHover({
    stackEnabled: () => props.stack === true,
    isDisabled,
    isFlipping: state.isFlipping,
    webglSupported,
    renderer,
    containerSize,
    currentStackSides,
    emit: (event, page, point) => emit(event, page, point),
  })

  const { isZoomed, onWheel, onDblClick, zoomIn, zoomOut, toggleZoom, setZoomLevel } = useZoomPan({
    zoomEnabled: () => props.zoomEnabled === true,
    dblClickZoom: () => props.dblClickZoom === true,
    isDisabled,
    isFlipping: state.isFlipping,
    // 拖拽/悬停预览占用场景时缩放让路
    isBusy: () => drag !== null || pan !== null || sheetOwner !== null,
    renderer,
    safeMaxZoom,
    emit: (event, level) => emit(event, level),
  })

  // 纸张完成/取消的统一收尾：拖拽提交或回弹后恢复状态机，悬停预览仅恢复布局。
  // 注意：onDone 读取的是调用时的 sheetOwner（而非创建回调时的快照），
  // 这让悬停预览（peel）→ 按下接管（drag）无需更换回调即可正确收尾
  function makeSheetDone(spec: FlipSpec, trigger: FlipDirection) {
    return (committed: boolean) => {
      const owner = sheetOwner
      sheetOwner = null
      clearPeel()
      if (owner === 'drag') {
        if (committed) state.commitFlip(spec.delta)
        else state.cancelFlip()
        renderStatic()
        emit('flip-end', trigger)
        void rasterizeWindow(false).then(() => releaseOutsideWindow())
      } else {
        // 悬停预览收起：恢复静态布局
        renderStatic()
      }
    }
  }

  const { updatePeel, releasePeelNow, discardPeel, getPeel, clearPeel } = usePeelPreview({
    peelEnabled: () => props.peel === true,
    isDisabled,
    forwardDirection: () => props.forwardDirection ?? 'left',
    state,
    renderer,
    textures,
    safePageAspect,
    safePeelZone,
    safeFlipDuration,
    foldEnabled,
    foldBendWorld,
    getLastPlacements,
    computeFlipSpecFor,
    sheetOptions,
    makeSheetDone,
    isPeelOwner: () => sheetOwner === 'peel',
    setPeelOwner: (value) => {
      sheetOwner = value ? 'peel' : null
    },
    isZoomed,
  })

  // ---------------------------------------------------------------------------
  // 折角命中与热区
  // ---------------------------------------------------------------------------

  // 折页命中（按下用）：fold 开启时命中页面任意位置（跨页左右页）均走折角变形。
  // 命中判定为纯函数（lib/foldHit.ts），此处只做拾取
  function foldPageAt(
    clientX: number,
    clientY: number,
  ): { trigger: FlipDirection; cornerV: number; edge: boolean; v: number } | null {
    if (!foldEnabled) return null
    const pick: PagePick | null = renderer.pickPage(clientX, clientY)
    if (!pick) return null
    return foldHitFromPick(pick, getLastPlacements(), props.forwardDirection ?? 'left')
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
  // 点击翻页
  // ---------------------------------------------------------------------------

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
      options.next()
    } else {
      options.prev()
    }
  }

  // ---------------------------------------------------------------------------
  // 拖拽翻页
  // ---------------------------------------------------------------------------

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
    claimKeyboardOwnership()
    // 清掉上一手势可能残留的 suppressClick：pointercancel 后浏览器不派发
    // click，该标记不会被消费，残留会吞掉下一次正常点击
    suppressClick = false
    // 新手势开始即作废单击延迟翻页判定（dblClickZoom）：否则"单击后立即
    // 拖拽"时无 click 派发消费 suppressClick，迟到的 timer 会在拖拽结束后
    // 绕过 click 入口额外触发一次翻页
    clearClickTimer()
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
      beginFoldDragGesture(event, el, rect, foldHit)
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
      const drag2 = startFoldDragGesture(event, spec, trigger, 0)
      if (drag2) {
        applyStacksFlip(spec)
        sheetOwner = 'drag'
        capturePointer(el, event.pointerId)
      }
      return
    }
    // 该方向的悬停预览已创建纸张：直接接管纸张，避免重建；
    // 纸叠过渡在此补设（悬停预览不动纸叠，真实翻页才过渡）
    const peelState: PeelState | null = getPeel()
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
    } else {
      // 接管同方向悬停预览的卷曲纸张（不重建）：转为真实交互，
      // 恢复书体/静态页/纸叠随拖拽进度联动
      renderer.activateSheet()
    }
    applyStacksFlip(spec)
    sheetOwner = 'drag'
    clearPeel()
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

  // 折角拖拽手势（命中页面四角区或页面中部）：before-flip 通过后
  // 创建/接管折角纸张并进入 drag 状态。失败时同步回退状态
  function beginFoldDragGesture(
    event: PointerEvent,
    el: HTMLElement,
    rect: DOMRect,
    foldHit: { trigger: FlipDirection; cornerV: number; edge: boolean; v: number },
  ): boolean {
    const spec = computeFlipSpecFor(foldHit.trigger)
    if (!spec) return false
    if (!emitBeforeFlip(foldHit.trigger, state.page.value, state.page.value + spec.delta)) {
      return false
    }
    clearStackHover()
    state.startFlip()
    emit('flip-start', foldHit.trigger)
    emit('pressed', { x: event.clientX - rect.left, y: event.clientY - rect.top })
    // 折页拖拽锚点高度取指针 v（页高坐标 v=0 为中），折角拖拽取外角
    const anchorV = foldHit.edge
      ? (foldHit.cornerV * PAGE_HEIGHT) / 2
      : (foldHit.v - 0.5) * PAGE_HEIGHT
    const drag2 = startFoldDragGesture(event, spec, foldHit.trigger, anchorV, foldHit)
    if (drag2) {
      applyStacksFlip(spec)
      sheetOwner = 'drag'
      capturePointer(el, event.pointerId)
    }
    return drag2 !== null
  }

  // 创建或接管折角纸张，进入 drag 状态（返回 DragState；失败时已同步回退）。
  // takeOverCorner：同方向同角悬停预览可直接接管的角标记（0 为竖直折线折页）
  function startFoldDragGesture(
    event: PointerEvent,
    spec: FlipSpec,
    trigger: FlipDirection,
    anchorV: number,
    foldHit?: { cornerV: number; edge: boolean },
  ): DragState | null {
    const foldW = pageWidthOf(safePageAspect)
    const takeOverCorner = foldHit ? (foldHit.edge ? foldHit.cornerV : 0) : 0
    const peelState: PeelState | null = getPeel()
    // 同方向同模式悬停预览的纸张直接接管；其余情况收起后新建折角纸张
    const takeOver =
      peelState !== null &&
      peelState.trigger === trigger &&
      peelState.isFold &&
      peelState.corner === takeOverCorner
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
      anchorV,
      foldBendWorld,
      makeSheetDone(spec, trigger),
      sheetOptions(spec),
    )
    if (!ok) {
      // 渲染不可用：立即回退状态，交互交由点击翻页兜底
      state.cancelFlip()
      emit('flip-end', trigger)
      return null
    }
    clearPeel()
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
    return drag
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
    // 无按键悬停：纸叠提示 > 角区折角预览（peel 总控；fold 开启为四角折角，关闭为整页轻卷）
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
      clearPeel()
      renderStatic()
    }
  }

  // 禁用/启用组件交互与翻页
  function disable(value = true) {
    disabledRef.value = value !== false
    if (disabledRef.value) {
      // 收起悬停预览，避免禁用后残留掀起的页角
      releasePeelNow()
      clearClickTimer()
    }
  }

  onBeforeUnmount(() => {
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
