import type { App } from 'vue'

import TurnItem from './components/TurnItem.vue'
import VueTurn from './components/VueTurn.vue'

export { VueTurn, TurnItem }
export * from './types/turn'

// app.use(VueTurnPlugin) 可全局注册 VueTurn / TurnItem
export default {
  install(app: App) {
    app.component('VueTurn', VueTurn)
    app.component('TurnItem', TurnItem)
  },
}
