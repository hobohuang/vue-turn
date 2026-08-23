import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import type * as THREE from 'three'

import { FlipbookScene } from '@/lib/FlipbookScene'
import type { FlipSpec, StaticPlacement } from '@/types/flipbook'

export interface FlipbookRendererOptions {
  pageAspect: number
  nPolygons: number
  perspective: number
  ambient: number
  gloss: number
  curl: number
}

export function useFlipbookRenderer(options: FlipbookRendererOptions) {
  const container = ref<HTMLElement | null>(null)
  const containerSize = reactive({ width: 0, height: 0 })
  let scene: FlipbookScene | null = null
  let observer: ResizeObserver | null = null

  onMounted(() => {
    const el = container.value
    if (!el) return
    scene = new FlipbookScene({ container: el, ...options })
    const rect = el.getBoundingClientRect()
    containerSize.width = rect.width
    containerSize.height = rect.height
    scene.resize(rect.width, rect.height)
    observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry || !scene) return
      containerSize.width = entry.contentRect.width
      containerSize.height = entry.contentRect.height
      scene.resize(entry.contentRect.width, entry.contentRect.height)
    })
    observer.observe(el)
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    observer = null
    scene?.dispose()
    scene = null
  })

  function setStaticPages(
    placements: StaticPlacement[],
    textureOf: (index: number) => THREE.Texture | null,
  ) {
    scene?.setStaticPages(placements, textureOf)
  }

  function applyStaticTexture(index: number, texture: THREE.Texture) {
    scene?.applyStaticTexture(index, texture)
  }

  function startFlip(
    spec: FlipSpec,
    frontTexture: THREE.Texture | null,
    backTexture: THREE.Texture | null,
    duration: number,
    onDone: () => void,
  ) {
    scene?.startFlip(spec, frontTexture, backTexture, duration, onDone)
  }

  return { container, containerSize, setStaticPages, applyStaticTexture, startFlip }
}
