<script setup lang="ts">
// 透明组件：自身不产生 DOM，仅作为“一页内容”的载体，
// 由 vue-turn 收集其 vnode 并克隆到离屏容器光栅化为纹理
defineOptions({ name: 'TurnItem' })
</script>

<template>
  <slot />
</template>
