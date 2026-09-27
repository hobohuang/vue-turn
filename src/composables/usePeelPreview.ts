import type { ComputedRef, Ref } from 'vue'
import type * as THREE from 'three'

import type { PagePick } from '@/lib/TurnScene'
import { PAGE_HEIGHT, pageWidth } from '@/lib/flipSpec'
import { FOLD_ZONE, foldStripFromPick } from '@/lib/foldHit'
import type {
  FlipDirection,
  FlipSheetOptions,
  FlipSpec,
  SheetFoldOptions,
  StaticPlacement,
} from '@/types/turn'

import type { useBookState } from './useBookState'
import type { PaperOwnership } from './paperOwnership'
import type { useTurnRenderer } from './useTurnRenderer'

// 整页轻卷悬停的最大进度
const PEEL_PROGRESS = 0.07
// 整页轻卷预览的两侧边缘条带宽度占视口宽度的比例（内部常量，不对外暴露）
const PEEL_ZONE = 0.12

export interface PeelPreviewOptions {
  /** props.peel（响应式读取） */
  peelEnabled: () => boolean
  /** 交互禁用状态（响应式读取） */
  isDisabled: () => boolean
  /** props.forwardDirection（响应式读取） */
  forwardDirection: () => FlipDirection
  state: ReturnType<typeof useBookState>
  /** 总页数（居中页判定封面/封底用） */
  pageCount: Ref<number>
  renderer: Pick<
    ReturnType<typeof useTurnRenderer>,
    | 'setStaticPages'
    | 'beginDragFlip'
    | 'beginFoldDrag'
    | 'setDragProgress'
    | 'setFoldDragFromClient'
    | 'foldAnchorDistanceFromClient'
    | 'endDragFlip'
    | 'endFoldDrag'
    | 'stopFlip'
    | 'pickPage'
  >
  textures: Map<number, THREE.Texture>
  safePageAspect: number
  safeFlipDuration: ComputedRef<number>
  /** fold 交互是否启用（preset 解析结果，挂载期冻结） */
  /** 翻页纸张所属档位的折页参数（内页 preset / 封面封底 coverPreset） */
  foldOfSpec: (spec: FlipSpec) => SheetFoldOptions
  /** 拾取命中的静态页所属纸张的折页参数 */
  foldOfPage: (index: number | undefined) => SheetFoldOptions
  /** 最近一次静态布局（由编排层提供） */
  getLastPlacements: () => StaticPlacement[]
  computeFlipSpecFor: (trigger: FlipDirection) => FlipSpec | null
  sheetOptions: (spec: FlipSpec) => FlipSheetOptions
  /** 纸张收尾回调工厂（由主状态机提供，读调用时的纸张归属收尾） */
  makeSheetDone: (spec: FlipSpec, trigger: FlipDirection) => (committed: boolean) => void
  /** 场景纸张归属状态（唯一事实来源，与主状态机共享读写） */
  ownership: PaperOwnership
  isZoomed: () => boolean
}

/**
 * 悬停预览（peel）：不动相机、不改纸叠，只预览纸角形变。
 * - fold 开启：仅四角区域为折角预览（turn.js 风格），折点跟随指针，
 *   与折角拖拽同一张纸张、同一条形变路径（preview=true 差异见下）
 * - fold 关闭：视口边缘条带整页轻卷
 *
 * 纸张归属记录在共享的 PaperOwnership 状态机上（composables/paperOwnership.ts）：
 * 悬停创建的预览纸张可被真实按下无缝接管；归属的建立/清除经状态机的
 * claimPeel / clear 方法完成。
 */
