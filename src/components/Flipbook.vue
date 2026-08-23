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
const { container, containerSize, setStaticPages, applyStaticTexture, startFlip } =
  useFlipbookRenderer({
    pageAspect: props.pageAspect,
    nPolygons: props.nPolygons,
    perspective: props.perspective,
    ambient: props.ambient,
    gloss: props.gloss,
    curl: props.curl,
  })

const pageEls = ref<HTMLElement[]>([])
const textures = new Map<number, THREE.Texture>()

// 使用 watch 而非 watchEffect：clampAndAlign 会读取 currentPage，
// watchEffect 会在翻页提交后重跑并把封面/封底的落点重新对齐到跨页
watch(
  () => [props.forwardDirection, props.numPages] as const,
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
    numPages: props.numPages,
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
    numPages: props.numPages,
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
    props.flipDuration,
    onDone,
  )
}

function goToPage(page: number) {
  if (store.isFlipping) return
  store.goToPage(page - 1)
}

const slotProps = computed<FlipbookSlotProps>(() => ({
  page: store.page,
  numPages: props.numPages,
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
  await Promise.all(
    Array.from({ length: props.numPages }, async (_, index) => {
      const el = pageEls.value[index]
      if (!el) return
      textures.set(index, await elementToTexture(el, 1))
    }),
  )
  for (const [index, texture] of textures) {
    applyStaticTexture(index, texture)
  }
  renderStatic()
})

onBeforeUnmount(() => {
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
    <div ref="container" class="viewport"></div>
    <slot v-bind="slotProps" />
    <div class="offscreen-pages" aria-hidden="true">
      <div
        v-for="index in props.numPages"
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
