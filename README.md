# vue-turn

基于 Three.js 的 Vue 3 书本翻页组件：真实纸张卷曲形变、双页跨页布局、封面/封底开合动画、拖拽翻页、折角提示、缩放视口与页面热区。页面内容以普通 HTML 编写，运行时离屏光栅化为纹理贴到可形变网格上。

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
| `clickToFlip` | `boolean` | `true` | 点击视口翻页（跟随阅读方向：LTR 右半前进、左半后退；RTL 相反） |
| `clickDeadZone` | `number` | `0` | 点击翻页中间死区宽度占比（0~0.5）：视口中轴该比例区域内的点击不翻页 |
| `keyboard` | `boolean` | `true` | 键盘翻页：方向键 / PageUp / PageDown / Space / Home / End（需先聚焦组件；方向键跟随阅读方向） |
| `ariaLabel` | `string` | `'翻书'` | 视口无障碍标签 |
| `cacheBust` | `boolean` | `true` | 光栅化时是否给图片加破缓存参数，避免拿到旧图 |
| `prefetchWindow` | `number` | `4` | 懒光栅化预取窗口：当前可见页前后各 N 页预生成纹理，窗口外释放（设为 0 关闭懒加载，全量光栅化） |
| `resourceTimeout` | `number` | `5000` | 光栅化前资源等待超时（毫秒）：等待 `<img>`、CSS background-image、文档字体；超时后放弃等待直接光栅化 |
| `dragToFlip` | `boolean` | `true` | 拖拽翻页：按住页面拖动，松手按拖动距离/甩动速度决定完成或回弹 |
| `peel` | `boolean` | `true` | 悬停折角提示：指针移入页面边缘条带时掀起页角 |
| `peelZone` | `number` | `0.12` | 折角提示区域宽度占视口宽度的比例（两侧边缘条带，0~0.5） |
| `maxZoom` | `number` | `3` | 最大缩放倍数 |
| `zoomEnabled` | `boolean` | `false` | 是否允许滚轮缩放（滚轮按指数步进调节级别） |
| `dblClickZoom` | `boolean` | `false` | 是否允许双击切换缩放（开启后单击翻页延迟约 260ms 以区分双击） |
| `stack` | `boolean` | `true` | 是否显示书本左右两侧的纸叠（页层厚度条带，厚度随翻页在两侧间转移，可悬停/点击跳页；平躺的封面/封底不计入层数） |
| `stackDepth` | `number` | `0.02` | 纸叠最大厚度占单页宽度的比例（0~0.5） |

## Events

| 事件 | 参数 | 说明 |
| --- | --- | --- |
| `update:modelValue` | `page: number` | 页码变化（v-model） |
| `change` | `page: number` | 页码变化（翻页与跳转均触发） |
| `flip-start` | `direction: 'left' \| 'right'` | 翻页开始（含拖拽翻页按下） |
| `flip-end` | `direction: 'left' \| 'right'` | 翻页结束（拖拽回弹取消也会触发，页码不变） |
| `before-flip` | `context: BeforeFlipContext` | 翻页/跳转前拦截：`context` 含 `from`/`to`/`direction`（直接跳转为 `null`），调用 `context.preventDefault()` 取消本次导航 |
| `first` | - | 翻到第一页（挂载初始页不触发） |
| `last` | - | 翻到最后一页（挂载初始页不触发） |
| `pressed` | `point: { x, y }` | 拖拽翻页按下（视口内坐标） |
| `released` | `point: { x, y }` | 拖拽翻页松开（视口内坐标） |
| `zoom-change` | `level: number` | 缩放级别变化（1 为未缩放） |
| `region-tap` | `page: number, region: PageRegion` | 点击命中页面热区（`page` 从 1 开始；命中热区不触发翻页） |
| `ready` | - | 首次纹理就绪 |
| `rasterize-error` | `page: number, error: unknown` | 单页光栅化失败（页码从 1 开始）；失败页不影响其他页 |
| `stack-hover` | `page: number \| null, point?: { x, y }` | 悬停纸叠层（`page` 从 1 开始，`null` 表示离开）；仅在命中页变化时触发，`point` 为视口内坐标 |
| `stack-tap` | `page: number` | 点击纸叠层跳转（跳转自动对齐到所属跨页，`page` 从 1 开始） |

## 插槽

- 默认插槽：仅接受 `<TurnItem>`，每个 item 为一页；其他节点会被忽略并告警。
- `#fallback`：WebGL 不可用时的降级内容。

> 工具栏已外置：组件不再提供 `#toolbar` 插槽，请通过实例方法与事件在组件外部自定义工具栏（见下方示例）。

## 跨页大图（spread）

`<TurnItem>` 支持 `spread` 属性，标记该页内容横跨整个跨页（如折页地图、跨页大图）：

```vue
<VueTurn v-model="page">
  <TurnItem>封面</TurnItem>
  <TurnItem>第 1 页</TurnItem>
  <TurnItem spread>跨页大图：内容按双倍宽度光栅化，摊开时整页居中显示</TurnItem>
  <TurnItem>后续页面</TurnItem>
</VueTurn>
```

