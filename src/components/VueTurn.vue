<script lang="ts">
import { defineComponent, type PropType, type VNode } from 'vue'
import { cloneVNode } from 'vue'

// 稳定类型的渲染载体：按 vnode 实际结构做最小 diff，
// 避免父组件每次渲染都整体重建离屏页面 DOM
export const VnodeHolder = defineComponent({
  name: 'VnodeHolder',
  props: { vnode: { type: Object as PropType<VNode>, required: true } },
  setup(props) {
    return () => cloneVNode(props.vnode)
  },
})
</script>

<script setup lang="ts">
import {
  Comment,
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  onUpdated,
  ref,
  useSlots,
  watch,
} from 'vue'
import type * as THREE from 'three'

import TurnItem from '@/components/TurnItem.vue'
import { useBookState } from '@/composables/useBookState'
import { useTurnRenderer } from '@/composables/useTurnRenderer'
import { computeFlipSpec, spreadLayout } from '@/lib/flipSpec'
import { elementToTexture, waitForResources } from '@/lib/textureFactory'
import type { DisplayMode, EasingFn, FlipDirection, TurnSlotProps } from '@/types/turn'

const props = withDefaults(
  defineProps<{
    /** 当前页码（从 1 开始），支持 v-model 双向绑定 */
    modelValue?: number
    /** 页面宽高比（宽 / 高） */
    pageAspect?: number
    /** 单次翻页动画时长（毫秒） */
    flipDuration?: number
    /** 初始页码（未提供 modelValue 时生效） */
    startPage?: number
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
    /** 前进方向：left 为从左向右阅读 */
    forwardDirection?: FlipDirection
    /** 显示模式：auto 按容器宽高自动判定，1/2 强制单/双页 */
    displayedPages?: DisplayMode
    /** 离屏光栅化宽度（像素），控制纹理清晰度与内存占用 */
    pageWidth?: number
    /** 光栅化像素比 */
    pixelRatio?: number
    /** 页面底色（纹理背景） */
    pageBackground?: string
    /** 相机适配边距（视口外扩比例），越大留白越多 */
    fitMargin?: number
    /** 渲染像素比上限 */
    maxPixelRatio?: number
    /** 翻页进度缓动函数 */
    easing?: EasingFn
    /** 是否允许点击视口翻页（右半前进、左半后退） */
    clickToFlip?: boolean
    /** 是否允许键盘方向键翻页（需先聚焦组件） */
    keyboard?: boolean
    /** 无障碍标签 */
    ariaLabel?: string
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
    displayedPages: 'auto',
    pageWidth: 768,
    pixelRatio: 1,
    pageBackground: '#ffffff',
    clickToFlip: true,
    keyboard: true,
    ariaLabel: '翻书',
  },
)

const emit = defineEmits<{
  'update:modelValue': [page: number]
  'flip-left-start': []
  'flip-left-end': []
  'flip-right-start': []
  'flip-right-end': []
  /** 方向无关的统一翻页开始事件 */
  'flip-start': [direction: FlipDirection]
  /** 方向无关的统一翻页结束事件 */
  'flip-end': [direction: FlipDirection]
  /** 页码变化（翻页提交与直接跳转均触发） */
  change: [page: number]
  /** 首次纹理就绪 */
  ready: []
}>()

const state = useBookState()

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
  fitMargin: props.fitMargin,
  maxPixelRatio: props.maxPixelRatio,
  easing: props.easing,
})

const slots = useSlots()

// 在模板渲染期收集 turn-item vnode（展平 v-for 产生的 Fragment），
// 非 turn-item 子节点忽略并提示。必须在渲染函数内调用插槽，
// 才能让父组件的内容变化正常触发本组件更新
let warnedInvalidChild = false
function collectPages(): VNode[] {
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
}

const offscreenEl = ref<HTMLElement | null>(null)
const pageEls = ref<HTMLElement[]>([])
const pageCount = ref(0)
const textures = new Map<number, THREE.Texture>()
let disposed = false
let pendingTarget: number | null = null
let pendingRaster = false
let rasterSeq = 0
let rasterScheduled = false
let readyEmitted = false
let mutationObserver: MutationObserver | null = null

const safeFlipDuration = computed(() =>
  Number.isFinite(props.flipDuration) && props.flipDuration > 0 ? props.flipDuration : 900,
)
const safePageWidth = computed(() =>
  Number.isFinite(props.pageWidth) && props.pageWidth > 0 ? props.pageWidth : 768,
)
const safePixelRatio = computed(() =>
  Number.isFinite(props.pixelRatio) && props.pixelRatio > 0 ? props.pixelRatio : 1,
)

