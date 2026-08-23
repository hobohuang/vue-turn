<script lang="ts">
// 模块级计数器：<script setup> 内的变量会随每个实例重新初始化，
// 放在普通 <script> 块中才能保证所有实例共享并递增
let instanceSeq = 0
</script>

<script setup lang="ts">
import { Comment, computed, nextTick, onBeforeUnmount, onMounted, ref, useSlots, watch } from 'vue'
import { cloneVNode, type VNode } from 'vue'
import type * as THREE from 'three'

import TurnItem from '@/components/TurnItem.vue'
import { useTurnRenderer } from '@/composables/useTurnRenderer'
import { computeFlipSpec, spreadLayout } from '@/lib/flipSpec'
import { elementToTexture } from '@/lib/textureFactory'
import { useBookStore } from '@/stores/book'
import type { ForwardDirection, TurnSlotProps } from '@/types/turn'

const PAGE_PIXEL_WIDTH = 768

const props = withDefaults(
  defineProps<{
    modelValue?: number
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
  'update:modelValue': [page: number]
  'flip-left-start': []
  'flip-left-end': []
  'flip-right-start': []
  'flip-right-end': []
}>()

// 实例隔离：每个 vue-turn 使用独立 store
const store = useBookStore(`turn-${instanceSeq++}`)

const {
  container,
  containerSize,
  webglSupported,
  setStaticPages,
  applyStaticTexture,
  startFlip,
} = useTurnRenderer({
  pageAspect: props.pageAspect,
  nPolygons: props.nPolygons,
  perspective: props.perspective,
  ambient: props.ambient,
  gloss: props.gloss,
  curl: props.curl,
})

const slots = useSlots()

// 收集默认插槽中的 turn-item vnode（展平 v-for 产生的 Fragment），
// 非 turn-item 子节点忽略并提示
let warnedInvalidChild = false
const pageVnodes = computed<VNode[]>(() => {
  const root = slots.default?.() ?? []
  const result: VNode[] = []
  const walk = (nodes: VNode[]) => {
    for (const node of nodes) {
      if (node.type === TurnItem) {
        result.push(node)
      } else if (Array.isArray(node.children)) {
        walk(node.children as VNode[])
      } else if (!warnedInvalidChild && node.type !== Comment && typeof node.type !== 'symbol') {
        warnedInvalidChild = true
        console.warn('[vue-turn] 默认插槽中仅支持 <turn-item>，其余子节点将被忽略')
      }
    }
  }
  walk(root)
  return result
})

const pageEls = ref<HTMLElement[]>([])
const textures = new Map<number, THREE.Texture>()
let disposed = false
let pendingTarget: number | null = null

const safeNumPages = computed(() => pageVnodes.value.length)
const safeFlipDuration = computed(() =>
  Number.isFinite(props.flipDuration) && props.flipDuration > 0 ? props.flipDuration : 900,
)

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

// v-model：外部页码变化时跳转；翻页中则推迟到动画结束
watch(
  () => props.modelValue,
  (value) => {
    if (value === undefined) return
    const target = Number.isFinite(value) ? Math.round(value) - 1 : 0
    if (target === store.currentPage) return
    if (store.isFlipping) {
      pendingTarget = target
    } else {
      store.goToPage(target)
    }
  },
)

watch(
  () => store.isFlipping,
  (flipping) => {
    if (!flipping && pendingTarget !== null) {
      const target = pendingTarget
      pendingTarget = null
      store.goToPage(target)
    }
  },
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
    emit('update:modelValue', store.page)
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

const slotProps = computed<TurnSlotProps>(() => ({
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
  const initial = props.modelValue ?? props.startPage
  store.goToPage((Number.isFinite(initial) ? Math.round(initial) : 1) - 1)
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
        console.warn(`[vue-turn] 第 ${index + 1} 页纹理生成失败`, error)
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
  <div class="vue-turn">
    <div v-if="!webglSupported" class="webgl-fallback">
      当前环境不支持 WebGL，无法展示 3D 翻页效果。
    </div>
    <div v-show="webglSupported" ref="container" class="viewport"></div>
    <slot name="toolbar" v-bind="slotProps" />
    <div class="offscreen-pages" aria-hidden="true">
      <div
        v-for="(vnode, index) in pageVnodes"
        :key="index"
        ref="pageEls"
        class="page-source"
        :style="{
          width: `${PAGE_PIXEL_WIDTH}px`,
          height: `${PAGE_PIXEL_WIDTH / props.pageAspect}px`,
        }"
      >
        <component :is="() => cloneVNode(vnode)" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.vue-turn {
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
