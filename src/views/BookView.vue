<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import TurnItem from '@/components/TurnItem.vue'
import VueTurn from '@/components/VueTurn.vue'
import type {
  BeforeFlipContext,
  DisplayMode,
  FlipDirection,
  ForwardDirection,
  KeyboardMode,
  PageRegion,
  TurnInstance,
  ViewportPoint,
  ZoomMode,
} from '@/types/turn'

const route = useRoute()
const router = useRouter()

const turnRef = ref<TurnInstance | null>(null)
const currentPage = ref(1)
const MAX_ZOOM = 4

// 响应式状态快照：指示器/按钮状态全部由 state 自动跟踪，无需事件回调强刷
const state = computed(() => turnRef.value?.state)

let syncing = false

// 解析路由页码：仅接受正整数；非法值（abc/0/负数等）回退第 1 页并纠正 URL
function applyRoutePage() {
  if (syncing) return
  const raw = route.params.page
  const value = Array.isArray(raw) ? raw[0] : raw
  const parsed = value === undefined ? NaN : Number(value)
  const valid = Number.isInteger(parsed) && parsed >= 1
  if (valid) {
    // 合法页码（含第 1 页）一律同步，否则 /book/1 导航会被忽略导致书页与 URL 脱钩
    currentPage.value = parsed
    return
  }
  if (!valid && value !== undefined) {
    currentPage.value = 1
    syncing = true
    router.replace({ name: 'book', params: { page: '1' } }).finally(() => {
      syncing = false
    })
  }
}

watch(() => route.params.page, applyRoutePage)

watch(currentPage, (value) => {
  if (syncing) return
  // URL 已是目标页码（URL 发起的同步）时跳过，避免冗余导航
  const raw = route.params.page
  const current = Array.isArray(raw) ? raw[0] : raw
  if (current === String(value)) return
  syncing = true
  router.replace({ name: 'book', params: { page: String(value) } }).finally(() => {
    syncing = false
  })
})

applyRoutePage()

// ---------- 运行时可变参数（右上参数面板） ----------
// preset / coverPreset / look / coverLook / pageAspect / fitMargin 等挂载时冻结，
// 不提供运行时切换（组件在挂载时读取一次）

const displayMode = ref<'auto' | '1' | '2'>('auto')
const displayModeValue = computed<DisplayMode>(() =>
  displayMode.value === 'auto' ? 'auto' : (Number(displayMode.value) as 1 | 2),
)

// 书皮模式：jacket 跨页封皮（一项声明整张书皮，右半封面/左半封底），
// 或经典 cover + back-cover 两项分别声明。切换即重排内容（页码映射随之变化）
const coverMode = ref<'jacket' | 'classic'>('jacket')
const jacketMode = computed(() => coverMode.value === 'jacket')

const direction = ref<ForwardDirection>('left')
const keyboardMode = ref<KeyboardMode>('focus')
const zoomMode = ref<ZoomMode>('both')
const flipDuration = ref(900)
const maxZoomLevel = ref(MAX_ZOOM)

const peelOn = ref(true)
const clickFlip = ref(true)
const dragFlip = ref(true)
const stackOn = ref(true)
// before-flip 拦截演示：开启后禁止翻到封底纸张（末尾两页）。
// 单页模式下自动开启并锁定（封底纸张在单页中逐页显示，自动保护不演示翻到封底）
const blockBackCover = ref(false)

// 单页模式（含 auto 解析结果）：自动开启封底拦截并锁定开关
const singlePageMode = computed(() => state.value?.displayedPages === 1)
watch(singlePageMode, (single) => {
  if (!single) return
  if (!blockBackCover.value) {
    blockBackCover.value = true
    log('before-flip', '单页模式：自动开启封底拦截')
  }
}, { immediate: true })

const isDisabled = computed(() => state.value?.disabled ?? false)

// ---------- 浮层面板开关 ----------
const settingsOpen = ref(true)
const logOpen = ref(true)

// ---------- 事件日志 ----------
interface LogEntry {
  id: number
  time: string
  name: string
  detail: string
}

const logs = ref<LogEntry[]>([])
let logId = 0

function log(name: string, detail = '') {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  logs.value.unshift({ id: ++logId, time, name, detail })
  if (logs.value.length > 60) logs.value.pop()
}

