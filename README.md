# vue-turnbook

基于 Three.js 的 Vue 3 书本翻页组件：真实纸张卷曲形变、双页跨页布局、封面/封底开合动画、拖拽翻页、角点折角拖拽（turn.js 4 风格）、折角提示、缩放视口与页面热区。页面内容以普通 HTML 编写，运行时离屏光栅化为纹理贴到可形变网格上。

**在线演示**：<https://hobohuang.github.io/vue-turn/>（push 到 `main` 自动部署）

## 安装

```sh
npm install vue-turnbook three
# 或 pnpm add vue-turnbook three
```

`vue` 与 `three` 为 peerDependencies。组件结构样式独立打包，需在入口引入一次：

```ts
import 'vue-turnbook/dist/vue-turn.css'
```

## 快速开始

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { VueTurn, TurnItem } from 'vue-turnbook'

const page = ref(1)
</script>

<template>
  <VueTurn v-model="page">
    <TurnItem type="cover">封面内容</TurnItem>
    <TurnItem>第 1 页内容</TurnItem>
    <TurnItem>第 2 页内容</TurnItem>
    <TurnItem type="back-cover">封底内容</TurnItem>
  </VueTurn>
</template>
```

组件容器宽高为 100%，需要父级提供确定高度。

需要内容横跨封面与封底（书皮整图）时，用 `type="jacket"` 一项声明整张书皮，内容按双倍宽度光栅化：**右半 = 封面、左半 = 封底**：

```vue
<template>
  <VueTurn v-model="page">
    <TurnItem type="jacket">
      <!-- 双倍宽度内容：flex 两半各自撑满一页 -->
      <div class="jacket">
        <div class="jacket-half jacket-back">封底半区</div>
        <div class="jacket-half jacket-front">封面半区</div>
      </div>
    </TurnItem>
    <TurnItem>第 1 页内容</TurnItem>
    <TurnItem>第 2 页内容</TurnItem>
  </VueTurn>
</template>
```

## Attributes（vue-turn 属性）

| # | Prop | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| 1 | `modelValue` | `number` | - | 当前页码（从 1 开始），支持 v-model |
| 2 | `preset` | `'soft' \| 'hard' \| 'custom'` | `'soft'` | 内页纸张类型：soft 普通纸张哑光（可卷曲/折角）、hard 纸板刚体强光泽、custom 自定义；为专业参数提供成组基线，`look` 可逐项覆盖（详见下文「观感预设」） |
| 3 | `coverPreset` | `'soft' \| 'hard' \| 'custom'` | `'hard'` | 封面/封底纸张类型：控制封面纸张的卷曲、折页/折角开关与折缝、网格密度与光影（独立灯光组照亮）；`coverLook` 可逐项覆盖（详见下文「封面与封底」） |
| 4 | `look` | `LookOptions` | - | 内页观感与折页参数，逐项覆盖 `preset` 基线：`nPolygons`（网格分段，回退 64）、`perspective`（透视参考距离，回退 2400，**全局相机参数**）、`ambient`（环境光，回退 1）、`gloss`（方向光，回退 0.15）、`curl`（卷曲幅度，0 为刚体，回退 0.8）、`fold`（折页变形开关，soft 开 / hard 关）、`bend`（折缝圆角占页宽比例，回退 0.04）。挂载时冻结 |
| 5 | `coverLook` | `LookOptions` | - | 封面/封底观感与折页参数，逐项覆盖 `coverPreset` 基线，未传项回退 `look`（`perspective` 为全局参数在此无效）。挂载时冻结 |
| 6 | `pageAspect` | `number` | `0.75` | 页面宽高比（宽/高），非法值（NaN/零/负数）回退 0.75；常见图书尺寸参考下文「常见图书宽高比」 |
| 7 | `flipDuration` | `number` | `900` | 翻页动画时长（毫秒），下限 500：更小的取值按 500 生效（回弹/收尾等派生动画同步受此下限约束） |
| 8 | `forwardDirection` | `'left' \| 'right'` | `'left'` | 阅读方向（决定往哪边翻算下一页）：`'left'` 左翻书（页码自左向右递增），`'right'` 右翻书（整体镜像）；运行时可改，详见下文「阅读方向」 |
| 9 | `displayedPages` | `'auto' \| 1 \| 2` | `'auto'` | 一次摊开显示几页：`auto` 按容器宽高判定（宽 > 高取 2），`1`/`2` 为强制值；双页以跨页为单位翻页（页码 ±2），单页逐页翻（±1），详见下文「显示模式」 |
| 10 | `pageWidth` | `number` | `768` | 离屏光栅化宽度（像素） |
| 11 | `pixelRatio` | `number` | `1` | 纹理采样倍率（1~2 足够，见下文「分辨率与取景」） |
| 12 | `fitMargin` | `number` | `1.12` | 相机适配边距（视口外扩比例） |
| 13 | `clickToFlip` | `boolean` | `true` | 点击视口翻页（跟随阅读方向：LTR 右半前进、左半后退；RTL 相反） |
| 14 | `clickDeadZone` | `number` | `0` | 点击翻页的中轴死区，**单位为占视口总宽度的比例**（无单位小数，钳制 0~0.5）：以视口中轴为中心、总带宽 = 值 × 视口宽度的竖向条带内，点击不触发翻页（`0.2` = 中央 20% 宽度）。典型用途：双页模式下书脊位于视口中轴，避免点击书缝误翻。仅拦点击翻页——中轴处的页面热区点击与纸叠跳页照常生效，拖拽/键盘/实例方法不受影响；`0.5` 时点击翻页整体失效 |
| 15 | `keyboard` | `'off' \| 'focus' \| 'global'` | `'focus'` | 键盘翻页模式：`focus` 聚焦视口后响应方向键 / PageUp / PageDown / Space / Home / End（方向键跟随阅读方向，**需先聚焦组件**，点击书页或 Tab 聚焦视口）；`global` 追加 document 级兜底——焦点不在组件内（如点击了外部工具栏按钮）时也响应，会在 document 级拦截方向键/空格等按键（影响宿主页面的键盘滚动），按钮/链接/输入框等可交互元素内的按键不劫持，多实例时仅最近交互过的实例响应，仅在确有需求时开启；`off` 关闭 |
| 16 | `cacheBust` | `boolean` | `true` | 手动重绘（`refresh`/`refreshPage`）时是否给图片加破缓存参数，避免拿到旧图；懒光栅化与 DOM 变化触发的自动光栅化不破缓存（详见下文「cacheBust 使用场景」） |
| 17 | `prefetchWindow` | `number` | `4` | 懒光栅化预取窗口：当前可见页前后各 N 页预生成纹理，窗口外释放（设为 0 关闭懒加载，全量光栅化） |
| 18 | `resourceTimeout` | `number` | `5000` | 光栅化前资源等待超时（毫秒）：等待 `<img>`、CSS background-image、文档字体；超时后放弃等待直接光栅化 |
| 19 | `dragToFlip` | `boolean` | `true` | 拖拽翻页：按住页面拖动，松手按拖动距离/甩动速度决定完成或回弹 |
| 20 | `peel` | `boolean` | `false` | 悬停预览总开关：开启后显示悬停预览——`fold` 开启时为四角折角预览（仅页面四角区域），关闭时为视口边缘条带整页轻卷（详见下文「拖拽翻页与折角交互」） |
| 21 | `maxZoom` | `number` | `3` | 最大缩放倍数（响应式：运行中修改即生效，当前级别超出新上限时立即收敛） |
| 22 | `zoomMode` | `'off' \| 'wheel' \| 'dblclick' \| 'both'` | `'off'` | 允许哪些**手势**触发缩放：`wheel` 滚轮按指数步进调级别、`dblclick` 双击在 1 倍与 `maxZoom` 间切换（含 `dblclick` 时单击翻页会延迟约 260ms 以区分双击）、`both` 两种都要、`off` 关闭。实例方法 `zoomIn`/`setZoom` 等不受此开关限制 |
| 23 | `stack` | `boolean` | `true` | 是否显示书本左右两侧的纸叠（页层厚度条带，厚度随翻页在两侧间转移，可悬停/点击跳页；平躺的封面/封底不计入层数） |
| 24 | `spineShadow` | `boolean` | `true` | 书脊内阴影：所有书页靠书脊一侧模仿真实书页的"缝谷"光影（深色缝芯 + 长尾缓降 + 外缘微暗），强度/宽度随书页数量缩放且封顶（默认开启，`false` 关闭）。长在纸面上、跟随卷曲/折页形变；单双页与阅读方向自动定侧（详见下文「书脊阴影（spineShadow）」）。挂载时冻结 |

## TurnItem Attributes（turn-item 属性）

`<TurnItem>` 支持 3 个属性，均为静态声明；各自的行为细节见对应章节。

| # | 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| 1 | `spread` | `boolean` | `false` | 跨页项：内容横跨左右两页，按双倍宽度光栅化；未对齐到左页起始时自动补空白页（见「跨页大图（spread）」） |
| 2 | `regions` | `PageRegion[]` | `[]` | 页面热区：坐标与尺寸为占整页比例（0~1，左上角原点），点击命中触发 `region-tap` 事件（见「页面热区（regions）」） |
| 3 | `type` | `'cover' \| 'back-cover' \| 'jacket'` | - | 类型标注：`cover` 封面 / `back-cover` 封底（各独占一张专用纸张，按 `coverPreset` + `coverLook` 观感渲染，见「封面与封底」）；`jacket` 跨页封皮（一项声明整张书皮，右半 = 封面、左半 = 封底，见「跨页封皮（jacket）」）。声明位置不限，未声明为普通内容页 |

## Slots（插槽）

**`<vue-turn>` 插槽**

| # | 插槽 | 说明 |
| --- | --- | --- |
| 1 | `default` | 页面内容，仅接受 `<TurnItem>`，其他节点会被忽略并告警。封面/封底各自独占一张专用纸张（见「封面与封底」） |
| 2 | `#fallback` | WebGL 不可用时的降级内容 |

