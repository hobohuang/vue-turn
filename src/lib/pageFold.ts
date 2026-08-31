// 折角（fold）几何：turn.js 4 风格的柔软折角翻页。
// 折线取抓取点 P 与拖点 Q 连线的垂直平分线：翻折后 P 恰好落在 Q 上，
// 折线 P 侧的纸面整体翻折过来（显示背面），折线附近按 bend 宽度做圆弧过渡。

// 折角翻起后与下层页面的微小抬升，避免 z-fighting
export const FOLD_LIFT = 0.012

// 折痕微开角（弧度，约 4.6°）：翻起平面绕折线的翘起角，与折缝圆弧
// （bend，computeCrease 参数）组合成"一条略带厚度的折痕"：弧段圆润
// 卷起（真实纸张折缝的圆角），弧末端相切接入微翘的翻起平面——高度差
// 与法线变化让折缝在光影和透视下可分辨。调用方随翻页进度把二者压平
export const FOLD_TILT = 0.08

export interface FoldCrease {
  /** 折线法向（单位向量，指向未翻折侧） */
  nx: number
  ny: number
  /** 折线方程 nx·x + ny·y = c */
  c: number
  /** 折缝圆弧的弧长（世界单位）；0 = 无圆角的锐利折痕 */
  bend: number
  /** 翻起平面绕折线的微开角（弧度）；0 = 翻起部分平贴底面 */
  tilt: number
}

export interface FoldPointResult {
  x: number
  y: number
  z: number
}

// 由抓取点 P(pu,pv)、拖点 Q(qu,qv) 计算折线；P≈Q（未折）返回 null。
// bend 为折缝圆弧的弧长，tilt 为翻起平面的微开角（调用方随翻页进度
// 压平二者：进度→1 时 bend/tilt→0，纸摊平落页无跳变）
export function computeCrease(
  pu: number,
  pv: number,
  qu: number,
  qv: number,
  bend = 0,
  tilt = FOLD_TILT,
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
    tilt,
  }
}

// 单顶点折角变换：s 为自书脊起算的页宽坐标 [0,W]，y 为页高坐标 [-H/2,H/2]。
// 纸跨过折线（d<0 侧）的剖面：底平面 → 折缝圆弧（弧长守恒，转过
// Φ = π − tilt）→ 翻起平面（绕折线翘 tilt 角延伸）。
// - 未翻折侧（d≥0）原位不动；
// - bend = 0：无圆角，镜像后绕折线刚性翘 tilt（跟手精确）；
// - bend > 0：a≤bend 段走半径 R = bend/Φ 的圆弧（z 单调升至弧顶，
//   旧式 z = a·sinψ 把直线距离当弧长用，ψ 过 90° 后 z 回落——
//   "塌回平面"形成第二条平行折线，即布匹感的根源）；a>bend 段
//   自弧末端相切接入翘面（切线斜率一致，无第二条折线）。
// 翻起纸角的 footprint 因弧的卷起略向折线收拢（滞后约 bend 量级），
// 与真实纸张一致；调用方随翻页进度把 bend/tilt 压向 0，落页摊平。
export function foldPoint(s: number, y: number, crease: FoldCrease): FoldPointResult {
  const d = crease.nx * s + crease.ny * y - crease.c
  if (d >= 0) return { x: s, y, z: 0 }
  const a = -d
  const { bend, tilt, nx, ny } = crease
  const sinT = Math.sin(tilt)
  const cosT = Math.cos(tilt)
  // 以下 offset 均为相对原始顶点（位于折线 −a 侧）的位移：目标带符号
  // 距离减 (−a)。原始顶点带符号距离为 −a，位移 = 目标 + a
  if (bend <= 0) {
    // 纯镜像 + 绕折线翘 tilt：目标 = a·cosT，位移 = a(1+cosT)，抬升 a·sinT
    return {
      x: s + a * (1 + cosT) * nx,
      y: y + a * (1 + cosT) * ny,
      z: a * sinT + FOLD_LIFT,
    }
  }
  const phi = Math.PI - tilt
  const R = bend / phi
  if (a <= bend) {
    // 弧段：纸自折线绕圆心在折线上方 R 处的圆柱卷起，ψ = Φ·a/bend。
    // 目标带符号距离 = −R·sinψ（卷起初期略越过折线），高度 R(1−cosψ)
    const psi = (phi * a) / bend
    const offset = a - R * Math.sin(psi)
    return {
      x: s + offset * nx,
      y: y + offset * ny,
      z: R * (1 - Math.cos(psi)) + FOLD_LIFT * (a / bend),
    }
  }
  // 翘面段：自弧末端（带符号距离 −R·sinT、高度 R(1+cosT)）沿 (cosT, sinT)
  // 方向延伸。目标带符号距离 = −R·sinT + (a−bend)·cosT
  const offset = a - R * sinT + (a - bend) * cosT
  return {
    x: s + offset * nx,
    y: y + offset * ny,
    z: R * (1 + cosT) + (a - bend) * sinT + FOLD_LIFT,
  }
}

// 折角翻页进度：外缘角自页外缘 (s=W) 拖到对侧镜像位 (-W) 为 1，
// 角点越过书脊 (s<0) 后过半。用于提交判定与纸叠插值。
export function foldProgress(qu: number, width: number): number {
  if (width <= 0) return 0
  return Math.min(1, Math.max(0, (width - qu) / (2 * width)))
}

// 折线与书脊边（s=0）交点的 y 坐标：折线竖直（qv≈pv，平行于书脊）时
// 返回 null（不相交）。交点落在书脊边内侧（|y| < height/2）意味着
// 翻折区域覆盖了书脊边缘的书页——装订处的纸被镜像拉离原位，
// 视觉上书页与书脊"撕开"
function spineCrossY(pu: number, pv: number, qu: number, qv: number): number | null {
  if (Math.abs(qv - pv) < 1e-6) return null
  return (qu * qu + qv * qv - pu * pu - pv * pv) / (2 * (qv - pv))
}

/**
 * 书脊约束下的拖点钳制：折线切入书脊边内侧时，将拖点 Q 沿抓取点方向
 * 收缩（qv → pv），直到折线与书脊边的交点退到页角以外（|y| ≥ height/2
 * 或折线竖直）。真实纸张此时被装订线绷住，折角停在极限位——拖点的
 * 水平分量（翻页进度）不受影响，仅折角高度被约束。
 * 与 turn.js 4 在折叠角超过 90° 时钳制拖点 y 并重算的策略等价。
 */
export function clampFoldDragToSpine(
  pu: number,
  pv: number,
  qu: number,
  qv: number,
  height: number,
): { qu: number; qv: number } {
  const half = Math.abs(height) / 2
  const y0 = spineCrossY(pu, pv, qu, qv)
  if (y0 === null || Math.abs(y0) >= half) return { qu, qv }
  // 二分收缩 t：qv(t) = pv + (qv−pv)·t，找最大 t 使交点退出书脊内侧。
  // t→0 时折线退化为竖直（P≈Q 未折），必然安全；y0 随 t 连续且至多一个
  // 危险区间，16 次迭代精度足够（每次 pointermove 调用，开销可忽略）
  let lo = 0
  let hi = 1
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2
    const qvT = pv + (qv - pv) * mid
    const y = spineCrossY(pu, pv, qu, qvT)
    if (y === null || Math.abs(y) >= half) lo = mid
    else hi = mid
  }
  return { qu, qv: pv + (qv - pv) * lo }
}
