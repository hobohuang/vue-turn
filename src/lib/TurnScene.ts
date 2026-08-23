import * as THREE from 'three'

import { PAGE_HEIGHT, pageWidth } from '@/lib/flipSpec'
import { curledColumns, easeInOutCubic, flipAngle } from '@/lib/pageCurl'
import type { FlipSpec, StaticPlacement } from '@/types/turn'

const STATIC_Z = -0.01
const FIT_MARGIN = 1.12

function positive(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback
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
}

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
  onDone: (() => void) | null
}

interface StaticEntry {
  mesh: THREE.Mesh
  material: THREE.MeshLambertMaterial
  fromX: number
  toX: number
  // fromSlot 显式给出时，起始位置已是世界坐标，不再叠加世界偏移
  fromIsWorld: boolean
}

export class TurnScene {
  private readonly container: HTMLElement
  private readonly pageAspect: number
  private readonly nPolygons: number
  private readonly perspective: number
  private readonly curl: number
  private readonly sheetWidth: number
  private readonly renderer: THREE.WebGLRenderer | null
  private contextLost = false
  private readonly scene = new THREE.Scene()
  private readonly camera: THREE.PerspectiveCamera
  private readonly staticMeshes = new Map<number, StaticEntry>()
  private sheet: SheetState | null = null
  private targetFitWidth: number
  private cameraFrom = 0
  private cameraTo = 0
  private cameraStart = 0
  private cameraDuration = 0
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
    this.sheetWidth = pageWidth(this.pageAspect)
    this.targetFitWidth = this.sheetWidth * 2

    this.renderer = createRenderer()
    if (this.renderer) {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
      this.renderer.setClearColor(0x000000, 0)
      this.container.appendChild(this.renderer.domElement)
      this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost)
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

  private onContextLost = (event: Event) => {
    event.preventDefault()
    this.contextLost = true
    // 上下文丢失后动画无法继续，提交翻页回调避免状态锁死
    const sheet = this.sheet
    if (sheet) {
      const onDone = sheet.onDone
      this.removeSheet()
      onDone?.()
    }
  }

  resize(width: number, height: number) {
    if (width <= 0 || height <= 0) return
    this.canvasW = width
    this.canvasH = height
    this.renderer?.setSize(width, height)
    this.camera.aspect = width / height
    this.fitCamera()
    if (this.cameraDuration <= 0 && !this.sheet) {
      this.camera.position.z = this.fitDistance(this.targetFitWidth)
    }
  }

  private fitDistance(fitWidth: number) {
    const vFov = 2 * Math.atan(this.canvasH / (2 * this.perspective))
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (this.canvasW / this.canvasH))
    return Math.max(
      (fitWidth * FIT_MARGIN) / (2 * Math.tan(hFov / 2)),
      (PAGE_HEIGHT * FIT_MARGIN) / (2 * Math.tan(vFov / 2)),
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
  ) {
    for (const entry of this.staticMeshes.values()) {
      this.scene.remove(entry.mesh)
      entry.mesh.geometry.dispose()
      entry.material.dispose()
    }
    this.staticMeshes.clear()

    this.targetFitWidth = placements.reduce(
      (width, p) => Math.max(width, Math.abs(this.slotX(p.slot)) * 2 + this.sheetWidth),
      this.sheetWidth,
    )

    for (const p of placements) {
      const geometry = new THREE.PlaneGeometry(this.sheetWidth, PAGE_HEIGHT)
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
      })
    }
    this.fitCamera()
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

  startFlip(spec: FlipSpec, frontTexture: THREE.Texture | null, backTexture: THREE.Texture | null, duration: number, onDone: () => void) {
    // 渲染不可用时同步提交翻页，保证状态机不会锁死
    if (!this.renderer || this.contextLost) {
      onDone()
      return
    }
    if (this.sheet) this.removeSheet()

    const worldFromX = spec.worldFromX ?? 0
    const worldToX = spec.worldToX ?? 0
    if (worldFromX !== 0 || worldToX !== 0) {
      for (const entry of this.staticMeshes.values()) {
        // 无 fromSlot：slot 属于起始布局，起终点都要叠加世界偏移；
        // 有 fromSlot：起点已是世界坐标，slot 即最终布局，不再偏移
        if (!entry.fromIsWorld) {
          entry.fromX = entry.mesh.position.x + worldFromX
          entry.toX += worldToX
        }
      }
    }

    const geometry = new THREE.PlaneGeometry(this.sheetWidth, PAGE_HEIGHT, this.nPolygons, 2)
    const positions = geometry.attributes.position
    const uvs = geometry.attributes.uv
    const normals = geometry.attributes.normal
    const index = geometry.getIndex()
    if (!positions || !uvs || !normals || !index) return
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

    const safeDuration = positive(duration, 900)
    const startTime = performance.now()
    this.sheet = {
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
      startTime,
      duration: safeDuration,
      onDone,
    }
    const fromFitWidth = positive(spec.fromFitWidth ?? this.targetFitWidth, this.targetFitWidth)
    const toFitWidth = positive(spec.toFitWidth ?? this.targetFitWidth, this.targetFitWidth)
    this.cameraFrom = this.fitDistance(fromFitWidth)
    this.cameraTo = this.fitDistance(toFitWidth)
    this.cameraStart = startTime
    this.cameraDuration = safeDuration
  }

  private updateCamera(now: number) {
    if (this.cameraDuration <= 0) return
    const t = Math.min(1, (now - this.cameraStart) / this.cameraDuration)
    const eased = easeInOutCubic(t)
    this.camera.position.z = this.cameraFrom + (this.cameraTo - this.cameraFrom) * eased
    if (t >= 1) this.cameraDuration = 0
  }

  private updateSlide(now: number) {
    if (!this.sheet) return
    const t = Math.min(1, (now - this.sheet.startTime) / this.sheet.duration)
    const eased = easeInOutCubic(t)
    for (const entry of this.staticMeshes.values()) {
      entry.mesh.position.x = entry.fromX + (entry.toX - entry.fromX) * eased
    }
  }

  private updateSheet(now: number) {
    const sheet = this.sheet
    if (!sheet) return
    const t = Math.min(1, (now - sheet.startTime) / sheet.duration)
    const eased = easeInOutCubic(t)
    sheet.group.position.x =
      sheet.worldFromX + (sheet.worldToX - sheet.worldFromX) * eased
    const theta = flipAngle(t)
    const amp = this.curl * Math.sin(theta)
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
    if (t >= 1) {
      const onDone = sheet.onDone
      this.removeSheet()
      onDone?.()
    }
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
    this.updateSlide(now)
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
      this.renderer.dispose()
      this.renderer.domElement.remove()
    }
  }
}
