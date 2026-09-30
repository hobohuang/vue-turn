# 更新日志

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与语义化版本。当前发布版本为 `0.2.0`。

## 未发布

### 修复

- **RTL 阅读方向下跨页翻页中内容交叉错乱**：跨页拆分态（翻页中）的半图此前按页码取纹理，而 RTL 的镜像页码配对（左槽 = 起始页 +1）会让屏幕左右两半与静止合并整页互换——翻起瞬间跨页内容突然交叉、翻完合并才恢复。现统一按「屏幕侧」解析半图（左右半图克隆常备，方向无关），翻页纸张正背面、前置静态布局与悬停预览全路径生效。
- **空白补位页与相邻内容页的书脊色差**：空白页纯色纹理漏标 `SRGBColorSpace`，被 GPU 当线性色渲染，同一色值观感偏亮，与相邻内容页的书脊边形成台阶色差。

### 变更

- **`flipDuration` 设置 500ms 下限**：更小的取值按 500 生效。过短的翻页在低帧率环境下只剩寥寥数帧，落页换帧与异步收尾容易被感知为闪烁；回弹/收尾等派生动画时长同源生效。

### 破坏性变更

- **移除 `pageBackground` prop**：光栅化画布恒为透明，页面背景由内容自绘（在 `turn-item` 内容根元素上设 `background`）。页面材质开启 `transparent` 以使纹理 alpha 生效——未绘制区域透出宿主页面（此前不绘制会显示 prop 的底色）。

### 修复

- **自动插入的空白页渲染为纸色而非白色**：跨页对齐补位、内页补偶、缺省封面底/封底里衬页没有 DOM 内容、不参与内容自绘，此前无纹理、落为材质白色，摊开时与内容页纸色形成明显色差。现以统一纸色（暖白 `#f5f2e9`）生成纯色纹理贴图，静态页与翻页纸张同源，翻页动画中空白页背面颜色同步一致。

### 变更

- **soft 档卷曲翻页纸张向上翘起**：基础卷曲是纵向均匀的柱面弯，翻起姿态偏"平"。现在内页（`preset="soft"`）与软封面（`coverPreset="soft"`）的卷曲翻页在柱面弯之上叠加双分量翘起：朝相机方向的鼓起（"帆面"感）+ 屏幕向上抬起自由边（上缘全额、下缘 35%，翻页全程可读），更接近真实纸页翻动的蓬松感。翘起量随翻页进度包络起落，起翻/落页归零，与静态页无缝衔接；`hard` 刚体翻转与 fold 折角路径不受影响。幅度为内部常量，不新增配置项。

## 0.2.0 - 2026-09-30


### 破坏性变更

- **移除 `easing` prop**：翻页曲线固定为内置 `easeInOutCubic`。审计发现它从未接到纸张形变进度上（只影响书体平移与相机动画），传自定义函数看不出预期效果。节奏调整请用 `flipDuration`。
- **移除 `maxPixelRatio` prop**：画布渲染像素比内收为常量 2（DPR 封顶 2 已覆盖现实设备，再高只增负载不增观感）。无替代项。
- **`zoomEnabled` + `dblClickZoom` 合并为 `zoomMode`**：类型 `'off' | 'wheel' | 'dblclick' | 'both'`，默认 `'off'`。原先两个互不解释的布尔存在未定义的第四种组合，现在枚举把组合说清楚了。

  | 旧写法 | 新写法 |
  | --- | --- |
  | `zoom-enabled` | `zoom-mode="wheel"` |
  | `dbl-click-zoom` | `zoom-mode="dblclick"` |
  | 两者都开 | `zoom-mode="both"` |
  | 两者都关（默认） | `zoom-mode="off"`（或不传） |

  注意：`zoomMode` 含 `dblclick` 时单击翻页仍会延迟约 260ms 判定；实例方法 `zoomIn` / `zoomOut` / `setZoom` / `toggleZoom` 不受该开关限制。

  之所以不叫 `zoom`：实例已暴露只读 `zoom`（当前缩放级别），同名 prop 会让组件实例类型冲突。

