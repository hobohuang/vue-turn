import { describe, expect, it } from 'vitest'

import { FOLD_LIFT, computeCrease, foldPoint, foldProgress } from '@/lib/pageFold'

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
