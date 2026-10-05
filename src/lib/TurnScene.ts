import * as THREE from 'three'

import { CameraRig } from './CameraRig'
import { StackRenderer } from './StackRenderer'
import { PAGE_HEIGHT, sheetWorldWidth } from './flipSpec'
import { clamp, positive } from './math'
import { clampFoldDragToSpine, computeCrease, foldPoint, foldProgress, FOLD_TILT } from './pageFold'
import { deriveStackEdges, type StackEdgeSource } from './pageStack'
import { curledColumns, easeInOutCubic } from './pageCurl'
import type { SpineShadeU } from './spineShading'
import type {
  FlipSheetOptions,
  FlipSpec,
  StackHover,
  StackVisual,
  StaticPlacement,
} from '../types/turn'

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
// 软纸卷曲翻页的向上翘起：真实纸页翻起时自由边会脱离书面拱起、页面上缘
// 翘得比下缘略高（空气从页下穿过）；基础卷曲是纵向均匀的柱面弯，姿态偏"平"。
// 翘起分两个分量，包络均随翻页进度 sin(θ) 起落、起翻/落页归零：
// - CURL_LIFT（朝相机方向，z，世界单位，约为页高 2 的 10%）：页面向外
//   鼓起的"帆面"感，页面斜对相机时呈现为弧面透视；页面立起侧对相机时
//   此分量不可见
// - CURL_LIFT_Y（屏幕向上，y）：自由边抬离书面、上缘抬得更高——正面视角
//   下全程可读的"翘起"，补足 z 分量在页面立起时的视觉空档
// soft 档点击翻页走 fold 路径、拖拽/边缘翻页走 curl 路径，两条路径共用
// 本组常量保证观感一致；hard 刚体翻转不受影响
const CURL_LIFT = 0.2
// 上缘相对下缘的翘起差（占各分量的比例）：翘起量沿页高线性倾斜，
// 顶缘 +30%、底缘 −30%，形成锥形扭翘而非整页平移
const CURL_LIFT_TILT = 0.6
// 屏幕向上分量幅度（世界单位，约为页高 2 的 10%）
const CURL_LIFT_Y = 0.2
// y 分量的纵向分布：底缘保留 35% 避免自由边下缘完全贴死书面，上缘全额抬起
const CURL_LIFT_Y_TOP_BIAS = 0.65
// fold 路径翘起权重的爬坡参考高度（占页宽比例）：顶点翘起权重取 fold 自身
// 抬升高度除以该值并钳制到 1——折缝圆弧段 z 平滑上升，权重随之从 0 爬到 1
const FOLD_LIFT_RAMP = 0.25
// 书脊内阴影：页面材质注入的"缝谷"渐变变暗，模仿真实书页装订侧的曲面
// 受光——深色缝芯（窄、深）+ 长尾缓降（宽、浅，书页拱起的曲面感）+ 外缘
// 微暗（纸层堆叠）。全部强度/宽度乘页数缩放系数（spineScaleOf），上限即
// scale=1 的照片匹配值；缩放曲线与常量不对外暴露
const SPINE_CORE = 0.45
const SPINE_CORE_W = 0.02
const SPINE_TAIL = 0.2
const SPINE_TAIL_W = 0.18
const SPINE_OUTER = 0.1
const SPINE_OUTER_W = 0.04

/** 书脊内阴影的注入 uniforms（挂在材质 userData 上跨编译复用）：
 * 几何（uSpineU/uSpineOuter/uSpineDual）按页更新，六项强度/宽度
 * 随页数缩放系数实时更新 */
interface SpineShadeUniforms {
  uSpineU: { value: number }
  uSpineOuter: { value: number }
  uSpineDual: { value: number }
  uCore: { value: number }
  uCoreW: { value: number }
  uTail: { value: number }
  uTailW: { value: number }
  uOuter: { value: number }
  uOuterW: { value: number }
}

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
  /** 书脊内阴影：所有书页靠书脊一侧的渐变变暗（默认开启），挂载时冻结 */
  spineShadow?: boolean
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
  /** 本张纸的网格横向分段数：形变场采样必须与建网格时的分段一致
   *  （封面档经 options.nPolygons 覆盖，与场景级值可不同） */
  nPolygons: number
  fromFitWidth: number
  toFitWidth: number
  /** 反向翻页（spec.reverse）：进度语义不变（1=翻出缝侧），但时间驱动
   *  反放（1→0）、拖拽进度按 1-p 换算，落定提交判定随之反转 */
  reverse: boolean
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

/** 扇形翻页的单张纸计划：多页跳转时每步一张纸并发翻动 */
export interface FanSheetPlan {
  spec: FlipSpec
  frontTexture: THREE.Texture | null
  backTexture: THREE.Texture | null
  /** 骨架纸（空白占位）：降低折页网格分段——无内容细节时形变开销随张数可控 */
  skeleton?: boolean
  /** 该张纸落定（翻页提交）时触发；全部落定后触发 startFanFlip 的整体 onDone */
  onDone: (committed: boolean) => void
}

/** 扇形翻页运行中的一张纸：折页 settle 动画 + 错峰时钟与落定标记 */
interface FanRunningSheet extends FoldSettleSheet {
  fanIndex: number
  landed: boolean
}

/** 扇形翻页运行态：多张纸并发、全局书体平移与一次整体收尾 */
interface FanState {
  sheets: FanRunningSheet[]
  /** 全局书体平移起止（首张纸 spec 的起点偏移 → 末张纸 spec 的终点偏移） */
  worldFromX: number
  worldToX: number
  startTime: number
  duration: number
  onDone: () => void
}

interface StaticEntry {
  mesh: THREE.Mesh
  material: THREE.MeshLambertMaterial
  index: number
  spread: boolean
}

