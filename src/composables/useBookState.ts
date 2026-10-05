import { computed, ref } from 'vue'

// 组件内部状态机：不依赖任何全局状态库，每个 vue-turn 实例天然隔离
// 阅读方向不入本状态机：所有消费方读的都是 props.forwardDirection，
// 另存一份只会产生"改一处忘另一处"的漂移
export function useBookState() {
  const numPages = ref(0)
  const currentPage = ref(0)
  const displayedPages = ref<1 | 2>(2)
  const isFlipping = ref(false)

  const page = computed(() => currentPage.value + 1)

  const canGoForward = computed(
    () => !isFlipping.value && currentPage.value < numPages.value - 1,
  )

  const canGoBack = computed(() => !isFlipping.value && currentPage.value > 0)

  function clampAndAlign(value: number): number {
    const max = Math.max(0, numPages.value - 1)
    const result = Math.min(Math.max(0, Math.round(value)), max)
    // 跨页为奇数左页 [1,2] [3,4] …，封面(0)与奇数索引封底单独居中
    if (displayedPages.value === 2 && result !== 0 && result !== max && result % 2 === 0) {
      return result - 1
    }
    return result
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

  // 页码对齐（goToPage/跳页扇形规划共用）：钳制到有效范围并按显示模式对齐跨页
  function alignPage(value: number): number {
    return clampAndAlign(value)
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
    page,
    canGoForward,
    canGoBack,
    setNumPages,
    setDisplayedPages,
    goToPage,
    alignPage,
    startFlip,
    commitFlip,
    cancelFlip,
  }
}
