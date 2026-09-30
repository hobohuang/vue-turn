import { computed, ref } from 'vue'

import type { ForwardDirection } from '../types/turn'

// 组件内部状态机：不依赖任何全局状态库，每个 vue-turn 实例天然隔离
export function useBookState() {
  const numPages = ref(0)
  const currentPage = ref(0)
  const displayedPages = ref<1 | 2>(2)
  const isFlipping = ref(false)
  const forwardDirection = ref<ForwardDirection>('left')

  const page = computed(() => currentPage.value + 1)

  const canGoForward = computed(
    () => !isFlipping.value && currentPage.value < numPages.value - 1,
  )

  const canGoBack = computed(() => !isFlipping.value && currentPage.value > 0)

  const canFlipLeft = computed(() =>
    forwardDirection.value === 'left' ? canGoForward.value : canGoBack.value,
  )

  const canFlipRight = computed(() =>
    forwardDirection.value === 'left' ? canGoBack.value : canGoForward.value,
  )

  function clampAndAlign(value: number): number {
    const max = Math.max(0, numPages.value - 1)
    const result = Math.min(Math.max(0, Math.round(value)), max)
    // 跨页为奇数左页 [1,2] [3,4] …，封面(0)与奇数索引封底单独居中
    if (displayedPages.value === 2 && result !== 0 && result !== max && result % 2 === 0) {
      return result - 1
    }
    return result
  }

  function setForwardDirection(direction: ForwardDirection) {
    forwardDirection.value = direction
  }

  function setNumPages(count: number) {
    numPages.value = Math.max(0, Math.floor(count))
    currentPage.value = clampAndAlign(currentPage.value)
  }

  function setDisplayedPages(count: 1 | 2) {
    if (displayedPages.value === count) return
    displayedPages.value = count
    currentPage.value = clampAndAlign(currentPage.value)
  }

  function goToPage(index: number) {
    if (isFlipping.value) return
    currentPage.value = clampAndAlign(index)
  }

  function startFlip() {
    isFlipping.value = true
  }

  function commitFlip(delta: number) {
    const max = Math.max(0, numPages.value - 1)
    currentPage.value = Math.min(Math.max(0, currentPage.value + delta), max)
    isFlipping.value = false
  }

  // 取消翻页（拖拽回弹）：页码不变，仅解除翻页中状态
  function cancelFlip() {
    isFlipping.value = false
  }

  return {
    numPages,
    currentPage,
    displayedPages,
    isFlipping,
    forwardDirection,
    page,
    canGoForward,
    canGoBack,
    canFlipLeft,
    canFlipRight,
    setForwardDirection,
    setNumPages,
    setDisplayedPages,
    goToPage,
    startFlip,
    commitFlip,
    cancelFlip,
  }
}
