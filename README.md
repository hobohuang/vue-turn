# vue-turn

基于 Three.js 的 Vue 3 书本翻页组件：真实纸张卷曲形变、双页跨页布局、封面/封底开合动画、拖拽翻页、角点折角拖拽（turn.js 4 风格）、折角提示、缩放视口与页面热区。页面内容以普通 HTML 编写，运行时离屏光栅化为纹理贴到可形变网格上。

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
| `preset` | `'soft' \| 'hard' \| 'custom'` | `'soft'` | 内页纸张类型：soft 普通纸张哑光（可卷曲/折角）、hard 纸板刚体强光泽、custom 自定义；soft/hard 档位值最高优先级（下列专业参数不生效），仅 custom 档可逐项设置（详见下文「观感预设」） |
| `coverPreset` | `'soft' \| 'hard' \| 'custom'` | `'hard'` | 封面/封底纸张类型：控制封面的纸张（卷曲/折角/网格密度）与光影（独立灯光组照亮）；`perspective` 为全局相机参数不按页生效；custom 档与内页共用同一组自定义参数（详见下文「封面与封底」） |
| `pageAspect` | `number` | `0.75` | 页面宽高比（宽/高），常见图书尺寸参考下文「常见图书宽高比」 |
| `flipDuration` | `number` | `900` | 翻页动画时长（毫秒） |
| `startPage` | `number` | `1` | 初始页码（未提供 modelValue 时生效） |
| `nPolygons` | `number` | 取 preset | 翻页网格纵向分段数，越大卷曲越平滑（仅 `preset="custom"` 时生效，回退 64） |
| `perspective` | `number` | 取 preset | 透视参考距离（像素），越小透视越强（仅 `preset="custom"` 时生效，回退 2400） |
| `ambient` | `number` | 取 preset | 环境光强度（仅 `preset="custom"` 时生效，回退 1） |
| `gloss` | `number` | 取 preset | 方向光（纸张光泽）强度（仅 `preset="custom"` 时生效，回退 0.15） |
| `curl` | `number` | 取 preset | 卷曲幅度（0 为纯刚体旋转）（仅 `preset="custom"` 时生效，回退 0.8） |
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
| `cacheBust` | `boolean` | `true` | 光栅化时是否给图片加破缓存参数，避免拿到旧图（详见下文「cacheBust 使用场景」） |
| `prefetchWindow` | `number` | `4` | 懒光栅化预取窗口：当前可见页前后各 N 页预生成纹理，窗口外释放（设为 0 关闭懒加载，全量光栅化） |
| `resourceTimeout` | `number` | `5000` | 光栅化前资源等待超时（毫秒）：等待 `<img>`、CSS background-image、文档字体；超时后放弃等待直接光栅化 |
| `dragToFlip` | `boolean` | `true` | 拖拽翻页：按住页面拖动，松手按拖动距离/甩动速度决定完成或回弹 |
| `peel` | `boolean` | `false` | 悬停预览总开关：开启后指针移入页面边缘显示预览——`fold` 开启时为四边折角预览，关闭时为视口边缘条带整页轻卷（详见下文「拖拽翻页与折角交互」） |
| `peelZone` | `number` | `0.12` | 整页轻卷预览区域宽度占视口宽度的比例（两侧边缘条带，0~0.5，仅 `fold` 关闭时使用） |
| `fold` | `boolean` | 取 preset（`soft` 开启，`hard` 关闭；仅 `custom` 档可设置） | 折页变形总开关（turn.js 4 风格）：开启时按下页面任意位置均为折角变形拖拽（四角为折角拖拽、其余为折页拖拽——拎起的书页沿竖直折线对折翻页）；关闭时全部为整页卷曲（详见下文「拖拽翻页与折角交互」） |
| `bend` | `number` | 取 preset（仅 `custom` 档可设置，回退 0.16） | 折角柔软度：折线圆弧过渡宽度占页宽比例，越大越柔软 |
| `maxZoom` | `number` | `3` | 最大缩放倍数 |
| `zoomEnabled` | `boolean` | `false` | 是否允许滚轮缩放（滚轮按指数步进调节级别） |
| `dblClickZoom` | `boolean` | `false` | 是否允许双击切换缩放（开启后单击翻页延迟约 260ms 以区分双击） |
| `stack` | `boolean` | `true` | 是否显示书本左右两侧的纸叠（页层厚度条带，厚度随翻页在两侧间转移，可悬停/点击跳页；平躺的封面/封底不计入层数） |
| `stackDepth` | `number` | `0.02` | 纸叠最大厚度占单页宽度的比例（0~0.5） |

### 观感预设（preset）