规则与行为：

- 跨页项在页索引空间中占用 2 页（起始页 + 后半页），整页内容按双倍宽度光栅化为一张纹理；摊开静止时以一张双倍宽度页面居中渲染，翻页时左右两半各自参与常规翻页动画（半图共享整图 GPU 数据，无额外显存开销）。
- 跨页项需从左页（奇数索引）开始；若前面的普通页数使其落在偶数索引，会自动插入一张空白页补位。
- 单页显示模式（`displayedPages: 1`）下跨页只显示左半。
- 首个 `<TurnItem>` 固定为封面（单页居中），其 `spread` 标记不生效。
- `numPages`、`v-model`、`goToPage` 均按映射后的页索引空间计。

## 硬页（纸板页）

`<TurnItem>` 支持 `hard` 属性，标记该页为硬页（如封面/封底）：整页刚体翻转，无卷曲形变，观感如纸板书封。纸张正反两面任一为硬页即按硬页翻转。

```vue
<turn-item hard>
  <div class="cover">封面</div>
</turn-item>
```

## 拖拽翻页与折角提示

- **拖拽翻页**（`dragToFlip`，默认开启）：按住页面拖动即可跟手翻页——LTR 右半区向前、左半区向后（RTL 相反）。松手时拖动超过约 45% 满程或朝翻页方向快速甩动即完成翻页，否则回弹取消；回弹同样触发 `flip-end`（页码不变）。按下/松开分别触发 `pressed`/`released` 事件，拖拽开始同样受 `before-flip` 拦截。
- **折角提示**（`peel`，默认开启）：指针悬停到页面边缘条带（宽度由 `peelZone` 控制）时掀起页角，提示可拖动翻页；此时按下可直接接管拖拽。

拖拽满程为视口宽度的 60%，配合点击翻页、键盘翻页互不冲突（拖拽位移超过阈值后自动吞掉随后的点击）。

## 缩放视口

通过实例方法缩放：`zoomIn()`（放大到 `maxZoom`）、`zoomOut()`（复位）、`toggleZoom()`、`setZoom(level)`（钳制到 `[1, maxZoom]`）；实例 `zoom` getter 读取当前级别，级别变化触发 `zoom-change` 事件。

- 开启 `zoomEnabled` 后支持滚轮缩放；开启 `dblClickZoom` 后双击切换缩放（单击翻页延迟约 260ms 判定）。
- 放大后按住拖动为平移查看，平移范围自动钳制不超出书本。
- 放大状态下点击不翻页（避免误触），但仍可命中页面热区。
- 翻页时相机自动复位，缩放随之归 1（若此前处于放大状态会额外触发一次 `zoom-change` 为 1）。

## 纸叠（stack）

开启 `stack`（默认开启）后，书本左右两侧显示贴在可见页面外缘的页层厚度条带，直观呈现剩余阅读量：

- **厚度随翻页转移**：已读页堆在一侧、剩余页在另一侧（跟随 `forwardDirection` 镜像），翻页动画期间两侧厚度平滑过渡。
- **封面/封底**：合书状态（封面/封底朝上）纸叠为除封面外的整本书；打开封面时纸叠贴合书体滑动，厚度从满厚渐隐到开书状态。平躺显示的封面/封底已作为页面渲染，不计入纸叠层数。
- **悬停与跳页**：悬停到条带上高亮对应页层并显示页码标签，点击跳转到该页（自动对齐到所属跨页）；触发 `stack-hover` / `stack-tap` 事件。层过薄时高亮条带保证最小可见宽度。
- **超多页/无限书页**：厚度按 `min(总页数, 100)` 归一后封顶到 `stackDepth × 单页宽`，条带不会随页数无限增长；悬停页码按比例映射，与厚度解耦。
- 单页显示模式（`displayedPages=1`）下条带贴合半页宽外缘，同样生效。
- 翻页中、禁用状态或 WebGL 不可用时不响应悬停/点击。

## 页面热区（regions）

页面内容光栅化为纹理后，页内 DOM 无法交互。`<TurnItem>` 的 `regions` 属性声明占整页比例的可点击区域，点击命中后触发 `region-tap` 事件（返回命中的页码与原始 region 对象）：

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { VueTurn, TurnItem, type PageRegion, type TurnInstance } from 'vue-turn'

const turnRef = ref<TurnInstance | null>(null)
const toc: PageRegion[] = [
  { x: 0.08, y: 0.66, w: 0.24, h: 0.14, data: 1 },
  { x: 0.38, y: 0.66, w: 0.24, h: 0.14, data: 5 },
]

function onRegionTap(_page: number, region: PageRegion) {
  turnRef.value?.goToPage(Number(region.data))
}
</script>

<template>
  <VueTurn ref="turnRef" @region-tap="onRegionTap">
    <turn-item :regions="toc">
      <div class="toc-page">
        <!-- 内容布局与 regions 坐标一一对应，例如绝对定位 left:8%; top:66%; width:24%; height:14% -->
      </div>
    </turn-item>
    <!-- ... -->
  </VueTurn>
