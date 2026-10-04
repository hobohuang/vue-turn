import * as THREE from 'three'

import { PAGE_HEIGHT } from './flipSpec'
import { clamp } from './math'
import type { StackEdges } from './pageStack'
import type { StackHover, StackVisual } from '../types/turn'

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
// 几何 +x 端在局部坐标中总是朝外（左右侧均成立）。
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

// 纸叠条带一侧的运行时状态：网格为缩放的梯形棱柱，厚度/层数随翻页插值
// 更新；内缘 edge 每帧取自静态页网格实际边缘（书体局部坐标），书本动
// 条带自动跟（书体平移由父组承载）
interface StackSideMesh {
  mesh: THREE.Mesh
  material: THREE.MeshLambertMaterial
  texture: THREE.Texture
  /** 内缘（书体局部坐标）：贴合的页面外缘 */
  edge: number
  thickness: number
  layers: number
  /** 伸展方向：-1 向左 / +1 向右（由所属侧决定，几何 +x 端朝外） */
  dir: 1 | -1
}

export interface StackRendererOptions {
  /** 书体组：条带与高亮的父节点，随书体平移（条带位置为其局部坐标） */
  parent: THREE.Object3D
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  raycaster: THREE.Raycaster
  renderer: THREE.WebGLRenderer | null
  /** 透视参考距离（世界/像素换算，层理密度随观察距离抽稀） */
  perspective: number
}

/**
 * 纸叠渲染器：书本左右两侧页层厚度条带的网格、层理纹理与悬停高亮。
 * 条带挂在书体组（parent）下，内缘每帧从静态页网格实际边缘读取
 * （apply 的 edges 参数），厚度/层数由编排层在每次 apply 时传入插值。
 */
export class StackRenderer {
  private readonly parent: THREE.Object3D
  private readonly scene: THREE.Scene
  private readonly camera: THREE.PerspectiveCamera
  private readonly raycaster: THREE.Raycaster
  private readonly renderer: THREE.WebGLRenderer | null
  private readonly perspective: number
  // 纸叠条带（左右各一，懒创建）
  private readonly sides: { left: StackSideMesh | null; right: StackSideMesh | null } = {
    left: null,
    right: null,
  }
  private geometry: THREE.BufferGeometry | null = null
  private baseTexture: THREE.Texture | null = null
  private highlight: THREE.Mesh | null = null
  private highlightMaterial: THREE.MeshBasicMaterial | null = null

  constructor(options: StackRendererOptions) {
    this.parent = options.parent
    this.scene = options.scene
    this.camera = options.camera
    this.raycaster = options.raycaster
    this.renderer = options.renderer
    this.perspective = options.perspective
  }

