export function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

export function flipAngle(t: number) {
  return Math.PI * easeInOutCubic(t)
}

export function curledColumns(theta: number, amp: number, width: number, columns: number) {
  const xs = new Float32Array(columns + 1)
  const zs = new Float32Array(columns + 1)
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
