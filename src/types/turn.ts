export type ForwardDirection = 'left' | 'right'

export type SheetGeometry = 'A' | 'B'

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