// ---------- 事件处理：演示全部 15 个事件 ----------
function onBeforeFlip(context: BeforeFlipContext) {
  // 封底纸张的页数按显示模式取：双页占末尾两页（封底里 + 封底），
  // 单页一页只有一面、封底里不占页，只有末页（封底）
  const numPages = turnRef.value?.numPages ?? 0
  const backCoverStart = (state.value?.displayedPages ?? 2) === 1 ? numPages : numPages - 1
  if (blockBackCover.value && context.to >= backCoverStart) {
    context.preventDefault()
    log('before-flip', `已拦截 ${context.from} → ${context.to}（封底保护区）`)
    return
  }
  log('before-flip', `${context.from} → ${context.to}${context.direction ? `（${dirLabel(context.direction)}）` : '（跳转）'}`)
}

function dirLabel(d: FlipDirection) {
  return d === 'left' ? '向左' : '向右'
}

function onFlipStart(d: FlipDirection) {
  log('flip-start', dirLabel(d))
}

function onFlipEnd(d: FlipDirection) {
  log('flip-end', dirLabel(d))
}

function onChange(page: number) {
  log('change', `第 ${page} 页`)
}

function onFirst() {
  log('first', '已到第一页')
}

function onLast() {
  log('last', '已到最后一页')
}

function onPressed(point: ViewportPoint) {
  log('pressed', `(${Math.round(point.x)}, ${Math.round(point.y)})`)
}

function onReleased(point: ViewportPoint) {
  log('released', `(${Math.round(point.x)}, ${Math.round(point.y)})`)
}

function onZoomChange(level: number) {
  log('zoom-change', `${level}×`)
}

function onReady() {
  log('ready', '首次纹理就绪')
}

function onRasterizeError(page: number, error: unknown) {
  log('rasterize-error', `第 ${page} 页：${error instanceof Error ? error.message : String(error)}`)
}

function onStackHover(page: number | null) {
  log('stack-hover', page === null ? '离开纸叠' : `第 ${page} 页`)
}

function onStackTap(page: number) {
  log('stack-tap', `跳向第 ${page} 页`)
}

// 目录热区：与页面内 .toc-box 的绝对定位百分比一一对应，
// 点击命中后跳转对应页（region.data 为目标页码）。
// 页码按书皮模式取：两种模式页数相同（16 页），仅跨页/目录位置相差 1 页
const tocRegions = computed<PageRegion[]>(() => [
  { x: 0.08, y: 0.66, w: 0.24, h: 0.14, data: 1 },
  { x: 0.38, y: 0.66, w: 0.24, h: 0.14, data: jacketMode.value ? 6 : 7 },
  { x: 0.68, y: 0.66, w: 0.24, h: 0.14, data: jacketMode.value ? 10 : 11 },
])

function onRegionTap(_page: number, region: PageRegion) {
  const target = Number(region.data)
  if (Number.isInteger(target) && target >= 1) {
    log('region-tap', `热区跳转 → 第 ${target} 页`)
    turnRef.value?.goToPage(target)
  }
}

// ---------- 工具栏：实例方法演示 ----------
function goFirst() {
  turnRef.value?.goToPage(1)
}

function goLast() {
  const n = turnRef.value?.numPages ?? 0
  if (n >= 1) turnRef.value?.goToPage(n)
}

async function onRefresh() {
  log('refresh', '开始重绘全部页面纹理')
  await turnRef.value?.refresh()
  log('refresh', '重绘完成')
}

function toggleDisabled() {
  turnRef.value?.disable(!isDisabled.value)
  log('disable', isDisabled.value ? '已启用' : '已禁用')
}

function onZoomInput(event: Event) {
  turnRef.value?.setZoom(Number((event.target as HTMLInputElement).value))
}
</script>

