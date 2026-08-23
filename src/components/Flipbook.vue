<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type * as THREE from 'three'

import { useFlipbookRenderer } from '@/composables/useFlipbookRenderer'
import { computeFlipSpec, spreadLayout } from '@/lib/flipSpec'
import { elementToTexture } from '@/lib/textureFactory'
import { useBookStore } from '@/stores/book'
import type { FlipbookSlotProps, ForwardDirection } from '@/types/flipbook'

const PAGE_PIXEL_WIDTH = 768

const props = withDefaults(
  defineProps<{
    numPages: number
    pageAspect?: number
    flipDuration?: number
    startPage?: number
    nPolygons?: number
    perspective?: number
    ambient?: number
    gloss?: number
    curl?: number
    forwardDirection?: ForwardDirection
    singlePage?: boolean
  }>(),
  {
    pageAspect: 0.75,
    flipDuration: 900,
    startPage: 1,
    nPolygons: 64,
    perspective: 2400,
    ambient: 1,
    gloss: 0.35,
    curl: 0.8,
    forwardDirection: 'left',
    singlePage: false,
  },
)

const emit = defineEmits<{
  'flip-left-start': []
  'flip-left-end': []
  'flip-right-start': []
  'flip-right-end': []
  'update:page': [page: number]
}>()

const store = useBookStore()
const {
  container,
  containerSize,
  webglSupported,
  setStaticPages,
  applyStaticTexture,
  startFlip,
} = useFlipbookRenderer({
  pageAspect: props.pageAspect,
  nPolygons: props.nPolygons,
  perspective: props.perspective,
  ambient: props.ambient,
  gloss: props.gloss,
  curl: props.curl,
})

const pageEls = ref<HTMLElement[]>([])
const textures = new Map<number, THREE.Texture>()
let disposed = false

// props 运行时校验：非法值回退到默认值，避免污染几何与动画时长
const safeNumPages = computed(() =>
  Number.isFinite(props.numPages) ? Math.max(0, Math.floor(props.numPages)) : 0,
)
const safeFlipDuration = computed(() =>
  Number.isFinite(props.flipDuration) && props.flipDuration > 0 ? props.flipDuration : 900,
)

// 使用 watch 而非 watchEffect：clampAndAlign 会读取 currentPage，
// watchEffect 会在翻页提交后重跑并把封面/封底的落点重新对齐到跨页
watch(
  () => [props.forwardDirection, safeNumPages.value] as const,
  ([direction, count]) => {
    store.setForwardDirection(direction)
    store.setNumPages(count)
  },
  { immediate: true },
)

watch(
  () => [containerSize.width, containerSize.height] as const,
  ([width, height]) => {
    store.setDisplayedPages(!props.singlePage && width > height ? 2 : 1)
  },
  { immediate: true },
)

function renderStatic() {
  if (store.isFlipping) return
  const placements = spreadLayout({
    currentPage: store.currentPage,
    displayedPages: store.displayedPages,
    forwardDirection: props.forwardDirection,
    numPages: safeNumPages.value,
  })
  setStaticPages(placements, (index) => textures.get(index) ?? null)
}

watch([() => store.currentPage, () => store.displayedPages], () => {
  renderStatic()
})

function flip(trigger: 'left' | 'right') {
  const ltr = props.forwardDirection === 'left'
  const advancing = ltr ? trigger === 'left' : trigger === 'right'
  if (advancing ? !store.canGoForward : !store.canGoBack) return
  store.startFlip()
  if (trigger === 'left') {
    emit('flip-left-start')
  } else {
    emit('flip-right-start')
  }
  const spec = computeFlipSpec({
    currentPage: store.currentPage,
    displayedPages: store.displayedPages,
    forwardDirection: props.forwardDirection,
    backward: !advancing,
    pageAspect: props.pageAspect,
    numPages: safeNumPages.value,
  })
  setStaticPages(spec.staticPages, (index) => textures.get(index) ?? null)
  const onDone = () => {
    store.commitFlip(spec.delta)
    renderStatic()
    if (trigger === 'left') {
      emit('flip-left-end')
    } else {
      emit('flip-right-end')
    }
    emit('update:page', store.page)
  }
  startFlip(
    spec,
    textures.get(spec.frontIndex) ?? null,
    textures.get(spec.backIndex) ?? null,
    safeFlipDuration.value,
    onDone,
  )
}

function goToPage(page: number) {
  if (store.isFlipping) return
  store.goToPage(page - 1)
}

const slotProps = computed<FlipbookSlotProps>(() => ({
  page: store.page,
  numPages: safeNumPages.value,
  isFlipping: store.isFlipping,
  canFlipLeft: store.canFlipLeft,
  canFlipRight: store.canFlipRight,
  flipLeft: () => flip('left'),
  flipRight: () => flip('right'),
  goToPage,
}))

onMounted(async () => {
  store.setDisplayedPages(!props.singlePage && containerSize.width > containerSize.height ? 2 : 1)
  store.goToPage(props.startPage - 1)
  await nextTick()
  // 逐页光栅化并单独兜底：任意一页失败只影响该页纹理，不阻断整体初始化
  await Promise.all(
    Array.from({ length: safeNumPages.value }, async (_, index) => {
      const el = pageEls.value[index]
      if (!el) return
      try {
        const texture = await elementToTexture(el, 1)
        if (disposed) {
          // 卸载发生在生成期间：立即释放，避免纹理泄漏
          texture.dispose()
          return
        }
        textures.set(index, texture)
        applyStaticTexture(index, texture)
      } catch (error) {
        console.warn(`[Flipbook] 第 ${index + 1} 页纹理生成失败`, error)
      }
    }),
  )
  if (!disposed) renderStatic()
})

onBeforeUnmount(() => {
  disposed = true
  for (const texture of textures.values()) {
    texture.dispose()
  }
  textures.clear()
})

defineExpose({
  flipLeft: () => flip('left'),
  flipRight: () => flip('right'),
  goToPage,
})
</script>

<template>
  <div class="flipbook">
    <div v-if="!webglSupported" class="webgl-fallback">
      当前环境不支持 WebGL，无法展示 3D 翻页效果。
    </div>
    <div v-show="webglSupported" ref="container" class="viewport"></div>
    <slot v-bind="slotProps" />
    <div class="offscreen-pages" aria-hidden="true">
      <div
        v-for="index in safeNumPages"
        :key="index"
        ref="pageEls"
        class="page-source"
        :style="{
          width: `${PAGE_PIXEL_WIDTH}px`,
          height: `${PAGE_PIXEL_WIDTH / props.pageAspect}px`,
        }"
      >
        <slot name="page" :index="index - 1" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.flipbook {
  position: relative;
  width: 100%;
  height: 100%;
}

.viewport {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.viewport :deep(canvas) {
  display: block;
  width: 100%;
  height: 100%;
}

.webgl-fallback {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  text-align: center;
  color: #e8ecf4;
  background: rgba(20, 24, 33, 0.6);
  font-size: 15px;
}

.offscreen-pages {
  position: fixed;
  top: 0;
  left: -100000px;
  pointer-events: none;
}

.page-source {
  overflow: hidden;
  background: #ffffff;
}
</style>
