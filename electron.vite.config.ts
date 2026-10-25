import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = { '@shared': resolve('src/shared') }

/**
 * 只在生产构建注入 CSP：
 * - 开发模式下 Vite/React Refresh 需要内联脚本，注入会直接打不开页面
 * - 图片走自定义协议 thumb:// photo://，需要显式放行
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: thumb: photo:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

function cspPlugin() {
  return {
    name: 'moonnest-csp',
    apply: 'build' as const,
    transformIndexHtml(html: string) {
      return html.replace(
        '</head>',
        `    <meta http-equiv="Content-Security-Policy" content="${CSP}" />\n  </head>`
      )
    }
  }
}

export default defineConfig({
  main: {
    resolve: { alias: shared },
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    resolve: { alias: shared },
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: { alias: { ...shared, '@': resolve('src/renderer/src') } },
    plugins: [react(), tailwindcss(), cspPlugin()]
  }
})
