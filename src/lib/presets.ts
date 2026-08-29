import type { TurnPreset } from '@/types/turn'

// 观感参数：五个专业渲染参数的集合，预设为其提供成组默认值
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

// 折角（fold）参数：是否开启角点拖拽折角及其柔软程度
export interface FoldParams {
  /** 是否开启角点拖拽折角（turn.js 4 风格） */
  enabled: boolean
  /** 折线圆弧过渡宽度占页宽比例，越大折角越柔软 */
  bend: number
}

interface PresetEntry extends LookParams, FoldParams {}

// 纸张类型观感预设：
// - soft 普通纸张（默认）：哑光（弱方向光）、自然卷曲，开启角点折角拖拽
// - hard 纸板：纯刚体旋转（零卷曲）、较强光泽（覆膜观感），关闭折角
// - custom 自定义基线：与 soft 一致，供 custom 档未传参数回退
export const TURN_PRESETS: Record<TurnPreset, PresetEntry> = {
  soft: {
    nPolygons: 64,
    perspective: 2400,
    ambient: 1,
    gloss: 0.15,
    curl: 0.8,
    enabled: true,
    bend: 0.16,
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
    bend: 0.16,
  },
}

// 解析观感参数：soft/hard 档位值为最高优先级，overrides（显式传入的专业参数）
// 不生效；仅 custom 档逐项采用 overrides，未传项回退 custom 基线。
// 非法 preset 回退 soft 并警告。
export function resolveLook(
  preset: TurnPreset | undefined,
  overrides: Partial<LookParams>,
): LookParams {
  if (preset && !TURN_PRESETS[preset]) {
    console.warn(`[vue-turn] 未知 preset "${String(preset)}"，已回退为 soft`)
  }
  const base = presetBase(preset)
  if (preset !== 'custom') {
    return {
      nPolygons: base.nPolygons,
      perspective: base.perspective,
      ambient: base.ambient,
      gloss: base.gloss,
      curl: base.curl,
    }
  }
  return {
    nPolygons: overrides.nPolygons ?? base.nPolygons,
    perspective: overrides.perspective ?? base.perspective,
    ambient: overrides.ambient ?? base.ambient,
    gloss: overrides.gloss ?? base.gloss,
    curl: overrides.curl ?? base.curl,
  }
}

// 解析折角参数：soft/hard 档取预设值（fold prop 不生效）；仅 custom 档
// 由 fold/bend prop 显式设置，未传回退 custom 基线
export function resolveFold(
  preset: TurnPreset | undefined,
  fold?: boolean,
  bend?: number,
): FoldParams {
  const base = presetBase(preset)
  if (preset !== 'custom') {
    return { enabled: base.enabled, bend: base.bend }
  }
  return { enabled: fold ?? base.enabled, bend: bend ?? base.bend }
}

function presetBase(preset: TurnPreset | undefined): PresetEntry {
  return (preset ? TURN_PRESETS[preset] : undefined) ?? TURN_PRESETS.soft
}
