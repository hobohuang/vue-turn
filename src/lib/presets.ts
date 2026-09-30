import type { LookOptions, TurnPreset } from '../types/turn'

/** 观感参数：五个专业渲染参数的集合，预设为其提供成组默认值 */
export interface LookParams {
  /** 翻页网格纵向分段数，越大卷曲越平滑 */
  nPolygons: number
  /** 透视参考距离（像素），越小透视越强 */
  perspective: number
  /** 环境光强度 */
  ambient: number
  /** 方向光（纸张光泽）强度 */
  gloss: number
  /** 卷曲幅度（0 为纯刚体旋转） */
  curl: number
}

/** 折角（fold）参数：是否开启角点拖拽折角及其柔软程度 */
export interface FoldParams {
  /** 是否开启角点拖拽折角（turn.js 4 风格） */
  enabled: boolean
  /** 折线圆弧过渡宽度占页宽比例，越大折角越柔软 */
  bend: number
}

interface PresetEntry extends LookParams, FoldParams {}

// 纸张类型观感预设（各参数的成组基线，look/coverLook 可逐项覆盖）：
// - soft 普通纸张（默认）：哑光（弱方向光）、自然卷曲，开启角点折角拖拽
// - hard 纸板：纯刚体旋转（零卷曲）、较强光泽（覆膜观感），关闭折角
// - custom 自定义：与 soft 基线一致，供完全自定义时显式声明意图
// bend 默认 0.04（4% 页宽）：折缝处的窄圆弧圆角，与翻起平面微翘组合成
// "一条略带厚度的折痕"；带过宽（≥0.1）会呈现"布匹感"
export const TURN_PRESETS: Record<TurnPreset, PresetEntry> = {
  soft: {
    nPolygons: 64,
    perspective: 2400,
    ambient: 1,
    gloss: 0.15,
    curl: 0.8,
    enabled: true,
    bend: 0.04,
  },
  hard: {
    nPolygons: 32,
    perspective: 2400,
    ambient: 1,
    gloss: 0.8,
    curl: 0,
    enabled: false,
    bend: 0,
  },
  custom: {
    nPolygons: 64,
    perspective: 2400,
    ambient: 1,
    gloss: 0.15,
    curl: 0.8,
    enabled: true,
    bend: 0.04,
  },
}

// 解析观感参数：preset 档位值为基线，look 未传项逐项取基线。
// 非法 preset 回退 soft 并警告。
export function resolveLook(preset: TurnPreset | undefined, look?: LookOptions): LookParams {
  if (preset && !TURN_PRESETS[preset]) {
    console.warn(`[vue-turn] 未知 preset "${String(preset)}"，已回退为 soft`)
  }
  const base = presetBase(preset)
  return {
    nPolygons: look?.nPolygons ?? base.nPolygons,
    perspective: look?.perspective ?? base.perspective,
    ambient: look?.ambient ?? base.ambient,
    gloss: look?.gloss ?? base.gloss,
    curl: look?.curl ?? base.curl,
  }
}

// 解析折角参数：preset 档位值为基线，look.fold / look.bend 逐项覆盖
export function resolveFold(preset: TurnPreset | undefined, look?: LookOptions): FoldParams {
  const base = presetBase(preset)
  return {
    enabled: look?.fold ?? base.enabled,
    bend: look?.bend ?? base.bend,
  }
}

/**
 * 合并封面观感与内页观感：coverLook 未传项逐项回退 look。
 * 只把 coverLook 中显式定义（非 undefined）的项视为覆盖。
 */
export function mergeLook(coverLook?: LookOptions, look?: LookOptions): LookOptions {
  if (!coverLook) return look ?? {}
  if (!look) return coverLook
  const merged: LookOptions = { ...look }
  const target = merged as Record<keyof LookOptions, unknown>
  for (const key of Object.keys(coverLook) as (keyof LookOptions)[]) {
    const value = coverLook[key]
    if (value !== undefined) target[key] = value
  }
  return merged
}

function presetBase(preset: TurnPreset | undefined): PresetEntry {
  return (preset ? TURN_PRESETS[preset] : undefined) ?? TURN_PRESETS.soft
}
