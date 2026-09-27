export function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

// 分段数 → 采样缓冲的复用缓存：curledColumns 由 deformSheet 每帧调用，
// 每帧新建 Float32Array 是纯 GC 压力；同分段数复用同一组缓冲（单线程
// 渲染循环内同步使用，无并发问题）
const curlBufferCache = new Map<number, { xs: Float32Array; zs: Float32Array }>()

export function curledColumns(theta: number, amp: number, width: number, columns: number) {
  let buffers = curlBufferCache.get(columns)
  if (!buffers) {
    buffers = { xs: new Float32Array(columns + 1), zs: new Float32Array(columns + 1) }
    curlBufferCache.set(columns, buffers)
  }
  const { xs, zs } = buffers
  xs[0] = 0
  zs[0] = 0
  const sub = 4
  const total = columns * sub
  const ds = width / total
  let x = 0
  let z = 0
  let prev = theta
  for (let i = 1; i <= total; i++) {
    const q = (i * ds) / width
    const angle = theta + amp * q * (2 - q)
    const mid = (prev + angle) / 2
    x += Math.cos(mid) * ds
    z += Math.sin(mid) * ds
    prev = angle
    if (i % sub === 0) {
      const col = i / sub
      xs[col] = x
      zs[col] = z
    }
  }
  return { xs, zs }
}