/**
 * 3D 翻书场景：静态页网格、翻页纸张形变与渲染循环的编排层。
 * 相机控制委托 CameraRig，纸叠渲染委托 StackRenderer；
 * 本类持有页面网格、纸张状态机与射线拾取。
 *
 * 书体组（bookBody）：静态页、翻页纸张与纸叠条带的公共父节点。
 * 翻页期"书体平移"（spec.worldFromX/worldToX，封面/封底开合时书本
 * 整体平移）只写在 bookBody.position.x 上——子节点一律使用书体局部
 * 坐标（静态页钉在槽位、纸张组钉在铰点、纸叠条带贴页面实际外缘），
 * 书本动则全体自动跟随，无逐网格的世界偏移烘焙。
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
  private readonly bookBody = new THREE.Group()
  private readonly rig: CameraRig
  private readonly raycaster = new THREE.Raycaster()
  private readonly stacks: StackRenderer
  private readonly staticMeshes = new Map<number, StaticEntry>()
  // 封面/封底页索引集合：这些页的网格挂到封面图层（封面灯光照亮）
  private readonly coverPages = new Set<number>()
  // 书脊内阴影开关（挂载时冻结）与页数缩放系数（随页数变化实时更新）
  private readonly spineShadow: boolean
  private spineScale = 1
  private stackFrom: StackVisual | null = null
  private stackTo: StackVisual | null = null
  private sheet: SheetState | null = null
  // 扇形翻页运行态（多页跳转的并发纸张）：与单纸张状态机互斥存在
  private fan: FanState | null = null
  // 页面布局适配宽度（不含纸叠）
  private pageFitWidth: number
  // 页面布局 + 纸叠的总适配宽度（推送给相机装配）
  private targetFitWidth: number
  // 逐帧/逐次拾取的复用缓冲：条带边缘每帧算一次、拾取每次 pointermove 都走，
  // 逐次新建数组与向量是纯 GC 压力（成员数很小，但频率高）
  private readonly edgeScratch: StackEdgeSource[] = []
  private readonly pickMeshes: THREE.Object3D[] = []
  private readonly pickEntries: StaticEntry[] = []
  private readonly pickNdc = new THREE.Vector2()
  private rafId = 0
  // 脏标记：按需渲染。纸张/相机动画进行中每帧渲染；静止时仅在场景
  // 有变化（布局重建、纹理更新、缩放平移、悬停高亮等）的那一帧渲染，
  // 避免书本静止时仍 60fps 全量渲染 WebGL 场景
  private dirty = true
  private disposed = false

  constructor(options: TurnSceneOptions) {
    this.container = options.container
    this.pageAspect = positive(options.pageAspect, 0.75)
    // 下限钳制 2：round 可能把 (0,0.5) 的输入收敛为 0，colW=width/0=Infinity
    // 会让卷曲形变整页塌缩到书脊
    this.nPolygons = Math.max(2, Math.round(positive(options.nPolygons ?? 64, 64)))
    this.curl = options.curl ?? 0.8
    this.spineShadow = options.spineShadow ?? true
    this.sheetWidth = sheetWorldWidth(this.pageAspect)
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

    this.scene.add(this.bookBody)
    this.stacks = new StackRenderer({
      parent: this.bookBody,
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
    // 扇形翻页同样无法继续：未落定纸张按提交收尾（跳转语义是前进到目标，
    // 半空中取消会让页码与书面撕裂）
    if (this.fan) this.finishFan(true)
    // 相机动画同样失效：冻结在当前位置，恢复后由 refit/下一次动画收敛
    // （否则恢复前 rig.update 仍对着失效上下文插值，恢复后停在陈旧终点）
    this.rig.cancelAnimation()
    // 清空静态网格：上下文丢失后几何体/材质失效，恢复时由调用方重建
    for (const entry of this.staticMeshes.values()) {
      this.bookBody.remove(entry.mesh)
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

  // 空闲时重适配相机；纸张动画（单张/扇形）进行中跳过（随后由动画终点收敛）
  private refitCamera() {
    if (this.sheet || this.fan) return
    if (this.rig.refit()) this.markDirty()
  }

  // 页数缩放系数（spineScaleOf，0~1 封顶）：书越厚缝谷越深越宽。
  // 更新后由调用方的 setStaticPages 把新系数写入各页 uniforms
  setSpineScale(scale: number) {
    const next = Number.isFinite(scale) ? clamp(scale, 0, 1) : 1
    if (this.spineScale === next) return
    this.spineScale = next
    this.markDirty()
  }

  // 书脊内阴影：往页面材质注入"缝谷"渐变变暗的片段着色——按 UV 到书脊
  // U 坐标的距离做双分量指数衰减（深缝芯 + 长尾缓降），叠加外缘微暗。
  // 阴影按 UV 计算并乘入漫反射色——长在纸面上，随卷曲/折页顶点形变，
  // 翻页中不脱落。u=null 时全部强度置 0（保留注入，布局切换不重编译）。
  // 材质各自持有 uniforms 实例（每页书脊位置不同），GLSL 相同故程序可共享
  private applySpineShading(material: THREE.MeshLambertMaterial, u: SpineShadeU | null) {
    if (!this.spineShadow) return
    // USE_UV 强制声明 vUv：页面可能暂无 map（纹理未就绪），Lambert 默认
    // 不声明 uv varying
    if (material.defines?.USE_UV === undefined) {
      material.defines = { ...material.defines, USE_UV: '' }
    }
    if (material.userData.spineUniforms === undefined) {
      const uniforms: SpineShadeUniforms = {
        uSpineU: { value: 0 },
        uSpineOuter: { value: 0 },
        uSpineDual: { value: 0 },
        uCore: { value: 0 },
        uCoreW: { value: 0 },
        uTail: { value: 0 },
        uTailW: { value: 0 },
        uOuter: { value: 0 },
        uOuterW: { value: 0 },
      }
      material.userData.spineUniforms = uniforms
      material.onBeforeCompile = (shader) => {
        shader.uniforms.uSpineU = uniforms.uSpineU
        shader.uniforms.uSpineOuter = uniforms.uSpineOuter
        shader.uniforms.uSpineDual = uniforms.uSpineDual
        shader.uniforms.uCore = uniforms.uCore
        shader.uniforms.uCoreW = uniforms.uCoreW
        shader.uniforms.uTail = uniforms.uTail
        shader.uniforms.uTailW = uniforms.uTailW
        shader.uniforms.uOuter = uniforms.uOuter
        shader.uniforms.uOuterW = uniforms.uOuterW
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            [
              '#include <common>',
              'uniform float uSpineU;',
              'uniform float uSpineOuter;',
              'uniform float uSpineDual;',
              'uniform float uCore;',
              'uniform float uCoreW;',
              'uniform float uTail;',
              'uniform float uTailW;',
              'uniform float uOuter;',
              'uniform float uOuterW;',
            ].join('\n'),
          )
          .replace(
            '#include <map_fragment>',
            [
              '#include <map_fragment>',
              // 缝谷：到书脊的双分量指数衰减（深缝芯+长尾）+ 外缘微暗；
              // max 防 scale 极小时宽度为 0 的除零
              '#ifdef USE_UV',
              'float dIn = abs(vUv.x - uSpineU);',
              'float dOut = uSpineDual > 0.5 ? min(vUv.x, 1.0 - vUv.x) : abs(vUv.x - uSpineOuter);',
              'float spineShade = uCore * exp(-dIn / max(uCoreW, 1e-4));',
              'spineShade += uTail * exp(-dIn / max(uTailW, 1e-4));',
              'spineShade += uOuter * exp(-dOut / max(uOuterW, 1e-4));',
              'diffuseColor.rgb *= 1.0 - clamp(spineShade, 0.0, 0.95);',
              '#endif',
            ].join('\n'),
          )
      }
      this.writeSpineUniforms(uniforms, u)
    } else {
      this.writeSpineUniforms(material.userData.spineUniforms as SpineShadeUniforms, u)
    }
  }

  // 把几何定位与"常量 × 页数缩放"写入材质 uniforms
  private writeSpineUniforms(uniforms: SpineShadeUniforms, u: SpineShadeU | null) {
    const scale = this.spineScale
    uniforms.uSpineU.value = u?.inner ?? 0
    uniforms.uSpineDual.value = u?.outer === 'both' ? 1 : 0
    uniforms.uSpineOuter.value = u === null ? 0 : u.outer === 'both' ? 0 : u.outer
    uniforms.uCore.value = u === null ? 0 : SPINE_CORE * scale
    uniforms.uCoreW.value = SPINE_CORE_W * scale
    uniforms.uTail.value = u === null ? 0 : SPINE_TAIL * scale
    uniforms.uTailW.value = SPINE_TAIL_W * scale
    uniforms.uOuter.value = u === null ? 0 : SPINE_OUTER * scale
    uniforms.uOuterW.value = SPINE_OUTER_W * scale
  }

  setStaticPages(
    placements: StaticPlacement[],
    textureOf: (index: number) => THREE.Texture | null,
    // false 表示这是翻页前置布局（spec.staticPages），相机由翻页动画接管，不重新适配
    refit = true,
    // 书脊内阴影 U 定位：按当前布局/阅读方向返回该页书脊与外缘的 U 坐标，
    // null 表示该页不渲染阴影；未提供时静态页不注入
    spineOf?: (index: number, placement: StaticPlacement) => SpineShadeU | null,
  ) {
    this.pageFitWidth = placements.reduce(
      (width, p) =>
        Math.max(width, p.spread ? this.sheetWidth * 2 : Math.abs(this.slotX(p.slot)) * 2 + this.sheetWidth),
      this.sheetWidth,
    )
    this.recomputeFitWidth()
    this.markDirty()

    // placement diff 复用：按页索引比对，几何形态（spread）相同的页复用
    // 现有网格与材质，仅更新纹理与位置。该调用频率很高（每次翻页 2 次、
    // 光栅化完成、peel 悬停进出边缘条带），全量销毁重建会造成 GPU 资源
    // 反复分配释放；静态页通常只有 1-3 个网格，diff 成本可忽略
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
        this.applySpineShading(existing.material, spineOf?.(p.index, p) ?? null)
        existing.mesh.position.set(this.slotX(p.slot), 0, STATIC_Z)
        // 封面图层归属可能随 coverPages 集合变化
        if (this.coverPages.has(p.index)) existing.mesh.layers.set(COVER_LAYER)
        else existing.mesh.layers.set(0)
        kept.add(p.index)
        continue
      }
      if (existing) {
        this.bookBody.remove(existing.mesh)
        existing.mesh.geometry.dispose()
        existing.material.dispose()
        this.staticMeshes.delete(p.index)
      }
      // 跨页项：双倍宽度网格，纹理为整张跨页图
      const geometry = new THREE.PlaneGeometry(
        spread ? this.sheetWidth * 2 : this.sheetWidth,
        PAGE_HEIGHT,
      )
      // 页面纹理可为透明（背景由内容自绘，未绘制区域 alpha=0），
      // 材质须开 transparent 否则透明区域渲染为黑色
      const material = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true })
      const texture = textureOf(p.index)
      if (texture) {
        material.map = texture
        material.color.set(0xffffff)
        material.needsUpdate = true
      }
      this.applySpineShading(material, spineOf?.(p.index, p) ?? null)
      const mesh = new THREE.Mesh(geometry, material)
      // 静态页在书体局部坐标中钉在目标槽位、全程不动（含 fromSlot 条目：
      // 唯一用例封底展开的起始槽位恰为 目标槽位+起点偏移，书体平移即可
      // 复现同一轨迹，无需逐网格起点烘焙）
      mesh.position.set(this.slotX(p.slot), 0, STATIC_Z)
      // 封面/封底挂封面图层，由封面灯光组照亮
      if (this.coverPages.has(p.index)) mesh.layers.set(COVER_LAYER)
      this.bookBody.add(mesh)
      this.staticMeshes.set(p.index, {
        mesh,
        material,
        index: p.index,
        spread,
      })
      kept.add(p.index)
    }
    // 移除新布局中不再出现的页
    for (const [index, entry] of this.staticMeshes) {
      if (kept.has(index)) continue
      this.bookBody.remove(entry.mesh)
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
    // 无纸张动画时立即应用终点（渲染不可用的兜底路径也走到这里）；
    // 扇形翻页进行中由 updateFan 按全局进度驱动，不能提前吸附终点。
    // 空闲收敛同时复位书体平移（翻页收尾后书体回正）
    if (!this.sheet && !this.fan) {
      this.bookBody.position.x = 0
      this.stacks.apply(this.stackFrom, this.stackTo, 1, this.stackEdges())
      // 空闲态纸叠厚度变化影响适配宽度，相机距离随之收敛
      // （否则要等到下一次 resize/翻页才收敛，条带可能被视口裁剪）
      this.refitCamera()
    }
    this.markDirty()
  }

  // 静态页网格的实际外缘（书体局部坐标）：纸叠条带内缘的跟随来源。
  // 跨页合并网格宽为两页，半宽取整页宽。
  // 每帧调用（翻页/扇形动画都走），故复用缓冲就地改写，不逐帧新建数组与对象
  private stackEdges() {
    const scratch = this.edgeScratch
    let count = 0
    for (const entry of this.staticMeshes.values()) {
      const halfWidth = entry.spread ? this.sheetWidth : this.sheetWidth / 2
      const x = entry.mesh.position.x
      const item = scratch[count]
      if (item) {
        item.x = x
        item.halfWidth = halfWidth
      } else {
        scratch[count] = { x, halfWidth }
      }
      count++
    }
    scratch.length = count
    return deriveStackEdges(scratch)
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

  // 翻页起点先把书体平移到起始偏移（终点位由每帧插值驱动）；
  // 静态页/纸张组都在书体局部坐标，无需逐网格烘焙偏移
  private applyWorldOffset(spec: FlipSpec) {
    this.bookBody.position.x = spec.worldFromX ?? 0
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
    const foldSegments = Math.max(8, Math.round(options?.foldSegments ?? FOLD_SEGMENTS))

    const geometry = new THREE.PlaneGeometry(
      this.sheetWidth,
      PAGE_HEIGHT,
      // 折角纸张横向同样需要足够分段（封面 hard 档 nPolygons=32 时
      // 过渡带横向欠采样，折痕边缘同样会起波浪）
      fold ? Math.max(nPolygons, foldSegments) : nPolygons,
      fold ? foldSegments : 2,
    )
    const positions = geometry.attributes.position
    const uvs = geometry.attributes.uv
    const normals = geometry.attributes.normal
    const index = geometry.getIndex()
    if (!positions || !uvs || !normals || !index) {
      geometry.dispose()
      return null
    }
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
      transparent: true,
    })
    if (frontTexture) {
      frontMaterial.map = frontTexture
      frontMaterial.needsUpdate = true
    }
    const backMaterial = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      side: THREE.BackSide,
      transparent: true,
    })
    if (backTexture) {
      backMaterial.map = backTexture
      backMaterial.needsUpdate = true
    }
    // 翻页纸张的书脊即铰点、自由边即外缘：几何 A/B 的 UV 都保证 u=0 在
    // 铰点侧、背面 UV 镜像后铰点在 u=1——与阅读方向无关
    this.applySpineShading(frontMaterial, { inner: 0, outer: 1 })
    this.applySpineShading(backMaterial, { inner: 1, outer: 0 })

    const front = new THREE.Mesh(geometry, frontMaterial)
    const back = new THREE.Mesh(backGeometry, backMaterial)
    back.position.z = 0.002
    front.frustumCulled = false
    back.frustumCulled = false
    // 正反两面各自按所属页挂图层：封面面由封面灯光照亮，内页面用内页灯光
    if (this.coverPages.has(spec.frontIndex)) front.layers.set(COVER_LAYER)
    if (this.coverPages.has(spec.backIndex)) back.layers.set(COVER_LAYER)

    const group = new THREE.Group()
    // 纸张组钉在铰点（书体局部坐标）；书体平移由 bookBody 承载。
    // 例外：悬停预览纸张由 beginDragFlip 叠加起点偏移（书体不动、
    // 静态布局保持空闲态，偏移只能由纸张自身携带）
    group.position.set(spec.hingeX, 0, 0)
    group.add(front)
    group.add(back)
    this.bookBody.add(group)

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
      nPolygons,
      fromFitWidth,
      toFitWidth,
      reverse: spec.reverse ?? false,
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
    if (this.fan) this.finishFan(true)
    if (this.sheet) this.removeSheet()

    this.applyWorldOffset(spec)
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
    if (this.fan) this.finishFan(true)
    if (this.sheet) this.removeSheet()
    this.applyWorldOffset(spec)
    const base = this.createSheet(spec, frontTexture, backTexture, onDone, true, options)
    if (!base) return false
    const settleDuration = positive(duration, 900)
    const startTime = performance.now()
    // 反向翻页（spec.reverse，单页后退）：纸张初始为对折越过缝侧的镜像位
    // （qu=-W，进度 1），拖点收回外缘（qu=+W）完成放平——与前进折页同一
    // 条形变路径反放
    const reverse = base.reverse
    const fromQ: [number, number] = reverse ? [-this.sheetWidth, 0] : [this.sheetWidth, 0]
    const toQ: [number, number] = reverse ? [this.sheetWidth, 0] : [-this.sheetWidth, 0]
    const sheet: FoldSettleSheet = {
      ...base,
      kind: 'fold',
      mode: 'settle',
      startTime,
      duration: settleDuration,
      fold: { pu: this.sheetWidth, pv: 0, qu: fromQ[0], qv: 0 },
      progress: reverse ? 1 : 0,
      p0: reverse ? 1 : 0,
      target: reverse ? 0 : 1,
      foldFromQ: fromQ,
      foldToQ: toQ,
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

  // 扇形翻页（多页跳转）：多张纸错峰并发翻动——每张纸是一步的折页 settle
  // 动画（相位依次延迟，形成波浪式的扇面），全部落定后触发整体 onDone。
  // 静态布局由调用方一次性摆好（出发侧留驻页 + 落点侧揭示页），书体平移
  // 取首张纸起点偏移 → 末张纸终点偏移随全局进度插值；落定的纸张保留在场
  // （堆叠在落点侧），整体收尾时统一释放
  startFanFlip(
    plans: FanSheetPlan[],
    fanOptions: { duration: number; onDone: () => void },
  ): boolean {
    // 渲染不可用返回 false，由调用方回退（瞬间跳转）
    if (!this.renderer || this.contextLost) return false
    if (plans.length === 0) return false
    if (this.fan) this.finishFan(true)
    if (this.sheet) this.removeSheet()

    const now = performance.now()
    const duration = positive(fanOptions.duration, 900)
    const count = plans.length
    // 每张纸的翻动时长占总时长的大头，剩余均分为错峰间隔——相邻纸张的
    // 相位差恒定，形成连续的扇面波浪
    const sheetDuration = duration * 0.62
    const worldFromX = plans[0]?.spec.worldFromX ?? 0
    const worldToX = plans[count - 1]?.spec.worldToX ?? 0
    // 全局书体平移：起点立即生效，终点位由 updateFan 随全局进度插值
    this.bookBody.position.x = worldFromX

    const sheets: FanRunningSheet[] = []
    for (let i = 0; i < count; i++) {
      const plan = plans[i]
      if (!plan) break
      const base = this.createSheet(
        plan.spec,
        plan.frontTexture,
        plan.backTexture,
        plan.onDone,
        true,
        plan.skeleton ? { nPolygons: 24, foldSegments: 32 } : undefined,
      )
      if (!base) break
      const reverse = base.reverse
      // 反向翻页（单页后退）：纸张初始对折在缝外侧，起飞前不可见
      // （前进纸张起飞前平贴在出发侧纸堆上，属于画面的一部分）
      const fromQ: [number, number] = reverse ? [-this.sheetWidth, 0] : [this.sheetWidth, 0]
      const toQ: [number, number] = reverse ? [this.sheetWidth, 0] : [-this.sheetWidth, 0]
      const delay = count > 1 ? (i * (duration - sheetDuration)) / (count - 1) : 0
      const sheet: FanRunningSheet = {
        ...base,
        kind: 'fold',
        mode: 'settle',
        startTime: now + delay,
        duration: sheetDuration,
        fold: { pu: this.sheetWidth, pv: 0, qu: fromQ[0], qv: 0 },
        progress: reverse ? 1 : 0,
        p0: reverse ? 1 : 0,
        target: reverse ? 0 : 1,
        foldFromQ: fromQ,
        foldToQ: toQ,
        fanIndex: i,
        landed: false,
      }
      // 纸张组已钉在铰点（书体局部坐标），无需叠加全局偏移
      sheet.group.visible = !reverse
      sheets.push(sheet)
    }
    if (sheets.length === 0) return false

    this.fan = { sheets, worldFromX, worldToX, startTime: now, duration, onDone: fanOptions.onDone }
    // 相机一次复位到目标适配距离（缩放/平移复位，级别归 1），
    // 随书体平移与纸叠转移在整个扇形窗口内收敛
    const lastPlan = plans[count - 1]
    const toFit = positive(lastPlan?.spec.toFitWidth ?? this.targetFitWidth, this.targetFitWidth)
    this.rig.resetTo(toFit + this.stackExtentWidth(this.stackTo), duration, now)
    this.wake()
    return true
  }

  // 扇形翻页逐帧推进：全局书体平移/静态页/纸叠按整体进度插值一次，
  // 各纸张按自己的错峰时钟独立播放折页动画（复用 deformSheetFold）
  private updateFan(now: number) {
    const fan = this.fan
    if (!fan) return
    const slideT = Math.min(1, (now - fan.startTime) / fan.duration)
    const slideP = easeInOutCubic(slideT)
    const count = fan.sheets.length
    let allLanded = true
    for (const sheet of fan.sheets) {
      // 层叠顺序：起飞前出发侧纸堆先翻的在上，落定后落点侧纸堆后翻的在上——
      // 进度过半（纸张立起最高点）时切换，被形变抬升遮挡、不可感知
      sheet.group.position.z =
        (sheet.progress > 0.5 ? sheet.fanIndex : count - 1 - sheet.fanIndex) * 0.0025
      if (!sheet.landed) {
        const t = (now - sheet.startTime) / sheet.duration
        if (t >= 1) {
          sheet.landed = true
          this.deformFanSheetAt(sheet, 1)
          sheet.group.visible = true
          sheet.onDone?.(true)
        } else if (t >= 0) {
          if (!sheet.group.visible) sheet.group.visible = true
          this.deformFanSheetAt(sheet, easeInOutCubic(t))
        } else {
          allLanded = false
        }
      }
      if (!sheet.landed) allLanded = false
    }
    // 书体平移：纸张组/静态页/纸叠条带都在书体局部坐标，随本插值整体滑动
    // （落定的纸张属于书本，随书体一起平移到终点位）
    this.bookBody.position.x =
      fan.worldFromX + (fan.worldToX - fan.worldFromX) * slideP
    // 纸叠厚度随全局进度从起点态连续过渡到目标态：出发侧随飞纸起飞
    // 逐张变薄、落点侧随落纸增厚（与单张翻页同一插值语义，无凭空
    // 消失/长出的包络）；条带内缘始终跟随静态页实际边缘。全部落定后
    // 由收尾布局（renderStatic → applyStacksIdle）接管精确状态
    this.stacks.apply(this.stackFrom, this.stackTo, slideP, this.stackEdges())
    if (allLanded && slideT >= 1) {
      this.finishFan(true)
    }
  }

  // 扇形纸张按局部进度设置折页形变（settle 路径的插值逻辑，时钟由 fan 驱动）
  private deformFanSheetAt(sheet: FanRunningSheet, eased: number) {
    const from = sheet.foldFromQ
    const to = sheet.foldToQ
    sheet.fold.qu = from[0] + (to[0] - from[0]) * eased
    sheet.fold.qv = from[1] + (to[1] - from[1]) * eased
    // 插值中间态同样受书脊约束（端点天然安全，中途保险）
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
    this.deformSheetFold(sheet)
  }

  // 扇形翻页收尾：释放全部纸张（落定的纸张此刻才离场，由静态布局接管），
  // 未落定纸张按 committed 提交（stop 中断 = 跳过动画直接到目标）
  private finishFan(committed: boolean) {
    const fan = this.fan
    this.fan = null
    if (!fan) return
    const lastSheet = fan.sheets[fan.sheets.length - 1]
    if (lastSheet) {
      this.rig.resetTo(lastSheet.toFitWidth + this.stackExtentWidth(this.stackTo), 0)
    }
    for (const sheet of fan.sheets) {
      this.bookBody.remove(sheet.group)
      sheet.geometry.dispose()
      sheet.backGeometry.dispose()
      sheet.frontMaterial.dispose()
      sheet.backMaterial.dispose()
      if (!sheet.landed) {
        sheet.landed = true
        sheet.onDone?.(committed)
      }
    }
    // 收尾后书体回正（后续 renderStatic → setStacks 空闲收敛亦会复位）
    this.bookBody.position.x = 0
    this.markDirty()
    fan.onDone()
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
    if (this.fan) this.finishFan(true)
    if (this.sheet) this.removeSheet()

    // 真实拖拽才把书体平移到起始偏移；悬停预览不动书体——预览不重设
    // 静态布局，若在此平移书体会把空闲布局的静态页挪到翻开态位置
    // （如封面被挪到侧旁），预览收起时再跳回，形成闪烁。
    // 预览纸张的起点偏移由纸张自身携带（见下）
    if (!preview) this.applyWorldOffset(spec)
    const base = this.createSheet(spec, frontTexture, backTexture, onDone, false, options)
    if (!base) return false
    if (preview) {
      // 书体未平移，起点偏移叠加在纸张组上：预览纸面精确覆盖在它即将
      // 翻起的静态页上方（如合书封面的居中位置）；接管时由 activateSheet 归位
      base.group.position.x = base.hingeX + (spec.worldFromX ?? 0)
    }
    // 反向翻页（spec.reverse）：纸张初始即翻出缝外侧（进度 1），拖入时回收
    this.sheet = {
      ...base,
      kind: 'curl',
      mode: 'drag',
      progress: base.reverse ? 1 : 0,
      preview,
    }
    // 新建纸张须立即可见：标脏唤醒一帧渲染（drag 模式不逐帧自驱）
    this.markDirty()
    return true
  }

  // 悬停预览纸张转为真实交互（按下接管且不重建纸张时调用）：
  // 清除预览标记，恢复书体平移/纸叠插值随进度联动。
  // spec 为接管的翻页 spec：调用方已用 spec.staticPages 重设静态布局，
  // 此处把书体平移到起始偏移，并把预览期间由纸张携带的起点偏移
  // 交还书体组（视觉位置不变，坐标系切换）
  activateSheet(spec?: FlipSpec) {
    const sheet = this.sheet
    if (!sheet) return
    if (!sheet.preview) return
    sheet.preview = false
    if (spec) {
      this.applyWorldOffset(spec)
      sheet.group.position.x = sheet.hingeX
    }
    // 预览标记清除后书体/纸叠开始随进度联动，唤醒循环重绘
    this.markDirty()
  }

  // 拖拽进度 [0,1]：调用方传入的是"拖向提交"的进度（0 按下 / 1 满程），
  // 反向翻页纸张换算为形变进度 1-p（初始翻出缝外，拖入回收）
  setDragProgress(progress: number) {
    const sheet = this.sheet
    if (!sheet || sheet.mode !== 'drag') return
    const clamped = clamp(progress, 0, 1)
    // 书脊拖拽接管折角悬停的纸张：降级为卷曲拖拽（清除折角形变）；
    // 接管即真实交互，一并清除预览标记
    if (sheet.kind === 'fold') {
      const { fold: _fold, kind: _kind, preview: _preview, ...rest } = sheet
      this.sheet = { ...rest, kind: 'curl', progress: clamped }
      this.markDirty()
      return
    }
    sheet.progress = sheet.reverse ? 1 - clamped : clamped
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
          this.applyWorldOffset(spec)
        }
        this.markDirty()
        return true
      }
      // 卷曲拖拽中的纸张转折角：重建为折角拖拽（沿用几何与纹理）。
      // 预览纸张携带的起点偏移交还书体组（真实/预览皆归位到书体承载）
      const { kind: _kind, progress: _progress, preview: _preview, ...rest } = existing
      this.sheet = {
        ...rest,
        kind: 'fold',
        mode: 'drag',
        fold: { pu: pickU, pv: pickV, qu: pickU, qv: pickV },
        progress: 0,
        bend: positive(bend, existing.bend),
      }
      this.applyWorldOffset(spec)
      this.sheet.group.position.x = this.sheet.hingeX
      this.markDirty()
      return true
    }
    if (this.fan) this.finishFan(true)
    if (this.sheet) this.removeSheet()
    // 静态页已由调用方按 spec.staticPages 重设（真实拖拽与折角预览皆然：
    // 折角下方露出的须是底页而非当前页），此处把书体平移到起始偏移；
    // 预览的书体平移/纸叠/相机仍钉在起始态（updateSheet 中 preview 的
    // slideP=0），收起时由调用方 renderStatic 恢复空闲布局
    this.applyWorldOffset(spec)
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

  // 指针位置转页平面坐标（z=0 平面射线求交，书体局部坐标系——
  // 书体平移期间书页/折角几何都在局部坐标，指针须换算到同一坐标系）
  pagePointFromClient(clientX: number, clientY: number): [number, number] | null {
    if (!this.renderer) return null
    const rect = this.renderer.domElement.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    this.pickNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(this.pickNdc, this.rig.camera)
    const { origin, direction } = this.raycaster.ray
    if (Math.abs(direction.z) < 1e-6) return null
    const t = -origin.z / direction.z
    if (t < 0) return null
    return [origin.x + direction.x * t - this.bookBody.position.x, origin.y + direction.y * t]
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
    // 页宽坐标：书体局部 x 减去纸张组原点（铰点）；
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
    if (!sheet || sheet.mode !== 'drag') return
    // 卷曲纸张误入折角收尾：按卷曲语义收尾（调用方配对错误时的兜底，
    // 避免静默 no-op 冻结画面与 isFlipping）
    if (sheet.kind === 'curl') {
      this.endDragFlip(commit, baseDuration)
      return
    }
    const { pu, pv, qu, qv } = sheet.fold
    // 反向翻页纸张的提交态是放平（进度 0）：拖点目标与提交判定随之反转
    const target = sheet.reverse ? (commit ? 0 : 1) : commit ? 1 : 0
    const toQ: [number, number] = sheet.reverse
      ? commit
        ? [this.sheetWidth, pv]
        : [pu, pv]
      : commit
        ? [-this.sheetWidth, pv]
        : [pu, pv]
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
    if (!sheet || sheet.mode !== 'drag') return
    // 折角纸张误入卷曲收尾：按折角语义收尾（调用方配对错误时的兜底，
    // 避免静默 no-op 冻结画面与 isFlipping）
    if (sheet.kind === 'fold') {
      this.endFoldDrag(commit, baseDuration)
      return
    }
    // 反向翻页纸张的提交态是放平（进度 0）：目标与提交判定随之反转
    const target = sheet.reverse ? (commit ? 0 : 1) : commit ? 1 : 0
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

  // 中断当前翻页并立即收尾：time/settle 按各自终点，drag 按最近端点。
  // 反向翻页纸张的提交态是放平（进度 0），最近端点判定随之反转。
  // 扇形翻页按提交收尾（未落定纸张直接到终点）——中断语义是跳过动画
  stopFlip() {
    if (this.fan) {
      this.finishFan(true)
      return
    }
    const sheet = this.sheet
    if (!sheet) return
    if (sheet.mode === 'drag') {
      const committed = sheet.kind === 'curl' ? (sheet.reverse ? sheet.progress < 0.5 : sheet.progress >= 0.5) : sheet.progress >= 0.5
      this.finishSheet(sheet, committed)
    } else if (sheet.mode === 'settle') {
      this.finishSheet(sheet, sheet.reverse ? sheet.target === 0 : sheet.target === 1)
    } else {
      this.finishSheet(sheet, true)
    }
  }

  // 立即完成一张纸张：跳到终点、复位相机并触发回调。
  // 悬停预览纸张不触碰相机/缩放（预览从未移动过它们）
  private finishSheet(sheet: SheetState, committed: boolean) {
    if (!sheet.preview) {
      this.rig.resetTo(this.sheetFitWidth(sheet, committed), 0)
      // 真实翻页收尾后书体回正（后续 renderStatic → setStacks 空闲收敛亦会复位）
      this.bookBody.position.x = 0
    }
    if (this.sheet === sheet) this.sheet = null
    this.markDirty()
    this.bookBody.remove(sheet.group)
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
    if (!this.renderer || this.sheet || this.fan) return
    this.rig.setZoom(level, animate, duration)
    this.markDirty()
  }

  // 按屏幕像素平移相机（放大后拖动查看）；翻页进行中忽略
  panBy(dxPixels: number, dyPixels: number) {
    if (!this.renderer || this.sheet || this.fan) return
    this.rig.panBy(dxPixels, dyPixels)
    this.markDirty()
  }

  // 射线拾取静态页面：返回命中页与纹理坐标，未命中返回 null
  pickPage(clientX: number, clientY: number): PagePick | null {
    if (!this.renderer) return null
    const rect = this.renderer.domElement.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    const meshes = this.pickMeshes
    const entries = this.pickEntries
    meshes.length = 0
    entries.length = 0
    for (const entry of this.staticMeshes.values()) {
      meshes.push(entry.mesh)
      entries.push(entry)
    }
    if (meshes.length === 0) return null
    this.pickNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(this.pickNdc, this.rig.camera)
    for (const hit of this.raycaster.intersectObjects(meshes, false)) {
      if (!hit.uv) continue
      const at = meshes.indexOf(hit.object)
      if (at < 0) continue
      const entry = entries[at]!
      return { index: entry.index, u: hit.uv.x, v: hit.uv.y, spread: entry.spread }
    }
    return null
  }

  // 纸张卷曲形变：pe 为翻页进度 [0,1]。
  // 分段数取纸张自身值（建网格与形变场采样必须同源，否则封面档 32 段
  // 网格会被场景级 64 段的形变场欠采样/越界采样）
  private deformSheet(sheet: CurlSheet, pe: number) {
    const theta = Math.PI * pe
    const amp = sheet.curl * Math.sin(theta)
    // 翘起包络：与卷曲幅度同相位（翻页中段最大、首尾归零）
    const sinTheta = Math.sin(theta)
    const liftEnv = CURL_LIFT * sinTheta
    const liftYEnv = CURL_LIFT_Y * sinTheta
    const n = sheet.nPolygons
    const columns = curledColumns(theta, amp, this.sheetWidth, n)
    const positions = sheet.geometry.attributes.position
    if (!positions) return
    const colW = this.sheetWidth / n
    for (let i = 0; i < positions.count; i++) {
      const s = sheet.baseS[i] ?? 0
      const f = s / colW
      const c0 = Math.min(n, Math.floor(f))
      const frac = f - c0
      const x = (columns.xs[c0] ?? 0) * (1 - frac) + (columns.xs[c0 + 1] ?? 0) * frac
      const z = (columns.zs[c0] ?? 0) * (1 - frac) + (columns.zs[c0 + 1] ?? 0) * frac
      // 翘起量：沿页宽 q(2-q) 铰链处为零、中后段最大（与卷曲同族的平滑
      // 分布）；沿页高线性倾斜形成锥形扭翘。z 分量朝相机鼓起，y 分量把
      // 自由边抬离书面（上缘全额、下缘 35%）
      const q = s / this.sheetWidth
      const qProfile = q * (2 - q)
      const v = ((sheet.baseY[i] ?? 0) + PAGE_HEIGHT / 2) / PAGE_HEIGHT
      const tilt = 1 + CURL_LIFT_TILT * (v - 0.5)
      positions.setX(i, sheet.sign * x)
      positions.setZ(i, z + liftEnv * qProfile * tilt)
      positions.setY(i, (sheet.baseY[i] ?? 0) + liftYEnv * qProfile * (1 + CURL_LIFT_Y_TOP_BIAS * (v - 1)))
    }
    positions.needsUpdate = true
    sheet.geometry.computeVertexNormals()
  }

  // 纸张折角形变：折线取抓取点与拖点连线的垂直平分线，P 侧翻折；
  // P≈Q（未折）时顶点还原为初始平面。
  // 折缝圆弧与微开角随翻页进度压平（进度→1 时 bend/tilt→0）：
  // 折角小时折缝圆润、翻起平面微翘；整页翻过落页时纸摊平贴合底面，
  // 与 renderStatic 接管的静态布局无缝衔接（无落页跳变）。
  // soft 档点击翻页走本路径（fold 默认开启），因此与卷曲路径共用同一组
  // 翘起分量（CURL_LIFT/CURL_LIFT_Y），保证两种翻页交互观感一致。
  // 翘起权重取 fold 自身的抬升高度归一化：贴书面的部分（z=0）不抬、
  // 只有真正翻过折缝的部分被抬起——整页不致呈刚性斜板（"硬"感根源）
  private deformSheetFold(sheet: FoldSheet) {
    const fold = sheet.fold
    const settle = 1 - Math.min(1, Math.max(0, sheet.progress))
    const sinProgress = Math.sin(Math.PI * Math.min(1, Math.max(0, sheet.progress)))
    const liftEnv = CURL_LIFT * sinProgress
    const liftYEnv = CURL_LIFT_Y * sinProgress
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
        // 权重由 fold 圆弧段的 z 平滑爬坡（0→1），折缝处无硬边过渡；
        // 沿页高线性倾斜保留锥形扭翘（z 顶 +30%/底 −30%，y 顶全额/底 35%）
        const weight = Math.min(1, p.z / (FOLD_LIFT_RAMP * this.sheetWidth))
        const v = (y + PAGE_HEIGHT / 2) / PAGE_HEIGHT
        p.z += liftEnv * weight * (1 + CURL_LIFT_TILT * (v - 0.5))
        p.y += liftYEnv * weight * (1 + CURL_LIFT_Y_TOP_BIAS * (v - 1))
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
          // 反向翻页纸张的提交态是放平（进度 0）
          this.finishSheet(sheet, sheet.reverse ? sheet.target === 0 : sheet.target === 1)
          return
        }
      }
      // 悬停预览：书体/纸叠钉在起始态（slideP=0，书体停在起始偏移），
      // 只有纸角形变跟随进度；真实拖拽/回弹（含封面/封底开合）与内页
      // 一致——书体随进度联动。反向翻页的书体过渡仍按 0→1 从当前态
      // 到目标态（slideP 取 1-进度）
      const slideP = sheet.preview
        ? 0
        : sheet.reverse
          ? 1 - sheet.progress
          : sheet.progress
      this.bookBody.position.x =
        sheet.worldFromX + (sheet.worldToX - sheet.worldFromX) * slideP
      // 纸叠厚度/层数随翻页插值；内缘跟随静态页实际边缘（书体局部）
      this.stacks.apply(this.stackFrom, this.stackTo, slideP, this.stackEdges())
      this.deformSheetFold(sheet)
      return
    }
    let pe: number
    let slideP: number
    if (sheet.mode === 'time') {
      const t = Math.min(1, (now - sheet.startTime) / sheet.duration)
      const eased = easeInOutCubic(t)
      // 反向翻页：纸张形变反放（1→0，从翻出缝外收回放平），
      // 书体/静态页/纸叠过渡仍按 0→1 从当前态到目标态
      pe = sheet.reverse ? 1 - eased : eased
      slideP = eased
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
        // 反向翻页纸张的提交态是放平（进度 0）
        this.finishSheet(sheet, sheet.reverse ? sheet.target === 0 : sheet.target === 1)
        return
      }
    }
    // 书体平移插值：纸张组钉在铰点、静态页钉在槽位，均随书体整体滑动
    // （跨页/封面 hingeX=0，单页模式 hingeX=±半页宽）。
    // 悬停预览不动书体（起点偏移由纸张自身携带，见 beginDragFlip）
    if (!sheet.preview) {
      this.bookBody.position.x =
        sheet.worldFromX + (sheet.worldToX - sheet.worldFromX) * slideP
    }
    // 纸叠厚度/位置与书体同步插值；条带内缘跟随静态页实际边缘
    this.stacks.apply(this.stackFrom, this.stackTo, slideP, this.stackEdges())
    this.deformSheet(sheet, pe)
  }

  // 静默替换纸张：不触发其 onDone（语义上被替换的纸张已被新交互接管/废弃）。
  // 依赖被替换纸张 onDone 做布局恢复的调用方（悬停预览路径）须先 stopFlip
  // 强制收尾——否则翻开前置布局等中间态会残留（见 usePeelPreview.ensurePeel）
  removeSheet() {
    const sheet = this.sheet
    if (!sheet) return
    this.sheet = null
    this.markDirty()
    this.bookBody.remove(sheet.group)
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
    // 渲染不可能发生（上下文丢失 / 从未取到 WebGL 上下文）：dirty 只在真正
    // render() 之后才清零，此时永远清不掉，继续排帧就是满频空转。停帧——
    // 上下文恢复时 onContextRestoredHandler 的 markDirty 会重新唤醒；
    // 无渲染器则本就降级到 fallback 文案，再没有可渲染的东西
    if (this.contextLost || !this.renderer) {
      this.rafId = 0
      return
    }
    this.updateSheet(now)
    this.updateFan(now)
    // 相机动画结束帧显式标脏，保证终点帧被渲染
    if (this.rig.update(now)) this.dirty = true
    // time/settle 模式逐帧动画；drag 模式由指针驱动，仅状态变化帧渲染
    //（写入入口已 markDirty/wake 唤醒）
    const animating =
      (this.sheet !== null && this.sheet.mode !== 'drag') ||
      this.fan !== null ||
      this.rig.isAnimating
    if ((animating || this.dirty) && this.renderer && !this.contextLost) {
      this.renderer.render(this.scene, this.rig.camera)
      this.dirty = false
    }
    // 空闲（无逐帧动画、无脏标记）时停帧节能；之后的任何状态变化经
    // wake()/markDirty() 重新挂起循环。上下文丢失在 tick 入口停帧
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
    // 组件卸载：扇形纸张直接释放，不触发回调（编排层同在卸载流程中）
    const fan = this.fan
    this.fan = null
    if (fan) {
      for (const sheet of fan.sheets) {
        this.bookBody.remove(sheet.group)
        sheet.geometry.dispose()
        sheet.backGeometry.dispose()
        sheet.frontMaterial.dispose()
        sheet.backMaterial.dispose()
      }
    }
    for (const entry of this.staticMeshes.values()) {
      this.bookBody.remove(entry.mesh)
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
      // 主动释放 WebGL 上下文：浏览器对活跃 context 有数量配额（本文件
      // createRenderer 注释），仅靠 renderer.dispose + GC 释放不及时，
      // 频繁挂载/卸载（v-if、HMR）会加速配额耗尽
      this.renderer.forceContextLoss()
      this.renderer.dispose()
      this.renderer.domElement.remove()
    }
  }
}
