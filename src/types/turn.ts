export type ForwardDirection = 'left' | 'right'

export type SheetGeometry = 'A' | 'B'

// 翻页进度缓动函数：输入归一化时间 [0,1]，输出归一化进度
export type EasingFn = (t: number) => number

// 显示模式：auto 按容器宽高自动判定，1/2 强制单/双页
export type DisplayMode = 'auto' | 1 | 2

export type Slot = 'left' | 'right' | 'center'

export interface StaticPlacement {
  index: number
  slot: Slot
  fromSlot?: Slot
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

export interface TurnSlotProps {
  page: number
  numPages: number
  isFlipping: boolean
  canFlipLeft: boolean
  canFlipRight: boolean
  flipLeft: () => void
  flipRight: () => void
  next: () => void
  prev: () => void
  goToPage: (page: number) => void
  refresh: () => Promise<void>
}

export interface TurnInstance {
  flipLeft: () => void
  flipRight: () => void
  next: () => void
  prev: () => void
  goToPage: (page: number) => void
  refresh: () => Promise<void>
  readonly page: number
  readonly numPages: number
  readonly isFlipping: boolean
}
