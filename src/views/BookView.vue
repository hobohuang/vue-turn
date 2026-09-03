<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import TurnItem from '@/components/TurnItem.vue'
import VueTurn from '@/components/VueTurn.vue'
import type { PageRegion, TurnInstance } from '@/types/turn'

const route = useRoute()
const router = useRouter()

const turnRef = ref<TurnInstance | null>(null)
const currentPage = ref(1)
const total = ref(10)
const flipping = ref(false)
const zoom = ref(1)
const MAX_ZOOM = 3
// canNext/canPrev 是实例 getter，非响应式；用 tick 在事件后强制重渲按钮状态
const tick = ref(0)
const bump = () => {
  tick.value++
}

// 工具栏按钮状态：翻页中统一禁用，否则取实例 getter
const canNext = computed(() => {
  void tick.value
  return flipping.value ? false : (turnRef.value?.canNext ?? false)
})
const canPrev = computed(() => {
  void tick.value
  return flipping.value ? false : (turnRef.value?.canPrev ?? false)
})

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
  syncing = true
  router.replace({ name: 'book', params: { page: String(value) } }).finally(() => {
    syncing = false
  })
})

applyRoutePage()

function onPrev() {
  turnRef.value?.prev()
}
function onNext() {
  turnRef.value?.next()
}
function onZoomIn() {
  turnRef.value?.zoomIn()
}
function onZoomOut() {
  turnRef.value?.zoomOut()
}
function onFlipStart() {
  flipping.value = true
  bump()
}
function onFlipEnd() {
  flipping.value = false
  bump()
}
function onReady() {
  total.value = turnRef.value?.numPages ?? total.value
  bump()
}
function onZoomChange(level: number) {
  zoom.value = level
}

// 目录热区：与页面内 .toc-box 的绝对定位百分比一一对应，
// 点击命中后跳转对应页（region.data 为目标页码）。
// 页码对应新映射：封面纸(0,1)+内容自页 3 起，跨页大图起始页 6、目录页 10
const tocRegions: PageRegion[] = [
  { x: 0.08, y: 0.66, w: 0.24, h: 0.14, data: 1 },
  { x: 0.38, y: 0.66, w: 0.24, h: 0.14, data: 6 },
  { x: 0.68, y: 0.66, w: 0.24, h: 0.14, data: 10 },
]

function onRegionTap(_page: number, region: PageRegion) {
  const target = Number(region.data)
  if (Number.isInteger(target) && target >= 1) {
    turnRef.value?.goToPage(target)
  }
}
</script>

<template>
  <div class="book-view">
    <VueTurn
      ref="turnRef"
      v-model="currentPage"
      :page-aspect="0.75"
      :peel="true"
      @change="bump"
      @flip-start="onFlipStart"
      @flip-end="onFlipEnd"
      @ready="onReady"
      @zoom-change="onZoomChange"
      @region-tap="onRegionTap"
    >
      <turn-item cover>
        <div class="demo-page cover">
          <span class="cover-badge">vue-turn</span>
          <h1 class="cover-title">TURN</h1>
          <p class="cover-subtitle">基于 Three.js 的真实卷曲翻页</p>
          <p class="cover-meta">Vue 3 · Three.js · TypeScript</p>
        </div>
        <template #back>
          <div class="demo-page endpaper">
            <span class="endpaper-mark">vue-turn</span>
            <p class="endpaper-note">翻开封面即见——这一面与封面同属一张专用纸张，按 coverPreset 观感渲染。</p>
          </div>
        </template>
      </turn-item>

      <turn-item>
        <div class="demo-page">
          <h2 class="page-heading">前言</h2>
          <p class="page-paragraph">
            这本书演示了如何把传统的 DOM 翻页组件重构为基于 WebGL 的三维翻页体验。每一页都是真实的
            HTML 内容，在运行时被光栅化为纹理，贴到可形变的网格上。
          </p>
          <p class="page-paragraph">
            点击右下角的“下一页”，或使用页面底部的深度链接跳转，观察纸张卷曲、缠绕并落下的完整过程。
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
        <div class="demo-page code-page">
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
            点击命中区域触发 region-tap 事件完成跳转。试试拖拽页面边缘翻页、悬停页角查看折角提示。
          </p>
          <div class="toc-box">第 1 页 · 封面</div>
          <div class="toc-box toc-box-mid">第 6 页 · 跨页大图</div>
          <div class="toc-box toc-box-end">第 10 页 · 目录</div>
        </div>
      </turn-item>

      <turn-item>
        <div class="demo-page quote-page">
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
            <li>所有数学均有单元测试覆盖</li>
          </ul>
        </div>
      </turn-item>

      <turn-item back-cover>
        <div class="demo-page cover back-cover">
          <h1 class="cover-title small">FIN</h1>
          <p class="cover-subtitle">感谢阅读</p>
        </div>
        <template #back>
          <div class="demo-page endpaper">
            <p class="endpaper-note">封底里——合上书前与最后一页相对的衬页。</p>
            <span class="endpaper-mark">FIN · vue-turn</span>
          </div>
        </template>
      </turn-item>
    </VueTurn>

    <div class="toolbar">
      <button class="nav-btn" :disabled="!canPrev" @click="onPrev">上一页</button>
      <span class="indicator">第 {{ currentPage }} / {{ total }} 页</span>
      <button class="nav-btn" :disabled="!canNext" @click="onNext">下一页</button>
      <button class="nav-btn" :disabled="flipping || zoom >= MAX_ZOOM" @click="onZoomIn">
        放大
      </button>
      <button class="nav-btn" :disabled="flipping || zoom <= 1" @click="onZoomOut">缩小</button>
    </div>
  </div>
</template>

<style scoped>
.book-view {
  position: relative;
  width: 100%;
  height: 100%;
}

.toolbar {
  position: absolute;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 18px;
  border-radius: 999px;
  background: rgba(20, 24, 33, 0.72);
  backdrop-filter: blur(8px);
  color: #e8ecf4;
  z-index: 10;
}

.nav-btn {
  padding: 6px 16px;
  border: 1px solid rgba(232, 236, 244, 0.28);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font-size: 14px;
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

.demo-page {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  padding: 72px 64px;
  display: flex;
  flex-direction: column;
  background: linear-gradient(150deg, #fdfcf9 0%, #f3efe6 100%);
  color: #2b2a26;
  font-family: 'Georgia', 'Noto Serif SC', serif;
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

/* 封面底/封底里：与封面同纸的衬页（#back 插槽），纸色暗于内页、纹理呼应封底 */
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
</style>
