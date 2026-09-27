import type { FlipDirection } from '@/types/turn'

/** 悬停预览当前状态（拖点/折角元信息，供按下接管判定） */
export interface PeelState {
  trigger: FlipDirection
  isFold: boolean
  corner: number
}

export type PaperOwner = 'drag' | 'peel'

/**
 * 场景纸张归属状态机：唯一事实来源（实例由 useFlipInteraction 持有，
 * 与 usePeelPreview 共享读写）。
 *
 * - 'drag'：真实拖拽占用的纸张，状态机收尾（提交/回弹 + flip-end）
 * - 'peel'：悬停预览占用的纸张，收起时仅恢复布局
 * - "peel 信息存在 ⟺ owner === 'peel'" 的不变式由写入方法构造保证：
 *   外部只能通过 claimPeel / claimDrag / releasePeel / clear 变更状态，
 *   不存在"清了 owner 忘了 peel"的中间态
 *
 * 归属的读取方（接管判定、收尾回调）通过 getter 与 isPeelMatch 进行。
 */
export class PaperOwnership {
  private kind: PaperOwner | null = null
  private peelInfo: PeelState | null = null

  get owner(): PaperOwner | null {
    return this.kind
  }

  /** 仅在 owner === 'peel' 时非空（构造保证） */
  get peel(): PeelState | null {
    return this.peelInfo
  }

  /** 悬停预览占用纸张 */
  claimPeel(info: PeelState): void {
    this.kind = 'peel'
    this.peelInfo = info
  }

  /** 转为真实拖拽占用：新建拖拽与 peel 预览按下接管共用此路径 */
  claimDrag(): void {
    this.kind = 'drag'
    this.peelInfo = null
  }

  /** 清除归属（收尾完成、纸张被静默替换等） */
  clear(): void {
    this.kind = null
    this.peelInfo = null
  }

  /** 仅当归属为 peel 时清除；返回是否发生了清除 */
  releasePeel(): boolean {
    if (this.kind !== 'peel') return false
    this.clear()
    return true
  }

  /**
   * 接管匹配：同方向的悬停预览可被按下直接接管（不重建纸张）。
   * corner 给出时进一步要求折角预览同角（corner 与 FoldState 拖点标记同源：
   * 角区折角为 cornerV，竖直折线折页为 0）。
   */
  isPeelMatch(trigger: FlipDirection, corner?: number): boolean {
    if (this.kind !== 'peel' || this.peelInfo === null) return false
    if (this.peelInfo.trigger !== trigger) return false
    if (corner === undefined) return !this.peelInfo.isFold
    return this.peelInfo.isFold && this.peelInfo.corner === corner
  }
}
