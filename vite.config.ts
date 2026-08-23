import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), vueDevTools()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // 库模式：产出可分发的组件包，样式随 JS 注入
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'VueTurn',
      formats: ['es', 'cjs'],
      fileName: (format) => (format === 'es' ? 'vue-turn.mjs' : 'vue-turn.cjs'),
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
})
