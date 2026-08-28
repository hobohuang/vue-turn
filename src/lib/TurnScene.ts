import * as THREE from 'three'

import { PAGE_HEIGHT, pageWidth } from '@/lib/flipSpec'
import { curledColumns, easeInOutCubic } from '@/lib/pageCurl'
import type { EasingFn, FlipSheetOptions, FlipSpec, StaticPlacement } from '@/types/turn'

const STATIC_Z = -0.01
// 相机适配边距默认值：视口相对书宽的外扩比例，越大留白越多
const DEFAULT_FIT_MARGIN = 1.12
// 渲染像素比默认上限：平衡清晰度与性能
const DEFAULT_MAX_PIXEL_RATIO = 2
// 最大缩放倍数默认值
const DEFAULT_MAX_ZOOM = 3
// 拖拽松手后回弹/补完动画的最短时长
const MIN_SETTLE_DURATION = 120

function positive(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function createRenderer(): THREE.WebGLRenderer | null {
  const probe = document.createElement('canvas')
  if (!probe.getContext('webgl2') && !probe.getContext('webgl')) return null
  try {
    return new THREE.WebGLRenderer({ antialias: true, alpha: true })
  } catch {
    return null
  }
}

export interface TurnSceneOptions {
  container: HTMLElement
  pageAspect: number
  nPolygons?: number
  perspective?: number
  ambient?: number
  gloss?: number
  curl?: number
  // 相机适配边距（视口外扩比例）
  fitMargin?: number
  // 渲染像素比上限
  maxPixelRatio?: number
  // 最大缩放倍数
  maxZoom?: number
  // 翻页进度缓动函数
  easing?: EasingFn
  // WebGL 上下文恢复回调：调用方应重建静态页并重光栅化窗口内纹理
  onContextRestored?: () => void
}

/** 页面拾取结果：index 为页索引，u/v 为命中点纹理坐标（v 从底边起算） */
export interface PagePick {
  index: number
  u: number
  v: number
  /** 命中的是跨页合并网格（uv 覆盖整个跨页项） */
  spread: boolean
}

type SheetMode = 'time' | 'drag' | 'settle'

interface SheetState {
  group: THREE.Group
  front: THREE.Mesh
  back: THREE.Mesh
  geometry: THREE.BufferGeometry
  backGeometry: THREE.BufferGeometry
  frontMaterial: THREE.MeshLambertMaterial
  backMaterial: THREE.MeshLambertMaterial
  baseS: Float32Array
  sign: number
  worldFromX: number
  worldToX: number
  startTime: number
  duration: number
  onDone: ((committed: boolean) => void) | null
  mode: SheetMode
  /** 卷曲幅度（硬页为 0） */
  curl: number
  /** drag/settle 当前进度 [0,1] */
  progress: number
  /** settle 起始进度 */
  p0: number
  /** settle 目标进度（0 取消 / 1 完成） */
  target: number
  fromFitWidth: number
  toFitWidth: number
}

interface StaticEntry {
  mesh: THREE.Mesh
  material: THREE.MeshLambertMaterial
  fromX: number
  toX: number
  // fromSlot 显式给出时，起始位置已是世界坐标，不再叠加世界偏移
  fromIsWorld: boolean
  index: number
  spread: boolean
}

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

export class TurnScene {
  private readonly container: HTMLElement
  private readonly pageAspect: number
  private readonly nPolygons: number
  private readonly perspective: number
  private readonly curl: number
  private readonly fitMargin: number
  private readonly maxZoom: number
  private readonly easing: EasingFn
  private readonly sheetWidth: number
  private readonly renderer: THREE.WebGLRenderer | null
  private contextLost = false
  private readonly onContextRestored?: () => void
  private readonly scene = new THREE.Scene()
  private readonly camera: THREE.PerspectiveCamera
  private readonly raycaster = new THREE.Raycaster()
  private readonly staticMeshes = new Map<number, StaticEntry>()
  private sheet: SheetState | null = null
  private targetFitWidth: number
  // 当前缩放级别（1 为未缩放），显式维护，resize/布局变化时按它重新适配相机距离
  private zoomLevel = 1
  private camTarget: CameraTarget = { x: 0, y: 0, z: 10 }
  private camAnim: CameraAnim | null = null
  private cameraReady = false
  private canvasW = 0
  private canvasH = 0
  private rafId = 0
  private disposed = false

  constructor(options: TurnSceneOptions) {
    this.container = options.container
    this.pageAspect = positive(options.pageAspect, 0.75)
    this.nPolygons = Math.round(positive(options.nPolygons ?? 64, 64))
    this.perspective = positive(options.perspective ?? 2400, 2400)
    this.curl = options.curl ?? 0.8
    this.fitMargin = positive(options.fitMargin ?? DEFAULT_FIT_MARGIN, DEFAULT_FIT_MARGIN)
    this.maxZoom = positive(options.maxZoom ?? DEFAULT_MAX_ZOOM, DEFAULT_MAX_ZOOM)
    this.easing = options.easing ?? easeInOutCubic
    this.sheetWidth = pageWidth(this.pageAspect)
    this.targetFitWidth = this.sheetWidth * 2

    this.renderer = createRenderer()
    this.onContextRestored = options.onContextRestored
    if (this.renderer) {
      const maxPixelRatio = positive(
        options.maxPixelRatio ?? DEFAULT_MAX_PIXEL_RATIO,
        DEFAULT_MAX_PIXEL_RATIO,
      )
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPixelRatio))
      this.renderer.setClearColor(0x000000, 0)
      this.container.appendChild(this.renderer.domElement)
      this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost)
      this.renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestoredHandler)
    }

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100)
    this.camera.position.set(0, 0, 10)
    this.camera.lookAt(0, 0, 0)
    this.scene.add(this.camera)

    this.scene.add(new THREE.AmbientLight(0xffffff, options.ambient ?? 1))
    const gloss = new THREE.DirectionalLight(0xffffff, options.gloss ?? 0.35)
    gloss.position.set(0.4, 0.9, 1.2)
    this.scene.add(gloss)

    this.rafId = requestAnimationFrame(this.tick)
  }

  get isFlipping() {
    return this.sheet !== null
  }

  get hasRenderer() {
    return this.renderer !== null
  }

  // 渲染器实际支持的最大各向异性过滤等级；无渲染器时返回 1（关闭）
  get maxAnisotropy() {
    return this.renderer ? this.renderer.capabilities.getMaxAnisotropy() : 1
  }

  private onContextLost = (event: Event) => {
    event.preventDefault()
    this.contextLost = true
    // 上下文丢失后动画无法继续，提交翻页回调避免状态锁死；
    // 拖拽/回弹中的纸张按取消处理（onDone 参数缺省为 falsy）
    const sheet = this.sheet
    if (sheet) {
      const onDone = sheet.onDone
      this.removeSheet()
      onDone?.(false)
    }
    // 清空静态网格：上下文丢失后几何体/材质失效，恢复时由调用方重建
    for (const entry of this.staticMeshes.values()) {
      this.scene.remove(entry.mesh)
      entry.mesh.geometry.dispose()
      entry.material.dispose()
    }
    this.staticMeshes.clear()
  }

  private onContextRestoredHandler = () => {
    this.contextLost = false
    // 通知调用方重建静态页并重光栅化窗口内纹理
    this.onContextRestored?.()
  }

  resize(width: number, height: number) {
    if (width <= 0 || height <= 0) return
    this.canvasW = width
    this.canvasH = height
    this.cameraReady = true
    this.renderer?.setSize(width, height)
    this.camera.aspect = width / height
    this.fitCamera()
    // 空闲时按当前布局与缩放级别重新适配相机（翻页/缩放动画进行中不打断）
    this.refitCamera()
  }

  // 空闲时按 targetFitWidth 与 zoomLevel 重新适配相机距离；
  // 相机动画或翻页进行中、画布尺寸未知时跳过（随后由动画终点或下一次 resize 收敛）
  private refitCamera() {
    if (!this.cameraReady || this.camAnim || this.sheet) return
    const z = this.fitDistance(this.targetFitWidth) / this.zoomLevel
    if (!Number.isFinite(z) || z <= 0) return
    this.camTarget = {
      x: this.clampPanX(this.camTarget.x, z),
      y: this.clampPanY(this.camTarget.y, z),
      z,
    }
  }

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

  setStaticPages(
    placements: StaticPlacement[],
    textureOf: (index: number) => THREE.Texture | null,
    // false 表示这是翻页前置布局（spec.staticPages），相机由翻页动画接管，不重新适配
    refit = true,
  ) {
    for (const entry of this.staticMeshes.values()) {
      this.scene.remove(entry.mesh)
      entry.mesh.geometry.dispose()
      entry.material.dispose()
    }
    this.staticMeshes.clear()

    this.targetFitWidth = placements.reduce(
      (width, p) =>
        Math.max(width, p.spread ? this.sheetWidth * 2 : Math.abs(this.slotX(p.slot)) * 2 + this.sheetWidth),
      this.sheetWidth,
    )

    for (const p of placements) {
      // 跨页项：双倍宽度网格，纹理为整张跨页图
      const geometry = new THREE.PlaneGeometry(
        p.spread ? this.sheetWidth * 2 : this.sheetWidth,
        PAGE_HEIGHT,
      )
      const material = new THREE.MeshLambertMaterial({ color: 0xffffff })
      const texture = textureOf(p.index)
      if (texture) {
        material.map = texture
        material.color.set(0xffffff)
        material.needsUpdate = true
      }
      const mesh = new THREE.Mesh(geometry, material)
      const fromX = this.slotX(p.fromSlot ?? p.slot)
      mesh.position.set(fromX, 0, STATIC_Z)
      this.scene.add(mesh)
      this.staticMeshes.set(p.index, {
        mesh,
        material,
        fromX,
        toX: this.slotX(p.slot),
        fromIsWorld: p.fromSlot !== undefined,
        index: p.index,
        spread: p.spread === true,
      })
    }
    this.fitCamera()
    // 布局变化（封面居中/跨页/单双页切换/跳转）时相机跟随当前布局适配，
    // 修复初始封面按跨页宽度适配导致的书本偏小；翻页前置布局不触发
    if (refit) this.refitCamera()
  }

  applyStaticTexture(index: number, texture: THREE.Texture) {
    const entry = this.staticMeshes.get(index)
    if (!entry) return
    entry.material.map = texture
    entry.material.needsUpdate = true
  }

  private slotX(slot: 'left' | 'right' | 'center') {
    if (slot === 'left') return -this.sheetWidth / 2
    if (slot === 'right') return this.sheetWidth / 2
    return 0
  }

  // 翻页的世界偏移应用到静态页（封面开合时书本整体平移）；
  // 无 fromSlot 的条目起点属于起始布局，起终点都要叠加偏移
  private applyWorldOffsets(spec: FlipSpec) {
    const worldFromX = spec.worldFromX ?? 0
    const worldToX = spec.worldToX ?? 0
    if (worldFromX === 0 && worldToX === 0) return
    for (const entry of this.staticMeshes.values()) {
      if (!entry.fromIsWorld) {
        entry.fromX = entry.mesh.position.x + worldFromX
        entry.toX += worldToX
      }
    }
  }

  // 创建翻页纸张（几何/材质/镜像），time 与 drag 模式共用
  private createSheet(
    spec: FlipSpec,
    frontTexture: THREE.Texture | null,
    backTexture: THREE.Texture | null,
    curl: number,
    onDone: (committed: boolean) => void,
  ): SheetState | null {
    const worldFromX = spec.worldFromX ?? 0
    const worldToX = spec.worldToX ?? 0

    const geometry = new THREE.PlaneGeometry(this.sheetWidth, PAGE_HEIGHT, this.nPolygons, 2)
    const positions = geometry.attributes.position
    const uvs = geometry.attributes.uv
    const normals = geometry.attributes.normal
    const index = geometry.getIndex()
    if (!positions || !uvs || !normals || !index) return null
    const sign = spec.geometry === 'A' ? 1 : -1
    const baseS = new Float32Array(positions.count)
    for (let i = 0; i < positions.count; i++) {
      const s = positions.getX(i) + this.sheetWidth / 2
      baseS[i] = s
      positions.setX(i, sign * s)
      if (spec.geometry === 'B') {
        uvs.setX(i, 1 - uvs.getX(i))
      }
    }
    positions.needsUpdate = true
    uvs.needsUpdate = true

    let backIndex = index
    if (spec.geometry === 'B') {
      const reversed = index.array.slice().reverse()
      backIndex = new THREE.BufferAttribute(reversed, 1)
      geometry.setIndex(backIndex)
    }
    const backGeometry = new THREE.BufferGeometry()
    backGeometry.setAttribute('position', positions)
    backGeometry.setAttribute('normal', normals)
    backGeometry.setIndex(backIndex)
    const backUvs = uvs.clone()
    for (let i = 0; i < backUvs.count; i++) {
      backUvs.setX(i, 1 - backUvs.getX(i))
    }
    backGeometry.setAttribute('uv', backUvs)

    const frontMaterial = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      side: THREE.FrontSide,
    })
    if (frontTexture) {
      frontMaterial.map = frontTexture
      frontMaterial.needsUpdate = true
    }
    const backMaterial = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      side: THREE.BackSide,
    })
    if (backTexture) {
      backMaterial.map = backTexture
      backMaterial.needsUpdate = true
    }

    const front = new THREE.Mesh(geometry, frontMaterial)
    const back = new THREE.Mesh(backGeometry, backMaterial)
    back.position.z = 0.002
    front.frustumCulled = false
    back.frustumCulled = false

    const group = new THREE.Group()
    group.position.set(spec.hingeX + worldFromX, 0, 0)
    group.add(front)
    group.add(back)
    this.scene.add(group)

    const fromFitWidth = positive(spec.fromFitWidth ?? this.targetFitWidth, this.targetFitWidth)
    const toFitWidth = positive(spec.toFitWidth ?? this.targetFitWidth, this.targetFitWidth)
    return {
      group,
      front,
      back,
      geometry,
      backGeometry,
      frontMaterial,
      backMaterial,
      baseS,
      sign,
      worldFromX,
      worldToX,
      startTime: 0,
      duration: 0,
      onDone,
      mode: 'time',
      curl,
      progress: 0,
      p0: 0,
      target: 1,
      fromFitWidth,
      toFitWidth,
    }
  }

  startFlip(
    spec: FlipSpec,
    frontTexture: THREE.Texture | null,
    backTexture: THREE.Texture | null,
    duration: number,
    onDone: (committed: boolean) => void,
    options?: FlipSheetOptions,
  ) {
    // 渲染不可用时同步提交翻页，保证状态机不会锁死
    if (!this.renderer || this.contextLost) {
      onDone(true)
      return
    }
    if (this.sheet) this.removeSheet()

    this.applyWorldOffsets(spec)
    const sheet = this.createSheet(
      spec,
      frontTexture,
      backTexture,
      options?.curl ?? this.curl,
      onDone,
    )
    if (!sheet) return
    const startTime = performance.now()
    sheet.startTime = startTime
    sheet.duration = positive(duration, 900)
    this.sheet = sheet
    // 相机从当前位置动画到目标适配距离（缩放/平移被一并复位，级别归 1）
    this.zoomLevel = 1
    this.animateCameraTo(this.fitDistance(sheet.toFitWidth), 0, 0, sheet.duration, startTime)
  }

  // 开始拖拽翻页：返回 false 表示渲染不可用，调用方不应进入拖拽状态
  beginDragFlip(
    spec: FlipSpec,
    frontTexture: THREE.Texture | null,
    backTexture: THREE.Texture | null,
    onDone: (committed: boolean) => void,
    options?: FlipSheetOptions,
  ): boolean {
    if (!this.renderer || this.contextLost) return false
    // 已有纸张（折角悬停/上一次拖拽）静默替换，不触发其 onDone
    if (this.sheet) this.removeSheet()

    this.applyWorldOffsets(spec)
    const sheet = this.createSheet(
      spec,
      frontTexture,
      backTexture,
      options?.curl ?? this.curl,
      onDone,
    )
    if (!sheet) return false
    sheet.mode = 'drag'
    sheet.progress = 0
    this.sheet = sheet
    return true
  }

  // 拖拽进度 [0,1]：0 为未翻，1 为完全翻过
  setDragProgress(progress: number) {
    const sheet = this.sheet
    if (!sheet || sheet.mode !== 'drag') return
    sheet.progress = clamp(progress, 0, 1)
  }

  // 拖拽结束：commit 为 true 动画补完翻页，否则回弹取消
  endDragFlip(commit: boolean, baseDuration: number) {
    const sheet = this.sheet
    if (!sheet || sheet.mode !== 'drag') return
    const target = commit ? 1 : 0
    if (sheet.progress === target) {
      this.finishSheet(sheet, commit)
      return
    }
    const startTime = performance.now()
    sheet.mode = 'settle'
    sheet.p0 = sheet.progress
    sheet.target = target
    sheet.startTime = startTime
    sheet.duration = Math.max(
      MIN_SETTLE_DURATION,
      positive(baseDuration, 900) * Math.abs(target - sheet.progress),
    )
    const fitWidth = commit ? sheet.toFitWidth : sheet.fromFitWidth
    // 相机复位到适配距离，缩放级别归 1
    this.zoomLevel = 1
    this.animateCameraTo(this.fitDistance(fitWidth), 0, 0, sheet.duration, startTime)
  }

  // 中断当前翻页并立即收尾：time/settle 按各自终点，drag 按最近端点
  stopFlip() {
    const sheet = this.sheet
    if (!sheet) return
    if (sheet.mode === 'drag') {
      this.finishSheet(sheet, sheet.progress >= 0.5)
    } else if (sheet.mode === 'settle') {
      this.finishSheet(sheet, sheet.target === 1)
    } else {
      this.finishSheet(sheet, true)
    }
  }

  // 立即完成一张纸张：跳到终点、复位相机并触发回调
  private finishSheet(sheet: SheetState, committed: boolean) {
    const fitWidth = committed ? sheet.toFitWidth : sheet.fromFitWidth
    // 相机复位到适配距离，缩放级别归 1
    this.zoomLevel = 1
    this.snapCamera(this.fitDistance(fitWidth), 0, 0)
    if (this.sheet === sheet) this.sheet = null
    this.scene.remove(sheet.group)
    sheet.geometry.dispose()
    sheet.backGeometry.dispose()
    sheet.frontMaterial.dispose()
    sheet.backMaterial.dispose()
    sheet.onDone?.(committed)
  }

  // 当前缩放级别：1 为未缩放
  getZoom() {
    return this.zoomLevel
  }

  // 设置缩放级别（钳制到 [1, maxZoom]）；翻页进行中忽略
  setZoom(level: number, animate = true, duration = 200) {
    if (!this.renderer || this.sheet) return
    const clamped = clamp(Number.isFinite(level) ? level : 1, 1, this.maxZoom)
    this.zoomLevel = clamped
    const z = this.fitDistance(this.targetFitWidth) / clamped
    const x = this.clampPanX(this.camTarget.x, z)
    const y = this.clampPanY(this.camTarget.y, z)
    if (animate && duration > 0) {
      this.animateCameraTo(z, x, y, duration)
    } else {
      this.snapCamera(z, x, y)
    }
  }

  // 按屏幕像素平移相机（放大后拖动查看）；翻页进行中忽略
  panBy(dxPixels: number, dyPixels: number) {
    if (!this.renderer || this.sheet) return
    if (this.canvasW <= 0 || this.canvasH <= 0) return
    const z = this.camTarget.z
    const vFov = (this.camera.fov * Math.PI) / 180
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect)
    const worldPerPxX = (2 * z * Math.tan(hFov / 2)) / this.canvasW
    const worldPerPxY = (2 * z * Math.tan(vFov / 2)) / this.canvasH
    this.camAnim = null
    this.camTarget = {
      x: this.clampPanX(this.camTarget.x + dxPixels * worldPerPxX, z),
      y: this.clampPanY(this.camTarget.y - dyPixels * worldPerPxY, z),
      z,
    }
  }

  // 平移钳制：书本不超出可视范围
  private clampPanX(x: number, z: number) {
    const vFov = (this.camera.fov * Math.PI) / 180
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect)
    const visibleWidth = 2 * z * Math.tan(hFov / 2)
    const maxX = Math.max(0, (visibleWidth - this.targetFitWidth) / 2)
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
    if (duration <= 0) {
      this.camAnim = null
      this.camera.position.set(x, y, z)
      return
    }
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

  // 射线拾取静态页面：返回命中页与纹理坐标，未命中返回 null
  pickPage(clientX: number, clientY: number): PagePick | null {
    if (!this.renderer) return null
    const rect = this.renderer.domElement.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(ndc, this.camera)
    const meshes = Array.from(this.staticMeshes.values()).map((entry) => entry.mesh)
    const hits = this.raycaster.intersectObjects(meshes, false)
    for (const hit of hits) {
      if (!hit.uv) continue
      for (const entry of this.staticMeshes.values()) {
        if (entry.mesh === hit.object) {
          return { index: entry.index, u: hit.uv.x, v: hit.uv.y, spread: entry.spread }
        }
      }
    }
    return null
  }

  private updateCamera(now: number) {
    const anim = this.camAnim
    if (anim) {
      const t = Math.min(1, (now - anim.start) / anim.duration)
      const eased = this.easing(t)
      this.camera.position.set(
        anim.from.x + (anim.to.x - anim.from.x) * eased,
        anim.from.y + (anim.to.y - anim.from.y) * eased,
        anim.from.z + (anim.to.z - anim.from.z) * eased,
      )
      if (t >= 1) this.camAnim = null
      return
    }
    this.camera.position.set(this.camTarget.x, this.camTarget.y, this.camTarget.z)
  }

  // 纸张卷曲形变：pe 为翻页进度 [0,1]
  private deformSheet(sheet: SheetState, pe: number) {
    const theta = Math.PI * pe
    const amp = sheet.curl * Math.sin(theta)
    const columns = curledColumns(theta, amp, this.sheetWidth, this.nPolygons)
    const positions = sheet.geometry.attributes.position
    if (!positions) return
    const colW = this.sheetWidth / this.nPolygons
    for (let i = 0; i < positions.count; i++) {
      const s = sheet.baseS[i] ?? 0
      const f = s / colW
      const c0 = Math.min(this.nPolygons, Math.floor(f))
      const frac = f - c0
      const x = (columns.xs[c0] ?? 0) * (1 - frac) + (columns.xs[c0 + 1] ?? 0) * frac
      const z = (columns.zs[c0] ?? 0) * (1 - frac) + (columns.zs[c0 + 1] ?? 0) * frac
      positions.setX(i, sheet.sign * x)
      positions.setZ(i, z)
    }
    positions.needsUpdate = true
    sheet.geometry.computeVertexNormals()
  }

  private updateSheet(now: number) {
    const sheet = this.sheet
    if (!sheet) return
    let pe: number
    let slideP: number
    if (sheet.mode === 'time') {
      const t = Math.min(1, (now - sheet.startTime) / sheet.duration)
      pe = easeInOutCubic(t)
      slideP = this.easing(t)
      if (t >= 1) {
        this.finishSheet(sheet, true)
        return
      }
    } else if (sheet.mode === 'drag') {
      pe = sheet.progress
      slideP = pe
    } else {
      const t = Math.min(1, (now - sheet.startTime) / sheet.duration)
      const eased = easeInOutCubic(t)
      pe = sheet.p0 + (sheet.target - sheet.p0) * eased
      slideP = pe
      if (t >= 1) {
        this.finishSheet(sheet, sheet.target === 1)
        return
      }
    }
    sheet.group.position.x =
      sheet.worldFromX + (sheet.worldToX - sheet.worldFromX) * slideP
    for (const entry of this.staticMeshes.values()) {
      entry.mesh.position.x = entry.fromX + (entry.toX - entry.fromX) * slideP
    }
    this.deformSheet(sheet, pe)
  }

  removeSheet() {
    const sheet = this.sheet
    if (!sheet) return
    this.sheet = null
    this.scene.remove(sheet.group)
    sheet.geometry.dispose()
    sheet.backGeometry.dispose()
    sheet.frontMaterial.dispose()
    sheet.backMaterial.dispose()
  }

  private tick = (now: number) => {
    if (this.disposed) return
    this.updateSheet(now)
    this.updateCamera(now)
    if (this.renderer && !this.contextLost) {
      this.renderer.render(this.scene, this.camera)
    }
    this.rafId = requestAnimationFrame(this.tick)
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.rafId)
    this.removeSheet()
    for (const entry of this.staticMeshes.values()) {
      this.scene.remove(entry.mesh)
      entry.mesh.geometry.dispose()
      entry.material.dispose()
    }
    this.staticMeshes.clear()
    if (this.renderer) {
      this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost)
      this.renderer.domElement.removeEventListener(
        'webglcontextrestored',
        this.onContextRestoredHandler,
      )
      this.renderer.dispose()
      this.renderer.domElement.remove()
    }
  }
}