function syncPageCount() {
  const count = pageEls.value.length
  if (pageCount.value !== count) pageCount.value = count
}

watch(
  () => [props.forwardDirection, pageCount.value] as const,
  ([direction, count]) => {
    state.setForwardDirection(direction)
    state.setNumPages(count)
  },
  { immediate: true },
)

// 显示模式解析：auto 按容器宽高判定，1/2 为强制值
function resolveDisplayedPages(): 1 | 2 {
  if (props.displayedPages === 1) return 1
  if (props.displayedPages === 2) return 2
  return containerSize.width > containerSize.height ? 2 : 1
}

watch(
  () => [containerSize.width, containerSize.height, props.displayedPages] as const,
  () => {
    state.setDisplayedPages(resolveDisplayedPages())
  },
  { immediate: true },
)

// v-model：外部页码变化时跳转；翻页中则推迟到动画结束
watch(
  () => props.modelValue,
  (value) => {
    if (value === undefined) return
    const target = Number.isFinite(value) ? Math.round(value) - 1 : 0
    if (target === state.currentPage.value) return
    if (state.isFlipping.value) {
      pendingTarget = target
    } else {
      state.goToPage(target)
    }
  },
)

watch(
  () => state.isFlipping.value,
  (flipping) => {
    if (flipping) return
    if (pendingTarget !== null) {
      const target = pendingTarget
      pendingTarget = null
      state.goToPage(target)
    }
    // 翻页期间累积的内容变化，动画结束后补刷纹理
    if (pendingRaster) {
      pendingRaster = false
      void rasterizeAll()
    }
  },
)

function renderStatic() {
  if (state.isFlipping.value) return
  const placements = spreadLayout({
    currentPage: state.currentPage.value,
    displayedPages: state.displayedPages.value,
    forwardDirection: props.forwardDirection,
    numPages: pageCount.value,
  })
  setStaticPages(placements, (index) => textures.get(index) ?? null)
}

watch([() => state.currentPage.value, () => state.displayedPages.value], () => {
  renderStatic()
})

// 页码变化统一出口：同步 v-model 并派发 change
watch(
  () => state.currentPage.value,
  () => {
    emit('update:modelValue', state.page.value)
    emit('change', state.page.value)
  },
)

function flip(trigger: FlipDirection) {
  const ltr = props.forwardDirection === 'left'
  const advancing = ltr ? trigger === 'left' : trigger === 'right'
  if (advancing ? !state.canGoForward.value : !state.canGoBack.value) return
  state.startFlip()
  if (trigger === 'left') {
    emit('flip-left-start')
  } else {
    emit('flip-right-start')
  }
  emit('flip-start', trigger)
  const spec = computeFlipSpec({
    currentPage: state.currentPage.value,
    displayedPages: state.displayedPages.value,
    forwardDirection: props.forwardDirection,
    backward: !advancing,
    pageAspect: props.pageAspect,
    numPages: pageCount.value,
  })
  setStaticPages(spec.staticPages, (index) => textures.get(index) ?? null)
  const onDone = () => {
    state.commitFlip(spec.delta)
    renderStatic()
    if (trigger === 'left') {
      emit('flip-left-end')
    } else {
      emit('flip-right-end')
    }
    emit('flip-end', trigger)
  }
  startFlip(
    spec,
    textures.get(spec.frontIndex) ?? null,
    textures.get(spec.backIndex) ?? null,
    safeFlipDuration.value,
    onDone,
  )
}

function next() {
  flip(props.forwardDirection)
}

function prev() {
  flip(props.forwardDirection === 'left' ? 'right' : 'left')
}

function goToPage(page: number) {
  if (state.isFlipping.value) return
  state.goToPage(page - 1)
}

// 点击视口翻页：右半前进、左半后退（与真实书籍一致）
function onViewportClick(event: MouseEvent) {
  if (!props.clickToFlip || state.isFlipping.value) return
  const target = event.currentTarget as HTMLElement | null
  if (!target) return
  const rect = target.getBoundingClientRect()
  if (rect.width <= 0) return
  if (event.clientX - rect.left >= rect.width / 2) {
    next()
  } else {
    prev()
  }
}

// 键盘方向键翻页：仅在组件聚焦时生效
function onKeydown(event: KeyboardEvent) {
  if (!props.keyboard) return
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    next()
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault()
    prev()
  }
}