**`<turn-item>` 插槽**

| # | 插槽 | 说明 |
| --- | --- | --- |
| 1 | `default` | 该页内容（按页面类型展开为封面正/封底正/内页） |

> 工具栏已外置：组件不再提供 `#toolbar` 插槽，请通过实例方法与事件在组件外部自定义工具栏（见下方示例）。

## Exposes（实例 API）

通过模板引用调用：

| # | 方法/属性 | 签名 | 说明 |
| --- | --- | --- | --- |
| 1 | `flipLeft` | `() => void` | 向左翻页 |
| 2 | `flipRight` | `() => void` | 向右翻页 |
| 3 | `next` | `() => void` | 前进一页 |
| 4 | `prev` | `() => void` | 后退一页 |
| 5 | `goToPage` | `(page: number) => boolean` | 跳转到指定页（从 1 开始）；翻页中或页码越界时拒绝并返回 `false`（受 `before-flip` 拦截时同样返回 `false`） |
| 6 | `stop` | `() => void` | 中断当前翻页并立即收尾：翻页动画按终点提交，拖拽按最近端点完成或取消 |
| 7 | `disable` | `(disabled?: boolean) => void` | 禁用（不传参默认 `true`）/启用翻页与所有交互 |
| 8 | `refresh` | `() => Promise<void>` | 重绘全部页面纹理 |
| 9 | `refreshPage` | `(page: number) => Promise<void>` | 重绘指定页纹理（页码从 1 开始） |
| 10 | `zoomIn` | `() => void` | 放大到最大倍数 |
| 11 | `zoomOut` | `() => void` | 复位到 1 倍 |
| 12 | `toggleZoom` | `() => void` | 在 1 倍与最大倍数间切换 |
| 13 | `setZoom` | `(level: number) => void` | 设置缩放级别（钳制到 `[1, maxZoom]`） |
| 14 | `state` | `TurnState`（只读响应式） | 响应式状态快照：`page` / `numPages` / `isFlipping` / `canNext` / `canPrev` / `disabled` / `displayedPages`（当前实际显示模式 1/2）/ `zoom`。在模板或 computed 中读取自动跟踪更新（推荐用此而非下方逐个只读属性） |
| 15 | `page` | `number`（只读） | 当前页码 |
| 16 | `numPages` | `number`（只读） | 总页数 |
| 17 | `isFlipping` | `boolean`（只读） | 是否翻页中 |
| 18 | `canNext` | `boolean`（只读） | 是否可前进 |
| 19 | `canPrev` | `boolean`（只读） | 是否可后退 |
| 20 | `disabled` | `boolean`（只读） | 是否处于禁用状态 |
| 21 | `zoom` | `number`（只读） | 当前缩放级别（1 为未缩放） |