<template>
  <div class="book-view">
    <VueTurn
      ref="turnRef"
      v-model="currentPage"
      :page-aspect="0.75"
      preset="soft"
      cover-preset="hard"
      :flip-duration="flipDuration"
      :displayed-pages="displayModeValue"
      :forward-direction="direction"
      :keyboard="keyboardMode"
      :zoom-mode="zoomMode"
      :max-zoom="maxZoomLevel"
      :click-to-flip="clickFlip"
      :drag-to-flip="dragFlip"
      :peel="peelOn"
      :stack="stackOn"
      @before-flip="onBeforeFlip"
      @flip-start="onFlipStart"
      @flip-end="onFlipEnd"
      @change="onChange"
      @first="onFirst"
      @last="onLast"
      @pressed="onPressed"
      @released="onReleased"
      @zoom-change="onZoomChange"
      @ready="onReady"
      @rasterize-error="onRasterizeError"
      @stack-hover="onStackHover"
      @stack-tap="onStackTap"
      @region-tap="onRegionTap"
    >
      <!-- 书皮：jacket 模式一项声明整张书皮（双倍宽度内容，右半=封面、
           左半=封底）；经典模式 cover / back-cover 两项分别声明 -->
      <turn-item v-if="jacketMode" type="jacket">
        <div class="jacket">
          <div class="jacket-half jacket-back">
            <span class="jacket-badge">vue-turn</span>
            <h1 class="jacket-title">FIN</h1>
            <p class="jacket-note">封底半区——同一项内容的左半，合上书从背后看就是它。</p>
          </div>
          <div class="jacket-half jacket-front">
            <span class="cover-badge">vue-turn</span>
            <h1 class="cover-title">TURN</h1>
            <p class="cover-subtitle">基于 Three.js 的真实卷曲翻页</p>
            <p class="cover-meta">Vue 3 · Three.js · TypeScript</p>
          </div>
        </div>
      </turn-item>
      <turn-item v-else type="cover">
        <div class="demo-page cover">
          <span class="cover-badge">vue-turn</span>
          <h1 class="cover-title">TURN</h1>
          <p class="cover-subtitle">基于 Three.js 的真实卷曲翻页</p>
          <p class="cover-meta">Vue 3 · Three.js · TypeScript</p>
        </div>
      </turn-item>

      <!-- 衬页示例：封面/封底纸张背面为固定空白纸页，需要封面底/封底里
           内容时在对应位置自行添加普通页（本页即"封面底"） -->
      <turn-item>
        <div class="demo-page endpaper">
          <span class="endpaper-mark">vue-turn</span>
          <p class="endpaper-note">
            翻开封面即见。衬页不再绑定封面纸张——需要封面底内容时，在封面后自行添加普通页即可。
          </p>
        </div>
      </turn-item>

      <turn-item>
        <div class="demo-page right">
          <h2 class="page-heading">前言</h2>
          <p class="page-paragraph">
            这本书演示了如何把传统的 DOM 翻页组件重构为基于 WebGL 的三维翻页体验。每一页都是真实的
            HTML 内容，在运行时被光栅化为纹理，贴到可形变的网格上。
          </p>
          <p class="page-paragraph">
            点击底部工具栏的「下一页」，或点击书页后使用 ←/→ 方向键翻页；也可以直接按住页角拖拽。
            悬停页角可预览折角，滚轮与双击可缩放视口（手势可在右上角参数面板切换）。
          </p>
          <p class="page-note">— vue-turn 团队</p>
        </div>
      </turn-item>

      <turn-item>
        <div class="demo-page">
          <h2 class="page-heading">第一章 · Three.js 渲染</h2>
          <ul class="page-list">
            <li>每个页面离屏渲染为 768×1024 的 DOM 节点</li>
            <li>html-to-image 将其转换为 Canvas</li>
            <li>CanvasTexture 承载 sRGB 颜色空间与各向异性过滤</li>
            <li>细分平面网格逐帧做卷曲形变</li>
            <li>懒光栅化：prefetchWindow 预取窗口按需生成纹理</li>
          </ul>
          <p class="page-paragraph">
            渲染循环由 requestAnimationFrame 驱动，翻页结束后网格与材质会被立即释放。
          </p>
        </div>
      </turn-item>

      <turn-item spread>
        <div class="demo-page art-page">
          <div class="art-frame">
            <div class="art-blob art-blob-a"></div>
            <div class="art-blob art-blob-b"></div>
            <div class="art-blob art-blob-c"></div>
          </div>
          <p class="art-caption">图 1 · 跨页大图：内容横跨整个跨页，随页面一起卷曲</p>
        </div>
      </turn-item>

      <turn-item>
        <div class="demo-page">
          <h2 class="page-heading">第二章 · 卷曲的数学</h2>
          <p class="page-paragraph">纸张绕着一根虚拟圆柱缠绕，弧长在形变中保持不变：</p>
          <div class="formula">α(s) = θ + κ·s</div>
          <div class="formula">P(s) = ((sin(θ+κs) − sinθ)/κ, y, (cosθ − cos(θ+κs))/κ)</div>
          <p class="page-paragraph">
            当曲率 κ 趋近于 0 时，公式退化为刚体旋转；动画过程中 κ 在中点达到峰值，两端归零。
          </p>
        </div>
      </turn-item>

      <turn-item>
        <div class="demo-page code-page right">
          <h2 class="page-heading">代码一瞥</h2>
          <pre class="code-block">
