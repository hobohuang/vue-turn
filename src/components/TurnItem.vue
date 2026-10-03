<script setup lang="ts">
import type { PageRegion, TurnItemType } from '../types/turn'

// 透明组件：自身不产生 DOM，仅作为“一页内容”的载体，
// 由 vue-turn 收集其 vnode 并克隆到离屏容器光栅化为纹理
defineOptions({ name: 'TurnItem' })

// 跨页项：内容横跨整个跨页（双倍宽度光栅化）。
// 热区：占整页比例的可点击区域，命中后触发 region-tap 事件。
// 类型：type="cover" 封面 / type="back-cover" 封底，各独占一张专用纸张
// （按 coverPreset 观感翻页）；type="cover-inside" 封面底 /
// type="back-cover-inside" 封底里，内容分别绑定到封面/封底纸张里侧；
// type="jacket" 跨页封皮，一张双倍宽度内容同时供给封面与封底（右半 =
// 封面、左半 = 封底）。未声明 type 的项为普通内容页。均显式声明为 prop
// 以阻止 attrs 透传到内容根元素。
defineProps<{
  spread?: boolean
  regions?: PageRegion[]
  type?: TurnItemType
}>()
</script>

<template>
  <slot />
</template>