</template>
```

规则与行为：

- 坐标以 `TurnItem` 内容的左上角为原点，`x/y/w/h` 均为占整页的比例（0~1）；`data` 为自定义数据，随事件原样返回。
- 跨页项的 regions 相对整个跨页内容定义（半页命中会自动换算到整页坐标）。
- 命中热区的点击不触发翻页；未命中则正常按点击翻页处理。
- 热区命中依赖射线拾取，在放大状态下同样有效。

## 奇数总页数的自动补页

封底合上动画依赖末页索引为奇数（即总页数为偶数）。当映射后的总页数为奇数时，组件自动补一张空白页：

- **末项为普通页**：空白页补在末项之前——你的封底仍落在最后一个索引，空白页作为衬页与倒数第二页组成跨页（与真实书籍一致）。
- **末项为跨页**：空白页补在书末（补在跨页前会破坏其奇数起始对齐）。

`numPages` 计入自动补的空白页。仅 1 页的书（只有封面）不补。

## 实例方法

通过模板引用调用：

| 方法/属性 | 签名 | 说明 |
| --- | --- | --- |
| `flipLeft` | `() => void` | 向左翻页 |
| `flipRight` | `() => void` | 向右翻页 |
| `next` | `() => void` | 前进一页 |
| `prev` | `() => void` | 后退一页 |
| `goToPage` | `(page: number) => boolean` | 跳转到指定页（从 1 开始）；翻页中或页码越界时拒绝并返回 `false`（受 `before-flip` 拦截时同样返回 `false`） |
| `stop` | `() => void` | 中断当前翻页并立即收尾：翻页动画按终点提交，拖拽按最近端点完成或取消 |
| `disable` | `(disabled?: boolean) => void` | 禁用（不传参默认 `true`）/启用翻页与所有交互 |
| `refresh` | `() => Promise<void>` | 重绘全部页面纹理 |
| `refreshPage` | `(page: number) => Promise<void>` | 重绘指定页纹理（页码从 1 开始） |
| `zoomIn` | `() => void` | 放大到最大倍数 |
| `zoomOut` | `() => void` | 复位到 1 倍 |
| `toggleZoom` | `() => void` | 在 1 倍与最大倍数间切换 |
| `setZoom` | `(level: number) => void` | 设置缩放级别（钳制到 `[1, maxZoom]`） |
| `page` | `number`（只读） | 当前页码 |
| `numPages` | `number`（只读） | 总页数 |
| `isFlipping` | `boolean`（只读） | 是否翻页中 |
| `canNext` | `boolean`（只读） | 是否可前进 |
| `canPrev` | `boolean`（只读） | 是否可后退 |
| `disabled` | `boolean`（只读） | 是否处于禁用状态 |
| `zoom` | `number`（只读） | 当前缩放级别（1 为未缩放） |

### 外置工具栏示例

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'
import { VueTurn, TurnItem, type TurnInstance } from 'vue-turn'

const turnRef = ref<TurnInstance | null>(null)
const page = ref(1)
const total = ref(10)
const flipping = ref(false)

const canNext = computed(() => (flipping.value ? false : turnRef.value?.canNext ?? false))
const canPrev = computed(() => (flipping.value ? false : turnRef.value?.canPrev ?? false))
</script>

<template>
  <VueTurn
    ref="turnRef"
    v-model="page"
    @flip-start="flipping = true"
    @flip-end="flipping = false"
    @ready="total = turnRef?.numPages ?? total"
  >
    <TurnItem>封面</TurnItem>
    <TurnItem>第 1 页</TurnItem>
    <!-- ... -->
    <TurnItem>封底</TurnItem>
  </VueTurn>

  <div class="toolbar">
    <button :disabled="!canPrev" @click="turnRef?.prev()">上一页</button>
    <span>{{ page }} / {{ total }}</span>
    <button :disabled="!canNext" @click="turnRef?.next()">下一页</button>
  </div>
</template>
```

> `canNext` / `canPrev` 是实例 getter，非响应式；翻页/`change`/`ready` 等事件触发后需让外部组件重渲（如上例通过 `flipping` 等 ref 驱动 computed）。

## 已知限制

- 页面内容被光栅化为纹理，页内按钮/链接不可交互；页内交互请使用页面热区（`regions` + `region-tap`），或放在组件外部（工具栏等）。
- 双页模式下建议总页数为偶数（封面 + 正文 + 封底），封底居中逻辑依赖该约定。
- 不支持竖排书。
- 拖拽翻页/折角提示仅覆盖视口桌面指针交互，不做移动端适配、国际化与无障碍扩展（仅保留基础 `role/aria-label/tabindex`）。

## 本地开发

```sh
cnpm install
cnpm run dev          # 开发服务器
cnpm run test:unit    # 单元测试
cnpm run type-check   # 类型检查
cnpm run lint         # Lint
cnpm run build:lib    # 构建可分发组件包（dist/）
```