  // 应用插值进度 p 下的纸叠几何：厚度/层数在 from/to 间线性过渡；
  // 某一侧状态缺失时按厚度 0 原地生长/渐隐。条带内缘取 edges 给出的
  // 静态页实际边缘（书体局部坐标），某侧无页面（null）时该侧隐藏——
  // 条带永远贴着页面网格，不自行建模位置。
  apply(from: StackVisual | null, to: StackVisual | null, p: number, edges: StackEdges) {
    for (const side of ['left', 'right'] as const) {
      const entry = this.sides[side]
      const edge = edges[side]
      const f = from?.[side] ?? null
      const t = to?.[side] ?? null
      if ((!f && !t) || edge === null) {
        if (entry) entry.mesh.visible = false
        continue
      }
      const ft = f?.thickness ?? 0
      const tt = t?.thickness ?? 0
      const fl = f?.layers ?? t!.layers
      const tl = t?.layers ?? f!.layers
      const e = entry ?? this.ensureSide(side)
      e.dir = side === 'left' ? -1 : 1
      e.edge = edge
      e.thickness = ft + (tt - ft) * p
      e.layers = fl + (tl - fl) * p
      e.mesh.visible = e.thickness > 1e-4
      e.mesh.scale.x = Math.max(e.thickness, 1e-4)
      // 梯形收窄端（几何 +x）须朝外侧：右侧即局部 +x，左侧绕 y 转 π
      // 镜像到局部 -x（法线随旋转保持朝外），保证两侧都是"内缘全高、外缘收窄"
      e.mesh.rotation.y = e.dir === 1 ? 0 : Math.PI
      e.mesh.position.x = e.edge + (e.dir * e.thickness) / 2
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

  private ensureSide(side: 'left' | 'right'): StackSideMesh {
    const existing = this.sides[side]
    if (existing) return existing
    if (!this.geometry) {
      // 梯形棱柱：内缘贴书全高，外缘按 STACK_TAPER 收窄形成缓坡透视
      this.geometry = createStackGeometry()
    }
    if (!this.baseTexture) this.baseTexture = createStackTexture()
    // 各侧克隆纹理以独立设置 repeat（层理密度随层数变化）；
    // 各向异性过滤：条带以斜视线观察，斜向采样不糊
    const texture = this.baseTexture.clone()
    texture.needsUpdate = true
    if (this.renderer) texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
    const material = new THREE.MeshLambertMaterial({ color: 0xffffff, map: texture })
    const mesh = new THREE.Mesh(this.geometry, material)
    mesh.visible = false
    this.parent.add(mesh)
    const entry: StackSideMesh = {
      mesh,
      material,
      texture,
      edge: 0,
      thickness: 0,
      layers: 0,
      dir: side === 'left' ? -1 : 1,
    }
    this.sides[side] = entry
    return entry
  }

  // 射线拾取纸叠：返回命中侧与自内侧算起的厚度比例。
  // 命中点换算到书体局部坐标再与条带内缘比较（条带挂在书体组下）
  pickStack(clientX: number, clientY: number): { side: 'left' | 'right'; fraction: number } | null {
    if (!this.renderer) return null
    const rect = this.renderer.domElement.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    const entries = (['left', 'right'] as const)
      .map((side) => ({ side, entry: this.sides[side] }))
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
    const localX = this.parent.worldToLocal(hit.point.clone()).x
    const fraction = ((localX - entry.edge) * entry.dir) / entry.thickness
    return { side: found.side, fraction: clamp(fraction, 0, 0.9999) }
  }

  // 设置纸叠高亮条带（null 清除）
  setHover(hover: StackHover | null) {
    if (!hover) {
      this.hideHighlight()
      return
    }
    const entry = this.sides[hover.side]
    if (!entry || !entry.mesh.visible || entry.thickness <= 0) {
      this.hideHighlight()
      return
    }
    if (!this.highlight) {
      this.highlightMaterial = new THREE.MeshBasicMaterial({
        color: 0x7fa8ff,
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
      })
      // 复用纸叠梯形几何：高亮形状与纸叠正面轮廓一致，
      // 外缘收窄处不会超出梯形边界
      const geometry = this.geometry ?? createStackGeometry()
      this.highlight = new THREE.Mesh(geometry, this.highlightMaterial)
      this.highlight.visible = false
      this.parent.add(this.highlight)
    }
    // 层过薄时保证最小可见高亮宽度
    const width = Math.max((hover.end - hover.start) * entry.thickness, 0.01)
    const center = (hover.start + hover.end) / 2
    this.highlight.visible = true
    this.highlight.scale.x = width
    // 与纸叠同向镜像：收窄端朝外侧，高亮轮廓贴合所在侧梯形
    this.highlight.rotation.y = entry.dir === 1 ? 0 : Math.PI
    // 几何正面在局部 z=+STACK_DEPTH/2，位置取 0.003 使其浮出纸叠正面
    this.highlight.position.set(
      entry.edge + entry.dir * center * entry.thickness,
      0,
      0.003,
    )
  }

  private hideHighlight() {
    if (this.highlight && this.highlight.visible) {
      this.highlight.visible = false
    }
  }

  // 释放纸叠资源（上下文丢失/组件销毁时）
  dispose() {
    for (const side of ['left', 'right'] as const) {
      const entry = this.sides[side]
      if (!entry) continue
      this.parent.remove(entry.mesh)
      entry.material.dispose()
      entry.texture.dispose()
      this.sides[side] = null
    }
    if (this.highlight) {
      this.parent.remove(this.highlight)
      this.highlight.geometry.dispose()
      this.highlight = null
    }
    this.highlightMaterial?.dispose()
    this.highlightMaterial = null
    this.geometry?.dispose()
    this.geometry = null
    this.baseTexture?.dispose()
    this.baseTexture = null
  }
}