`nPolygons` / `perspective` / `ambient` / `gloss` / `curl` 五个渲染参数较为专业，`preset`（纸张类型）为它们提供成组值。预设同时决定折角（`fold`）的开关与柔软度（`bend`，折线圆弧过渡宽度占页宽比例，越大折角越柔软）：

| 预设 | 定位 | nPolygons | perspective | ambient | gloss | curl | fold / bend |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `soft`（默认） | 普通纸张：哑光（弱方向光）、自然卷曲，支持折角拖拽 | 64 | 2400 | 1 | 0.15 | 0.8 | 开 / 0.16 |
| `hard` | 纸板：纯刚体旋转（零卷曲）、较强光泽（覆膜观感），关闭折角；适合封面/封底（`coverPreset` 默认）或整本纸板书 | 32 | 2400 | 1 | 0.8 | 0 | 关 / - |
| `custom` | 自定义：下列专业参数与 `fold`/`bend` 逐项取显式传入值，未传项回退 soft 基线 | 64 | 2400 | 1 | 0.15 | 0.8 | 开 / 0.16 |

优先级语义：**soft/hard 档位值为最高优先级，显式传入的专业参数不生效**。例如 `preset="hard" :curl="0.6"` 卷曲仍为 0——想调整任何参数必须切换到 `preset="custom"`，此时 `nPolygons`/`perspective`/`ambient`/`gloss`/`curl`/`fold`/`bend` 逐项取显式值、未传项回退 soft 基线。未传 preset 时按 soft 档处理；非法 preset 值回退 soft 并 `console.warn`。

这些参数在组件挂载时读取一次（与此前行为一致），运行中切换 preset 或专业参数不会热更新。

### 常见图书宽高比

`pageAspect` 为单页宽/高（注意是宽除以高，不是开本习惯的高除以宽）。常见成品书的参考值：

| 书籍类型 | 开本尺寸 | 宽高比（宽/高） |
| --- | --- | --- |
| 32 开口袋书（文学小说） | 130 × 184 mm | `0.71` |
| 大众 16 开（畅销书/教材） | 185 × 260 mm | `0.71` |
| B5（技术书/经管书） | 170 × 240 mm | `0.71` |
| 标准 A4（杂志/画册） | 210 × 297 mm | `0.71` |
| 24 开（绘本/图文书） | 150 × 210 mm | `0.71` |
| 16 开方形画册 | 210 × 210 mm | `1.0` |
| 6:9 现代小说（西方平装） | 152 × 229 mm | `0.66` |
| 横版儿童绘本 | 260 × 210 mm | `1.24` |

实际取值以你的设计稿单页尺寸为准（跨页项按双倍宽度光栅化，`pageAspect` 仍按单页传）；多数大众图书集中在 `0.66 ~ 0.75`，这也是组件默认 `0.75` 的由来。

### cacheBust 使用场景

`cacheBust` 控制 `html-to-image` 光栅化时是否给图片 URL 追加时间戳参数（默认 `true`，即 `url?timestamp=...`）强制绕过浏览器缓存，保证同名图片更新后重新拉取。以下场景应设为 `false`：

- **图片内容不可变**：图片 URL 与内容一一对应（如带内容哈希的构建产物 `cover.a3f9c2.png`、CDN 指纹地址），不存在"同名不同图"，跳过破缓存可直接复用缓存，加快光栅化并减少请求。
- **图片服务端校验签名**：图片 URL 含签名/鉴权参数（如 OSS/七牛的 `?Expires=...&Signature=...`），再追加时间戳会使签名校验失败导致图片 403，必须关闭。
- **重复光栅化频繁**：翻页窗口反复进出触发同页多次光栅化，或调用 `refresh()`/`refreshPage()` 较多——每次都破缓存意味着每次都完整重新下载，关闭后命中浏览器缓存可显著提速。
- **离线/内嵌资源**：页面使用 `data:`/`blob:` URL 或 Service Worker 代理的本地资源，破缓存参数无意义甚至可能干扰匹配。

注意：设为 `false` 后，若图片同名但内容已更新（如运营后台替换了同 URL 的图），光栅化可能拿到浏览器缓存的旧图；这种情况需保持 `true`，或改用带版本号的 URL（如 `img.png?v=2`）后关闭 `cacheBust`。

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

## 封面与封底（coverPreset）

首个 `<TurnItem>` 固定为封面（单页居中），末个 `<TurnItem>` 固定为封底。两者的观感由组件级 `coverPreset` 单独控制（默认 `'hard'`，纸板刚体翻转），与内页的 `preset` 互不干扰：

```vue
<VueTurn preset="soft" coverPreset="hard">
  <TurnItem>封面（hard 档纸板刚体强光泽）</TurnItem>
  <TurnItem>内页（soft 档哑光卷曲）</TurnItem>
  <TurnItem>封底（hard 档）</TurnItem>
</VueTurn>
```

