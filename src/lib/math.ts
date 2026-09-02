// 数值工具：全库共用的校验与钳制，替代各模块的本地拷贝

/** 数值校验：仅接受有限正数，否则回退 fallback */
export function positive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
