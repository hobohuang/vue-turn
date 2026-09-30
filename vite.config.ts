import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
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
    copyPublicDir: mode !== 'lib',
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'VueTurn',
      formats: ['es', 'cjs'],
      fileName: (format) => (format === 'es' ? 'vue-turn.mjs' : 'vue-turn.cjs'),
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
  },
}))
