import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // GitHub Pages 项目页部署在 /<仓库名>/ 子路径下，构建时通过 DEMO_BASE 注入仓库名（如 vue-turn）
  // 只传名称不带斜杠，避免 Git Bash/MSYS 把值误当作本地路径转换
  base: process.env.DEMO_BASE ? `/${process.env.DEMO_BASE.replace(/^\/+|\/+$/g, '')}/` : '/',
  plugins: [vue(), vueDevTools()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // 库模式（npm run build:lib，--mode lib）：产出可分发的组件包
    // - 不复制 public/（favicon 等站点资源不属于组件包）
    // - CSS 文件名固定为 vue-turn.css（默认取包名，包名变更会连带产物改名）
    // 默认构建（无 --mode lib）走应用模式，产出 index.html 演示站点
    ...(mode === 'lib'
      ? {
          copyPublicDir: false,
          lib: {
            entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
            name: 'VueTurn',
            formats: ['es', 'cjs'] as const,
            fileName: (format: string) =>
              format === 'es' ? 'vue-turn.mjs' : 'vue-turn.cjs',
            cssFileName: 'vue-turn',
          },
          rollupOptions: {
            external: ['vue', 'three', 'html-to-image'],
            output: {
              globals: { vue: 'Vue' },
              // 同时存在命名导出与默认导出（插件对象），显式声明避免歧义
              exports: 'named',
            },
          },
        }
      : {}),
  },
}))
