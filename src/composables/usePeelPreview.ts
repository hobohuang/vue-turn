import type { ComputedRef } from 'vue'
import type * as THREE from 'three'

import type { PagePick } from '@/lib/TurnScene'
import { PAGE_HEIGHT, pageWidth } from '@/lib/flipSpec'
import { foldStripFromPick } from '@/lib/foldHit'
import type { FlipDirection, FlipSheetOptions, FlipSpec, StaticPlacement } from '@/types/turn'

import type { useBookState } from './useBookState'
import type { useTurnRenderer } from './useTurnRenderer'

// 整页轻卷悬停的最大进度
const PEEL_PROGRESS = 0.07

/** 悬停预览当前状态（不变式：peel !== null ⟺ 场景纸张归属为 peel） */
export interface PeelState {
  trigger: FlipDirection
  isFold: boolean
  corner: number
}

export interface PeelPreviewOptions {
  /** props.peel（响应式读取） */
  peelEnabled: () => boolean
  /** 交互禁用状态（响应式读取） */
  isDisabled: () => boolean
  /** props.forwardDirection（响应式读取） */
  forwardDirection: () => FlipDirection
  state: ReturnType<typeof useBookState>
  renderer: Pick<
    ReturnType<typeof useTurnRenderer>,
    | 'setStaticPages'
    | 'beginDragFlip'
    | 'beginFoldDrag'
    | 'setDragProgress'
    | 'setFoldDragAt'
    | 'endDragFlip'
    | 'endFoldDrag'
    | 'pickPage'
  >
  textures: Map<number, THREE.Texture>
  safePageAspect: number
  safePeelZone: ComputedRef<number>
  safeFlipDuration: ComputedRef<number>
  /** fold 交互是否启用（preset 解析结果，挂载期冻结） */
  foldEnabled: boolean
  foldBendWorld: number
  /** 最近一次静态布局（由编排层提供） */
  getLastPlacements: () => StaticPlacement[]
  computeFlipSpecFor: (trigger: FlipDirection) => FlipSpec | null
  sheetOptions: (spec: FlipSpec) => FlipSheetOptions
  /** 纸张收尾回调工厂（由主状态机提供，读调用时的纸张归属收尾） */
  makeSheetDone: (spec: FlipSpec, trigger: FlipDirection) => (committed: boolean) => void
  /** 场景纸张当前是否归属悬停预览（主状态机的 sheetOwner === 'peel'） */
  isPeelOwner: () => boolean
  /** 置为悬停预览归属（主状态机 sheetOwner = 'peel' / 清除） */
  setPeelOwner: (value: boolean) => void
  isZoomed: () => boolean
}

/**
 * 悬停预览（peel）：不动相机、不改纸叠布局，只预览纸角形变。
 * - fold 开启：仅四角区域为折角预览（turn.js 风格），按深入强度折起最近外角
 * - fold 关闭：视口边缘条带整页轻卷（旧版 peel 行为）
 *
 * 与主拖拽状态机共享"场景纸张归属"（sheetOwner）：悬停创建的预览纸张
 * 可被真实按下无缝接管；归属标记由 isPeelOwner/setPeelOwner 读写，
 * peel 内部状态与归属标记保持同置同清。
 */
export function usePeelPreview(options: PeelPreviewOptions) {
  const {
    peelEnabled,
    isDisabled,
    forwardDirection,
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
    isPeelOwner,
    setPeelOwner,
    isZoomed,
  } = options

  let peel: PeelState | null = null

  /** 当前悬停预览状态（主状态机判定按下接管时读取） */
  function getPeel(): PeelState | null {
    return peel
  }

  /** 清除内部状态（主状态机接管纸张转为 drag 时调用） */
  function clearPeel() {
    peel = null
  }

  // 丢弃折角悬停（不触发收尾动画，供 startFlip 即将静默替换纸张时使用）
  function discardPeel() {
    if (isPeelOwner()) {
      setPeelOwner(false)
      peel = null
    }
  }

  // 立即收起悬停预览的纸张（同步触发取消收尾）
  function releasePeelNow() {
    if (!isPeelOwner() || !peel) return
    const wasFold = peel.isFold
    setPeelOwner(false)
    peel = null
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
    if (peel && peel.trigger === trigger && !peel.isFold) {
      renderer.setDragProgress(progress)
      return
    }
    releasePeelNow()
    const spec = computeFlipSpecFor(trigger)
    if (!spec) return
    // 翻页前置布局：悬停预览不动相机
    renderer.setStaticPages(spec.staticPages, (index) => textures.get(index) ?? null, false)
    // preview=true：悬停预览不动书体/静态页/纸叠，只预览整页卷曲
    const ok = renderer.beginDragFlip(
      spec,
      textures.get(spec.frontIndex) ?? null,
      textures.get(spec.backIndex) ?? null,
      makeSheetDone(spec, trigger),
      sheetOptions(spec),
      true,
    )
    if (!ok) return
    setPeelOwner(true)
    peel = { trigger, isFold: false, corner: 0 }
    renderer.setDragProgress(progress)
  }

  /** 悬停驱动入口（pointermove 无按键时由主状态机调用） */
  function updatePeel(event: PointerEvent) {
    // peel 为悬停预览总开关：关闭时无论 fold 开关均无悬停预览
    if (!peelEnabled() || isDisabled() || state.isFlipping.value || isZoomed()) {
      releasePeelNow()
      return
    }
    // fold 开启：仅四角区域悬停为折角预览（turn.js 风格）——
    // 按深入强度折起最近外角；其余位置无任何悬停预览
    if (foldEnabled) {
      const pick: PagePick | null = renderer.pickPage(event.clientX, event.clientY)
      const hit = pick
        ? foldStripFromPick(pick, getLastPlacements(), forwardDirection())
        : null
      if (hit) {
        ensureFoldPreview(hit.trigger, hit.t, hit.cornerV)
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
    const ltr = forwardDirection() === 'left'
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

  // 折角悬停预览：命中四角区域（fold 开启）时按深入强度轻轻折起最近外角
  // （cornerV 指定顶 +1 / 底 -1，斜折线），提示可抓取。
  // 不动相机、不改纸叠布局（真实翻页才过渡）
  function ensureFoldPreview(trigger: FlipDirection, t: number, cornerV: number) {
    const w = pageWidth(safePageAspect)
    const pickV = (cornerV * PAGE_HEIGHT) / 2
    // 拖点自锚点向内偏移，t 越大折得越明显
    const qu = w - t * 0.16 * w
    const qv = pickV - t * cornerV * 0.1 * PAGE_HEIGHT
    if (peel && peel.trigger === trigger && peel.isFold && peel.corner === cornerV) {
      renderer.setFoldDragAt(qu, qv)
      return
    }
    releasePeelNow()
    const spec = computeFlipSpecFor(trigger)
    if (!spec) return
    // 翻页前置布局：悬停预览不动相机
    renderer.setStaticPages(spec.staticPages, (index) => textures.get(index) ?? null, false)
    // preview=true：悬停预览不动书体/静态页/纸叠，只预览折角形变
    const ok = renderer.beginFoldDrag(
      spec,
      textures.get(spec.frontIndex) ?? null,
      textures.get(spec.backIndex) ?? null,
      w,
      pickV,
      foldBendWorld,
      makeSheetDone(spec, trigger),
      sheetOptions(spec),
      true,
    )
    if (!ok) return
    setPeelOwner(true)
    peel = { trigger, isFold: true, corner: cornerV }
    renderer.setFoldDragAt(qu, qv)
  }

  return { updatePeel, releasePeelNow, discardPeel, getPeel, clearPeel }
}
