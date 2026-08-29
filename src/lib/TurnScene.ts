import * as THREE from 'three'

import { PAGE_HEIGHT, pageWidth } from '@/lib/flipSpec'
import { computeCrease, foldPoint, foldProgress } from '@/lib/pageFold'
import { curledColumns, easeInOutCubic } from '@/lib/pageCurl'
import type {
  EasingFn,
  FlipSheetOptions,
  FlipSpec,
  StackHover,
  StackVisual,
  StaticPlacement,
} from '@/types/turn'

const STATIC_Z = -0.01
// 相机适配边距默认值：视口相对书宽的外扩比例，越大留白越多
const DEFAULT_FIT_MARGIN = 1.12
// 渲染像素比默认上限：平衡清晰度与性能
const DEFAULT_MAX_PIXEL_RATIO = 2
// 最大缩放倍数默认值
const DEFAULT_MAX_ZOOM = 3
// 纸叠条带 z 向厚度（世界单位）：页高 2 时约 1.6%，模拟翻开书页堆的鼓起
const STACK_DEPTH = 0.032
// 纸叠几何呈缓坡梯形：外缘（离书远端）高度按此比例收窄，
// 模拟近大远小的透视——远端纸层在视野中更小更短
const STACK_TAPER = 0.01
// 纸叠内缘高度略低于页面：内页通常小于封面，留出的收边让纸叠不像贴纸块
const STACK_HEIGHT = PAGE_HEIGHT * 0.988
// 每个纹理单元内的页线数：层理密度按层数映射（一层纸一条页线），
// repeat.x = 层数 / 此值；层数过多时按厚度上限截断避免糊成噪声
const STACK_LINES_PER_UNIT = 32
// 纹理单元数上限：约 200 条页线，超过后混为整体灰调（真实厚书书口即如此）
const STACK_MAX_UNITS = 6
// 页线的最小屏幕像素间距：层数过多导致线距小于该值时按比例抽稀，
// 保证层理在屏幕上可分辨（窄条带下不会被采样糊掉）
const STACK_MIN_LINE_PX = 2
// 拖拽松手后回弹/补完动画的最短时长
const MIN_SETTLE_DURATION = 120
// 折角纸张的纵向网格分段：折线是斜线，纵向也需要分辨率（普通卷曲 2 段即可）
const FOLD_ROWS = 16
// 封面图层：封面/封底网格与封面灯光组单独一层，灯光按图层隔离，
// 实现封面（coverPreset）与内页（preset）互不干扰的光影
const COVER_LAYER = 1

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

// 程序化生成纸叠层理纹理：暖白纸色底 + 等距页线（一层纸一条线）+
// 上下边缘阴影。页线为"暗缝 + 亮边"双线：暗缝是纸页间缝隙，
// 亮边是纸页边缘的反光，两者相间构成可感知的层理。
// 一个纹理单元含 STACK_LINES_PER_UNIT 条页线，密度由层数驱动，
// 并按屏幕密度取下限（每线至少 STACK_MIN_LINE_PX 屏幕像素）
function createStackTexture(): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (ctx) {
    // 纸页切口的暖白底色，接近页面白避免色块突兀
    ctx.fillStyle = '#ede4d3'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    // 等距页线（8px 一条 → 32 条/单元）：3px 深暗缝 + 1px 亮边，
    // 高对比保证窄条带下仍可分辨（配合禁用 mipmap 的锐利采样）
    for (let x = 0; x < canvas.width; x += 8) {
      const lx = x + Math.floor(Math.random() * 2)
      const tone = 0.3 + Math.random() * 0.22
      ctx.fillStyle = `rgba(104, 88, 64, ${tone.toFixed(3)})`
      ctx.fillRect(lx, 0, 3, canvas.height)
      // 纸页边缘反光亮线，紧贴暗缝右侧
      ctx.fillStyle = 'rgba(255, 252, 244, 0.55)'
      ctx.fillRect(lx + 3, 0, 1, canvas.height)
    }
    // 少量更深的错位缝：纸堆局部滑移形成的"书口纹"
    for (let i = 0; i < 4; i++) {
      const x = Math.floor(Math.random() * canvas.width)
      ctx.fillStyle = 'rgba(112, 96, 72, 0.32)'
      ctx.fillRect(x, 0, 2, canvas.height)
    }
    // 上下边缘轻微压暗：页堆顶/底边与页面衔接处的柔和阴影
    const shade = ctx.createLinearGradient(0, 0, 0, canvas.height)
    shade.addColorStop(0, 'rgba(60, 50, 36, 0.16)')
    shade.addColorStop(0.12, 'rgba(60, 50, 36, 0)')
    shade.addColorStop(0.88, 'rgba(60, 50, 36, 0)')
    shade.addColorStop(1, 'rgba(60, 50, 36, 0.16)')
    ctx.fillStyle = shade
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  // 禁用 mipmap：条带仅数像素宽，mip 链会把细页线平均成色块；
  // 线距已按屏幕密度抽稀（每线 ≥2px），线性采样无闪烁
  texture.generateMipmaps = false
  texture.minFilter = THREE.LinearFilter
  return texture
}

