export type ForwardDirection = 'left' | 'right'

/**
 * turn-item 类型标注（type prop）：
 * - cover 封面：独占封面纸张
 * - cover-inside 封面底：内容绑定到封面纸张里侧（翻开封面所见）
 * - back-cover 封底：独占封底纸张
 * - back-cover-inside 封底里：内容绑定到封底纸张里侧（合上书前所见）
 * - jacket 跨页封皮：一张双倍宽度内容同时供给封面与封底（右半 = 封面、
 *   左半 = 封底），不能再与 cover / back-cover 混用，可与两种衬页共存
 * 衬页必须依附于对应封皮纸（cover-inside 需全书存在 cover 或 jacket，
 * back-cover-inside 需 back-cover 或 jacket）。未声明的项为普通内容页；
 * 全书未声明封面/封底时由位置兜底（首个内容面提升为封面、末个提升为封底）
 */
export type TurnItemType =
  | 'cover'
  | 'cover-inside'
  | 'back-cover'
  | 'back-cover-inside'
  | 'jacket'

export type SheetGeometry = 'A' | 'B'

// 缩放手势模式：off 关闭、wheel 滚轮步进、dblclick 双击切换（单击翻页需延迟判定）、both 两者
export type ZoomMode = 'off' | 'wheel' | 'dblclick' | 'both'

// 显示模式：auto 按容器宽高自动判定，1/2 强制单/双页
export type DisplayMode = 'auto' | 1 | 2

// 键盘翻页模式：off 关闭、focus 聚焦视口后响应（默认）、global 追加
// document 级兜底（焦点不在组件内也响应，会劫持宿主页面的方向键/空格）
export type KeyboardMode = 'off' | 'focus' | 'global'


// 观感预设：纸张类型。为专业渲染参数提供成组基线，look/coverLook 可逐项覆盖
// - soft 普通纸张（默认）：哑光、可卷曲、支持角点折角
// - hard 纸板：刚体旋转、强光泽、关闭折角
// - custom 自定义：基线与 soft 一致，供完全自定义时显式声明意图
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
  /**
   * 反向翻页：纸张从翻起态（进度 1，翻出页缝外侧）收回放平（进度 0），
   * 正面（frontIndex）盖住 staticPages 呈现的当前页——单页模式页缝固定
   * 在一侧时的"上一页从缝侧翻入"动画。未标记时进度 0→1 正常翻出
   */
  reverse?: boolean
  /**
   * 封面/封底开合的边界 spec：伴随书体平移（worldFromX/worldToX）且跨距
   * 固定为 ±1/±2。跳页扇形规划据此不把边界步并入合并大步
   */
  boundary?: boolean
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

/**
 * 观感与折页参数（均可选）：逐项覆盖 preset 档位基线，未传项取预设值。
 * `look` 用于内页，`coverLook` 用于封面/封底纸张（未传项回退 `look`）。
 * 与 preset 一样在挂载时冻结，运行时修改不生效。
 */
export interface LookOptions {
  /** 翻页网格纵向分段数，越大卷曲越平滑 */
  nPolygons?: number
  /** 透视参考距离（像素），越小透视越强 */
  perspective?: number
  /** 环境光强度 */
  ambient?: number
  /** 方向光（纸张光泽）强度 */
  gloss?: number
  /** 卷曲幅度（0 为纯刚体旋转） */
  curl?: number
  /** 是否开启折角/折页形变（turn.js 4 风格） */
  fold?: boolean
  /** 折缝圆角弧长占页宽比例，越大折缝越柔软 */
  bend?: number
}

/** 拖拽翻页参数 */
export interface FlipSheetOptions {
  /** 卷曲幅度覆盖；硬页（纸板页）传 0 做纯刚体翻转 */
  curl?: number
  /** 网格纵向分段数覆盖；封面档与内页密度不同时使用 */
  nPolygons?: number
  /** 折页网格分段数覆盖（默认 96）；骨架占位纸等无内容细节的纸张
   *  传低值降低多张并发形变的逐帧开销 */
  foldSegments?: number
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

/** 实例响应式状态快照：模板/computed 中读取自动跟踪更新，运行时只读 */
export interface TurnState {
  /** 当前页码（从 1 开始） */
  readonly page: number
  readonly numPages: number
  readonly isFlipping: boolean
  readonly canNext: boolean
  readonly canPrev: boolean
  readonly disabled: boolean
  /** 当前显示模式：1 单页 / 2 双页（auto 解析后的实际值） */
  readonly displayedPages: 1 | 2
  /** 当前缩放级别（1 为未缩放） */
  readonly zoom: number
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
  /** 响应式状态（模板/computed 直接读取，自动跟踪更新） */
  readonly state: TurnState
  readonly page: number
  readonly numPages: number
  readonly isFlipping: boolean
  readonly canNext: boolean
  readonly canPrev: boolean
  readonly disabled: boolean
  /** 当前缩放级别（1 为未缩放） */
  readonly zoom: number
}
