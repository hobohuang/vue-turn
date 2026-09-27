export type ForwardDirection = 'left' | 'right'

export type SheetGeometry = 'A' | 'B'

// 缩放手势模式：off 关闭、wheel 滚轮步进、dblclick 双击切换（单击翻页需延迟判定）、both 两者
export type ZoomMode = 'off' | 'wheel' | 'dblclick' | 'both'

// 显示模式：auto 按容器宽高自动判定，1/2 强制单/双页
export type DisplayMode = 'auto' | 1 | 2

// 观感预设：纸张类型。soft/hard 档位值为最高优先级（显式传入的专业参数不生效），
// 仅 custom 档可逐项设置 nPolygons/perspective/ambient/gloss/curl/fold/bend（见 lib/presets.ts）
// - soft 普通纸张（默认）：哑光、可卷曲、支持角点折角
// - hard 纸板：刚体旋转、强光泽、关闭折角
// - custom 自定义：各参数取显式传入值，未传项回退 soft 基线
export type TurnPreset = 'soft' | 'hard' | 'custom'

export type Slot = 'left' | 'right' | 'center'

export interface StaticPlacement {
  index: number
  slot: Slot
  fromSlot?: Slot
  /** 跨页项：以双倍宽度的整页纹理居中渲染（index 为跨页起始页索引） */
  spread?: boolean
}

export interface FlipSpec {
  geometry: SheetGeometry
  hingeX: number
  frontIndex: number
  backIndex: number
  staticPages: StaticPlacement[]
  delta: number
  worldFromX?: number
  worldToX?: number
  fromFitWidth?: number
  toFitWidth?: number
}

export type FlipDirection = ForwardDirection

/** 纸叠条带一侧的渲染几何：贴在可见页面外缘的页层块 */
export interface StackSideVisual {
  /** 条带内侧贴合的页面外缘 x（世界坐标） */
  edgeX: number
  /** 厚度（世界单位） */
  thickness: number
  /** 该侧纸叠层数（驱动层理纹理密度：一层纸一条页线） */
  layers: number
  /** 伸展方向：-1 向左 / +1 向右 */
  dir: 1 | -1
}

/** 纸叠条带整体（渲染用） */
export interface StackVisual {
  left: StackSideVisual | null
  right: StackSideVisual | null
}

/** 纸叠高亮：start/end 为沿厚度方向自内侧算起的比例 [0,1] */
export interface StackHover {
  side: 'left' | 'right'
  start: number
  end: number
}

/** 页面热区：坐标与尺寸均为占整页（TurnItem 内容）的比例，左上角为原点 */
export interface PageRegion {
  x: number
  y: number
  w: number
  h: number
  /** 自定义数据，随 region-tap 事件原样返回 */
  data?: unknown
}

/** before-flip 事件上下文：调用 preventDefault() 可取消本次翻页/跳转 */
export interface BeforeFlipContext {
  /** 当前页码（从 1 开始） */
  from: number
  /** 目标页码（从 1 开始） */
  to: number
  /** 触发方向；直接跳转（goToPage/键盘 Home/End）时为 null */
  direction: FlipDirection | null
  prevented: boolean
  preventDefault: () => void
}

/** 视口内坐标（像素，相对视口左上角） */
export interface ViewportPoint {
  x: number
  y: number
}

/** 拖拽翻页参数 */
export interface FlipSheetOptions {
  /** 卷曲幅度覆盖；硬页（纸板页）传 0 做纯刚体翻转 */
  curl?: number
  /** 网格纵向分段数覆盖；封面档与内页密度不同时使用 */
  nPolygons?: number
}

/**
 * 折页形变参数（按纸张归属解析，世界单位）：封面/封底纸张取 coverPreset 档、
 * 内页取 preset 档——与 FlipSheetOptions 的封面档覆盖同一套归属判定，
 * 一张纸的正反两面同档。
 */
export interface SheetFoldOptions {
  /** 是否走折页形变（false 时按下与主动翻页均回到整页卷曲/刚体翻转） */
  enabled: boolean
  /** 折缝圆角弧长（世界单位） */
  bendWorld: number
}

export interface TurnInstance {
  flipLeft: () => void
  flipRight: () => void
  next: () => void
  prev: () => void
  /** 跳转到指定页；翻页中或页码越界时拒绝并返回 false */
  goToPage: (page: number) => boolean
  /** 中断当前翻页并立即完成（拖拽中按最近端点收尾） */
  stop: () => void
  /** 禁用（不传参默认 true）/启用组件的翻页与交互 */
  disable: (disabled?: boolean) => void
  refresh: () => Promise<void>
  refreshPage: (page: number) => Promise<void>
  /** 放大到最大倍数 */
  zoomIn: () => void
  /** 复位到 1 倍 */
  zoomOut: () => void
  /** 在 1 倍与最大倍数间切换 */
  toggleZoom: () => void
  /** 设置缩放级别（钳制到 [1, maxZoom]） */
  setZoom: (level: number) => void
  readonly page: number
  readonly numPages: number
  readonly isFlipping: boolean
  readonly canNext: boolean
  readonly canPrev: boolean
  readonly disabled: boolean
  /** 当前缩放级别（1 为未缩放） */
  readonly zoom: number
}
