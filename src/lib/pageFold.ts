// 折角（fold）几何：turn.js 4 风格的柔软折角翻页。
// 折线取抓取点 P 与拖点 Q 连线的垂直平分线：翻折后 P 恰好落在 Q 上，
// 折线 P 侧的纸面整体翻折过来（显示背面），折线附近按 bend 宽度做圆弧过渡。

// 折角翻起后与下层页面的微小抬升，避免 z-fighting
export const FOLD_LIFT = 0.012

export interface FoldCrease {
  /** 折线法向（单位向量，指向未翻折侧） */
  nx: number
  ny: number
  /** 折线方程 nx·x + ny·y = c */
  c: number
  /** 折线附近的圆弧过渡宽度（世界单位） */
  bend: number
}

export interface FoldPointResult {
  x: number
  y: number
  z: number
}

// 由抓取点 P(pu,pv)、拖点 Q(qu,qv) 计算折线；P≈Q（未折）返回 null
export function computeCrease(
  pu: number,
  pv: number,
  qu: number,
  qv: number,
  bend: number,
): FoldCrease | null {
  const dx = qu - pu
  const dy = qv - pv
  const len = Math.hypot(dx, dy)
  if (len < 1e-4) return null
  return {
    nx: dx / len,
    ny: dy / len,
    c: (qu * qu + qv * qv - pu * pu - pv * pv) / (2 * len),
    bend,
  }
}

// 单顶点折角变换：s 为自书脊起算的页宽坐标 [0,W]，y 为页高坐标 [-H/2,H/2]。
// - 未翻折侧（含折线）原位不动；
// - 折线附近 bend 带内：绕折线方向按距离比例旋转 0→π，形成圆弧过渡；
// - 超出 bend 带：镜像翻折平摊，微抬 FOLD_LIFT。
export function foldPoint(s: number, y: number, crease: FoldCrease): FoldPointResult {
  const d = crease.nx * s + crease.ny * y - crease.c
  if (d >= 0) return { x: s, y, z: 0 }
  const a = -d
  const { bend } = crease
  if (bend <= 0 || a >= bend) {
    return {
      x: s - 2 * d * crease.nx,
      y: y - 2 * d * crease.ny,
      z: FOLD_LIFT,
    }
  }
  const psi = (Math.PI * a) / bend
  const shift = d * (1 - Math.cos(psi))
  return {
    x: s - shift * crease.nx,
    y: y - shift * crease.ny,
    z: a * Math.sin(psi) + FOLD_LIFT * (a / bend),
  }
}

// 折角翻页进度：外缘角自页外缘 (s=W) 拖到对侧镜像位 (-W) 为 1，
// 角点越过书脊 (s<0) 后过半。用于提交判定与纸叠插值。
export function foldProgress(qu: number, width: number): number {
  if (width <= 0) return 0
  return Math.min(1, Math.max(0, (width - qu) / (2 * width)))
}
