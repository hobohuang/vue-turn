import * as THREE from 'three'

import { CameraRig } from '@/lib/CameraRig'
import { StackRenderer } from '@/lib/StackRenderer'
import { PAGE_HEIGHT, pageWidth } from '@/lib/flipSpec'
import { clamp, positive } from '@/lib/math'
import { clampFoldDragToSpine, computeCrease, foldPoint, foldProgress, FOLD_TILT } from '@/lib/pageFold'
import { curledColumns, easeInOutCubic } from '@/lib/pageCurl'
import type {
  FlipSheetOptions,
  FlipSpec,
  StackHover,
  StackVisual,
  StaticPlacement,
} from '@/types/turn'

const STATIC_Z = -0.01
// 渲染像素比默认上限：平衡清晰度与性能
const DEFAULT_MAX_PIXEL_RATIO = 2
// 拖拽松手后回弹/补完动画的最短时长
const MIN_SETTLE_DURATION = 120
// 折角纸张网格分段（横纵同值）：折线可以是斜线，折痕圆弧过渡带必须在
// 横纵两个方向都被足够多的顶点采样——分段过少时过渡带欠采样，折痕
// 边缘呈波浪/台阶状（"布匹感"）。96 段下过渡带约含 4 个顶点，折痕
// 边缘平直；普通卷曲只沿横向变化，纵向 2 段即可（见 createSheet）
const FOLD_SEGMENTS = 96
// 封面图层：封面/封底网格与封面灯光组单独一层，灯光按图层隔离，
// 实现封面（coverPreset）与内页（preset）互不干扰的光影
const COVER_LAYER = 1