- **平铺观感参数删除，换为 `look` / `coverLook` 对象参数**：`nPolygons` / `perspective` / `ambient` / `gloss` / `curl` / `fold` / `bend` 七个 prop 移除，改为 `look`（内页）与 `coverLook`（封面/封底）两个对象（`LookOptions`，均可选，未传项回退基线）。`coverLook` 未传项逐项回退 `look`，封面观感自此可与内页独立设置。
- **`preset` 退化为纯基线，`look` 对任何档位生效**：删除"soft/hard 档位值最高优先级、显式参数不生效、仅 custom 档可设置"机制。`preset="hard" :look="{ curl: 0.6 }"` 现在可在纸板基线上单独打开卷曲。`perspective` 为全局相机参数，只读 `look.perspective`。
- **`keyboard` + `globalKeyboard` 合并为枚举 `keyboard`**：类型 `'off' | 'focus' | 'global'`，默认 `'focus'`。两个布尔存在 `globalKeyboard=true` 而 `keyboard=false` 的死配置（document 入口被一并拦截），枚举使无效状态不可表达。

  | 旧写法 | 新写法 |
  | --- | --- |
  | `keyboard="false"` | `keyboard="off"` |
  | `keyboard="true"`（默认） | `keyboard="focus"`（或不传） |
  | `globalKeyboard` | `keyboard="global"` |
- **移除 `startPage`**：初始页码全权由 `modelValue` 决定，未绑定时从第 1 页开始。
- **移除 `peelZone` / `stackDepth`**：整页轻卷条带宽度（0.12）与纸叠最大厚度比例（0.02）收为内部常量，不对外暴露。
- **移除无障碍代码**：`ariaLabel` prop、viewport 的 `role`/`aria-label`、离屏容器与纸叠提示的 `aria-hidden`。保留 `tabindex` 与 `:focus-visible`（`keyboard` 聚焦通道的功能依赖）。

### 行为变更

- **折页（`fold`）与折缝（`bend`）改为按纸张归属取档**：内页纸张读 `preset`，封面/封底专用纸张读 `coverPreset`，一张纸正反两面同档（与 `curl` / `nPolygons` 的封面档覆盖同一套判定）。

  影响：默认配置（`preset="soft"` + `coverPreset="hard"`）下，封面/封底现在是**刚体翻转**——角点不响应折角拖拽、角区悬停不再掀起折角预览，与 README「封面与封底」承诺的"hard 即刚体旋转无卷曲"一致。此前折页开关只看 `preset`，而折页形变不读 `curl`，导致 `coverPreset="hard"` 的零卷曲在默认配置下被折页路径吞掉。

  要恢复旧观感（封面也折角）：传 `coverPreset="soft"`。要整本都不折角：`preset="hard"`。

### 文档

- 新增「显示模式（displayedPages）」「阅读方向（forwardDirection）」「分辨率与取景（pageWidth / pixelRatio / fitMargin）」三节，说清各旋钮管哪段管线与生效时机。
- 「观感预设」补充档位按纸张归属生效的说明；修正「封面与封底」中与折页实现相反的旧表述（原文写"封面/封底不响应角点折角"，与同文档另一处矛盾）。
- 「已知限制」补充：折页形变的网格密度不受 `nPolygons` 影响（固定不低于 96 段，低于此值折痕边缘起波浪）。

### 新增

| 新增项 | 类型 / 位置 | 说明 |
| --- | --- | --- |
| `look` | prop，`LookOptions` | 内页观感与折页参数，逐项覆盖 `preset` 基线（挂载冻结） |
| `coverLook` | prop，`LookOptions` | 封面/封底观感与折页参数，未传项逐项回退 `look`（挂载冻结） |
| `state` | 实例属性，`TurnState`（只读响应式） | 状态快照：`page` / `numPages` / `isFlipping` / `canNext` / `canPrev` / `disabled` / `zoom`，模板/computed 读取自动跟踪 |
| `LookOptions` / `TurnState` / `KeyboardMode` | 导出类型（`types/turn.ts`，经包入口 `export *`） | 供使用方标注 prop 与实例类型 |

