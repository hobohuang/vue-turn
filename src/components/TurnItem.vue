<script setup lang="ts">
import type { PageRegion } from '@/types/turn'

// 透明组件：自身不产生 DOM，仅作为“一页内容”的载体，
// 由 vue-turn 收集其 vnode 并克隆到离屏容器光栅化为纹理
defineOptions({ name: 'TurnItem' })

// 跨页项：内容横跨整个跨页（双倍宽度光栅化）。
// 热区：占整页比例的可点击区域，命中后触发 region-tap 事件。
// 封面/封底：声明该项为封面（首个 item）/封底（末个 item），其纸张
// 独占一张（背面内容用 #back 插槽声明，未定义则为空白衬页），
// 并按 coverPreset 观感翻页。
// 均显式声明为 prop 以阻止 attrs 透传到内容根元素。
defineProps<{
  spread?: boolean
  regions?: PageRegion[]
  cover?: boolean
  backCover?: boolean
}>()
</script>

<template>
  <slot />
</template>
