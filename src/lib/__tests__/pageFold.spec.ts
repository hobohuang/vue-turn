import { describe, expect, it } from 'vitest'

import {
  clampFoldDragToSpine,
  computeCrease,
  FOLD_LIFT,
  foldPoint,
  foldProgress,
} from '@/lib/pageFold'

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

  it('翻折区顶点镜像：抓取点 P 落在拖点 Q 上', () => {
    const Q = { u: 0.3, v: -0.2 }
    const crease = computeCrease(W, -H / 2, Q.u, Q.v, BEND)!
    const p = foldPoint(W, -H / 2, crease)
    expect(p.x).toBeCloseTo(Q.u, 6)
    expect(p.y).toBeCloseTo(Q.v, 6)
    expect(p.z).toBeCloseTo(FOLD_LIFT, 6)
  })

  it('深度翻折顶点为折线镜像且微抬', () => {
    const crease = computeCrease(W, -H / 2, 0.3, -0.2, BEND)!
    // 取一个远超 bend 带的翻折侧顶点（折线附近取距折线 > bend 的点）
    const s = W
    const y = -H / 2
    const d = crease.nx * s + crease.ny * y - crease.c
    expect(d).toBeLessThan(-BEND)
    const p = foldPoint(s, y, crease)
    // 镜像点仍在折线另一侧对称位置
    const dMirror = crease.nx * p.x + crease.ny * p.y - crease.c
    expect(dMirror).toBeCloseTo(-d, 6)
    expect(p.z).toBeCloseTo(FOLD_LIFT, 10)
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

  it('bend=0 时为锐利折线（无圆弧带）', () => {
    const crease = computeCrease(W, -H / 2, 0.3, -0.2, 0)!
    const p = foldPoint(W, -H / 2, crease)
    expect(p.x).toBeCloseTo(0.3, 6)
    expect(p.z).toBeCloseTo(FOLD_LIFT, 10)
  })

  it('整页折过（Q 为对侧镜像位）时折线即书脊', () => {
    const crease = computeCrease(W, -H / 2, -W, -H / 2, BEND)!
    // 书脊 u=0 上各点到折线距离为 0（原位不动），外缘全部镜像到负侧
    const spine = foldPoint(0, 0.5, crease)
    expect(spine.x).toBeCloseTo(0, 10)
    const outer = foldPoint(W, -H / 2, crease)
    expect(outer.x).toBeCloseTo(-W, 6)
    const outerMid = foldPoint(W, 0, crease)
    expect(outerMid.x).toBeCloseTo(-W, 6)
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