// 梯形棱柱纸叠几何：x∈[-0.5,0.5]，x=-0.5 为内缘（贴书，全高），
// x=+0.5 为外缘（高度按 STACK_TAPER 收窄）。scale.x=thickness 时
// 几何 +x 端在世界坐标中总是朝外（左右侧均成立）。
// 每面独立顶点（flat 法线），uv 的 u 轴沿厚度方向，层理纹理各面对齐
function createStackGeometry(): THREE.BufferGeometry {
  const h0 = STACK_HEIGHT / 2
  const h1 = (STACK_HEIGHT * (1 - STACK_TAPER)) / 2
  const d = STACK_DEPTH / 2
  // 8 个角点：内缘 A(下前) E(下后) D(上前) H(上后)，外缘 B F C G
  const A: [number, number, number] = [-0.5, -h0, d]
  const B: [number, number, number] = [0.5, -h1, d]
  const C: [number, number, number] = [0.5, h1, d]
  const D: [number, number, number] = [-0.5, h0, d]
  const E: [number, number, number] = [-0.5, -h0, -d]
  const F: [number, number, number] = [0.5, -h1, -d]
  const G: [number, number, number] = [0.5, h1, -d]
  const H: [number, number, number] = [-0.5, h0, -d]
  // 每面：4 顶点（逆时针，法线朝外）+ 对应 uv
  const faces: Array<{ pts: [number, number, number][]; uvs: [number, number][] }> = [
    // 正面 +z：层理线沿厚度（u=x）
    { pts: [A, B, C, D], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] },
    // 背面 -z
    { pts: [E, H, G, F], uvs: [[0, 0], [0, 1], [1, 1], [1, 0]] },
    // 顶面 +y（内高外低的斜面）：u 沿厚度
    { pts: [D, C, G, H], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] },
    // 底面 -y
    { pts: [E, F, B, A], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] },
    // 外缘端面 +x
    { pts: [F, B, C, G], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] },
    // 内缘端面 -x（通常被书页贴合遮挡）
    { pts: [E, A, D, H], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] },
  ]
  const positions: number[] = []
  const uvs: number[] = []
  for (const face of faces) {
    const { pts, uvs: faceUvs } = face
    // quad 拆两个三角形：(0,1,2) + (0,2,3)
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const p = pts[i]!
      const uv = faceUvs[i]!
      positions.push(p[0], p[1], p[2])
      uvs.push(uv[0], uv[1])
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.computeVertexNormals()
  return geometry
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
  /** 初始纵向坐标（折角形变需要还原 y） */
  baseY: Float32Array
  sign: number
  worldFromX: number
  worldToX: number
  startTime: number
  duration: number
  onDone: ((committed: boolean) => void) | null
  mode: SheetMode
  /** 铰点（书脊/页缘）世界 x：纸张组原点，卷曲旋转与折线 s 坐标都以此为基准 */
  hingeX: number
  /** 卷曲幅度（硬页为 0） */
  curl: number
  /** 折角状态：非 null 时按折角形变渲染（替代书脊卷曲） */
  fold: { pu: number; pv: number; qu: number; qv: number } | null
  /** 折线圆弧过渡宽度（世界单位） */
  bend: number
  /** 折角 settle 动画的拖点起止（页宽坐标） */
  foldFromQ: [number, number] | null
  foldToQ: [number, number] | null
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

// 纸叠条带一侧的运行时状态：网格为缩放的梯形棱柱，厚度/位置/层数随翻页插值更新
interface StackSideMesh {
  mesh: THREE.Mesh
  material: THREE.MeshLambertMaterial
  texture: THREE.Texture
  edgeX: number
  thickness: number
  layers: number
  dir: 1 | -1
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
  // 封面/封底页索引集合：这些页的网格挂到封面图层（封面灯光照亮）
  private readonly coverPages = new Set<number>()
  // 纸叠条带（左右各一，懒创建）
  private readonly stackSides: { left: StackSideMesh | null; right: StackSideMesh | null } = {
    left: null,
    right: null,
  }
  private stackFrom: StackVisual | null = null
  private stackTo: StackVisual | null = null
  private stackGeometry: THREE.BufferGeometry | null = null
  private stackBaseTexture: THREE.Texture | null = null
  private stackHighlight: THREE.Mesh | null = null
  private stackHighlightMaterial: THREE.MeshBasicMaterial | null = null
  private sheet: SheetState | null = null
  private targetFitWidth: number
  // 页面布局适配宽度（不含纸叠）
  private pageFitWidth: number
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
    this.pageFitWidth = this.sheetWidth * 2
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
    // 相机放行封面图层，否则封面网格不渲染
    this.camera.layers.enable(COVER_LAYER)
    // 拾取放行封面图层（射线默认只测图层 0，会漏掉封面网格）
    this.raycaster.layers.enableAll()

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
    this.disposeStacks()
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

    this.pageFitWidth = placements.reduce(
      (width, p) =>
        Math.max(width, p.spread ? this.sheetWidth * 2 : Math.abs(this.slotX(p.slot)) * 2 + this.sheetWidth),
      this.sheetWidth,
    )
    this.recomputeFitWidth()

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

  // 封面/封底页索引：布局重建时同步，静态页与翻页纸张据此挂封面图层
  setCoverPages(indices: number[]) {
    this.coverPages.clear()
    for (const index of indices) this.coverPages.add(index)
  }

  // 适配宽度 = 页面布局宽度 + 纸叠两侧厚度（空闲态以 stackTo 计）
  private recomputeFitWidth() {
    this.targetFitWidth =
      this.pageFitWidth + (this.stackTo?.left?.thickness ?? 0) + (this.stackTo?.right?.thickness ?? 0)
  }

  // 纸叠条带：贴在可见页面外缘的页层块，厚度随翻页插值变化。
  // to 省略时直接吸附到 from（空闲布局）；同时给出时由翻页动画驱动插值。
  setStacks(from: StackVisual | null, to?: StackVisual | null) {
    this.stackFrom = from
    this.stackTo = to ?? from
    this.recomputeFitWidth()
    this.hideStackHighlight()
    // 无纸张动画时立即应用终点（渲染不可用的兜底路径也走到这里）
    if (!this.sheet) this.applyStacks(1)
  }

  // 应用插值进度 p 下的纸叠几何：edgeX 与厚度在 from/to 间线性过渡；
  // 某一侧状态缺失时按厚度 0 原地生长/渐隐。
  // computeStackSides 对合书（±半页宽）与开书（±整页宽）已返回正确边缘，
  // 线性插值与书体滑动同步，无需额外缩放
  private applyStacks(p: number) {
    const from = this.stackFrom
    const to = this.stackTo
    for (const side of ['left', 'right'] as const) {
      const f = from?.[side] ?? null
      const t = to?.[side] ?? null
      const entry = this.stackSides[side]
      if (!f && !t) {
        if (entry) entry.mesh.visible = false
        continue
      }
      const fe = f ? f.edgeX : t!.edgeX
      const te = t ? t.edgeX : f!.edgeX
      const ft = f?.thickness ?? 0
      const tt = t?.thickness ?? 0
      const fl = f?.layers ?? t!.layers
      const tl = t?.layers ?? f!.layers
      const e = entry ?? this.ensureStackSide(side)
      e.dir = (t ?? f)!.dir
      e.edgeX = fe + (te - fe) * p
      e.thickness = ft + (tt - ft) * p
      e.layers = fl + (tl - fl) * p
      e.mesh.visible = e.thickness > 1e-4
      e.mesh.scale.x = Math.max(e.thickness, 1e-4)
      // 梯形收窄端（几何 +x）须朝外侧：右侧即世界 +x，左侧绕 y 转 π
      // 镜像到世界 -x（法线随旋转保持朝外），保证两侧都是"内缘全高、外缘收窄"
      e.mesh.rotation.y = e.dir === 1 ? 0 : Math.PI
      e.mesh.position.x = e.edgeX + (e.dir * e.thickness) / 2
      // 层理密度按层数映射（一层纸一条页线），再按屏幕密度抽稀：
      // 每线至少 STACK_MIN_LINE_PX 像素，线距过小时按比例减线，
      // 保证层理在屏幕上可分辨；层数过多时按厚度截断混为灰调
      const worldPerPx = this.camera.position.z / this.perspective
      const maxLines =
        worldPerPx > 0 ? e.thickness / (worldPerPx * STACK_MIN_LINE_PX) : Infinity
      const lines = Math.min(e.layers, maxLines)
      const units = Math.min(lines / STACK_LINES_PER_UNIT, STACK_MAX_UNITS)
      e.texture.repeat.set(Math.max(1e-3, units), 1)
    }
  }

  private ensureStackSide(side: 'left' | 'right'): StackSideMesh {
    const existing = this.stackSides[side]
    if (existing) return existing
    if (!this.stackGeometry) {
      // 梯形棱柱：内缘贴书全高，外缘按 STACK_TAPER 收窄形成缓坡透视
      this.stackGeometry = createStackGeometry()
    }
    if (!this.stackBaseTexture) this.stackBaseTexture = createStackTexture()
    // 各侧克隆纹理以独立设置 repeat（层理密度随层数变化）；
    // 各向异性过滤：条带以斜视线观察，斜向采样不糊
    const texture = this.stackBaseTexture.clone()
    texture.needsUpdate = true
    if (this.renderer) texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
    const material = new THREE.MeshLambertMaterial({ color: 0xffffff, map: texture })
    const mesh = new THREE.Mesh(this.stackGeometry, material)
    mesh.visible = false
    this.scene.add(mesh)
    const entry: StackSideMesh = {
      mesh,
      material,
      texture,
      edgeX: 0,
      thickness: 0,
      layers: 0,
      dir: side === 'left' ? -1 : 1,
    }
    this.stackSides[side] = entry
    return entry
  }

  // 射线拾取纸叠：返回命中侧与自内侧算起的厚度比例
  pickStack(clientX: number, clientY: number): { side: 'left' | 'right'; fraction: number } | null {
    if (!this.renderer || this.contextLost) return null
    const rect = this.renderer.domElement.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    const entries = (['left', 'right'] as const)
      .map((side) => ({ side, entry: this.stackSides[side] }))
      .filter(
        (item): item is { side: 'left' | 'right'; entry: StackSideMesh } =>
          item.entry !== null && item.entry.mesh.visible && item.entry.thickness > 0,
      )
    if (entries.length === 0) return null
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(ndc, this.camera)
    const hits = this.raycaster.intersectObjects(
      entries.map((item) => item.entry.mesh),
      false,
    )
    const hit = hits[0]
    if (!hit) return null
    const found = entries.find((item) => item.entry.mesh === hit.object)
    if (!found) return null
    const { entry } = found
    const fraction = ((hit.point.x - entry.edgeX) * entry.dir) / entry.thickness
    return { side: found.side, fraction: clamp(fraction, 0, 0.9999) }
  }

  // 设置纸叠高亮条带（null 清除）
  setStackHover(hover: StackHover | null) {
    if (!hover) {
      this.hideStackHighlight()
      return
    }
    const entry = this.stackSides[hover.side]
    if (!entry || !entry.mesh.visible || entry.thickness <= 0) {
      this.hideStackHighlight()
      return
    }
    if (!this.stackHighlight) {
      this.stackHighlightMaterial = new THREE.MeshBasicMaterial({
        color: 0x7fa8ff,
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
      })
      // 复用纸叠梯形几何：高亮形状与纸叠正面轮廓一致，
      // 外缘收窄处不会超出梯形边界
      const geometry = this.stackGeometry ?? createStackGeometry()
      this.stackHighlight = new THREE.Mesh(geometry, this.stackHighlightMaterial)
      this.stackHighlight.visible = false
      this.scene.add(this.stackHighlight)
    }
    // 层过薄时保证最小可见高亮宽度
    const width = Math.max((hover.end - hover.start) * entry.thickness, 0.01)
    const center = (hover.start + hover.end) / 2
    this.stackHighlight.visible = true
    this.stackHighlight.scale.x = width
    // 与纸叠同向镜像：收窄端朝外侧，高亮轮廓贴合所在侧梯形
    this.stackHighlight.rotation.y = entry.dir === 1 ? 0 : Math.PI
    // 几何正面在局部 z=+STACK_DEPTH/2，位置取 0.003 使其浮出纸叠正面
    this.stackHighlight.position.set(
      entry.edgeX + entry.dir * center * entry.thickness,
      0,
      0.003,
    )
  }

  private hideStackHighlight() {
    if (this.stackHighlight) this.stackHighlight.visible = false
  }

  private stackExtentWidth(visual: StackVisual | null): number {
    return (visual?.left?.thickness ?? 0) + (visual?.right?.thickness ?? 0)
  }

  // 释放纸叠资源（上下文丢失/组件销毁时）
  private disposeStacks() {
    for (const side of ['left', 'right'] as const) {
      const entry = this.stackSides[side]
      if (!entry) continue
      this.scene.remove(entry.mesh)
      entry.material.dispose()
      entry.texture.dispose()
      this.stackSides[side] = null
    }
    if (this.stackHighlight) {
      this.scene.remove(this.stackHighlight)
      this.stackHighlight.geometry.dispose()
      this.stackHighlight = null
    }
    this.stackHighlightMaterial?.dispose()
    this.stackHighlightMaterial = null
    this.stackGeometry?.dispose()
    this.stackGeometry = null
    this.stackBaseTexture?.dispose()
    this.stackBaseTexture = null
    this.stackFrom = null
    this.stackTo = null
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

  // 创建翻页纸张（几何/材质/镜像），time 与 drag 模式共用；
  // fold 为 true 时提高纵向分段（斜折线需要纵向分辨率）；
  // options 携带封面档覆盖（curl/nPolygons），封面/封底网格挂封面图层独立光照
  private createSheet(
    spec: FlipSpec,
    frontTexture: THREE.Texture | null,
    backTexture: THREE.Texture | null,
    onDone: (committed: boolean) => void,
    fold = false,
    options?: FlipSheetOptions,
  ): SheetState | null {
    const worldFromX = spec.worldFromX ?? 0
    const worldToX = spec.worldToX ?? 0
    const curl = options?.curl ?? this.curl
    const nPolygons = Math.max(2, Math.round(options?.nPolygons ?? this.nPolygons))

    const geometry = new THREE.PlaneGeometry(
      this.sheetWidth,
      PAGE_HEIGHT,
      nPolygons,
      fold ? FOLD_ROWS : 2,
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
      startTime: 0,
      duration: 0,
      onDone,
      mode: 'time',
      curl,
      fold: null,
      bend: 0.16 * this.sheetWidth,
      foldFromQ: null,
      foldToQ: null,
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
    const sheet = this.createSheet(spec, frontTexture, backTexture, onDone, false, options)
    if (!sheet) return
    const startTime = performance.now()
    sheet.startTime = startTime
    sheet.duration = positive(duration, 900)
    this.sheet = sheet
    // 相机从当前位置动画到目标适配距离（缩放/平移被一并复位，级别归 1）；
    // 适配宽度计入目标态纸叠厚度，条带不被视口裁剪
    this.zoomLevel = 1
    this.animateCameraTo(
      this.fitDistance(sheet.toFitWidth + this.stackExtentWidth(this.stackTo)),
      0,
      0,
      sheet.duration,
      startTime,
    )
  }

  // 主动折页翻页（点击翻页/next/prev，fold 开启时替代 startFlip 的卷曲动画）：
  // 锚点取外缘中部（竖直折线），拖点从外缘扫到对侧完成翻页——折页拖拽的
  // 自动化版本，复用 settle 动画机制
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
    const sheet = this.createSheet(spec, frontTexture, backTexture, onDone, true, options)
    if (!sheet) return false
    sheet.mode = 'drag'
    sheet.bend = positive(bend, sheet.bend)
    sheet.fold = { pu: this.sheetWidth, pv: 0, qu: this.sheetWidth, qv: 0 }
    sheet.progress = 0
    this.sheet = sheet
    // 相机复位与 startFlip 一致（缩放/平移复位，级别归 1）
    this.zoomLevel = 1
    this.animateCameraTo(
      this.fitDistance(sheet.toFitWidth + this.stackExtentWidth(this.stackTo)),
      0,
      0,
      positive(duration, 900),
      performance.now(),
    )
    // settle 到完成：拖点动画扫到对侧
    this.endFoldDrag(true, positive(duration, 900))
    return true
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
    const sheet = this.createSheet(spec, frontTexture, backTexture, onDone, false, options)
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
    // 书脊拖拽接管折角悬停的纸张：清除折角状态，回落到卷曲形变
    if (sheet.fold) {
      sheet.fold = null
      sheet.foldFromQ = null
      sheet.foldToQ = null
    }
    sheet.progress = clamp(progress, 0, 1)
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
  ): boolean {
    if (!this.renderer || this.contextLost) return false
    const existing = this.sheet
    if (existing && existing.mode === 'drag') {
      existing.fold = { pu: pickU, pv: pickV, qu: pickU, qv: pickV }
      existing.bend = positive(bend, existing.bend)
      existing.progress = 0
      return true
    }
    if (this.sheet) this.removeSheet()
    this.applyWorldOffsets(spec)
    const sheet = this.createSheet(spec, frontTexture, backTexture, onDone, true, options)
    if (!sheet) return false
    sheet.mode = 'drag'
    sheet.fold = { pu: pickU, pv: pickV, qu: pickU, qv: pickV }
    sheet.bend = positive(bend, sheet.bend)
    sheet.progress = 0
    this.sheet = sheet
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
    this.raycaster.setFromCamera(ndc, this.camera)
    const { origin, direction } = this.raycaster.ray
    if (Math.abs(direction.z) < 1e-6) return null
    const t = -origin.z / direction.z
    if (t < 0) return null
    return [origin.x + direction.x * t, origin.y + direction.y * t]
  }

  // 折角拖拽跟随指针：指针投射到页平面后换算为页宽坐标并钳制。
  // 返回当前折角进度 [0,1]，无折角纸张时返回 null
  setFoldDragFromClient(clientX: number, clientY: number): number | null {
    const sheet = this.sheet
    if (!sheet || sheet.mode !== 'drag' || !sheet.fold) return null
    const world = this.pagePointFromClient(clientX, clientY)
    if (!world) return sheet.progress
    // 页宽坐标：世界 x 减去纸张组原点（书脊铰点 + 布局偏移）；
    // 镜像几何（B）顶点 x = 组原点 - s，方向取反
    let qu = world[0] - sheet.group.position.x
    if (sheet.sign < 0) qu = -qu
    const qv = world[1]
    return this.setFoldDragAt(qu, qv)
  }

  // 直接以页宽坐标设置折角拖点（悬停预览用）；返回折角进度
  setFoldDragAt(qu: number, qv: number): number | null {
    const sheet = this.sheet
    if (!sheet || sheet.mode !== 'drag' || !sheet.fold) return null
    sheet.fold.qu = clamp(qu, -this.sheetWidth, this.sheetWidth)
    sheet.fold.qv = clamp(qv, -PAGE_HEIGHT / 2, PAGE_HEIGHT / 2)
    sheet.progress = foldProgress(sheet.fold.qu, this.sheetWidth)
    return sheet.progress
  }

  // 折角拖拽结束：commit 动画拖点至对侧镜像位（整页折过 = 完成翻页），
  // 否则拖点收回抓取点展平；动画结束统一走 finishSheet 收敛布局
  endFoldDrag(commit: boolean, baseDuration: number) {
    const sheet = this.sheet
    if (!sheet || !sheet.fold || sheet.mode !== 'drag') return
    const { pu, pv, qu, qv } = sheet.fold
    const target = commit ? 1 : 0
    const toQ: [number, number] = commit ? [-this.sheetWidth, pv] : [pu, pv]
    if (qu === toQ[0] && qv === toQ[1]) {
      this.finishSheet(sheet, commit)
      return
    }
    sheet.mode = 'settle'
    sheet.p0 = sheet.progress
    sheet.target = target
    sheet.foldFromQ = [qu, qv]
    sheet.foldToQ = toQ
    sheet.startTime = performance.now()
    sheet.duration = Math.max(
      MIN_SETTLE_DURATION,
      positive(baseDuration, 900) * Math.abs(target - sheet.progress),
    )
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
    const fitWidth =
      (commit ? sheet.toFitWidth : sheet.fromFitWidth) +
      this.stackExtentWidth(commit ? this.stackTo : this.stackFrom)
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
    const fitWidth =
      (committed ? sheet.toFitWidth : sheet.fromFitWidth) +
      this.stackExtentWidth(committed ? this.stackTo : this.stackFrom)
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

  // 纸张折角形变：折线取抓取点与拖点连线的垂直平分线，P 侧翻折；
  // P≈Q（未折）时顶点还原为初始平面
  private deformSheetFold(sheet: SheetState) {
    const fold = sheet.fold
    if (!fold) return
    const crease = computeCrease(fold.pu, fold.pv, fold.qu, fold.qv, sheet.bend)
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
    if (sheet.fold) {
      if (sheet.mode === 'settle') {
        const t = Math.min(1, (now - sheet.startTime) / sheet.duration)
        const eased = easeInOutCubic(t)
        const from = sheet.foldFromQ
        const to = sheet.foldToQ
        if (from && to) {
          sheet.fold.qu = from[0] + (to[0] - from[0]) * eased
          sheet.fold.qv = from[1] + (to[1] - from[1]) * eased
          sheet.progress = foldProgress(sheet.fold.qu, this.sheetWidth)
        }
        if (t >= 1) {
          this.finishSheet(sheet, sheet.target === 1)
          return
        }
      }
      const slideP = sheet.progress
      sheet.group.position.x =
        sheet.hingeX + sheet.worldFromX + (sheet.worldToX - sheet.worldFromX) * slideP
      for (const entry of this.staticMeshes.values()) {
        entry.mesh.position.x = entry.fromX + (entry.toX - entry.fromX) * slideP
      }
      this.applyStacks(sheet.progress)
      this.deformSheetFold(sheet)
      return
    }
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
    // 铰点 + 世界偏移插值：跨页/封面 hingeX=0 与历史行为一致，
    // 单页模式 hingeX=±半页宽 不再被清零
    sheet.group.position.x =
      sheet.hingeX + sheet.worldFromX + (sheet.worldToX - sheet.worldFromX) * slideP
    for (const entry of this.staticMeshes.values()) {
      entry.mesh.position.x = entry.fromX + (entry.toX - entry.fromX) * slideP
    }
    // 纸叠厚度/位置与静态页同步插值；开合翻页的边缘过渡由
    // from/to 的绝对边缘线性插值完成，与书体滑动同步
    this.applyStacks(slideP)
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
    this.disposeStacks()
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
