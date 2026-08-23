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

export interface TurnSlotProps {
  page: number
  numPages: number
  isFlipping: boolean
  canFlipLeft: boolean
  canFlipRight: boolean
  flipLeft: () => void
  flipRight: () => void
  goToPage: (page: number) => void
}