### 外置工具栏示例

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'
import { VueTurn, TurnItem, type TurnInstance } from 'vue-turnbook'

const turnRef = ref<TurnInstance | null>(null)
const page = ref(1)

// 响应式状态：指示器/按钮状态全部自动跟踪，无需事件回调强刷
const state = computed(() => turnRef.value?.state)
</script>

<template>
  <VueTurn ref="turnRef" v-model="page">
    <TurnItem>封面</TurnItem>
    <TurnItem>第 1 页</TurnItem>
    <!-- ... -->
    <TurnItem>封底</TurnItem>
  </VueTurn>

  <div class="toolbar">
    <button :disabled="!state?.canPrev" @click="turnRef?.prev()">上一页</button>
    <span>{{ state?.page ?? page }} / {{ state?.numPages ?? '…' }}</span>
    <button :disabled="!state?.canNext" @click="turnRef?.next()">下一页</button>
  </div>
</template>
```

## Events（事件）

| # | 事件 | 参数 | 说明 |
| --- | --- | --- | --- |
| 1 | `update:modelValue` | `page: number` | 页码变化（v-model） |
| 2 | `change` | `page: number` | 页码变化（翻页与跳转均触发） |
| 3 | `flip-start` | `direction: 'left' \| 'right'` | 翻页开始（含拖拽翻页按下） |
| 4 | `flip-end` | `direction: 'left' \| 'right'` | 翻页结束（拖拽回弹取消也会触发，页码不变） |
| 5 | `before-flip` | `context: BeforeFlipContext` | 翻页/跳转前拦截：`context` 含 `from`/`to`/`direction`（直接跳转为 `null`），调用 `context.preventDefault()` 取消本次导航；外部修改 `v-model` 同样受拦截，取消时页码回写为当前页 |
| 6 | `first` | - | 翻到第一页（挂载初始页不触发） |
| 7 | `last` | - | 翻到最后一页（挂载初始页不触发） |
| 8 | `pressed` | `point: { x, y }` | 拖拽翻页按下（视口内坐标） |
| 9 | `released` | `point: { x, y }` | 拖拽翻页松开（视口内坐标） |
| 10 | `zoom-change` | `level: number` | 缩放级别变化（1 为未缩放） |
| 11 | `region-tap` | `page: number, region: PageRegion` | 点击命中页面热区（`page` 从 1 开始；命中热区不触发翻页） |
| 12 | `ready` | - | 首次纹理就绪 |
| 13 | `rasterize-error` | `page: number, error: unknown` | 单页光栅化失败（页码从 1 开始）；失败页不影响其他页 |
| 14 | `stack-hover` | `page: number \| null, point?: { x, y }` | 悬停纸叠层（`page` 从 1 开始，`null` 表示离开）；仅在命中页变化时触发，`point` 为视口内坐标 |
| 15 | `stack-tap` | `page: number` | 点击纸叠层跳转（跳转自动对齐到所属跨页，`page` 从 1 开始） |

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
- 跨页项需从左页（奇数索引）开始；若落在偶数索引，会自动插入一张空白页补位。空白页没有 DOM 内容，以统一纸色纯色渲染（避免落为白色与内容页纸色形成色差）。
- 单页显示模式（`displayedPages: 1`）一页只有一面：内页跨页项自动忽略（不占页并打印控制台警告），也不自动插入空白页——封面/封底纸张的背面一律不占页（单页翻页背面恒为空白，没有显示机会），页数与双页模式不同（见「显示模式」）。
- 首个内容面兜底为封面（单页居中），其 `spread` 标记不生效（跨页封面请用 `type="jacket"`）；封面/封底专用纸张各带一张固定空白背面页，内容页从页索引 2 开始。
- 内页区段（不含封面纸/封底纸）计数为奇数时，在封底纸张之前自动补一张空白页保证总页数为偶数。
- `numPages`、`v-model`、`goToPage` 均按映射后的页索引空间计（含空白页）。

## 封面与封底（type="cover" / type="back-cover"）

封面与封底通过 `<TurnItem>` 的 `type` 属性声明（未声明时按位置约定兜底：首个内容面为封面、末个内容面为封底）。它们各自**独占一张专用纸张**：正面为 item 内容，背面为固定空白纸页。观感由组件级 `coverPreset` 单独控制（默认 `'hard'`，纸板刚体翻转），与内页的 `preset` 互不干扰——正因为封面/封底独占纸张，一张纸的正反两面不会出现内页与封面纸张类型冲突：

```vue
<VueTurn preset="soft" coverPreset="hard">
  <TurnItem type="cover">封面（hard 档纸板刚体强光泽）</TurnItem>
  <TurnItem>内页（soft 档哑光卷曲）</TurnItem>
  <TurnItem type="back-cover">封底（hard 档）</TurnItem>
