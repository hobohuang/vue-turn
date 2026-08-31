import { describe, expect, it } from 'vitest'

import {
  clampFoldDragToSpine,
  computeCrease,
  FOLD_LIFT,
  foldPoint,
  foldProgress,
  FOLD_TILT,
} from '@/lib/pageFold'

const TILT_SIN = Math.sin(FOLD_TILT)

const W = 1.5
const H = 2
const BEND = 0.24

describe('computeCrease', () => {
  it('P≈Q（未折）返回 null', () => {
    expect(computeCrease(W, -H / 2, W, -H / 2, BEND)).toBeNull()
    expect(computeCrease(W, -H / 2, W + 1e-5, -H / 2, BEND)).toBeNull()
  })

  it('折线为 P→Q 垂直平分线：P 与 Q 到折线距离相等', () => {
    const crease = computeCrease(W, -H / 2, 0.3, 0.2, BEND)
    expect(crease).not.toBeNull()
    const dP = crease!.nx * W + crease!.ny * -H / 2 - crease!.c
    const dQ = crease!.nx * 0.3 + crease!.ny * 0.2 - crease!.c
    expect(dP).toBeCloseTo(-dQ, 10)
    // P 在翻折侧（负距离）
    expect(dP).toBeLessThan(0)
  })
})

describe('foldPoint', () => {
  it('未翻折侧顶点原位不动', () => {
    const crease = computeCrease(W, -H / 2, 0.3, -0.2, BEND)!
    // 书脊附近点在折线另一侧
    const p = foldPoint(0.05, 0, crease)
    expect(p.x).toBeCloseTo(0.05, 10)
    expect(p.y).toBeCloseTo(0, 10)
    expect(p.z).toBeCloseTo(0, 10)
  })

  it('翻折区顶点：翻起页翻过折线盖住底面（P 落在 Q 附近并抬升）', () => {
    // 生产默认折缝弧长（0.04 × 页宽 1.5）
    const B = 0.06
    const Q = { u: 0.3, v: -0.2 }
    const crease = computeCrease(W, -H / 2, Q.u, Q.v, B)!
    const p = foldPoint(W, -H / 2, crease)
    const dP = crease.nx * W + crease.ny * -H / 2 - crease.c
    const a = -dP
    expect(a).toBeGreaterThan(B)
    // 回归守卫：翻起页必须翻过折线（输出带符号距离 > 0）——
    // 位移公式符号错误时整页被压缩回折线 −a 侧（"折页不显示"）
    const dOut = crease.nx * p.x + crease.ny * p.y - crease.c
    expect(dOut).toBeGreaterThan(0)
    // 独立推导（弧末端切线延伸）：dOut = (a−B)·cosθ − R·sinθ
    const R = B / (Math.PI - FOLD_TILT)
    const sinT = Math.sin(FOLD_TILT)
    const cosT = Math.cos(FOLD_TILT)
    expect(dOut).toBeCloseTo((a - B) * cosT - R * sinT, 6)
    // P 落在 Q 附近（镜像 + 弧滞后 O(bend) 量级，不得被压回折线）
    expect(Math.hypot(p.x - Q.u, p.y - Q.v)).toBeLessThan(3 * B)
    // 高度 = 弧顶 R(1+cosθ) + (a−B)·sinθ + LIFT（不塌、单调爬升）
    expect(p.z).toBeCloseTo(R * (1 + cosT) + (a - B) * sinT + FOLD_LIFT, 6)
    expect(p.z).toBeGreaterThan(FOLD_LIFT)
  })

  it('折缝弧段 z 单调升至弧顶（不塌回平面，无双折痕）', () => {
    const crease = computeCrease(W, -H / 2, 0.3, -0.2, BEND)!
    const R = BEND / (Math.PI - FOLD_TILT)
    // 沿法向扫描弧段 [0, bend]，z 必须单调不降
    let prevZ = -1
    const mid = { x: (W + 0.3) / 2, y: (-H / 2 - 0.2) / 2 }
    for (let i = 0; i <= 20; i++) {
      const a = (i / 20) * BEND
      const s = mid.x - a * crease.nx
      const y = mid.y - a * crease.ny
      const p = foldPoint(s, y, crease)
      expect(p.z).toBeGreaterThanOrEqual(prevZ - 1e-9)
      prevZ = p.z
    }
    // 弧顶高度 ≈ 2R（tilt 小时），明显高于纯垫高
    expect(prevZ).toBeGreaterThan(R * 1.9)
  })

  it('bend 带边界连续过渡（无跳变）', () => {
    const crease = computeCrease(W, -H / 2, 0.6, -0.6, BEND)!
    // 沿折线法向扫描，记录相邻采样点的最大位移（bend 带边界应无跳变）
    let prev: ReturnType<typeof foldPoint> | null = null
    let maxStep = 0
    for (let i = 0; i <= 60; i++) {
      const d = -BEND * 1.5 + (i / 60) * BEND * 3
      // 构造距折线 d 的点：取折线上一点加法向偏移
      const base = { x: W * 0.5, y: -H * 0.25 }
      const off = crease.nx * base.x + crease.ny * base.y - crease.c
      const s = base.x + (d - off) * crease.nx
      const y = base.y + (d - off) * crease.ny
      const p = foldPoint(s, y, crease)
      if (prev) {
        maxStep = Math.max(maxStep, Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z))
      }
      prev = p
    }
    expect(maxStep).toBeLessThan(BEND * 0.2)
  })

  it('bend=0 时为锐利折线（无圆弧带）且翻起部分微翘', () => {
    const crease = computeCrease(W, -H / 2, 0.3, -0.2, 0)!
    const p = foldPoint(W, -H / 2, crease)
    expect(p.x).toBeCloseTo(0.3, 2)
    // 微开角抬升：a·sinθ + FOLD_LIFT
    const d = crease.nx * W + crease.ny * -H / 2 - crease.c
    expect(p.z).toBeCloseTo(-d * TILT_SIN + FOLD_LIFT, 6)
  })

  it('翻起平面为刚性倾斜：同距折线等高，高度随距离线性增长（无鼓包）', () => {
    const crease = computeCrease(W, -H / 2, 0.3, -0.2, 0)!
    // 取翻折侧同一法向距离 a 的多个点（折线平行线上）：z 应相等
    // （绕折线刚体旋转的等高线是折线的平行线，而非任何鼓起弧面）
    const a = 0.6
    // 垂足取 P、Q 中点（垂直平分线过中点），沿折线方向偏移 t
    const mid = { x: (W + 0.3) / 2, y: (-H / 2 - 0.2) / 2 }
    for (const t of [-0.5, 0, 0.5]) {
      const foot = { x: mid.x + t * -crease.ny, y: mid.y + t * crease.nx }
      const s = foot.x - a * crease.nx
      const y = foot.y - a * crease.ny
      const p = foldPoint(s, y, crease)
      expect(p.z).toBeCloseTo(a * TILT_SIN + FOLD_LIFT, 6)
    }
  })

  it('整页折过（Q 为对侧镜像位）时折线即书脊；落页压平后回到镜像位', () => {
    // 折缝压平（bend=0，对应翻页进度→1 的落页态）：外缘回到镜像位 −W
    const flat = computeCrease(W, -H / 2, -W, -H / 2, 0)!
    const spine = foldPoint(0, 0.5, flat)
    expect(spine.x).toBeCloseTo(0, 10)
    const outer = foldPoint(W, -H / 2, flat)
    expect(outer.x).toBeCloseTo(-W, 2)
    expect(outer.z).toBeCloseTo(W * Math.sin(FOLD_TILT) + FOLD_LIFT, 4)
    // 未压平时（折角中段）：外缘因弧卷起向折线收拢（真实纸性滞后）
    const crease = computeCrease(W, -H / 2, -W, -H / 2, BEND)!
    const folded = foldPoint(W, -H / 2, crease)
    expect(folded.x).toBeGreaterThan(-W)
    expect(folded.x).toBeLessThan(0)
  })
})

