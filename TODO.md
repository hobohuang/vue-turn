# TODO — 功能方向备选清单

> 排期时从此处取项；完成请勾选并在 CHANGELOG 记录。

## 功能

- [ ] **移动端触摸支持**
  - pinch 双指缩放：当前缩放仅支持滚轮（`zoomMode`）与双击，触摸设备缺双指捏合
  - 触摸甩动阈值调优：`useFlipInteraction` 的拖拽提交阈值（0.45）与甩动速度判定按桌面鼠标调校，触摸手感需单独标定
  - 涉及：`src/composables/useFlipInteraction.ts`、`src/composables/useZoomPan.ts`

- [ ] **无障碍（ARIA）**
  - 现状：仅 `tabindex` + `:focus-visible` 外框 + 键盘导航，屏幕阅读器不可用
  - 需要：viewport `role` 与 `aria-label`、页码变化 `aria-live` 播报、页面内容的 alt 通道（TurnItem 可声明描述文本）
  - 涉及：`src/components/VueTurn.vue` 模板、`src/types/turn.ts`（TurnItem props）

- [ ] **翻页排队与循环翻页**
  - 翻页排队：`isFlipping` 期间新翻页请求被直接拒绝，快速连点丢操作；加 opt-in 的排队/合并机制（如最多排队 1 步）
  - 循环翻页：`canGoForward`/`canGoBack` 在首末页封死（`src/composables/useBookState.ts`），加 opt-in prop 支持末页接首页，适配相册/菜单场景
  - 注意与 `before-flip` 拦截、`first`/`last` 事件的语义冲突需先定义清楚

- [ ] **单页模式后退拖拽**
  - 单页模式反向纸张静止时不在页面上，无从抓取（`useFlipInteraction.ts` 中已注释该限制）；后退只能点击/键盘
  - 思路：从书脊对侧边缘滑入一张反向纸张承接拖拽，动画沿用 `spec.reverse`

- [ ] **竖排书支持**
  - RTL 已完整镜像翻页方向，但不改变页面内容排版（README「已知限制」）；竖排书为差异化大项，需先调研页面内容排版与光栅化的配合方式

## 工程（已完成或进行中的改进见 CHANGELOG）