</VueTurn>
```

规则与行为：

- **专用纸张**：封面纸张 = 封面（正）+ 空白背面，封底纸张 = 空白正面 + 封底（外侧）；背面页计入页数。组件不再提供衬页（封面底/封底里）内容声明——需要这些位置有内容时，在封面/封底纸张后的对应位置**自行添加普通页**（普通内页纸张观感、占内页页码）。
- **声明约束**：`type` 按面种类分拣归位、与声明位置无关；同一类型只能声明一次，`jacket` 不能与 `cover` / `back-cover` 混用，非法枚举值同样无效——违反时 `console.error` 并**整本书拒绝渲染**。两者都未声明时按位置约定兜底（首个内容面为封面、末个内容面为封底，背面空白）。
- **生效范围**：卷曲（curl）、折页开关与折缝（fold/bend）、网格密度（nPolygons）与光影（ambient/gloss，由封面专属灯光组照亮，与内页灯光独立）；`perspective` 为全局相机参数，只读 `look.perspective`。折页开关也按封面档判定意味着：`coverPreset="hard"`（默认）时封面**不响应**角点折角拖拽与角区悬停折角预览（纸板不折角），`coverPreset="soft"` 时封面与内页完全一致地支持折角/折页。
- **翻页规则**：封面/封底纸张正反两面均为封面档渲染，整张按封面档翻转——默认 `hard` 为刚体旋转（零卷曲、无折缝），`soft` 按普通纸张卷曲/折页；翻页中封面灯光组与内页灯光组按面独立照亮。
- **软封面**：杂志/画册类软封面传 `coverPreset="soft"`，封面即按普通纸张卷曲，并同样支持角点折角拖拽与角区悬停折角预览。
- **整本纸板书**：`preset="hard"` 让全部内页也刚体翻转（此时折角自动关闭）。
- `coverPreset` 取档位基线；`coverLook` 逐项覆盖（未传项回退 `look`，可实现封面与内页观感一致或各自独立）。非法值回退 soft 并 `console.warn`。挂载时读取一次，运行中切换不热更新。

## 跨页封皮（jacket）

`type="jacket"` 用一项声明整张书皮：内容按双倍宽度光栅化（与内页跨页同一套半图管线），**右半 = 封面、左半 = 封底**——合书时看到右半封面，从背后看（翻到最后一页的纸张外侧）是左半封底：

```vue
<VueTurn v-model="page" cover-preset="hard">
  <TurnItem type="jacket">
    <div class="jacket">
      <div class="jacket-half jacket-back">封底半区（左半）</div>
      <div class="jacket-half jacket-front">封面半区（右半）</div>
    </div>
  </TurnItem>
  <TurnItem>内页</TurnItem>