- **自 0.1.0 以来的功能全集随本版首次发布**：折角/折页拖拽与悬停预览（turn.js 4 风格）、纸叠页层条带（悬停/点击跳页）、缩放视口（滚轮/双击/实例方法）、封面/封底专用纸张与 `coverPreset` 独立灯光、观感预设（`preset`/`look`/`coverLook`）、跨页合并渲染、页面热区（`regions` + `region-tap`）、懒光栅化窗口（`prefetchWindow`）、深度链接友好的 `goToPage` 与 `before-flip` 拦截、`stop`/`disable` 实例控制。
- **实例响应式 `state`**：`TurnInstance` 新增 `state` 只读快照（`page` / `numPages` / `isFlipping` / `canNext` / `canPrev` / `disabled` / `zoom`），`readonly(reactive)` 暴露，模板/computed 中读取自动跟踪更新——外置工具栏不再需要事件回调手动强刷。`zoom` 经 `onZoomChange` 回调镜像，并补齐 `maxZoom` 收敛不发 `zoom-change` 的缺口。

### 修复

- **相机**：`fitDistance` 非有限守卫（0 尺寸容器下程序化 `setZoom`/翻页不再把相机推到 Infinity）；`near`/`far` 随相机距离动态收敛（比值恒 1/200，超宽书不再 z-fighting）；`panBy` 打断缩放动画时从当前位置继续，不再跳到动画目标。
- **上下文丢失**：渲染循环停帧（不再满频空转）、相机动画冻结在当前位置、`dispose` 补 `forceContextLoss`（防浏览器 context 配额耗尽）。
- **纸张**：每张纸的 `nPolygons` 贯通到形变采样（封面档 32 段网格不再被场景级 64 段形变场采样）；`nPolygons` 钳制下限 2（0<n<0.5 不再整页塌缩到书脊）；`endDragFlip`/`endFoldDrag` 误配对时按对方语义兜底收尾（不再静默 no-op 冻结 `isFlipping`）；`createSheet` 防御路径补 geometry dispose。
- **纹理**：`refreshPage` 的 `cacheBust` 意图跨翻页补刷保留；刷新跨页半图时两半共刷（同批次共享基准纹理，不再左右内容不一致）。
- **性能**：`curledColumns` 采样缓冲复用，翻页动画每帧不再分配 `Float32Array`。
- **pageWidth 下限钳制 64px**：防御异常输入产生无意义微纹理；内部世界宽度函数改名 `sheetWorldWidth`，消除与 `pageWidth` prop 的撞名。
- **死代码清理**：移除 `pageCurl.flipAngle`；`easing`/`maxPixelRatio` 相关残留见上。

### 测试

- 新增 `src/__tests__/presetDoc.spec.ts`：逐条对账 README「观感预设」与「封面与封底」两节（档位基线、look/coverLook 逐项覆盖、非法值回退、封面独占纸张与独立灯光、封面折页档按 `coverPreset`）。
- 新增 `src/__tests__/state.spec.ts`：覆盖实例响应式 `state` 的自动跟踪与 zoom 镜像全路径（实例方法 / 翻页复位 / maxZoom 收敛）。
- `VueTurn.spec.ts`：新增 hard 封面保持刚体（不折角预览、不折角拖拽）用例，以及 `zoomMode='both'` / 默认 `'off'` 的手势覆盖用例。

## 0.1.0 - 2026-08-24

首个发布版本：基于 Three.js 的真实纸张卷曲翻页组件完成基础形态。

- **核心渲染**：页面内容以普通 HTML 编写，运行时离屏光栅化为纹理，贴到可形变网格做真实卷曲形变；WebGL 不可用时插槽兜底。
- **组件式 API**：Element Plus 风格的 `<vue-turn>` + `<turn-item>` 调用方式；多实例隔离；v-model 双向绑定页码。
- **基础交互与事件**：内置点击/键盘翻页、`change` / `flip-start` / `flip-end` / `ready` 事件；`next` / `prev` / `refresh` 等实例 API。
- **布局与参数化**：显示模式 `displayedPages`（'auto' / 1 / 2）、阅读方向、翻页时长与曲率、渲染像素比、相机适配边距等核心参数；跨页布局与书体平移。
- **内容同步**：动态内容自动重光栅化（MutationObserver 监听离屏 DOM）；光栅化前异步等待图片/字体就绪。
- **路由解耦**：页码状态完全由外部（v-model）驱动，可接 Vue Router 深度链接。
- 拖拽翻页、折角、纸叠、缩放等进阶能力未包含（随 0.2.0 发布，见上）。