export function curlPoint(s, θ, κ) {
  if (Math.abs(κ) &lt; 1e-6) {
    return { x: s * cos(θ), z: s * sin(θ) }
  }
  const end = θ + κ * s
  return {
    x: (sin(end) - sin(θ)) / κ,
    z: (cos(θ) - cos(end)) / κ,
  }
}</pre>
        </div>
      </turn-item>

      <turn-item :regions="tocRegions">
        <div class="demo-page">
          <h2 class="page-heading">第三章 · 状态与路由</h2>
          <p class="page-paragraph">
            vue-turn 以 v-model 暴露当前页码；Vue Router 提供 /book/:page
            深度链接。两个方向互相监听，翻页过程中收到的跳转请求会被推迟到动画结束后执行。
          </p>
          <p class="page-paragraph">
            页面内容光栅化为纹理后 DOM 不再可交互：下方目录使用“页面热区”实现——
            点击命中区域触发 region-tap 事件完成跳转。试试悬停左右两侧的纸叠跳页、
            悬停页角查看折角预览（右上角可切换显示模式与阅读方向）。
          </p>
          <div class="toc-box">第 1 页 · 封面</div>
          <div class="toc-box toc-box-mid">第 {{ jacketMode ? 6 : 7 }} 页 · 跨页大图</div>
          <div class="toc-box toc-box-end">第 {{ jacketMode ? 10 : 11 }} 页 · 目录</div>
        </div>
      </turn-item>

      <turn-item>
        <div class="demo-page quote-page right">
          <p class="quote-mark">“</p>
          <p class="quote-text">纸张会旧，交互不会。</p>
          <p class="quote-author">— 某位翻书页翻到腱鞘炎的工程师</p>
        </div>
      </turn-item>

      <turn-item>
        <div class="demo-page">
          <h2 class="page-heading">小结</h2>
          <ul class="page-list">
            <li>两种镜像几何（A / B）统一处理左右与前进后退</li>
            <li>FlipSpec 纯函数描述每一次翻页的全部索引</li>
            <li>单页模式下铰链移到页缘，页面飞出画面</li>
            <li>跨页未对齐左页时自动插空白页补位，内页区段为奇数时末尾补偶</li>
            <li>type="jacket" 跨页封皮：右半封面、左半封底，复用跨页半图管线</li>
            <li>所有数学均有单元测试覆盖</li>
          </ul>
        </div>
      </turn-item>

      <!-- 衬页示例（封底里）：合上书前与封底纸张相对的一页 -->
      <turn-item>
        <div class="demo-page endpaper">
          <p class="endpaper-note">封底里——合上书前与封底纸张相对的一页。</p>
          <span class="endpaper-mark">FIN · vue-turn</span>
        </div>
      </turn-item>

      <!-- jacket 模式的封底由书皮左半供给，无需再声明封底项 -->
      <turn-item v-if="!jacketMode" type="back-cover">
        <div class="demo-page cover back-cover">
          <h1 class="cover-title small">FIN</h1>
          <p class="cover-subtitle">感谢阅读</p>
        </div>
      </turn-item>

      <template #fallback>
        <div class="webgl-fallback">
          <p>当前环境不支持 WebGL，无法展示 3D 翻页效果。</p>
          <p class="webgl-fallback-note">这是 #fallback 插槽的降级内容。</p>
        </div>
      </template>
    </VueTurn>

    <!-- 参数面板：运行时可变的 props -->
    <div class="panel settings-panel">
      <div class="panel-header">
        <span class="panel-title">参数面板</span>
        <button class="mini-btn" @click="settingsOpen = !settingsOpen">
          {{ settingsOpen ? '收起' : '展开' }}
        </button>
      </div>
      <div v-show="settingsOpen" class="panel-body">
        <label class="panel-row">
          <span class="panel-label">书皮</span>
          <select v-model="coverMode" class="panel-control">
            <option value="jacket">jacket（跨页封皮）</option>
            <option value="classic">cover + back-cover</option>
          </select>
        </label>
        <label class="panel-row">
          <span class="panel-label">显示模式</span>
          <select v-model="displayMode" class="panel-control">
            <option value="auto">auto（按容器宽高）</option>
            <option value="1">1（强制单页）</option>
            <option value="2">2（强制双页）</option>
          </select>
        </label>
        <label class="panel-row">
          <span class="panel-label">阅读方向</span>
          <select v-model="direction" class="panel-control">
            <option value="left">left（左翻书）</option>
            <option value="right">right（右翻书）</option>
          </select>
        </label>
        <label class="panel-row">
          <span class="panel-label">键盘翻页</span>
          <select v-model="keyboardMode" class="panel-control">
            <option value="focus">focus（聚焦后响应）</option>
            <option value="global">global（全局兜底）</option>
            <option value="off">off（关闭）</option>
          </select>
        </label>
        <label class="panel-row">
          <span class="panel-label">缩放手势</span>
          <select v-model="zoomMode" class="panel-control">
            <option value="both">both（滚轮 + 双击）</option>
            <option value="wheel">wheel（滚轮）</option>
            <option value="dblclick">dblclick（双击）</option>
            <option value="off">off（仅实例方法）</option>
          </select>
        </label>
        <label class="panel-row">
          <span class="panel-label">翻页时长</span>
          <input v-model.number="flipDuration" type="range" min="500" max="2000" step="100" class="panel-control" />
          <span class="panel-value">{{ flipDuration }}ms</span>
        </label>
        <label class="panel-row">
          <span class="panel-label">最大缩放</span>
          <input v-model.number="maxZoomLevel" type="range" min="2" max="6" step="1" class="panel-control" />
          <span class="panel-value">{{ maxZoomLevel }}×</span>
        </label>
        <label class="panel-row panel-check">
          <input v-model="peelOn" type="checkbox" />
          <span>悬停预览（peel）</span>
        </label>
        <label class="panel-row panel-check">
          <input v-model="clickFlip" type="checkbox" />
          <span>点击翻页（clickToFlip）</span>
        </label>
        <label class="panel-row panel-check">
          <input v-model="dragFlip" type="checkbox" />
          <span>拖拽翻页（dragToFlip）</span>
        </label>
        <label class="panel-row panel-check">
          <input v-model="stackOn" type="checkbox" />
          <span>纸叠（stack）</span>
        </label>
        <label class="panel-row panel-check">
          <input v-model="blockBackCover" type="checkbox" :disabled="singlePageMode" />
          <span>before-flip 拦截封底演示{{ singlePageMode ? '（单页模式自动开启）' : '' }}</span>
        </label>
        <p class="panel-hint">
          preset / look / pageAspect 等观感参数挂载时冻结，不提供运行时切换；
          pageWidth / pixelRatio / fitMargin 等管线参数见 README。
        </p>
      </div>
    </div>

    <!-- 事件日志：演示全部 15 个事件 -->
    <div class="panel log-panel">
      <div class="panel-header">
        <span class="panel-title">事件日志</span>
        <div class="panel-actions">
          <button class="mini-btn" @click="logs.length = 0">清空</button>
          <button class="mini-btn" @click="logOpen = !logOpen">
            {{ logOpen ? '收起' : '展开' }}
          </button>
        </div>
      </div>
      <ul v-show="logOpen" class="log-list">
        <li v-if="!logs.length" class="log-empty">等待事件触发…</li>
        <li v-for="entry in logs" :key="entry.id" class="log-item">
          <span class="log-time">{{ entry.time }}</span>
          <span class="log-name">{{ entry.name }}</span>
          <span class="log-detail">{{ entry.detail }}</span>
        </li>
      </ul>
    </div>

    <div class="toolbar">
      <div class="tool-group">
        <button class="nav-btn" :disabled="isDisabled || (state?.page ?? 1) <= 1" @click="goFirst">首页</button>
        <button class="nav-btn" :disabled="!state?.canPrev" @click="turnRef?.prev()">上一页</button>
        <span class="indicator">
          第 {{ state?.page ?? currentPage }} / {{ state?.numPages ?? '…' }} 页
        </span>
        <button class="nav-btn" :disabled="!state?.canNext" @click="turnRef?.next()">下一页</button>
        <button
          class="nav-btn"
          :disabled="isDisabled || !state?.numPages || (state?.page ?? 1) >= state.numPages"
          @click="goLast"
        >
          末页
        </button>
      </div>

      <span class="tool-divider"></span>

      <div class="tool-group">
        <button class="nav-btn" :disabled="isDisabled || !state?.canPrev" @click="turnRef?.flipLeft()">左翻</button>
        <button class="nav-btn" :disabled="isDisabled || !state?.canNext" @click="turnRef?.flipRight()">右翻</button>
      </div>

      <span class="tool-divider"></span>

      <div class="tool-group">
        <button class="nav-btn" :disabled="isDisabled || (state?.zoom ?? 1) <= 1" @click="turnRef?.zoomOut()">缩小</button>
        <input
          class="zoom-slider"
          type="range"
          min="1"
          :max="maxZoomLevel"
          step="0.5"
          :value="state?.zoom ?? 1"
          :disabled="isDisabled"
          @input="onZoomInput"
        />
        <span class="indicator zoom-indicator">{{ (state?.zoom ?? 1).toFixed(1) }}×</span>
        <button class="nav-btn" :disabled="isDisabled || (state?.zoom ?? 1) >= (maxZoomLevel)" @click="turnRef?.zoomIn()">
          放大
        </button>
        <button class="nav-btn" :disabled="isDisabled" @click="turnRef?.toggleZoom()">切换</button>
      </div>

      <span class="tool-divider"></span>

      <div class="tool-group">
        <button class="nav-btn" :disabled="!state?.isFlipping" @click="turnRef?.stop()">停止</button>
        <button class="nav-btn" @click="onRefresh">重绘</button>
        <button class="nav-btn" @click="toggleDisabled">{{ isDisabled ? '启用' : '禁用' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.book-view {
  position: relative;
  width: 100%;
  height: 100%;
}

/* ---------- 底部工具栏 ---------- */
.toolbar {
  position: absolute;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  max-width: calc(100% - 32px);
  padding: 10px 18px;
  border-radius: 999px;
  background: rgba(20, 24, 33, 0.72);
  backdrop-filter: blur(8px);
  color: #e8ecf4;
  z-index: 10;
}

.tool-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tool-divider {
  width: 1px;
  height: 20px;
  background: rgba(232, 236, 244, 0.22);
}

.nav-btn {
  padding: 6px 14px;
  border: 1px solid rgba(232, 236, 244, 0.28);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.2s;
}

.nav-btn:hover:not(:disabled) {
  background: rgba(232, 236, 244, 0.14);
}

.nav-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.indicator {
  font-size: 13px;
  min-width: 96px;
  text-align: center;
}

.zoom-indicator {
  min-width: 44px;
}

.zoom-slider {
  width: 110px;
  accent-color: #7cc4ff;
}

/* ---------- 浮层面板（参数 / 事件日志） ---------- */
.panel {
  position: absolute;
  width: 264px;
  border-radius: 14px;
  background: rgba(20, 24, 33, 0.78);
  backdrop-filter: blur(8px);
  color: #e8ecf4;
  z-index: 10;
  overflow: hidden;
}

.settings-panel {
  top: 16px;
  right: 16px;
}

.log-panel {
  top: 16px;
  left: 16px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 14px;
}

.panel-title {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 1px;
}

.panel-actions {
  display: flex;
  gap: 6px;
}

.mini-btn {
  padding: 3px 10px;
  border: 1px solid rgba(232, 236, 244, 0.28);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.2s;
}

.mini-btn:hover {
  background: rgba(232, 236, 244, 0.14);
}

.panel-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 14px 12px;
}

.panel-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.panel-label {
  flex: 0 0 60px;
  opacity: 0.75;
}

.panel-control {
  flex: 1;
  min-width: 0;
  padding: 3px 6px;
  border: 1px solid rgba(232, 236, 244, 0.24);
  border-radius: 6px;
  background: rgba(232, 236, 244, 0.08);
  color: inherit;
  font-size: 12px;
}

.panel-control option {
  color: #1d2738;
}

.panel-value {
  flex: 0 0 52px;
  text-align: right;
  opacity: 0.75;
  font-variant-numeric: tabular-nums;
}

.panel-check {
  gap: 6px;
  cursor: pointer;
}

.panel-check input {
  accent-color: #7cc4ff;
}

.panel-hint {
  margin: 4px 0 0;
  font-size: 11px;
  line-height: 1.6;
  opacity: 0.5;
}

.log-list {
  max-height: 34vh;
  margin: 0;
  padding: 2px 14px 12px;
  list-style: none;
  overflow-y: auto;
}

.log-item {
  display: flex;
  gap: 8px;
  padding: 3px 0;
  font-size: 12px;
  line-height: 1.5;
  border-bottom: 1px solid rgba(232, 236, 244, 0.06);
}

.log-time {
  flex: 0 0 auto;
  opacity: 0.45;
  font-variant-numeric: tabular-nums;
}

.log-name {
  flex: 0 0 auto;
  color: #7cc4ff;
}

.log-detail {
  opacity: 0.8;
  word-break: break-all;
}

.log-empty {
  padding: 6px 0;
  font-size: 12px;
  opacity: 0.45;
}

/* ---------- 书页内容 ---------- */
.demo-page {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  padding: 72px 64px;
  display: flex;
  flex-direction: column;
  /* 书脊方向的水平渐变：外缘浅、书脊侧深，且书脊边颜色沿整条边恒定。
     深端取组件空白补位页的纯色（textureFactory BLANK_PAGE_COLOR #f5f2e9）——
     补位空白页没有 DOM 内容、以恒定纯色渲染，只有书脊边颜色恒定的渐变
     才能与它严丝合缝（此前的 150deg 对角渐变沿书脊边由浅变深，底部色差
     最明显）。左页外缘在左，故 90deg 浅 → 深 */
  background: linear-gradient(90deg, #fdfcf9 0%, #f5f2e9 100%);
  color: #2b2a26;
  font-family: 'Georgia', 'Noto Serif SC', serif;
}

/* 书脊右页：渐变镜像为 270deg——左右两页都在书脊侧偏深（#f5f2e9）、
   外缘偏浅，摊开时书脊两侧颜色衔接一致 */
.demo-page.right {
  background: linear-gradient(270deg, #fdfcf9 0%, #f5f2e9 100%);
}

.cover {
  align-items: center;
  justify-content: center;
  text-align: center;
  background: linear-gradient(160deg, #1d2738 0%, #0f1420 100%);
  color: #e8ecf4;
}

.cover-badge {
  padding: 6px 18px;
  border: 1px solid rgba(232, 236, 244, 0.4);
  border-radius: 999px;
  font-size: 22px;
  letter-spacing: 4px;
  margin-bottom: 40px;
}

.cover-title {
  font-size: 140px;
  letter-spacing: 24px;
  margin: 0 0 24px;
  text-indent: 24px;
}

.cover-title.small {
  font-size: 90px;
}

.cover-subtitle {
  font-size: 30px;
  opacity: 0.85;
  margin: 0 0 56px;
}

.cover-meta {
  font-size: 20px;
  opacity: 0.55;
  margin: 0;
}

/* 跨页封皮（type="jacket"）：离屏按双倍宽度光栅化，flex 两半各自撑满一页，
   右半 = 封面、左半 = 封底，中缝为书脊（内缘内阴影加重模拟书脊凹陷） */
.jacket {
  display: flex;
  width: 100%;
  height: 100%;
}

.jacket-half {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 32px;
  text-align: center;
  color: #e8ecf4;
}

.jacket-front {
  background: linear-gradient(200deg, #1d2738 0%, #0f1420 100%);
  box-shadow: inset 28px 0 40px -28px rgba(0, 0, 0, 0.85);
}

.jacket-back {
  background: linear-gradient(160deg, #0f1420 0%, #1d2738 100%);
  box-shadow: inset -28px 0 40px -28px rgba(0, 0, 0, 0.85);
}

.jacket-badge {
  padding: 6px 18px;
  border: 1px solid rgba(232, 236, 244, 0.4);
  border-radius: 999px;
  font-size: 18px;
  letter-spacing: 4px;
}

.jacket-title {
  font-size: 90px;
  letter-spacing: 24px;
  text-indent: 24px;
  margin: 0;
}

.jacket-note {
  max-width: 22em;
  font-size: 20px;
  line-height: 1.8;
  opacity: 0.6;
  margin: 0;
}

/* 封面底/封底里：衬页现为普通内页（在封面/封底纸张后自行添加），纸色暗于内页 */
.endpaper {
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 28px;
  background: linear-gradient(160deg, #e9e2d2 0%, #d9cfba 100%);
}

.endpaper-mark {
  padding: 6px 18px;
  border: 1px solid rgba(43, 42, 38, 0.3);
  border-radius: 999px;
  font-size: 18px;
  letter-spacing: 4px;
  color: #2b2a26;
  opacity: 0.75;
}

.endpaper-note {
  max-width: 30em;
  font-size: 22px;
  line-height: 1.9;
  color: #2b2a26;
  opacity: 0.65;
  margin: 0;
}

.page-heading {
  font-size: 44px;
  margin: 0 0 36px;
  padding-bottom: 18px;
  border-bottom: 2px solid rgba(43, 42, 38, 0.16);
}

.page-paragraph {
  font-size: 26px;
  line-height: 1.9;
  margin: 0 0 28px;
  text-align: justify;
}

.page-list {
  font-size: 25px;
  line-height: 2;
  margin: 0 0 28px;
  padding-left: 36px;
}

.page-note {
  margin-top: auto;
  font-size: 22px;
  text-align: right;
  opacity: 0.7;
}

.formula {
  font-family: 'Cambria Math', 'Georgia', serif;
  font-size: 27px;
  padding: 20px 28px;
  margin: 0 0 22px;
  background: rgba(43, 42, 38, 0.06);
  border-left: 4px solid rgba(43, 42, 38, 0.35);
  border-radius: 6px;
}

.code-page .code-block {
  font-family: 'Cascadia Code', 'Consolas', monospace;
  font-size: 21px;
  line-height: 1.7;
  padding: 30px;
  background: #171c26;
  color: #d7e0f0;
  border-radius: 12px;
  white-space: pre;
  overflow: hidden;
}

.art-page {
  align-items: center;
  justify-content: center;
}

.art-frame {
  position: relative;
  width: 560px;
  height: 560px;
  border-radius: 24px;
  overflow: hidden;
  background: #10131c;
}

.art-blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(2px);
}

.art-blob-a {
  width: 380px;
  height: 380px;
  left: -60px;
  top: 40px;
  background: radial-gradient(circle at 35% 35%, #7cc4ff, #2a5fb0 70%);
}

.art-blob-b {
  width: 320px;
  height: 320px;
  right: -40px;
  top: 160px;
  background: radial-gradient(circle at 60% 40%, #ffb36b, #c2452d 72%);
}

.art-blob-c {
  width: 260px;
  height: 260px;
  left: 150px;
  bottom: -60px;
  background: radial-gradient(circle at 50% 45%, #9ff0c0, #2c8a5e 74%);
}

.art-caption {
  margin: 36px 0 0;
  font-size: 22px;
  opacity: 0.6;
}

.quote-page {
  align-items: center;
  justify-content: center;
  text-align: center;
}

.quote-mark {
  font-size: 130px;
  line-height: 0.6;
  margin: 0 0 30px;
  opacity: 0.35;
}

.quote-text {
  font-size: 46px;
  margin: 0 0 40px;
}

.quote-author {
  font-size: 22px;
  opacity: 0.6;
  margin: 0;
}

/* 目录热区按钮：绝对定位百分比与 tocRegions 的 x/y/w/h 一一对应 */
.toc-box {
  position: absolute;
  left: 8%;
  top: 66%;
  width: 24%;
  height: 14%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(43, 42, 38, 0.35);
  border-radius: 14px;
  font-size: 21px;
  color: #2b2a26;
  background: rgba(43, 42, 38, 0.04);
}

.toc-box-mid {
  left: 38%;
}

.toc-box-end {
  left: 68%;
}

/* #fallback 插槽：WebGL 不可用时的降级内容 */
.webgl-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: #f3efe6;
  color: #2b2a26;
  font-size: 24px;
}

.webgl-fallback-note {
  font-size: 16px;
  opacity: 0.55;
  margin: 0;
}
</style>
