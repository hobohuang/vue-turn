# 更新日志

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与语义化版本。当前发布版本为 `0.2.0`。

## 未发布

（暂无）

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
