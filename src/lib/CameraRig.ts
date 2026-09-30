import * as THREE from 'three'

import { PAGE_HEIGHT } from './flipSpec'
import { clamp, positive } from './math'
import { easeInOutCubic } from './pageCurl'

// 相机适配边距默认值：视口相对书宽的外扩比例，越大留白越多
const DEFAULT_FIT_MARGIN = 1.12
// 最大缩放倍数默认值
const DEFAULT_MAX_ZOOM = 3

interface CameraTarget {
  x: number
  y: number
  z: number
}

interface CameraAnim {
  from: CameraTarget
  to: CameraTarget
  start: number
  duration: number
}

export interface CameraRigOptions {
  /** 透视参考距离（像素），越小透视越强 */
  perspective: number
  /** 相机适配边距（视口外扩比例） */
  fitMargin: number
  /** 最大缩放倍数（交互参数，可运行时更新） */
  maxZoom: number
  /** 初始适配宽度（页面布局 + 纸叠厚度） */
  initialFitWidth: number
}

/**
 * 相机装配：管理透视相机、适配距离、缩放级别与平移钳制。
 *
 * 适配模型：相机距离 = fitDistance(适配宽度) / 缩放级别，
 * 适配宽度由编排层（TurnScene）随布局变化通过 setFitWidth 更新。
 * 翻页/拖拽进行中的守卫（sheet 存在时禁缩放平移）由编排层负责。
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera
  private readonly perspective: number
  private readonly fitMargin: number
  private maxZoom: number
  // 当前缩放级别（1 为未缩放），显式维护，resize/布局变化时按它重新适配相机距离
  private zoomLevel = 1
  // 当前布局适配宽度（不含纸叠，由编排层计算后推送）
  private fitWidth: number
  private camTarget: CameraTarget = { x: 0, y: 0, z: 10 }
  private camAnim: CameraAnim | null = null
  private ready = false
  private canvasW = 0
  private canvasH = 0

  constructor(options: CameraRigOptions) {
    this.perspective = positive(options.perspective, 2400)
    this.fitMargin = positive(options.fitMargin, DEFAULT_FIT_MARGIN)
    this.maxZoom = positive(options.maxZoom, DEFAULT_MAX_ZOOM)
    this.fitWidth = positive(options.initialFitWidth, 1)

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100)
    this.camera.position.set(0, 0, 10)
    this.camera.lookAt(0, 0, 0)
  }

  // 按相机距离动态更新裁剪面：near/far 比恒为 1/200（默认 0.01/100 的比
  // 是 1/10000）。超宽书（pageAspect 大）适配距离可达 ~75，固定 far=100
  // 时深度精度不足，纸张背贴（偏移 0.002）会 z-fighting；near 随距离放大
  // 后精度恢复。每帧按当前距离收敛，动画中途也正确
  private updateClipping(z: number) {
    const near = Math.max(0.01, z * 0.02)
    const far = Math.max(100, z * 4)
    if (near === this.camera.near && far === this.camera.far) return
    this.camera.near = near
    this.camera.far = far
    this.camera.updateProjectionMatrix()
  }

  /** 画布尺寸变化：更新纵横比与 fov（首次调用后相机视为就绪） */
  resize(width: number, height: number) {
    this.canvasW = width
    this.canvasH = height
    this.ready = true
    this.camera.aspect = width / height
    this.fitCamera()
  }

  get isAnimating() {
    return this.camAnim !== null
  }

  // 编排层更新适配宽度（页面布局 + 纸叠厚度）
  setFitWidth(width: number) {
    this.fitWidth = width
  }

  // 当前缩放级别：1 为未缩放
  getZoom() {
    return this.zoomLevel
  }

  // 运行时更新最大缩放倍数：当前级别超出新上限时立即收敛
  setMaxZoom(value: number) {
    this.maxZoom = positive(value, DEFAULT_MAX_ZOOM)
    if (this.zoomLevel > this.maxZoom) this.setZoom(this.zoomLevel)
  }

  // 空闲时按 fitWidth 与 zoomLevel 重新适配相机距离。
  // 相机动画进行中、画布尺寸未知时跳过（随后由动画终点或下一次 resize 收敛）。
  // 返回 camTarget 是否更新（调用方据此补渲染一帧）
  refit(): boolean {
    if (!this.ready || this.camAnim) return false
    const z = this.fitDistance(this.fitWidth) / this.zoomLevel
    if (!Number.isFinite(z) || z <= 0) return false
    this.camTarget = {
      x: this.clampPanX(this.camTarget.x, z),
      y: this.clampPanY(this.camTarget.y, z),
      z,
    }
    return true
  }

  // 设置缩放级别（钳制到 [1, maxZoom]），距离按当前适配宽度换算。
  // 画布尺寸未知（容器 0 尺寸/display:none）时适配距离非有限，跳过——
  // 否则相机被推到 Infinity/NaN，画面全空且缩放路径不会自愈
  setZoom(level: number, animate = true, duration = 200) {
    const clamped = clamp(Number.isFinite(level) ? level : 1, 1, this.maxZoom)
    const z = this.fitDistance(this.fitWidth) / clamped
    if (!Number.isFinite(z) || z <= 0) return
    this.zoomLevel = clamped
    const x = this.clampPanX(this.camTarget.x, z)
    const y = this.clampPanY(this.camTarget.y, z)
    if (animate && duration > 0) {
      this.animateCameraTo(z, x, y, duration)
    } else {
      this.snapCamera(z, x, y)
    }
  }

  // 按屏幕像素平移相机（放大后拖动查看），平移量钳制在可视范围内。
  // 相机动画进行中：从当前位置继续平移并打断动画——若基于动画目标距离
  // 计算，相机会在一帧内跳到目标距离
  panBy(dxPixels: number, dyPixels: number) {
    if (this.canvasW <= 0 || this.canvasH <= 0) return
    if (this.camAnim) {
      this.camTarget = {
        x: this.camera.position.x,
        y: this.camera.position.y,
        z: this.camera.position.z,
      }
      this.camAnim = null
    }
    const z = this.camTarget.z
    const vFov = (this.camera.fov * Math.PI) / 180
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect)
    const worldPerPxX = (2 * z * Math.tan(hFov / 2)) / this.canvasW
    const worldPerPxY = (2 * z * Math.tan(vFov / 2)) / this.canvasH
    this.camTarget = {
      x: this.clampPanX(this.camTarget.x + dxPixels * worldPerPxX, z),
      y: this.clampPanY(this.camTarget.y - dyPixels * worldPerPxY, z),
      z,
    }
  }

  // 相机复位到指定适配宽度对应的距离，缩放级别归 1。
  // duration > 0 从当前位置动画过渡，否则直接吸附（翻页动画接管/收尾用）。
  // 画布尺寸未知时适配距离非有限，跳过（随后由 resize 收敛）
  resetTo(fitWidth: number, duration: number, startTime?: number) {
    const z = this.fitDistance(fitWidth)
    if (!Number.isFinite(z) || z <= 0) return
    this.zoomLevel = 1
    if (duration > 0) {
      this.animateCameraTo(z, 0, 0, duration, startTime)
    } else {
      this.snapCamera(z, 0, 0)
    }
  }

  // 冻结相机动画：停在当前位置（上下文丢失等渲染中断场景用，
  // 恢复后由 refit/下一次动画收敛）
  cancelAnimation() {
    if (!this.camAnim) return
    this.camTarget = {
      x: this.camera.position.x,
      y: this.camera.position.y,
      z: this.camera.position.z,
    }
    this.camAnim = null
  }

  // 逐帧驱动：动画中插值相机位置；静止时贴合 camTarget。
  // 返回动画是否在本帧结束（调用方据此补渲染终点帧）
  update(now: number): boolean {
    const anim = this.camAnim
    if (anim) {
      const t = Math.min(1, (now - anim.start) / anim.duration)
      const eased = easeInOutCubic(t)
      this.camera.position.set(
        anim.from.x + (anim.to.x - anim.from.x) * eased,
        anim.from.y + (anim.to.y - anim.from.y) * eased,
        anim.from.z + (anim.to.z - anim.from.z) * eased,
      )
      this.updateClipping(this.camera.position.z)
      if (t >= 1) {
        this.camAnim = null
        return true
      }
      return false
    }
    this.camera.position.set(this.camTarget.x, this.camTarget.y, this.camTarget.z)
    this.updateClipping(this.camTarget.z)
    return false
  }

  // 适配距离：按水平/垂直视野中需求更大的一侧留出 fitMargin 余量
  private fitDistance(fitWidth: number) {
    const vFov = 2 * Math.atan(this.canvasH / (2 * this.perspective))
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (this.canvasW / this.canvasH))
    return Math.max(
      (fitWidth * this.fitMargin) / (2 * Math.tan(hFov / 2)),
      (PAGE_HEIGHT * this.fitMargin) / (2 * Math.tan(vFov / 2)),
    )
  }

  private fitCamera() {
    if (this.canvasW <= 0 || this.canvasH <= 0) return
    const vFov = 2 * Math.atan(this.canvasH / (2 * this.perspective))
    this.camera.fov = (vFov * 180) / Math.PI
    this.camera.updateProjectionMatrix()
  }

  // 平移钳制：书本不超出可视范围
  private clampPanX(x: number, z: number) {
    const vFov = (this.camera.fov * Math.PI) / 180
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect)
    const visibleWidth = 2 * z * Math.tan(hFov / 2)
    const maxX = Math.max(0, (visibleWidth - this.fitWidth) / 2)
    return clamp(x, -maxX, maxX)
  }

  private clampPanY(y: number, z: number) {
    const vFov = (this.camera.fov * Math.PI) / 180
    const visibleHeight = 2 * z * Math.tan(vFov / 2)
    const maxY = Math.max(0, (visibleHeight - PAGE_HEIGHT) / 2)
    return clamp(y, -maxY, maxY)
  }

  private animateCameraTo(z: number, x: number, y: number, duration: number, startTime?: number) {
    const start = startTime ?? performance.now()
    this.camTarget = { x, y, z }
    this.camAnim = {
      from: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
      to: { x, y, z },
      start,
      duration,
    }
  }

  private snapCamera(z: number, x: number, y: number) {
    this.camAnim = null
    this.camTarget = { x, y, z }
    this.camera.position.set(x, y, z)
  }
}
