import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/** 单测只覆盖不依赖 Electron / 数据库的纯逻辑，跑在 node 环境里 */
export default defineConfig({
  resolve: {
    alias: [
      { find: '@shared', replacement: fileURLToPath(new URL('./src/shared', import.meta.url)) },
      { find: '@', replacement: fileURLToPath(new URL('./src/renderer/src', import.meta.url)) }
    ]
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})