describe('foldProgress', () => {
  it('未拖为 0，角点拖到对侧镜像位为 1，越 spine 过半', () => {
    expect(foldProgress(W, W)).toBe(0)
    expect(foldProgress(-W, W)).toBe(1)
    expect(foldProgress(0, W)).toBeCloseTo(0.5, 10)
    expect(foldProgress(W * 2, W)).toBe(0) // 向外拖无效
  })
})

describe('clampFoldDragToSpine', () => {
  // 折线与书脊边交点的 y（与实现同式，测试内联验证约束达成）
  const crossY = (pu: number, pv: number, qu: number, qv: number) =>
    (qu * qu + qv * qv - pu * pu - pv * pv) / (2 * (qv - pv))

  it('竖直折线（qv=pv，折页拖拽）原样通过', () => {
    const out = clampFoldDragToSpine(W, 0.3, 0.4, 0.3, H)
    expect(out.qu).toBe(0.4)
    expect(out.qv).toBe(0.3)
  })

  it('折线交点在书脊边外（正常角区折角）原样通过', () => {
    // 右上角抓取，轻折：交点 y0 = 4.26 > H/2
    const out = clampFoldDragToSpine(W, H / 2, 1.26, 0.9, H)
    expect(out.qu).toBe(1.26)
    expect(out.qv).toBe(0.9)
  })

  it('上下拉动导致折线切入书脊内侧时收缩 qv 至交点退到页角外', () => {
    // 抓右上角拉向左下：原始交点 y0≈0.55 落在书脊内侧（|0.55| < 1）
    const out = clampFoldDragToSpine(W, H / 2, 0.2, -1, H)
    expect(out.qu).toBe(0.2) // 水平分量（翻页进度）不受影响
    const y = crossY(W, H / 2, out.qu, out.qv)
    expect(Math.abs(y)).toBeGreaterThanOrEqual(H / 2 - 1e-3)
    // qv 向抓取点方向收缩（未拉到底）
    expect(out.qv).toBeGreaterThan(-1)
    expect(out.qv).toBeLessThan(H / 2)
  })

  it('钳制后书脊边顶点不再落入翻折侧', () => {
    const out = clampFoldDragToSpine(W, H / 2, 0.2, -1, H)
    const crease = computeCrease(W, H / 2, out.qu, out.qv, BEND)!
    // 书脊边中点与两端的折线距离均 ≥ 0（不在翻折侧）
    for (const y of [-H / 2, 0, H / 2]) {
      // 书脊边 s=0 上的点：d = nx·0 + ny·y − c
      const d = crease.ny * y - crease.c
      expect(d).toBeGreaterThanOrEqual(-1e-6)
    }
  })

  it('整页翻折目标（Q 为对侧镜像位）不受钳制影响', () => {
    const out = clampFoldDragToSpine(W, -H / 2, -W, -H / 2, H)
    expect(out.qu).toBe(-W)
    expect(out.qv).toBe(-H / 2)
  })
})
