# 更新日志

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与语义化版本。当前发布版本为 `0.1.0`，以下条目尚未发版。

## 未发布

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

### 行为变更

- **折页（`fold`）与折缝（`bend`）改为按纸张归属取档**：内页纸张读 `preset`，封面/封底专用纸张读 `coverPreset`，一张纸正反两面同档（与 `curl` / `nPolygons` 的封面档覆盖同一套判定）。

  影响：默认配置（`preset="soft"` + `coverPreset="hard"`）下，封面/封底现在是**刚体翻转**——角点不响应折角拖拽、角区悬停不再掀起折角预览，与 README「封面与封底」承诺的"hard 即刚体旋转无卷曲"一致。此前折页开关只看 `preset`，而折页形变不读 `curl`，导致 `coverPreset="hard"` 的零卷曲在默认配置下被折页路径吞掉。

  要恢复旧观感（封面也折角）：传 `coverPreset="soft"`。要整本都不折角：`preset="hard"`。

### 文档

- 新增「显示模式（displayedPages）」「阅读方向（forwardDirection）」「分辨率与取景（pageWidth / pixelRatio / fitMargin）」三节，说清各旋钮管哪段管线与生效时机。
- 「观感预设」补充档位按纸张归属生效的说明；修正「封面与封底」中与折页实现相反的旧表述（原文写"封面/封底不响应角点折角"，与同文档另一处矛盾）。
- 「已知限制」补充：折页形变的网格密度不受 `nPolygons` 影响（固定不低于 96 段，低于此值折痕边缘起波浪）。

### 测试

- 新增 `src/__tests__/presetDoc.spec.ts`：逐条对账 README「观感预设」与「封面与封底」两节（档位成组值、显式参数优先级、custom 回退、非法值回退、封面独占纸张与独立灯光、封面折页档按 `coverPreset`）。
- `VueTurn.spec.ts`：新增 hard 封面保持刚体（不折角预览、不折角拖拽）用例，以及 `zoomMode='both'` / 默认 `'off'` 的手势覆盖用例。
