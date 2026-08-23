import { createRouter, createWebHistory } from 'vue-router'

import BookView from '@/views/BookView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', redirect: '/book' },
    { path: '/book/:page?', name: 'book', component: BookView },
  ],
})

export default router