</VueTurn>
```

规则与行为：

- **半区由内容的左右位置决定**：管线固定把双倍宽度内容切分为「右半 = 封面、左半 = 封底」，与 DOM 声明顺序无关——想让某块内容显示在封面上，就把它放进 jacket 内容的**右半**（如 flex 行的右侧），放在左半的内容显示为封底。上例两个半区对调后，封面/封底显示的内容随之对调。
- **两端同源**：封面页取 jacket 内容右半、封底页取左半，双页与单页模式一致（单页模式封面显示右半、封底显示左半，不会像内页跨页那样被忽略——书不能没有封面）；阅读方向（`forwardDirection`）镜像翻页方向，但不改变这一半图归属。
- **专用纸张观感不变**：封面/封底纸张仍按 `coverPreset` 渲染与翻页（含独立灯光组），封面背面/封底里侧仍为固定空白纸页（需要衬页内容自行加普通页）。
- **不参与跨页合并**：封面/封底恒为居中单页（slot center），不会像内页跨页那样左右合并渲染；摊开内页时书皮两半各自独立显示。
- **声明约束**：jacket 已同时供给封面与封底，与 `cover` / `back-cover` 混用、同类型重复声明、非法枚举值均 `console.error` 并整本书拒绝渲染。

## 书脊阴影（spineShadow）

`spineShadow`（默认开启）由组件在**所有书页**靠书脊一侧渲染模仿真实书页装订侧的"缝谷"光影：**深色缝芯 + 长尾缓降**（书页在装订侧拱起的曲面受光）+ **外缘微暗**（纸层堆叠）——摊开时左右两页在中缝两侧对称加深、合并跨页两外缘微暗、合书时封面/封底在书脊缘加深、单页模式在页缝侧加深。传 `:spine-shadow="false"` 关闭。

- **长在纸面上**：阴影在页面材质的着色器中按 UV 距书脊的距离计算并乘入漫反射色——跟随纸张的卷曲/折页顶点形变，翻页动画中随纸张一起运动（翻页纸张的书脊即铰点、自由边即外缘，无需方向信息）。
- **自动定侧**：双页模式左右页、合并跨页中线、合书封面/封底、单页模式页缝侧，以及 LTR/RTL 镜像，全部由组件按当前布局自动判定，宿主无需关心。
- **随书页数量缩放**：强度与渐变宽度乘以页数缩放系数（sqrt 曲线，参考页数 80）——书越厚缝谷越深越宽，**封顶 1**（即照片匹配的上限值）；薄书仍有可感知的缝谷。
- 强度/宽度常量不对外暴露配置；阴影为固定黑色系渐变，乘在内容颜色上（深浅由内容自定）。
- 挂载时冻结（与 `preset` 等观感参数同一策略），运行时修改不生效。
- 内容自绘的书脊方向渐变/内阴影可以删掉交给组件——同一位置叠加两份阴影会过深。

## 拖拽翻页与折角交互

- **拖拽翻页**（`dragToFlip`，默认开启）：按住页面拖动即可跟手翻页——LTR 右半区向前、左半区向后（RTL 相反）。松手时拖动超过约 45% 满程或朝翻页方向快速甩动即完成翻页，否则回弹取消；回弹同样触发 `flip-end`（页码不变）。按下/松开分别触发 `pressed`/`released` 事件，拖拽开始同样受 `before-flip` 拦截。
- **折页变形**（`look.fold`，soft 基线开启，turn.js 4 风格）：翻页交互的变形模式总开关。开启时按下页面**任意位置**均为折角变形拖拽，本质都是"拎起页面的一部分对折"——锚点与拖点自由度按命中区分两种：
  - **外角区**（距最近外角 22% 页宽的圆形区域，跨页按实际宽度折算）为**折角拖拽**：锚点取最近外角，斜折线，拖点纵向自由、页角跟手折起；
  - **其余位置**为**折页拖拽**：锚点取指针同高度的外页边缘点，竖直折线——拖点**钉在按下高度**，上下移动指针只改变对折进度、不改变折线方向，拎起的书页始终沿竖直折线对折翻页（等效普通翻页的进度/方向，但带折叠感，区别于普通拖拽的微曲卷绕）。
  - 折线由锚点与拖点实时计算；折缝为「窄圆弧圆角 + 翻起平面微翘约 4.6°」的组合，读作一条略带厚度的折痕（弧内高度单调升至翘面、无第二条平行折线），圆角弧长由 `bend` 控制。翻页进度推进时折缝圆角与微翘随进度压平，落页时纸摊平衔接静态布局。**书脊约束**：折线不会切入书脊边内侧（装订处的书页永不被翻折拉离书脊），折角拖拽斜拉过度时自动停在极限位。松手时进度超过约 45% 或快速甩动即完成翻页，否则收回展平。折前进侧的页等于向前翻页，折后退侧等于向后翻页。
  - **封面/封底（合书态居中单页）按封面档取形变方式**：`coverPreset="soft"` 时与内页完全一致，支持折角/折页拖拽与折页翻页动画——拎起封面一角为折角拖拽（封面只能向前翻开、封底只能向后翻回，外缘为可折侧），书体（静态页、纸叠、开合平移）随拖拽进度联动的方式与内页翻页一致，松手提交完成开合、回弹则收回合书态。`coverPreset="hard"`（默认）时封面为纸板档：角点不折角、悬停不折角预览，按下与主动翻页都是整张刚体翻转。
  - **主动翻页（点击翻页、`next`/`prev`）同样走折页动画**：锚点取外缘中部，竖直折线扫过整页完成翻页；渲染不可用时自动回退卷曲动画。**书页外（视口空白处）按下拖拽**也走折页拖拽（方向按视口半区判定，拖点钉在外缘中部高度）。所有翻页（含封面开合等布局切换）中书体（静态页、纸叠）随进度同步平移，拖拽与主动动画行为一致。关闭时（该纸张的档位为 `hard`，或 `look`/`coverLook` 中 `fold: false`）其交互与主动翻页回到整页卷曲模式——内页与封面/封底各按自己的档位判定，可以一张折页、另一张刚体。
- **悬停预览**（`peel`，默认关闭）：悬停预览总开关，与 `fold` 组合决定预览形态——
  - `peel` + `fold`（开启）：指针移入页面外角区域（与折角拖拽同款的圆形判定）时渐进掀起最近页角（真实折角预览，越靠近角点掀得越高，进入/离开平滑过渡）；边缘中部、顶/底边中部不触发任何悬停预览。
  - `peel` + `fold`（关闭）：指针悬停到视口边缘条带时整页轻微卷曲弯折——越靠近外缘翘得越高。
  - `peel` 关闭：无任何悬停预览（按下拖拽行为不受影响）。
  - 悬停仅预览页角，不改变纸叠布局；预览中按下可直接接管拖拽。

悬停判定优先级：纸叠条带 > 页面角区预览（`peel` 总控；`fold` 开启为四角折角，关闭为整页轻卷），互不冲突。翻页中、禁用状态或放大视口下不响应折角交互。拖拽满程为视口宽度的 60%，配合点击翻页、键盘翻页互不冲突（拖拽位移超过阈值后自动吞掉随后的点击）。

## 缩放视口

通过实例方法缩放：`zoomIn()`（放大到 `maxZoom`）、`zoomOut()`（复位）、`toggleZoom()`、`setZoom(level)`（钳制到 `[1, maxZoom]`）；实例 `zoom` getter 读取当前级别，级别变化触发 `zoom-change` 事件。

- 手势开关由 `zoomMode` 统一控制：`'wheel'` 只放开滚轮、`'dblclick'` 只放开双击、`'both'` 两者都放开、`'off'`（默认）两种手势都不响应（实例方法仍可缩放）。含 `dblclick` 时单击翻页会延迟约 260ms 判定，以区分双击。
- 放大后按住拖动为平移查看，平移范围自动钳制不超出书本。
- 放大状态下点击不翻页（避免误触），但仍可命中页面热区。
- 翻页时相机自动复位，缩放随之归 1（若此前处于放大状态会额外触发一次 `zoom-change` 为 1）。

## 纸叠（stack）

开启 `stack`（默认开启）后，书本左右两侧显示贴在可见页面外缘的页层厚度条带，直观呈现剩余阅读量：

- **厚度随翻页转移**：已读页堆在一侧、剩余页在另一侧（跟随 `forwardDirection` 镜像），翻页动画期间两侧厚度平滑过渡。
- **层理纹理**：条带渲染"暗缝 + 亮边"相间的页线层理，密度按层数映射（一层纸一条页线），并按屏幕密度抽稀保证每线至少约 2 像素可分辨；层数过多时混为整体灰调，与真实厚书书口一致。
- **梯形透视**：条带呈缓坡梯形——贴书内缘全高，外缘按约 1% 收窄，模拟近大远小的透视（远端纸层在视野中更短），左右两侧镜像对称。
- **合书压实**：封面/封底朝上（居中单页）时书页全部压紧叠放，条带按约 0.6 压实系数收窄；翻开状态的纸叠页边微张，保持蓬松厚度。
- **封面/封底**：合书状态（封面/封底朝上）纸叠为除封面外的整本书；打开封面时纸叠贴合书体滑动，厚度从满厚渐隐到开书状态。平躺显示的封面/封底已作为页面渲染，不计入纸叠层数。
- **悬停与跳页**：悬停到条带上高亮对应页层并显示页码标签，点击跳转到该页（自动对齐到所属跨页）；触发 `stack-hover` / `stack-tap` 事件。层过薄时高亮条带保证最小可见宽度。
- **超多页/无限书页**：厚度按 `min(总页数, 100)` 归一后封顶（最大厚度约为单页宽的 2%），条带不会随页数无限增长；悬停页码按比例映射，与厚度解耦。
- 单页显示模式（`displayedPages=1`）页缝固定在阅读方向一侧：条带只出现在缝对侧（未读页堆叠，贴合半页宽外缘），缝侧无纸叠；厚度随阅读进度递减。
- 翻页中、禁用状态或 WebGL 不可用时不响应悬停/点击。

## 页面热区（regions）

页面内容光栅化为纹理后，页内 DOM 无法交互。`<TurnItem>` 的 `regions` 属性声明占整页比例的可点击区域，点击命中后触发 `region-tap` 事件（返回命中的页码与原始 region 对象）：

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { VueTurn, TurnItem, type PageRegion, type TurnInstance } from 'vue-turnbook'

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

## 观感预设（preset）

`nPolygons` / `perspective` / `ambient` / `gloss` / `curl` 五个渲染参数较为专业，`preset`（纸张类型）为它们提供成组基线，`look`（内页）/ `coverLook`（封面/封底）对象参数可逐项覆盖。预设同时给出折角（`fold`）开关与折缝圆角（`bend`，折缝圆弧弧长占页宽比例，越大折缝越圆润柔软）的基线：

| # | 预设 | 定位 | nPolygons | perspective | ambient | gloss | curl | fold / bend |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `soft`（默认） | 普通纸张：哑光（弱方向光）、自然卷曲，支持折角拖拽 | 64 | 2400 | 1 | 0.15 | 0.8 | 开 / 0.04 |
| 2 | `hard` | 纸板：纯刚体旋转（零卷曲）、较强光泽（覆膜观感），关闭折角；适合封面/封底（`coverPreset` 默认）或整本纸板书 | 32 | 2400 | 1 | 0.8 | 0 | 关 / - |
| 3 | `custom` | 自定义声明：基线与 soft 一致，配合 `look` 完全自定义 | 64 | 2400 | 1 | 0.15 | 0.8 | 开 / 0.04 |

优先级语义：**preset 提供基线，`look` 逐项覆盖、对任何档位生效，未传项回退基线**。例如 `preset="hard" :look="{ curl: 0.6 }"` 在纸板刚体基线上单独打开卷曲；`:look="{ fold: false }"` 可在 soft 档关闭折角。未传 preset 时按 soft 档处理；非法 preset 值回退 soft 并 `console.warn`。

档位按**纸张归属**生效，不是全局一刀切：一张纸的正反两面同档——内页纸张读 `preset` + `look`，封面/封底专用纸张读 `coverPreset` + `coverLook`（未传项逐项回退 `look`）。因此默认的 `preset="soft" coverPreset="hard"` 下，内页可折角卷曲、封面为纸板刚体，互不干扰。`perspective` 例外：它是全局相机参数，只读 `look.perspective`（`coverLook.perspective` 无效）。

这些参数在组件挂载时读取一次（与此前行为一致），运行中切换 preset 或专业参数不会热更新。

## 常见图书宽高比

`pageAspect` 为单页宽/高（注意是宽除以高，不是开本习惯的高除以宽）。常见成品书的参考值：

| # | 书籍类型 | 开本尺寸 | 宽高比（宽/高） |
| --- | --- | --- | --- |
| 1 | 32 开口袋书（文学小说） | 130 × 184 mm | `0.71` |
| 2 | 大众 16 开（畅销书/教材） | 185 × 260 mm | `0.71` |
| 3 | B5（技术书/经管书） | 170 × 240 mm | `0.71` |
| 4 | 标准 A4（杂志/画册） | 210 × 297 mm | `0.71` |
| 5 | 24 开（绘本/图文书） | 150 × 210 mm | `0.71` |
| 6 | 16 开方形画册 | 210 × 210 mm | `1.0` |
| 7 | 6:9 现代小说（西方平装） | 152 × 229 mm | `0.66` |
| 8 | 横版儿童绘本 | 260 × 210 mm | `1.24` |

实际取值以你的设计稿单页尺寸为准（跨页项按双倍宽度光栅化，`pageAspect` 仍按单页传）；多数大众图书集中在 `0.66 ~ 0.75`，这也是组件默认 `0.75` 的由来。

## 显示模式（displayedPages）

决定书本摊开时显示一页还是两页：

| # | 取值 | 含义 |
| --- | --- | --- |
| 1 | `'auto'`（默认） | 按容器形状判定：宽 > 高取 `2`，否则取 `1`（容器 resize 会重新判定） |
| 2 | `1` | 强制单页：始终只显示一张页并居中 |
| 3 | `2` | 强制双页：左右两页摊开成跨页 |

两种模式的行为差别（`lib/flipSpec.ts`）：

- **一次翻多少页**：双页 `delta = ±2`（翻一张纸＝跨 2 个页码，`v-model` 只会落在跨页起点，跳页会自动向前对齐到所属跨页）；单页 `delta = ±1`（可停在任意一页）。
- **绕哪里转**：双页以书脊为铰链（`hingeX = 0`）；单页把铰链移到该页的外缘（`±width/2`），所以整页是"翻出画面"而非绕书脊转。
- **相机取景**：适配宽度在单页宽与跨页宽（`width` ↔ `width*2`）之间过渡——封面/封底的合书态本就是居中单页，翻开时才拉远到跨页。
- **跨页大图（`spread`）**：双页摊成一张双倍宽度整页；单页不支持跨页显示——跨页项自动忽略（不占页）并打印控制台警告。
- **页源映射**：单页一页只有一面，不自动插入空白页，封面/封底纸张背面一律不占页（单页翻页背面恒为空白，没有显示机会），跨页对齐与奇偶补位全部取消——因此 `numPages` 与双页模式不同。`type="jacket"` 跨页封皮不忽略：封面显示右半、封底显示左半。
- **模式切换（回封面）**：单双页的页码语义不同，任意方向切换后统一回到封面（页码经 `v-model` 回写）；已光栅化纹理按内容源迁移到新页索引（**不重做栅格化**），静态布局重建、缺失页按需补生成。
- **页缝固定一侧**：单页的页缝固定在阅读方向一侧（`forwardDirection: 'left'` 为左缘，RTL 镜像到右缘）——下一页绕缝翻出，上一页为目标页纸张从缝侧翻回放平盖住当前页（反向翻页）。折页/折角拖拽（soft 档）同样以缝侧为书脊生效：前进半区按双页同一套几何折叠。**后退方向不支持拖拽与悬停预览**（反向纸张静止时不在页面上、无从抓取），后退导航走点击/键盘/实例方法。
- **翻页纸张背面**：单页翻起纸张的背面统一为空白纸页（一页只有一面内容，不再显示下一页内容的"影子页"）。
- **纸叠条带**：单页模式下贴合半页宽的外缘，其余行为一致。

注意：

- 该参数运行时可改（`auto` 会随容器尺寸重判），但**翻页动画期间收到的模式切换会推迟到动画结束**再应用——进行中翻页的 spec 按旧模式算，中途切换会让页码语义错位。
- `'auto'` 只看容器宽高、不看页数：窄长窗口（手机竖屏）会自动落到单页模式。不想让它跟着窗口变，就显式传 `1` 或 `2`。
- 双页模式下也有居中单页的时刻：封面（页索引 0）与奇数末页按合书/封底态居中显示，此时看不出模式差异。

## 阅读方向（forwardDirection）

决定"往哪边翻算下一页"，也就是这本书是左翻还是右翻。值本身就是 `next()` 触发的翻页动作方向：`'left'` 为"向左翻即前进"（现代横排书、西文），`'right'` 为"向右翻即前进"（阿拉伯文、古籍右翻本）。

| # | 表现 | `'left'`（默认） | `'right'` |
| --- | --- | --- | --- |
| 1 | 跨页两侧页码 | 左页小、右页大（第 2 页在左，第 3 页在右） | 左页大、右页小 |
| 2 | 点击视口 | 点右半前进、左半后退 | 点左半前进、右半后退 |
| 3 | 拖拽起手半区 | 右半向前拖 | 左半向前拖 |
| 4 | 方向键 | `→` 前进、`←` 后退 | `←` 前进、`→` 后退 |
| 5 | 纸叠（`stack`） | 已读页堆在左侧、未读在右侧 | 两侧互换 |
| 6 | 翻页纸张铰点/书体平移 | 按左翻几何 | 整体镜像 |

要点：

- 属交互参数，运行中改 prop 立即生效（不像 `preset`/`coverPreset` 挂载时冻结）。
- 只镜像翻页与版面配对方向，**不改变页面内容排版**：`<TurnItem>` 里的 DOM 仍是横排书写方向，需要竖排/RTL 文字排版请自行用 CSS 处理（组件不支持竖排书，见「已知限制」）。
- `PageDown`/`Space` 恒为前进、`PageUp` 恒为后退（不随该参数镜像），`Home`/`End` 恒为首页/末页；只有方向键跟随阅读方向。
- 单页显示模式（`displayedPages=1`）没有左右配对，此时该参数只影响点击/拖拽/键盘的前进判定。

## 分辨率与取景（pageWidth / pixelRatio / fitMargin）

三个"装机调优"旋钮各管一段管线，别混用：

| # | Prop | 管什么 | 什么时候动它 |
| --- | --- | --- | --- |
| 1 | `pageWidth` | 离屏设计画布宽度（像素）。页面内容里的 `px` 尺寸都是相对它排的 | 只有当你按别宽度的设计稿做内容时才改（默认 768 对应常见竖版页）；改了要同步调整内容里的 px 值 |
| 2 | `pixelRatio` | 纹理采样倍率：**不改排版**，只把同一张离屏 DOM 按 N 倍分辨率光栅化 | 文字/线条发糊时优先调它（2 足够；显存与耗时按平方增长） |
| 3 | `fitMargin` | 相机取景外扩比例，书本四周留白 | 书显得太小/太挤时微调（1.0 贴边，越大越空） |

生效时机：`fitMargin` 与观感参数一样在挂载时读取一次，运行中改不热更新；**`pageWidth`/`pixelRatio` 会即时改变离屏画布尺寸，但已生成的纹理要等下一次光栅化**（翻页进入新窗口、页内容变化、或手动 `refresh()`）才按新值重画。

画布渲染像素比（原 `maxPixelRatio`）已内收为常量 2：DPR 封顶 2 已覆盖现实设备，再高只增负载不增观感。

## cacheBust 使用场景

`cacheBust` 仅在**手动重绘**（`refresh()` / `refreshPage()`）时控制 `html-to-image` 是否给图片 URL 追加时间戳参数（默认 `true`，即 `url?timestamp=...`）强制绕过浏览器缓存；懒光栅化预取与页面 DOM 变化触发的自动重光栅化始终复用浏览器缓存，不受此参数影响。以下场景应设为 `false`：

- **图片内容不可变**：图片 URL 与内容一一对应（如带内容哈希的构建产物 `cover.a3f9c2.png`、CDN 指纹地址），不存在"同名不同图"，跳过破缓存可直接复用缓存，加快手动重绘并减少请求。
- **图片服务端校验签名**：图片 URL 含签名/鉴权参数（如 OSS/七牛的 `?Expires=...&Signature=...`），再追加时间戳会使签名校验失败导致图片 403，必须关闭。
- **频繁手动重绘**：调用 `refresh()`/`refreshPage()` 较多——每次都破缓存意味着每次都完整重新下载，关闭后命中浏览器缓存可显著提速。
- **离线/内嵌资源**：页面使用 `data:`/`blob:` URL 或 Service Worker 代理的本地资源，破缓存参数无意义甚至可能干扰匹配。

注意：设为 `false` 后，若图片同名但内容已更新（如运营后台替换了同 URL 的图），手动重绘可能拿到浏览器缓存的旧图；这种情况需保持 `true`，或改用带版本号的 URL（如 `img.png?v=2`）后关闭 `cacheBust`。

## 奇数总页数的自动补页

封底合上动画依赖末页索引为奇数（即总页数为偶数）。封面纸张与封底纸张各占 2 页（恒为偶数），因此补页只取决于内页区段：当内页区段计数为奇数时，组件在封底纸张之前自动补一张空白页（补在内页区段末尾不会破坏跨页的奇数起始对齐，封底固定落在最后一个索引）。

`numPages` 计入自动补的空白页与封面/封底纸张的空白背面页。

## 路由深度链接（宿主集成）

组件与路由零耦合：对外的唯一状态是 `v-model` 页码（从 1 开始）。`/book/:page` 这类深度链接不是组件功能，由宿主自行实现——路由形态不限（路径参数、query、哈希均可），只需在宿主里做"路由 ↔ 页码"的双向同步。路由参数是业务 id（而非页码）时，维护一张"业务 id ↔ 组件页码"的映射表即可：

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { VueTurn, TurnItem, type TurnInstance } from 'vue-turnbook'

const route = useRoute()
const router = useRouter()
const turnRef = ref<TurnInstance | null>(null)

// 业务 id ↔ 页码映射：页码为组件映射后的页索引（见下方要点）
const entries = [
  { id: 'intro', page: 1 },
  { id: 'chapter1', page: 3 },
  { id: 'gallery', page: 6 },
]
const idToPage = Object.fromEntries(entries.map((e) => [e.id, e.page]))
function pageToId(page: number) {
  return entries.reduce((best, e) => (Math.abs(e.page - page) < Math.abs(best.page - page) ? e : best)).id
}

// 路由 → 页码：非法 id 回退第 1 页
const page = ref(idToPage[route.params.id as string] ?? 1)

// 页码 → 路由：翻页提交后回写（replace 不产生历史记录，按需改 push）
function onChange(p: number) {
  if (route.params.id === pageToId(p)) return
  router.replace({ params: { id: pageToId(p) } })
}
</script>

<template>
  <VueTurn ref="turnRef" v-model="page" @change="onChange">
    <TurnItem>封面</TurnItem>
    <!-- ... -->
    <TurnItem type="back-cover">封底</TurnItem>
  </VueTurn>
</template>
```