规则与行为：

- **生效范围**：卷曲（curl）、网格密度（nPolygons）、折角（fold，封面/封底不响应角点折角）与光影（ambient/gloss，由封面专属灯光组照亮，与内页灯光独立）；`perspective` 为全局相机参数，不按页生效。
- **翻页规则**：纸张正反任一面为封面/封底时，整张按封面档卷曲翻转——默认 `hard` 即刚体旋转无卷曲；翻页中封面前面用封面灯光、背面（内页）用内页灯光，各自独立。
- **软封面**：杂志/画册类软封面传 `coverPreset="soft"`，封面即按普通纸张卷曲。
- **整本纸板书**：`preset="hard"` 让全部内页也刚体翻转（此时折角自动关闭）。
- `coverPreset` 取档位默认值；`custom` 档与内页共用同一组自定义参数（即封面与内页观感一致）。非法值回退 soft 并 `console.warn`。挂载时读取一次，运行中切换不热更新。

## 拖拽翻页与折角交互

- **拖拽翻页**（`dragToFlip`，默认开启）：按住页面拖动即可跟手翻页——LTR 右半区向前、左半区向后（RTL 相反）。松手时拖动超过约 45% 满程或朝翻页方向快速甩动即完成翻页，否则回弹取消；回弹同样触发 `flip-end`（页码不变）。按下/松开分别触发 `pressed`/`released` 事件，拖拽开始同样受 `before-flip` 拦截。
- **折页变形**（`fold`，soft 默认开启，turn.js 4 风格）：翻页交互的变形模式总开关。开启时按下页面**任意位置**均为折角变形拖拽，锚点按命中区分两种：
  - **四角区**（外缘 22% 见方）为**折角拖拽**：锚点取最近外角，斜折线，页角跟手折起；
  - **其余位置**为**折页拖拽**：锚点取指针同高度的外页边缘点，竖直折线——拎起的书页沿折线对折翻页（等效普通翻页的进度/方向，但带折叠感，区别于普通拖拽的微曲卷绕）。
  - 折线由锚点与指针实时计算，折起部分带圆弧过渡的柔软弯曲（柔软度 `bend`）。松手时进度超过约 45% 或快速甩动即完成翻页，否则收回展平。折前进侧的页等于向前翻页，折后退侧等于向后翻页；居中显示的封面/封底不可折。
  - **主动翻页（点击翻页、`next`/`prev`）同样走折页动画**：锚点取外缘中部，竖直折线扫过整页完成翻页；渲染不可用时自动回退卷曲动画。关闭时（`preset="hard"` 或 custom 档 `:fold="false"`）所有交互与主动翻页均回到整页卷曲模式。
- **悬停预览**（`peel`，默认关闭）：悬停预览总开关，与 `fold` 组合决定预览形态——
  - `peel` + `fold`（开启）：指针移入页面四边条带时渐进掀起最近页角（真实折角预览，越靠近外缘掀得越高，进入/离开平滑过渡）。
  - `peel` + `fold`（关闭）：指针悬停到视口边缘条带（宽度由 `peelZone` 控制）时整页轻微卷曲弯折——越靠近外缘翘得越高。
  - `peel` 关闭：无任何悬停预览（按下拖拽行为不受影响）。
  - 悬停仅预览页角，不改变纸叠布局；预览中按下可直接接管拖拽。

悬停判定优先级：纸叠条带 > 页面边缘预览（`peel` 总控；`fold` 开启为四边折角，关闭为整页轻卷），互不冲突。翻页中、禁用状态或放大视口下不响应折角交互。拖拽满程为视口宽度的 60%，配合点击翻页、键盘翻页互不冲突（拖拽位移超过阈值后自动吞掉随后的点击）。

## 缩放视口

通过实例方法缩放：`zoomIn()`（放大到 `maxZoom`）、`zoomOut()`（复位）、`toggleZoom()`、`setZoom(level)`（钳制到 `[1, maxZoom]`）；实例 `zoom` getter 读取当前级别，级别变化触发 `zoom-change` 事件。

- 开启 `zoomEnabled` 后支持滚轮缩放；开启 `dblClickZoom` 后双击切换缩放（单击翻页延迟约 260ms 判定）。
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
- 拖拽翻页/角点折角/折角提示仅覆盖视口桌面指针交互，不做移动端适配、国际化与无障碍扩展（仅保留基础 `role/aria-label/tabindex`）。

## 本地开发

```sh
cnpm install
cnpm run dev          # 开发服务器
cnpm run test:unit    # 单元测试
cnpm run type-check   # 类型检查
cnpm run lint         # Lint
cnpm run build:lib    # 构建可分发组件包（dist/）
```