function createRenderer(): THREE.WebGLRenderer | null {
  // 探测与渲染共用同一 canvas：探测用的 context 无法显式释放，弃置会
  // 永久占用一个 WebGL context 配额（浏览器上限约 16 个，多实例会加速
  // 耗尽并触发 context lost）。二次 getContext 返回同一 context
  const canvas = document.createElement('canvas')
  if (!canvas.getContext('webgl2') && !canvas.getContext('webgl')) return null
  try {
    return new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
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
  /** 封面/封底灯光组：环境光强度（封面图层独立照亮，与内页光影解耦） */
  coverAmbient?: number
  /** 封面/封底灯光组：方向光（纸张光泽）强度 */
  coverGloss?: number
  // 相机适配边距（视口外扩比例）
  fitMargin?: number
  // 渲染像素比上限
  // 最大缩放倍数
  maxZoom?: number
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

/** 折角状态：抓取点 P 与拖点 Q（页宽坐标），折线为其连线的垂直平分线 */
interface FoldState {
  pu: number
  pv: number
  qu: number
  qv: number
}

// 纸张状态为判别联合：卷曲（curl）与折角（fold）两类形变 ×
// time（时钟驱动）/ drag（指针驱动）/ settle（回弹动画）三种驱动方式。
// 各变体只携带自身用到的字段，避免单一胖结构体上大量"某模式才有效"
// 的可空字段；模式转换（如书脊拖拽接管折角纸张）通过重建对象完成
interface SheetBase {
  group: THREE.Group
  front: THREE.Mesh
  back: THREE.Mesh
  geometry: THREE.BufferGeometry
  backGeometry: THREE.BufferGeometry
  frontMaterial: THREE.MeshLambertMaterial
  backMaterial: THREE.MeshLambertMaterial
  /** 初始横向坐标（页宽坐标）：卷曲/折角形变的还原基准 */
  baseS: Float32Array
  /** 初始纵向坐标（折角形变需要还原 y） */
  baseY: Float32Array
  sign: number
  worldFromX: number
  worldToX: number
  onDone: ((committed: boolean) => void) | null
  /** 铰点（书脊/页缘）世界 x：纸张组原点，卷曲旋转与折线 s 坐标都以此为基准 */
  hingeX: number
  /** 卷曲幅度（硬页为 0）；折角模式不使用 */
  curl: number
  /** 折线圆弧过渡宽度（世界单位）；卷曲模式不使用 */
  bend: number
  fromFitWidth: number
  toFitWidth: number
  /** 悬停预览纸张：书体平移/静态页滑动/纸叠插值钉在起始态（slideP=0），只预览纸角形变；真实按下接管时清除 */
  preview?: boolean
}

/** 卷曲翻页动画：进度由时钟驱动 */
interface CurlTimeSheet extends SheetBase {
  kind: 'curl'
  mode: 'time'
  startTime: number
  duration: number
}

/** 卷曲拖拽：进度由指针驱动 */
interface CurlDragSheet extends SheetBase {
  kind: 'curl'
  mode: 'drag'
  progress: number
}

/** 卷曲回弹/补完动画 */
interface CurlSettleSheet extends SheetBase {
  kind: 'curl'
  mode: 'settle'
  startTime: number
  duration: number
  /** 当前进度 [0,1] */
  progress: number
  /** settle 起始进度 */
  p0: number
  /** settle 目标进度（0 取消 / 1 完成） */
  target: number
}

/** 折角/折页拖拽：拖点由指针驱动 */
interface FoldDragSheet extends SheetBase {
  kind: 'fold'
  mode: 'drag'
  fold: FoldState
  progress: number
}

/** 折角回弹/补完动画：拖点向目标位移动 */
interface FoldSettleSheet extends SheetBase {
  kind: 'fold'
  mode: 'settle'
  startTime: number
  duration: number
  fold: FoldState
  progress: number
  p0: number
  target: number
  /** 折角 settle 动画的拖点起止（页宽坐标） */
  foldFromQ: [number, number]
  foldToQ: [number, number]
}

type SheetState =
  | CurlTimeSheet
  | CurlDragSheet
  | CurlSettleSheet
  | FoldDragSheet
  | FoldSettleSheet

type CurlSheet = CurlTimeSheet | CurlDragSheet | CurlSettleSheet
type FoldSheet = FoldDragSheet | FoldSettleSheet

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

/**
 * 3D 翻书场景：静态页网格、翻页纸张形变与渲染循环的编排层。
 * 相机控制委托 CameraRig，纸叠渲染委托 StackRenderer；
 * 本类持有页面网格、纸张状态机与射线拾取。
 */
export class TurnScene {
  private readonly container: HTMLElement
  private readonly pageAspect: number
  private readonly nPolygons: number
  private readonly curl: number
  private readonly sheetWidth: number
  private readonly renderer: THREE.WebGLRenderer | null
  private contextLost = false
  private readonly onContextRestored?: () => void
  private readonly scene = new THREE.Scene()
  private readonly rig: CameraRig
  private readonly raycaster = new THREE.Raycaster()
  private readonly stacks: StackRenderer
  private readonly staticMeshes = new Map<number, StaticEntry>()
  // 封面/封底页索引集合：这些页的网格挂到封面图层（封面灯光照亮）
  private readonly coverPages = new Set<number>()
  private stackFrom: StackVisual | null = null
  private stackTo: StackVisual | null = null
  private sheet: SheetState | null = null
  // 页面布局适配宽度（不含纸叠）
  private pageFitWidth: number
  // 页面布局 + 纸叠的总适配宽度（推送给相机装配）
  private targetFitWidth: number
  private rafId = 0
  // 脏标记：按需渲染。纸张/相机动画进行中每帧渲染；静止时仅在场景
  // 有变化（布局重建、纹理更新、缩放平移、悬停高亮等）的那一帧渲染，
  // 避免书本静止时仍 60fps 全量渲染 WebGL 场景
  private dirty = true
  private disposed = false

  constructor(options: TurnSceneOptions) {
    this.container = options.container
    this.pageAspect = positive(options.pageAspect, 0.75)
    this.nPolygons = Math.round(positive(options.nPolygons ?? 64, 64))
    this.curl = options.curl ?? 0.8
    this.sheetWidth = pageWidth(this.pageAspect)
    this.pageFitWidth = this.sheetWidth * 2
    this.targetFitWidth = this.sheetWidth * 2

    this.renderer = createRenderer()
    this.onContextRestored = options.onContextRestored
    if (this.renderer) {
      // 画布像素比上限内收为常量：DPR 封顶 2 已覆盖全部现实设备，
      // 更高只增负载不增观感（原 maxPixelRatio prop 无消费方、无测试）
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, DEFAULT_MAX_PIXEL_RATIO))
      this.renderer.setClearColor(0x000000, 0)
      this.container.appendChild(this.renderer.domElement)
      this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost)
      this.renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestoredHandler)
    }

    // 相机装配：翻页动画与缩放/平移都经由它驱动相机
    this.rig = new CameraRig({
      perspective: options.perspective ?? 2400,
      fitMargin: options.fitMargin ?? 1.12,
      maxZoom: options.maxZoom ?? 3,
      initialFitWidth: this.targetFitWidth,
    })
    this.scene.add(this.rig.camera)
    // 相机放行封面图层，否则封面网格不渲染
    this.rig.camera.layers.enable(COVER_LAYER)
    // 拾取放行封面图层（射线默认只测图层 0，会漏掉封面网格）
    this.raycaster.layers.enableAll()

    this.stacks = new StackRenderer({
      scene: this.scene,
      camera: this.rig.camera,
      raycaster: this.raycaster,
      renderer: this.renderer,
      perspective: options.perspective ?? 2400,
    })

    // 内页灯光组（图层 0）：整本书共用
    this.scene.add(new THREE.AmbientLight(0xffffff, options.ambient ?? 1))
    const gloss = new THREE.DirectionalLight(0xffffff, options.gloss ?? 0.35)
    gloss.position.set(0.4, 0.9, 1.2)
    this.scene.add(gloss)
    // 封面灯光组（图层 1）：只照亮封面/封底网格，实现封面独立光影
    const coverAmbient = new THREE.AmbientLight(
      0xffffff,
      options.coverAmbient ?? options.ambient ?? 1,
    )
    coverAmbient.layers.set(COVER_LAYER)
    this.scene.add(coverAmbient)
    const coverGloss = new THREE.DirectionalLight(
      0xffffff,
      options.coverGloss ?? options.gloss ?? 0.35,
    )
    coverGloss.position.set(0.4, 0.9, 1.2)
    coverGloss.layers.set(COVER_LAYER)
    this.scene.add(coverGloss)

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
    // 纸叠同样失效，恢复时随 renderStatic 重建
    this.stacks.dispose()
    this.stackFrom = null
    this.stackTo = null
  }

  private onContextRestoredHandler = () => {
    this.contextLost = false
    this.markDirty()
    // 通知调用方重建静态页并重光栅化窗口内纹理
    this.onContextRestored?.()
  }

  resize(width: number, height: number) {
    if (width <= 0 || height <= 0) return
    this.renderer?.setSize(width, height)
    this.rig.resize(width, height)
    // 空闲时按当前布局与缩放级别重新适配相机（翻页/缩放动画进行中不打断）
    this.refitCamera()
    this.markDirty()
  }

  // 空闲时重适配相机；纸张动画进行中跳过（随后由动画终点收敛）
  private refitCamera() {
    if (this.sheet) return
    if (this.rig.refit()) this.markDirty()
  }

  setStaticPages(
    placements: StaticPlacement[],
    textureOf: (index: number) => THREE.Texture | null,
    // false 表示这是翻页前置布局（spec.staticPages），相机由翻页动画接管，不重新适配
    refit = true,
  ) {
    this.pageFitWidth = placements.reduce(
      (width, p) =>
        Math.max(width, p.spread ? this.sheetWidth * 2 : Math.abs(this.slotX(p.slot)) * 2 + this.sheetWidth),
      this.sheetWidth,
    )
    this.recomputeFitWidth()
    this.markDirty()

    // placement diff 复用：按页索引比对，几何形态（spread）相同的页复用
    // 现有网格与材质，仅更新纹理与起止位置。该调用频率很高（每次翻页 2 次、
    // 光栅化完成、peel 悬停进出边缘条带），全量销毁重建会造成 GPU 资源反复
    // 分配释放；静态页通常只有 1-3 个网格，diff 成本可忽略
    const kept = new Set<number>()
    for (const p of placements) {
      const spread = p.spread === true
      const existing = this.staticMeshes.get(p.index)
      if (existing && existing.spread === spread) {
        const texture = textureOf(p.index)
        if (existing.material.map !== texture) {
          existing.material.map = texture
          existing.material.needsUpdate = true
        }
        existing.fromX = this.slotX(p.fromSlot ?? p.slot)
        existing.toX = this.slotX(p.slot)
        existing.fromIsWorld = p.fromSlot !== undefined
        existing.mesh.position.set(existing.fromX, 0, STATIC_Z)
        // 封面图层归属可能随 coverPages 集合变化
        if (this.coverPages.has(p.index)) existing.mesh.layers.set(COVER_LAYER)
        else existing.mesh.layers.set(0)
        kept.add(p.index)
        continue
      }
      if (existing) {
        this.scene.remove(existing.mesh)
        existing.mesh.geometry.dispose()
        existing.material.dispose()
        this.staticMeshes.delete(p.index)
      }
      // 跨页项：双倍宽度网格，纹理为整张跨页图
      const geometry = new THREE.PlaneGeometry(
        spread ? this.sheetWidth * 2 : this.sheetWidth,
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
      // 封面/封底挂封面图层，由封面灯光组照亮
      if (this.coverPages.has(p.index)) mesh.layers.set(COVER_LAYER)
      this.scene.add(mesh)
      this.staticMeshes.set(p.index, {
        mesh,
        material,
        fromX,
        toX: this.slotX(p.slot),
        fromIsWorld: p.fromSlot !== undefined,
        index: p.index,
        spread,
      })
      kept.add(p.index)
    }
    // 移除新布局中不再出现的页
    for (const [index, entry] of this.staticMeshes) {
      if (kept.has(index)) continue
      this.scene.remove(entry.mesh)
      entry.mesh.geometry.dispose()
      entry.material.dispose()
      this.staticMeshes.delete(index)
    }
    // 布局变化（封面居中/跨页/单双页切换/跳转）时相机跟随当前布局适配，
    // 修复初始封面按跨页宽度适配导致的书本偏小；翻页前置布局不触发
    if (refit) this.refitCamera()
  }

  applyStaticTexture(index: number, texture: THREE.Texture) {
    const entry = this.staticMeshes.get(index)
    if (!entry) return
    entry.material.map = texture
    entry.material.needsUpdate = true
    this.markDirty()
  }

  // 封面/封底页索引：布局重建时同步，静态页与翻页纸张据此挂封面图层
  setCoverPages(indices: number[]) {
    this.coverPages.clear()
    for (const index of indices) this.coverPages.add(index)
  }

  // 适配宽度 = 页面布局宽度 + 纸叠两侧厚度（空闲态以 stackTo 计）
  private recomputeFitWidth() {
    this.targetFitWidth =
      this.pageFitWidth + (this.stackTo?.left?.thickness ?? 0) + (this.stackTo?.right?.thickness ?? 0)
    this.rig.setFitWidth(this.targetFitWidth)
  }

  // 纸叠条带：贴在可见页面外缘的页层块，厚度随翻页插值变化。
  // to 省略时直接吸附到 from（空闲布局）；同时给出时由翻页动画驱动插值。
  setStacks(from: StackVisual | null, to?: StackVisual | null) {
    this.stackFrom = from
    this.stackTo = to ?? from
    this.recomputeFitWidth()
    this.stacks.setHover(null)
    // 无纸张动画时立即应用终点（渲染不可用的兜底路径也走到这里）
    if (!this.sheet) {
      this.stacks.apply(this.stackFrom, this.stackTo, 1)
      // 空闲态纸叠厚度变化影响适配宽度，相机距离随之收敛
      // （否则要等到下一次 resize/翻页才收敛，条带可能被视口裁剪）
      this.refitCamera()
    }
    this.markDirty()
  }

  // 某视觉态下纸叠两侧厚度之和（相机适配宽度计入纸叠，条带不被视口裁剪）
  private stackExtentWidth(visual: StackVisual | null): number {
    return (visual?.left?.thickness ?? 0) + (visual?.right?.thickness ?? 0)
  }

  // 纸张收尾/接管时的目标适配宽度（目标态页面宽度 + 目标态纸叠厚度）
  private sheetFitWidth(sheet: SheetBase, committed: boolean): number {
    return (
      (committed ? sheet.toFitWidth : sheet.fromFitWidth) +
      this.stackExtentWidth(committed ? this.stackTo : this.stackFrom)
    )
  }

  // 射线拾取纸叠（透传 StackRenderer；上下文丢失时不可用）
  pickStack(clientX: number, clientY: number): { side: 'left' | 'right'; fraction: number } | null {
    if (this.contextLost) return null
    return this.stacks.pickStack(clientX, clientY)
  }

  // 设置纸叠高亮条带（null 清除）
  setStackHover(hover: StackHover | null) {
    this.stacks.setHover(hover)
    this.markDirty()
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

  // 创建翻页纸张的公共部分（几何/材质/镜像），各模式变体在此基础上扩展；
  // fold 为 true 时提高纵向分段（斜折线需要纵向分辨率）；
  // options 携带封面档覆盖（curl/nPolygons），封面/封底网格挂封面图层独立光照
  private createSheet(
    spec: FlipSpec,
    frontTexture: THREE.Texture | null,
    backTexture: THREE.Texture | null,
    onDone: (committed: boolean) => void,
    fold = false,
    options?: FlipSheetOptions,
  ): SheetBase | null {
    const worldFromX = spec.worldFromX ?? 0
    const worldToX = spec.worldToX ?? 0
    const curl = options?.curl ?? this.curl
    const nPolygons = Math.max(2, Math.round(options?.nPolygons ?? this.nPolygons))

    const geometry = new THREE.PlaneGeometry(
      this.sheetWidth,
      PAGE_HEIGHT,
      // 折角纸张横向同样需要足够分段（封面 hard 档 nPolygons=32 时
      // 过渡带横向欠采样，折痕边缘同样会起波浪）
      fold ? Math.max(nPolygons, FOLD_SEGMENTS) : nPolygons,
      fold ? FOLD_SEGMENTS : 2,
    )
    const positions = geometry.attributes.position
    const uvs = geometry.attributes.uv
    const normals = geometry.attributes.normal
    const index = geometry.getIndex()
    if (!positions || !uvs || !normals || !index) return null
    const sign = spec.geometry === 'A' ? 1 : -1
    const baseS = new Float32Array(positions.count)
    const baseY = new Float32Array(positions.count)
    for (let i = 0; i < positions.count; i++) {
      const s = positions.getX(i) + this.sheetWidth / 2
      baseS[i] = s
      baseY[i] = positions.getY(i)
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
    // 正反两面各自按所属页挂图层：封面面由封面灯光照亮，内页面用内页灯光
    if (this.coverPages.has(spec.frontIndex)) front.layers.set(COVER_LAYER)
    if (this.coverPages.has(spec.backIndex)) back.layers.set(COVER_LAYER)

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
      baseY,
      sign,
      hingeX: spec.hingeX,
      worldFromX,
      worldToX,
      onDone,
      curl,
      // 折缝圆弧兜底宽度：与 soft/custom 预设一致（4% 页宽窄圆角）
      bend: 0.04 * this.sheetWidth,
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
    const base = this.createSheet(spec, frontTexture, backTexture, onDone, false, options)
    if (!base) return
    const startTime = performance.now()
    const sheet: CurlTimeSheet = {
      ...base,
      kind: 'curl',
      mode: 'time',
      startTime,
      duration: positive(duration, 900),
    }
    this.sheet = sheet
    // 相机从当前位置动画到目标适配距离（缩放/平移被一并复位，级别归 1）；
    // 适配宽度计入目标态纸叠厚度，条带不被视口裁剪
    this.rig.resetTo(
      sheet.toFitWidth + this.stackExtentWidth(this.stackTo),
      sheet.duration,
      startTime,
    )
    this.wake()
  }

  // 主动折页翻页（点击翻页/next/prev，fold 开启时替代 startFlip 的卷曲动画）：
  // 锚点取外缘中部（竖直折线），拖点从外缘扫到对侧完成翻页——折页拖拽的
  // 自动化版本，直接构造 settle 态（拖点从外缘动画到对侧镜像位）
  startFoldFlip(
    spec: FlipSpec,
    frontTexture: THREE.Texture | null,
    backTexture: THREE.Texture | null,
    duration: number,
    onDone: (committed: boolean) => void,
    options?: FlipSheetOptions,
    bend = 0,
  ): boolean {
    // 渲染不可用返回 false，由调用方回退 startFlip（其自带同步提交兜底）
    if (!this.renderer || this.contextLost) return false
    if (this.sheet) this.removeSheet()
    this.applyWorldOffsets(spec)
    const base = this.createSheet(spec, frontTexture, backTexture, onDone, true, options)
    if (!base) return false
    const settleDuration = positive(duration, 900)
    const startTime = performance.now()
    const sheet: FoldSettleSheet = {
      ...base,
      kind: 'fold',
      mode: 'settle',
      startTime,
      duration: settleDuration,
      fold: { pu: this.sheetWidth, pv: 0, qu: this.sheetWidth, qv: 0 },
      progress: 0,
      p0: 0,
      target: 1,
      foldFromQ: [this.sheetWidth, 0],
      foldToQ: [-this.sheetWidth, 0],
      bend: positive(bend, base.bend),
    }
    this.sheet = sheet
    // 相机复位与 startFlip 一致（缩放/平移复位，级别归 1）
    this.rig.resetTo(
      sheet.toFitWidth + this.stackExtentWidth(this.stackTo),
      settleDuration,
      startTime,
    )
    this.wake()
    return true
  }

  // 开始拖拽翻页：返回 false 表示渲染不可用，调用方不应进入拖拽状态。
  // preview=true 为悬停预览纸张：书体/静态页/纸叠钉在起始态，只预览卷曲形变
  beginDragFlip(
    spec: FlipSpec,
    frontTexture: THREE.Texture | null,
    backTexture: THREE.Texture | null,
    onDone: (committed: boolean) => void,
    options?: FlipSheetOptions,
    preview = false,
  ): boolean {
    if (!this.renderer || this.contextLost) return false
    // 已有纸张（折角悬停/上一次拖拽）静默替换，不触发其 onDone
    if (this.sheet) this.removeSheet()

    // 真实拖拽才应用布局切换的世界偏移；悬停预览不动静态网格——
    // 预览不重设静态布局，若在此叠加偏移会把空闲布局的静态页起点
    // 篡改到翻开态位置（如封面被挪到侧旁），预览收起时再跳回，形成闪烁
    if (!preview) this.applyWorldOffsets(spec)
    const base = this.createSheet(spec, frontTexture, backTexture, onDone, false, options)
    if (!base) return false
    this.sheet = { ...base, kind: 'curl', mode: 'drag', progress: 0, preview }
    // 新建纸张须立即可见：标脏唤醒一帧渲染（drag 模式不逐帧自驱）
    this.markDirty()
    return true
  }

  // 悬停预览纸张转为真实交互（按下接管且不重建纸张时调用）：
  // 清除预览标记，恢复书体平移/静态页滑动/纸叠插值随进度联动。
  // spec 为接管的翻页 spec：调用方已用 spec.staticPages 重设静态布局，
  // 此处补齐布局切换的世界偏移（预览路径不应用偏移，见 beginDragFlip）
  activateSheet(spec?: FlipSpec) {
    const sheet = this.sheet
    if (!sheet) return
    if (!sheet.preview) return
    sheet.preview = false
    // 预览标记清除后书体/静态页/纸叠开始随进度联动，唤醒循环重绘
    this.markDirty()
    if (spec) this.applyWorldOffsets(spec)
  }

  // 拖拽进度 [0,1]：0 为未翻，1 为完全翻过
  setDragProgress(progress: number) {
    const sheet = this.sheet
    if (!sheet || sheet.mode !== 'drag') return
    // 书脊拖拽接管折角悬停的纸张：降级为卷曲拖拽（清除折角形变）；
    // 接管即真实交互，一并清除预览标记
    if (sheet.kind === 'fold') {
      const { fold: _fold, kind: _kind, preview: _preview, ...rest } = sheet
      this.sheet = { ...rest, kind: 'curl', progress: clamp(progress, 0, 1) }
      this.markDirty()
      return
    }
    sheet.progress = clamp(progress, 0, 1)
    // drag 模式纸张不逐帧自驱，进度变化须标脏唤醒一帧渲染
    this.markDirty()
  }

  // 开始折角拖拽：已有 drag 模式纸张（同方向折角悬停预览）则直接接管，
  // 否则新建（折角纸张纵向分段更高，斜折线才平滑）。返回 false 表示渲染不可用
  beginFoldDrag(
    spec: FlipSpec,
    frontTexture: THREE.Texture | null,
    backTexture: THREE.Texture | null,
    pickU: number,
    pickV: number,
    bend: number,
    onDone: (committed: boolean) => void,
    options?: FlipSheetOptions,
    preview = false,
  ): boolean {
    if (!this.renderer || this.contextLost) return false
    const existing = this.sheet
    if (existing && existing.mode === 'drag') {
      if (existing.kind === 'fold') {
        // 同方向折角悬停预览的纸张：直接接管重置拖点。
        // 真实交互（preview=false）时清除预览标记并补齐世界偏移
        // （调用方已用 spec.staticPages 重设静态布局）；悬停预览间的
        // 重建保持预览标记与起始态布局
        existing.fold = { pu: pickU, pv: pickV, qu: pickU, qv: pickV }
        existing.bend = positive(bend, existing.bend)
        existing.progress = 0
        if (!preview) {
          existing.preview = false
          this.applyWorldOffsets(spec)
        }
        this.markDirty()
        return true
      }
      // 卷曲拖拽中的纸张转折角：重建为折角拖拽（沿用几何与纹理）
      const { kind: _kind, progress: _progress, preview: _preview, ...rest } = existing
      this.sheet = {
        ...rest,
        kind: 'fold',
        mode: 'drag',
        fold: { pu: pickU, pv: pickV, qu: pickU, qv: pickV },
        progress: 0,
        bend: positive(bend, existing.bend),
      }
      this.applyWorldOffsets(spec)
      this.markDirty()
      return true
    }
    if (this.sheet) this.removeSheet()
    // 静态页已由调用方按 spec.staticPages 重设（真实拖拽与折角预览皆然：
    // 折角下方露出的须是底页而非当前页），此处统一叠加布局切换的世界偏移；
    // 预览的书体平移/纸叠/相机仍钉在起始态（updateSheet 中 preview 的
    // slideP=0），收起时由调用方 renderStatic 恢复空闲布局
    this.applyWorldOffsets(spec)
    const base = this.createSheet(spec, frontTexture, backTexture, onDone, true, options)
    if (!base) return false
    this.sheet = {
      ...base,
      kind: 'fold',
      mode: 'drag',
      fold: { pu: pickU, pv: pickV, qu: pickU, qv: pickV },
      progress: 0,
      bend: positive(bend, base.bend),
      preview,
    }
    // 新建纸张须立即可见：标脏唤醒一帧渲染（drag 模式不逐帧自驱）
    this.markDirty()
    return true
  }

  // 指针位置转页平面世界坐标（z=0 平面射线求交）
  pagePointFromClient(clientX: number, clientY: number): [number, number] | null {
    if (!this.renderer) return null
    const rect = this.renderer.domElement.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(ndc, this.rig.camera)
    const { origin, direction } = this.raycaster.ray
    if (Math.abs(direction.z) < 1e-6) return null
    const t = -origin.z / direction.z
    if (t < 0) return null
    return [origin.x + direction.x * t, origin.y + direction.y * t]
  }

  // 折角拖拽跟随指针：指针投射到页平面后换算为页宽坐标并钳制。
  // lockedV 给出时拖点纵向钉在该高度（页高坐标）——折页拖拽（非角区）
  // 锁定按下高度，折线保持竖直对折；省略时纵向自由（角区折角拖拽）。
  // 返回当前折角进度 [0,1]，无折角纸张时返回 null
  setFoldDragFromClient(clientX: number, clientY: number, lockedV?: number): number | null {
    const sheet = this.sheet
    if (!sheet || sheet.kind !== 'fold' || sheet.mode !== 'drag') return null
    const world = this.pagePointFromClient(clientX, clientY)
    if (!world) return sheet.progress
    // 页宽坐标：世界 x 减去纸张组原点（书脊铰点 + 布局偏移）；
    // 镜像几何（B）顶点 x = 组原点 - s，方向取反
    let qu = world[0] - sheet.group.position.x
    if (sheet.sign < 0) qu = -qu
    const qv = lockedV ?? world[1]
    return this.setFoldDragAt(qu, qv)
  }

  // 指针到当前折角锚点（外角抓取点 P）的世界距离；无折角拖拽纸张时返回
  // null。折角预览激活期间静态布局是翻开前置布局，pickPage 命中的是底页，
  // 角区进出判定不能依赖拾取，改用与锚点的几何距离（与折角条带命中
  // foldStripFromPick 的外角圆形判定同心同半径）
  foldAnchorDistanceFromClient(clientX: number, clientY: number): number | null {
    const sheet = this.sheet
    if (!sheet || sheet.kind !== 'fold' || sheet.mode !== 'drag') return null
    const world = this.pagePointFromClient(clientX, clientY)
    if (!world) return null
    const anchorX = sheet.group.position.x + sheet.sign * sheet.fold.pu
    return Math.hypot(world[0] - anchorX, world[1] - sheet.fold.pv)
  }

  // 直接以页宽坐标设置折角拖点（悬停预览/拖拽跟随共用入口）；返回折角进度。
  // 拖点经书脊约束钳制：折线不得切入书脊边内侧，否则装订处的书页会被
  // 翻折拉离书脊（视觉"撕开"）
  setFoldDragAt(qu: number, qv: number): number | null {
    const sheet = this.sheet
    if (!sheet || sheet.kind !== 'fold' || sheet.mode !== 'drag') return null
    const clamped = clampFoldDragToSpine(
      sheet.fold.pu,
      sheet.fold.pv,
      clamp(qu, -this.sheetWidth, this.sheetWidth),
      clamp(qv, -PAGE_HEIGHT / 2, PAGE_HEIGHT / 2),
      PAGE_HEIGHT,
    )
    sheet.fold.qu = clamped.qu
    sheet.fold.qv = clamped.qv
    sheet.progress = foldProgress(sheet.fold.qu, this.sheetWidth)
    // drag 模式纸张不逐帧自驱，拖点变化须标脏唤醒一帧渲染
    this.markDirty()
    return sheet.progress
  }

  // 折角拖拽结束：commit 动画拖点至对侧镜像位（整页折过 = 完成翻页），
  // 否则拖点收回抓取点展平；动画结束统一走 finishSheet 收敛布局
  endFoldDrag(commit: boolean, baseDuration: number) {
    const sheet = this.sheet
    if (!sheet || sheet.kind !== 'fold' || sheet.mode !== 'drag') return
    const { pu, pv, qu, qv } = sheet.fold
    const target = commit ? 1 : 0
    const toQ: [number, number] = commit ? [-this.sheetWidth, pv] : [pu, pv]
    if (qu === toQ[0] && qv === toQ[1]) {
      this.finishSheet(sheet, commit)
      return
    }
    const startTime = performance.now()
    // drag → settle 模式转换：判别联合不可变字段（kind/mode）随对象重建
    const { kind: _kind, mode: _mode, ...rest } = sheet
    this.sheet = {
      ...rest,
      kind: 'fold',
      mode: 'settle',
      startTime,
      duration: Math.max(
        MIN_SETTLE_DURATION,
        positive(baseDuration, 900) * Math.abs(target - sheet.progress),
      ),
      p0: sheet.progress,
      target,
      foldFromQ: [qu, qv],
      foldToQ: toQ,
    }
    this.wake()
  }

  // 拖拽结束：commit 为 true 动画补完翻页，否则回弹取消
  endDragFlip(commit: boolean, baseDuration: number) {
    const sheet = this.sheet
    if (!sheet || sheet.kind !== 'curl' || sheet.mode !== 'drag') return
    const target = commit ? 1 : 0
    if (sheet.progress === target) {
      this.finishSheet(sheet, commit)
      return
    }
    const startTime = performance.now()
    // drag → settle 模式转换：判别联合不可变字段（kind/mode）随对象重建
    const { kind: _kind, mode: _mode, ...rest } = sheet
    const settle: CurlSettleSheet = {
      ...rest,
      kind: 'curl',
      mode: 'settle',
      startTime,
      duration: Math.max(
        MIN_SETTLE_DURATION,
        positive(baseDuration, 900) * Math.abs(target - sheet.progress),
      ),
      p0: sheet.progress,
      target,
    }
    this.sheet = settle
    // 悬停预览的回弹不动相机（预览从未移动过相机）；真实拖拽的松手
    // 相机复位到适配距离（缩放/平移随松手收尾一并复位，级别归 1）
    if (settle.preview) {
      this.wake()
      return
    }
    this.rig.resetTo(this.sheetFitWidth(sheet, commit), settle.duration, startTime)
    this.wake()
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

  // 立即完成一张纸张：跳到终点、复位相机并触发回调。
  // 悬停预览纸张不触碰相机/缩放（预览从未移动过它们）
  private finishSheet(sheet: SheetState, committed: boolean) {
    if (!sheet.preview) {
      this.rig.resetTo(this.sheetFitWidth(sheet, committed), 0)
    }
    if (this.sheet === sheet) this.sheet = null
    this.markDirty()
    this.scene.remove(sheet.group)
    sheet.geometry.dispose()
    sheet.backGeometry.dispose()
    sheet.frontMaterial.dispose()
    sheet.backMaterial.dispose()
    sheet.onDone?.(committed)
  }

  // 当前缩放级别：1 为未缩放
  getZoom() {
    return this.rig.getZoom()
  }

  // 运行时更新最大缩放倍数：当前级别超出新上限时立即收敛
  setMaxZoom(value: number) {
    this.rig.setMaxZoom(value)
    // 当前级别超出新上限时 rig 会立即收敛（可能启动相机动画），唤醒重绘
    this.wake()
  }

  // 设置缩放级别（钳制到 [1, maxZoom]）；翻页进行中忽略
  setZoom(level: number, animate = true, duration = 200) {
    if (!this.renderer || this.sheet) return
    this.rig.setZoom(level, animate, duration)
    this.markDirty()
  }

  // 按屏幕像素平移相机（放大后拖动查看）；翻页进行中忽略
  panBy(dxPixels: number, dyPixels: number) {
    if (!this.renderer || this.sheet) return
    this.rig.panBy(dxPixels, dyPixels)
    this.markDirty()
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
    this.raycaster.setFromCamera(ndc, this.rig.camera)
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

  // 纸张卷曲形变：pe 为翻页进度 [0,1]
  private deformSheet(sheet: CurlSheet, pe: number) {
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

  // 纸张折角形变：折线取抓取点与拖点连线的垂直平分线，P 侧翻折；
  // P≈Q（未折）时顶点还原为初始平面。
  // 折缝圆弧与微开角随翻页进度压平（进度→1 时 bend/tilt→0）：
  // 折角小时折缝圆润、翻起平面微翘；整页翻过落页时纸摊平贴合底面，
  // 与 renderStatic 接管的静态布局无缝衔接（无落页跳变）
  private deformSheetFold(sheet: FoldSheet) {
    const fold = sheet.fold
    const settle = 1 - Math.min(1, Math.max(0, sheet.progress))
    const crease = computeCrease(
      fold.pu,
      fold.pv,
      fold.qu,
      fold.qv,
      sheet.bend * settle,
      FOLD_TILT * settle,
    )
    const positions = sheet.geometry.attributes.position
    if (!positions) return
    for (let i = 0; i < positions.count; i++) {
      const s = sheet.baseS[i] ?? 0
      const y = sheet.baseY[i] ?? 0
      if (crease) {
        const p = foldPoint(s, y, crease)
        positions.setX(i, sheet.sign * p.x)
        positions.setY(i, p.y)
        positions.setZ(i, p.z)
      } else {
        positions.setX(i, sheet.sign * s)
        positions.setY(i, y)
        positions.setZ(i, 0)
      }
    }
    positions.needsUpdate = true
    sheet.geometry.computeVertexNormals()
  }

  private updateSheet(now: number) {
    const sheet = this.sheet
    if (!sheet) return
    // 折角模式：纸叠/静态页/纸张组随折角进度同步插值（封面开合等布局切换
    // 时书体逐渐平移到目标位），折角形变在页内完成
    if (sheet.kind === 'fold') {
      if (sheet.mode === 'settle') {
        const t = Math.min(1, (now - sheet.startTime) / sheet.duration)
        const eased = easeInOutCubic(t)
        const from = sheet.foldFromQ
        const to = sheet.foldToQ
        sheet.fold.qu = from[0] + (to[0] - from[0]) * eased
        sheet.fold.qv = from[1] + (to[1] - from[1]) * eased
        // settle 插值中间态同样受书脊约束（目标端点天然安全，中途保险）
        const clamped = clampFoldDragToSpine(
          sheet.fold.pu,
          sheet.fold.pv,
          sheet.fold.qu,
          sheet.fold.qv,
          PAGE_HEIGHT,
        )
        sheet.fold.qu = clamped.qu
        sheet.fold.qv = clamped.qv
        sheet.progress = foldProgress(sheet.fold.qu, this.sheetWidth)
        if (t >= 1) {
          this.finishSheet(sheet, sheet.target === 1)
          return
        }
      }
      // 悬停预览：书体/静态页/纸叠钉在起始态，只有纸角形变跟随进度；
      // 真实拖拽/回弹（含封面/封底开合）与内页一致——书体随进度联动
      const slideP = sheet.preview ? 0 : sheet.progress
      sheet.group.position.x =
        sheet.hingeX + sheet.worldFromX + (sheet.worldToX - sheet.worldFromX) * slideP
      for (const entry of this.staticMeshes.values()) {
        entry.mesh.position.x = entry.fromX + (entry.toX - entry.fromX) * slideP
      }
      this.stacks.apply(this.stackFrom, this.stackTo, slideP)
      this.deformSheetFold(sheet)
      return
    }
    let pe: number
    let slideP: number
    if (sheet.mode === 'time') {
      const t = Math.min(1, (now - sheet.startTime) / sheet.duration)
      pe = easeInOutCubic(t)
      slideP = pe
      if (t >= 1) {
        this.finishSheet(sheet, true)
        return
      }
    } else if (sheet.mode === 'drag') {
      pe = sheet.progress
      // 悬停预览：只预览卷曲形变，书体/静态页/纸叠钉在起始态
      slideP = sheet.preview ? 0 : pe
    } else {
      const t = Math.min(1, (now - sheet.startTime) / sheet.duration)
      const eased = easeInOutCubic(t)
      pe = sheet.p0 + (sheet.target - sheet.p0) * eased
      // 预览回弹同样不动书体
      slideP = sheet.preview ? 0 : pe
      if (t >= 1) {
        this.finishSheet(sheet, sheet.target === 1)
        return
      }
    }
    // 铰点 + 世界偏移插值：跨页/封面 hingeX=0 与历史行为一致，
    // 单页模式 hingeX=±半页宽 不再被清零
    sheet.group.position.x =
      sheet.hingeX + sheet.worldFromX + (sheet.worldToX - sheet.worldFromX) * slideP
    for (const entry of this.staticMeshes.values()) {
      entry.mesh.position.x = entry.fromX + (entry.toX - entry.fromX) * slideP
    }
    // 纸叠厚度/位置与静态页同步插值；开合翻页的边缘过渡由
    // from/to 的绝对边缘线性插值完成，与书体滑动同步
    this.stacks.apply(this.stackFrom, this.stackTo, slideP)
    this.deformSheet(sheet, pe)
  }

  removeSheet() {
    const sheet = this.sheet
    if (!sheet) return
    this.sheet = null
    this.markDirty()
    this.scene.remove(sheet.group)
    sheet.geometry.dispose()
    sheet.backGeometry.dispose()
    sheet.frontMaterial.dispose()
    sheet.backMaterial.dispose()
  }

  // 唤醒渲染循环：空闲停帧后，任何状态变化或动画启动的入口须调用。
  // 循环运行中（rafId 非 0）为 no-op；disposed 后不再排帧
  private wake() {
    if (this.rafId === 0 && !this.disposed) {
      this.rafId = requestAnimationFrame(this.tick)
    }
  }

  // 标脏并唤醒循环：所有让画面产生变化的状态写入统一走此入口
  private markDirty() {
    this.dirty = true
    this.wake()
  }

  private tick = (now: number) => {
    if (this.disposed) return
    this.updateSheet(now)
    // 相机动画结束帧显式标脏，保证终点帧被渲染
    if (this.rig.update(now)) this.dirty = true
    // time/settle 模式逐帧动画；drag 模式由指针驱动，仅状态变化帧渲染
    //（写入入口已 markDirty/wake 唤醒）
    const animating =
      (this.sheet !== null && this.sheet.mode !== 'drag') || this.rig.isAnimating
    if ((animating || this.dirty) && this.renderer && !this.contextLost) {
      this.renderer.render(this.scene, this.rig.camera)
      this.dirty = false
    }
    // 空闲（无逐帧动画、无脏标记）时停帧节能；之后的任何状态变化经
    // wake()/markDirty() 重新挂起循环。上下文丢失期间 dirty 无法被渲染
    // 清除，循环保持运转直至恢复/销毁（与停帧前行为一致）
    if (!animating && !this.dirty) {
      this.rafId = 0
      return
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
    this.stacks.dispose()
    this.stackFrom = null
    this.stackTo = null
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
