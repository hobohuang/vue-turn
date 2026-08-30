import { onBeforeUnmount, onMounted } from 'vue'
import type { Ref } from 'vue'

import type { FlipDirection } from '@/types/turn'

// document 级键盘监听的多实例互斥：页面上有多个 vue-turn 时，
// 仅最近交互过的实例响应 document 级按键，避免一次方向键所有书同时翻页
let docKeyboardOwner: object | null = null
let turnInstanceCount = 0

export interface KeyboardNavOptions {
  /** props.keyboard（响应式读取） */
  keyboardEnabled: () => boolean
  /** 交互禁用状态（响应式读取） */
  isDisabled: () => boolean
  /** 阅读方向（响应式读取） */
  forwardDirection: () => FlipDirection
  rootEl: Ref<HTMLElement | null>
  /** 本实例标识：多实例时最近交互过的实例获得 document 级键盘响应权 */
  instanceToken: object
  pageCount: Ref<number>
  next: () => void
  prev: () => void
  goToPage: (page: number) => boolean
}

/**
 * 键盘翻页：方向键跟随阅读方向，PageUp/PageDown/Space 前进后退，
 * Home/End 跳首末页。视口聚焦按键与 document 级兜底监听双通道，
 * 可交互元素（按钮/链接/输入框等）内的按键不劫持。
 */
export function useKeyboardNav(options: KeyboardNavOptions) {
  const {
    keyboardEnabled,
    isDisabled,
    forwardDirection,
    rootEl,
    instanceToken,
    pageCount,
    next,
    prev,
    goToPage,
  } = options

  // 视口聚焦按键
  function onKeydown(event: KeyboardEvent) {
    if (!keyboardEnabled() || isDisabled()) return
    // 组件内按键即声明本实例为 document 键盘的响应者（多实例互斥）
    docKeyboardOwner = instanceToken
    handleKeydown(event)
  }

  // document 级键盘监听：焦点不在书页上（如点击了外部工具栏按钮）时
  // 方向键依然可翻页。组件内部目标已由 viewport 的 @keydown 处理，
  // 此处跳过避免重复；可交互元素（按钮/链接/输入框等）内的按键不劫持，
  // 保留其原生激活行为；多实例时仅最近交互过的实例响应
  function onDocKeydown(event: KeyboardEvent) {
    if (!keyboardEnabled() || isDisabled()) return
    if (turnInstanceCount > 1 && docKeyboardOwner !== instanceToken) return
    const target = event.target as Node | null
    if (target) {
      if (rootEl.value?.contains(target)) return
      const el = target as HTMLElement
      if (
        el.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A', 'SUMMARY'].includes(el.tagName)
      ) {
        return
      }
    }
    handleKeydown(event)
  }

  function handleKeydown(event: KeyboardEvent) {
    const forwardKey = forwardDirection() === 'left' ? 'ArrowRight' : 'ArrowLeft'
    const backwardKey = forwardDirection() === 'left' ? 'ArrowLeft' : 'ArrowRight'
    switch (event.key) {
      case forwardKey:
      case 'PageDown':
      case ' ':
        event.preventDefault()
        next()
        break
      case backwardKey:
      case 'PageUp':
        event.preventDefault()
        prev()
        break
      case 'Home':
        event.preventDefault()
        goToPage(1)
        break
      case 'End':
        event.preventDefault()
        goToPage(pageCount.value)
        break
      default:
        break
    }
  }

  /** 组件内按下时声明 document 键盘响应权（供指针交互调用） */
  function claimKeyboardOwnership() {
    docKeyboardOwner = instanceToken
  }

  onMounted(() => {
    turnInstanceCount++
    document.addEventListener('keydown', onDocKeydown)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('keydown', onDocKeydown)
    turnInstanceCount--
    if (docKeyboardOwner === instanceToken) docKeyboardOwner = null
  })

  return { onKeydown, claimKeyboardOwnership }
}