要点：

- **页码是映射后的页索引空间**：封面/封底专用纸张各占 2 页（内容面 + 空白背面页）、跨页项占 2 页、对齐/补偶的自动补位页同样计入 `numPages`（见「跨页大图（spread）」「奇数总页数的自动补页」）。业务"第 N 个内容"对应的组件页码请按此空间换算——例如内容项前有 1 张封面纸（2 页）时，第 1 个内容页从页码 3 开始。
- **深度链接定位**：以 `v-model` 初始值传入即可在挂载时定位；运行中收到外部跳转调 `turnRef.value?.goToPage(page)`（翻页中或越界时会被拒绝并返回 `false`，可在路由同步处据此回退）。
- **双向同步防环**：路由 → 页码方向用 `v-model` / `goToPage`；页码 → 路由方向监听 `change`（或响应式 `state.page`），回写前先比对当前路由参数、相同则跳过，避免冗余导航与多余历史记录。含非法值纠正的完整参考实现见演示页 `BookView.vue` 的 `applyRoutePage` / `watch(currentPage)`。

## 已知限制

- 页面内容被光栅化为纹理，页内按钮/链接不可交互；页内交互请使用页面热区（`regions` + `region-tap`），或放在组件外部（工具栏等）。
- 页面背景由内容自绘（在 `turn-item` 内容根元素上设 `background`）：未绘制的区域光栅化后为透明，会透出宿主页面而非白色。
- 双页模式下建议总页数为偶数（封面 + 正文 + 封底），封底居中逻辑依赖该约定。
- 不支持竖排书。
- 拖拽翻页/角点折角/折角提示仅覆盖视口桌面指针交互，不做移动端适配与国际化，也不提供无障碍语义（视口的 `tabindex` 仅为 `keyboard` 聚焦通道服务）。
- 折页形变不受 `nPolygons` 影响：折缝与斜折线需要固定不低于 96 的横向分段（低于此值折痕边缘起波浪），`nPolygons` 只作用于整页卷曲路径；斜折线边缘约 5~6 像素的分段阶梯是该采样的正常结果。

