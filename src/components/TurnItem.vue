<script setup lang="ts">
import type { PageRegion } from '@/types/turn'

// 透明组件：自身不产生 DOM，仅作为“一页内容”的载体，
// 由 vue-turn 收集其 vnode 并克隆到离屏容器光栅化为纹理
defineOptions({ name: 'TurnItem' })

// 跨页项：内容横跨整个跨页（双倍宽度光栅化）。
// 热区：占整页比例的可点击区域，命中后触发 region-tap 事件。
// 均显式声明为 prop 以阻止 attrs 透传到内容根元素。
defineProps<{
  spread?: boolean
  regions?: PageRegion[]
}>()
</script>

<template>
  <slot />
</template>
