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

// 三档观感预设：
// - realistic 真实纸感（默认）：均衡卷曲与光影，接近真实平装书
// - crisp 干脆硬朗：低卷曲偏刚体、弱光泽、透视略强，适合硬纸板书/儿童绘本
// - soft 柔和舒缓：高卷曲慢飘感、光影更平、透视更弱，适合杂志/画册
export const TURN_PRESETS: Record<TurnPreset, LookParams> = {
  realistic: { nPolygons: 64, perspective: 2400, ambient: 1, gloss: 0.35, curl: 0.8 },
  crisp: { nPolygons: 32, perspective: 1800, ambient: 1.05, gloss: 0.15, curl: 0.25 },
  soft: { nPolygons: 96, perspective: 3200, ambient: 1.2, gloss: 0.25, curl: 0.95 },
}

// 解析观感参数：preset 提供成组默认值，overrides 中显式传入（非 undefined）
// 的专业参数逐项覆盖预设值。非法 preset 回退 realistic 并警告。
export function resolveLook(
  preset: TurnPreset | undefined,
  overrides: Partial<LookParams>,
): LookParams {
  if (preset && !TURN_PRESETS[preset]) {
    console.warn(`[vue-turn] 未知 preset "${String(preset)}"，已回退为 realistic`)
  }
  const base = (preset ? TURN_PRESETS[preset] : undefined) ?? TURN_PRESETS.realistic
  return {
    nPolygons: overrides.nPolygons ?? base.nPolygons,
    perspective: overrides.perspective ?? base.perspective,
    ambient: overrides.ambient ?? base.ambient,
    gloss: overrides.gloss ?? base.gloss,
    curl: overrides.curl ?? base.curl,
  }
}