## 本地开发

```sh
cnpm install
cnpm run dev          # 开发服务器
cnpm run test:unit    # 单元测试
cnpm run type-check   # 类型检查
cnpm run lint         # Lint
cnpm run build:lib    # 构建可分发组件包（dist/）
```

## 更新日志

完整的版本变更记录见 [CHANGELOG.md](./CHANGELOG.md)(遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与语义化版本),各版本要点:

| 版本 | 日期 | 要点 |
| --- | --- | --- |
| [0.4.0](./CHANGELOG.md#040---2026-10-02) | 2026-10-02 | **破坏性**:`type` 枚举统一封面/封底声明(移除 `cover`/`back-cover` 布尔属性与 `#back` 插槽)、衬页声明删除;新增跨页封皮 `type="jacket"`、书脊内阴影 `spineShadow`(默认开启)、type 校验(冲突拒绝渲染) |
| [0.3.0](./CHANGELOG.md#030---2026-10-02) | 2026-10-02 | 单页模式按"一页一面"重新定义:空白背面、页缝固定一侧、反向翻页、纸叠只在缝对侧 |
| [0.2.2](./CHANGELOG.md#022---2026-10-01) | 2026-10-01 | 库/应用构建模式区分;GitHub Pages 演示页自动部署 |
| [0.2.1](./CHANGELOG.md#021---2026-09-30) | 2026-09-30 | RTL 跨页半图修复;空白页纸色/色差修复;`flipDuration` 500ms 下限;**移除 `pageBackground`**(页面背景改由内容自绘) |
| [0.2.0](./CHANGELOG.md#020---2026-09-30) | 2026-09-30 | **破坏性**:移除 `easing`/`maxPixelRatio`、`zoomMode` 合并缩放手势;自 0.1.0 功能全集首次发布(折角/折页拖拽、纸叠、缩放视口、封面独立灯光、`look`/`coverLook`、页面热区等)与实例响应式 `state` |
| [0.1.0](./CHANGELOG.md#010---2026-08-24) | 2026-08-24 | 首个发布版本:Three.js 真实纸张卷曲翻页基础形态、组件式 API(`<vue-turn>` + `<turn-item>`)、基础交互与事件 |