export function usePeelPreview(options: PeelPreviewOptions) {
  const {
    peelEnabled,
    isDisabled,
    forwardDirection,
    state,
    pageCount,
    renderer,
    textures,
    safePageAspect,
    safeFlipDuration,
    foldOfSpec,
    foldOfPage,
    getLastPlacements,
    computeFlipSpecFor,
    sheetOptions,
    makeSheetDone,
    ownership,
    isZoomed,
  } = options

  // 丢弃悬停预览（不触发收尾动画，供 startFlip 即将静默替换纸张时使用）
  function discardPeel() {
    ownership.releasePeel()
  }

  // 立即收起悬停预览的纸张（同步触发取消收尾）
  function releasePeelNow() {
    const peel = ownership.peel
    if (ownership.owner !== 'peel' || !peel) return
    const wasFold = peel.isFold
    ownership.clear()
    if (wasFold) {
      renderer.endFoldDrag(false, safeFlipDuration.value)
    } else {
      renderer.endDragFlip(false, safeFlipDuration.value)
    }
  }

  // 整页弯折条带（fold 关闭 + peel 开启时的预览形态）：
  // t 为条带强度 [0,1]，乘以 PEEL_PROGRESS 得拖拽进度；同向重复悬停只更新
  // 进度，不重建纸张。悬停仅预览页角：不动相机、不改纸叠、不替换静态布局
  // ——静态布局一旦被替换成翻开布局，悬停侧（后退方向的左半边）可能不再
  // 有静态网格，pickPage 拾取随即 miss → 收起回弹 → 布局恢复 → 再命中，
  // 形成"折起-恢复"的闪烁循环
  function ensurePeel(trigger: FlipDirection, t: number) {
    const progress = Math.min(1, Math.max(0, t)) * PEEL_PROGRESS
    const peel = ownership.peel
    if (ownership.owner === 'peel' && peel && peel.trigger === trigger && !peel.isFold) {
      renderer.setDragProgress(progress)
      return
    }
    releasePeelNow()
    const spec = computeFlipSpecFor(trigger)
    if (!spec) return
    // 强制收尾在途 settle：curl 预览不重设静态布局，若上一步是 fold 预览
    // （布局已被重设为翻开前置态且世界偏移已叠加），其收起动画的 onDone
    // 会被场景静默替换丢弃，翻开前置布局残留到下一次真实翻页
    renderer.stopFlip()
    // preview=true：悬停预览不动书体/静态页/纸叠，只预览整页卷曲
    // （静态布局保持空闲态，命中判定所依赖的网格不随预览变化）
    const ok = renderer.beginDragFlip(
      spec,
      textures.get(spec.frontIndex) ?? null,
      textures.get(spec.backIndex) ?? null,
      makeSheetDone(spec, trigger),
      sheetOptions(spec),
      true,
    )
    if (!ok) return
    ownership.claimPeel({ trigger, isFold: false, corner: 0 })
    renderer.setDragProgress(progress)
  }

  /** 悬停驱动入口（pointermove 无按键时由主状态机调用） */
  function updatePeel(event: PointerEvent) {
    // peel 为悬停预览总开关：关闭时无论 fold 开关均无悬停预览
    if (!peelEnabled() || isDisabled() || state.isFlipping.value || isZoomed()) {
      releasePeelNow()
      return
    }
    // 折角预览已激活：静态布局已是翻开前置布局，pickPage 命中的是底页，
    // 角区进出改按指针到折角锚点（外角）的世界距离判定（与折角条带
    // 命中同心同半径）；折点跟随指针，与折角拖拽同一入口
    const peel = ownership.peel
    if (ownership.owner === 'peel' && peel?.isFold) {
      const radius = FOLD_ZONE * pageWidth(safePageAspect)
      const dist = renderer.foldAnchorDistanceFromClient(event.clientX, event.clientY)
      if (dist !== null && dist <= radius) {
        renderer.setFoldDragFromClient(event.clientX, event.clientY)
      } else {
        releasePeelNow()
      }
      return
    }
    const el = event.currentTarget as HTMLElement | null
    const rect = el?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return
    const ratio = (event.clientX - rect.left) / rect.width
    const ltr = forwardDirection() === 'left'
    const zone = PEEL_ZONE
    const forwardTrigger: FlipDirection = ltr ? 'left' : 'right'
    const backwardTrigger: FlipDirection = ltr ? 'right' : 'left'
    // 指针距两侧外缘的深度（0=贴外缘，zone=条带内缘）：折角强度随深度渐变，
    // 消除进出条带时的阶跃跳变
    const fwdDepth = ltr ? 1 - ratio : ratio
    const backDepth = ltr ? ratio : 1 - ratio
    const pick: PagePick | null = renderer.pickPage(event.clientX, event.clientY)
    // 折页档按纸张归属取（内页 preset / 封面封底 coverPreset）：hard 档纸张
    // 不走角区折角预览，回到视口边缘条带的整页轻卷（刚体微抬）
    const foldOn = pick
      ? foldOfPage(pick.index).enabled
      : isFoldSheet(fwdDepth < zone ? forwardTrigger : backwardTrigger)
    if (foldOn) {
      // fold 档：仅四角区域悬停为折角预览（turn.js 风格），角区外不预览
      const hit = pick
        ? foldStripFromPick(
            pick,
            getLastPlacements(),
            forwardDirection(),
            pageWidth(safePageAspect),
            pageCount.value,
          )
        : null
      if (hit) ensureFoldPreview(hit.trigger, hit.cornerV, event)
      else releasePeelNow()
      return
    }
    // fold 关闭：视口边缘条带整页轻微卷曲
    if (fwdDepth < zone && state.canGoForward.value) {
      ensurePeel(forwardTrigger, 1 - fwdDepth / zone)
    } else if (backDepth < zone && state.canGoBack.value) {
      ensurePeel(backwardTrigger, 1 - backDepth / zone)
    } else {
      releasePeelNow()
    }
  }

  /** 该方向将要翻起的纸张是否为折页档（书页外悬停/按下时按半区取档） */
  function isFoldSheet(trigger: FlipDirection): boolean {
    const spec = computeFlipSpecFor(trigger)
    return spec !== null && foldOfSpec(spec).enabled
  }

  // 折角悬停预览：与折角拖拽同一张纸张、同一条形变路径（beginFoldDrag +
  // setFoldDragFromClient），差别仅在 preview=true——静态页钉在翻页前置
  // 布局起点、书体平移/纸叠/相机钉在起始态，只有折角形变跟随指针；
  // 折点直接取指针位置（角区内跟随鼠标），书脊约束钳制在场景层
  function ensureFoldPreview(trigger: FlipDirection, cornerV: number, event: PointerEvent) {
    releasePeelNow()
    const spec = computeFlipSpecFor(trigger)
    if (!spec) return
    const w = pageWidth(safePageAspect)
    // 与真实拖拽一致：先重设翻开前置布局再建纸张，折角下方露出的才是
    // 下一页而非当前页；世界偏移由 beginFoldDrag 统一叠加。收起时经
    // makeSheetDone 的 renderStatic 恢复空闲布局
    renderer.setStaticPages(spec.staticPages, (index) => textures.get(index) ?? null, false)
    const ok = renderer.beginFoldDrag(
      spec,
      textures.get(spec.frontIndex) ?? null,
      textures.get(spec.backIndex) ?? null,
      w,
      (cornerV * PAGE_HEIGHT) / 2,
      foldOfSpec(spec).bendWorld,
      makeSheetDone(spec, trigger),
      sheetOptions(spec),
      true,
    )
    if (!ok) return
    ownership.claimPeel({ trigger, isFold: true, corner: cornerV })
    // 创建时拖点先落在锚点外角（平展），立即移到指针当前位置
    renderer.setFoldDragFromClient(event.clientX, event.clientY)
  }

  return { updatePeel, releasePeelNow, discardPeel }
}
