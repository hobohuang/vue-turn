# vue-turn

基于 Three.js 的 Vue 3 书本翻页组件：真实纸张卷曲形变、双页跨页布局、封面/封底开合动画。页面内容以普通 HTML 编写，运行时离屏光栅化为纹理贴到可形变网格上。

## 安装

```sh
cnpm install vue-turn three
```

`vue` 与 `three` 为 peerDependencies。

## 快速开始

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { VueTurn, TurnItem } from 'vue-turn'

const page = ref(1)
</script>

<template>
  <VueTurn v-model="page">
    <TurnItem>封面内容</TurnItem>
    <TurnItem>第 1 页内容</TurnItem>
    <TurnItem>第 2 页内容</TurnItem>
    <TurnItem>封底内容</TurnItem>
  </VueTurn>
</template>
```

组件容器宽高为 100%，需要父级提供确定高度。

## Props

| Prop | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `modelValue` | `number` | - | 当前页码（从 1 开始），支持 v-model |
| `pageAspect` | `number` | `0.75` | 页面宽高比（宽/高） |
| `flipDuration` | `number` | `900` | 翻页动画时长（毫秒） |
| `startPage` | `number` | `1` | 初始页码（未提供 modelValue 时生效） |
| `nPolygons` | `number` | `64` | 翻页网格纵向分段数 |
| `perspective` | `number` | `2400` | 透视参考距离（像素） |
| `ambient` | `number` | `1` | 环境光强度 |
| `gloss` | `number` | `0.35` | 方向光强度 |
| `curl` | `number` | `0.8` | 卷曲幅度（0 为纯刚体旋转） |
| `forwardDirection` | `'left' \| 'right'` | `'left'` | 前进方向 |
| `displayedPages` | `'auto' \| 1 \| 2` | `'auto'` | 显示模式：auto 按容器宽高判定 |
| `pageWidth` | `number` | `768` | 离屏光栅化宽度（像素） |
| `pixelRatio` | `number` | `1` | 光栅化像素比 |
| `pageBackground` | `string` | `'#ffffff'` | 页面底色 |
| `fitMargin` | `number` | `1.12` | 相机适配边距（视口外扩比例） |
| `maxPixelRatio` | `number` | `2` | 渲染像素比上限 |
| `easing` | `(t: number) => number` | easeInOutCubic | 翻页进度缓动函数 |
| `clickToFlip` | `boolean` | `true` | 点击视口翻页（右半前进、左半后退） |
| `keyboard` | `boolean` | `true` | 方向键翻页（需先聚焦组件） |
| `ariaLabel` | `string` | `'翻书'` | 无障碍标签 |

## Events

| 事件 | 参数 | 说明 |
| --- | --- | --- |
| `update:modelValue` | `page: number` | 页码变化（v-model） |
| `change` | `page: number` | 页码变化（翻页与跳转均触发） |
| `flip-start` | `direction` | 翻页开始 |
| `flip-end` | `direction` | 翻页结束 |
| `flip-left-start` / `flip-left-end` | - | 向左翻页开始/结束 |
| `flip-right-start` / `flip-right-end` | - | 向右翻页开始/结束 |
| `ready` | - | 首次纹理就绪 |

## 插槽

- 默认插槽：仅接受 `<TurnItem>`，每个 item 为一页。
- `#toolbar`：作用域插槽，提供 `page`、`numPages`、`isFlipping`、`canFlipLeft`、`canFlipRight`、`flipLeft`、`flipRight`、`next`、`prev`、`goToPage`、`refresh`。
- `#fallback`：WebGL 不可用时的降级内容。

## 实例方法

通过模板引用调用：`flipLeft()`、`flipRight()`、`next()`、`prev()`、`goToPage(page)`、`refresh()`；只读属性：`page`、`numPages`、`isFlipping`。

`refresh()` 手动重绘全部页面纹理，适用于内容含异步资源、需要在资源就绪后刷新的场景。

## 已知限制

- 页面内容被光栅化为纹理，页内按钮/链接不可交互；交互请放在 `#toolbar` 插槽或组件外部。
- 双页模式下建议总页数为偶数（封面 + 正文 + 封底），封底居中逻辑依赖该约定。
- 不支持竖排书与页面缩放。

## 本地开发

```sh
cnpm install
cnpm run dev          # 开发服务器
cnpm run test:unit    # 单元测试
cnpm run type-check   # 类型检查
cnpm run lint         # Lint
cnpm run build:lib    # 构建可分发组件包（dist/）
```