// 光栅化单页：seq 过期（内容再次变化/卸载）时丢弃结果，旧纹理立即释放
async function rasterizePage(index: number, seq: number) {
  const el = pageEls.value[index]
  if (!el) return
  try {
    // 等待页内图片与字体就绪，避免光栅化出缺图/缺字的纹理
    await waitForResources(el)
    if (disposed || seq !== rasterSeq) return
    const texture = await elementToTexture(el, safePixelRatio.value, props.pageBackground)
    if (disposed || seq !== rasterSeq) {
      texture.dispose()
      return
    }
    textures.get(index)?.dispose()
    textures.set(index, texture)
    applyStaticTexture(index, texture)
  } catch (error) {
    if (seq === rasterSeq) {
      console.warn(`[vue-turn] 第 ${index + 1} 页纹理生成失败`, error)
    }
  }
}

async function rasterizeAll() {
  const seq = ++rasterSeq
  // 等待离屏 DOM 完成最新内容的 patch，避免光栅化到旧内容
  await nextTick()
  if (disposed || seq !== rasterSeq) return
  const total = pageEls.value.length
  await Promise.all(Array.from({ length: total }, (_, index) => rasterizePage(index, seq)))
  if (disposed || seq !== rasterSeq) return
  renderStatic()
  if (!readyEmitted) {
    readyEmitted = true
    emit('ready')
  }
}

// 手动重绘全部页面纹理（内容含异步资源时可在资源就绪后调用）
function refresh() {
  return rasterizeAll()
}

// 离屏内容发生 DOM 变化时合并触发一次重光栅化；
// 翻页动画期间不打断，动画结束后补刷
function scheduleRaster() {
  if (disposed) return
  if (state.isFlipping.value) {
    pendingRaster = true
    return
  }
  if (rasterScheduled) return
  rasterScheduled = true
  void nextTick(() => {
    rasterScheduled = false
    if (!disposed) void rasterizeAll()
  })
}

const slotProps = computed<TurnSlotProps>(() => ({
  page: state.page.value,
  numPages: pageCount.value,
  isFlipping: state.isFlipping.value,
  canFlipLeft: state.canFlipLeft.value,
  canFlipRight: state.canFlipRight.value,
  flipLeft: () => flip('left'),
  flipRight: () => flip('right'),
  next,
  prev,
  goToPage,
  refresh,
}))

onMounted(async () => {
  state.setDisplayedPages(resolveDisplayedPages())
  const initial = props.modelValue ?? props.startPage
  state.goToPage((Number.isFinite(initial) ? Math.round(initial) : 1) - 1)
  syncPageCount()
  if (offscreenEl.value) {
    mutationObserver = new MutationObserver(scheduleRaster)
    mutationObserver.observe(offscreenEl.value, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    })
  }
  await nextTick()
  // 逐页光栅化并单独兜底：任意一页失败只影响该页纹理，不阻断整体初始化
  await rasterizeAll()
})

onUpdated(() => {
  syncPageCount()
})

onBeforeUnmount(() => {
  disposed = true
  rasterSeq++
  mutationObserver?.disconnect()
  mutationObserver = null
  for (const texture of textures.values()) {
    texture.dispose()
  }
  textures.clear()
})

defineExpose({
  flipLeft: () => flip('left'),
  flipRight: () => flip('right'),
  next,
  prev,
  goToPage,
  refresh,
  get page() {
    return state.page.value
  },
  get numPages() {
    return pageCount.value
  },
  get isFlipping() {
    return state.isFlipping.value
  },
})
</script>

<template>
  <div class="vue-turn">
    <div v-if="!webglSupported" class="webgl-fallback">
      <slot name="fallback">当前环境不支持 WebGL，无法展示 3D 翻页效果。</slot>
    </div>
    <div
      v-show="webglSupported"
      ref="container"
      class="viewport"
      role="group"
      :aria-label="ariaLabel"
      :tabindex="keyboard ? 0 : undefined"
      @click="onViewportClick"
      @keydown="onKeydown"
    ></div>
    <slot name="toolbar" v-bind="slotProps" />
    <div ref="offscreenEl" class="offscreen-pages" aria-hidden="true">
      <div
        v-for="(vnode, index) in collectPages()"
        :key="index"
        ref="pageEls"
        class="page-source"
        :style="{
          width: `${safePageWidth}px`,
          height: `${safePageWidth / props.pageAspect}px`,
          background: props.pageBackground,
        }"
      >
        <VnodeHolder :vnode="vnode" />
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

.viewport:focus-visible {
  outline: 2px solid rgba(96, 165, 250, 0.9);
  outline-offset: -2px;
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
}
</style>
