import type { ThemeMode } from '@shared/types'
import type { SkinId } from '@shared/skins'

const DARK_QUERY = '(prefers-color-scheme: dark)'
const CACHE_KEY = 'moonnest:theme'
const SKIN_KEY = 'moonnest:skin'

export function resolveTheme(mode: ThemeMode): 'dark' | 'light' {
  if (mode === 'dark' || mode === 'light') return mode
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

/** 把主题写到根节点，CSS 变量随之切换 */
export function applyTheme(mode: ThemeMode): void {
  document.documentElement.dataset.theme = resolveTheme(mode)
}

/** 缓存一份到 localStorage，供首屏脚本在 React 启动前先上色，避免闪一下 */
export function cacheTheme(mode: ThemeMode): void {
  try {
    localStorage.setItem(CACHE_KEY, mode)
  } catch {
    /* 隐私模式写不进去也不影响使用 */
  }
}

/** 切换界面风格：写到根节点，CSS 变量随之覆盖 */
export function applySkin(skin: SkinId): void {
  const root = document.documentElement
  if (skin === 'classic') root.removeAttribute('data-skin')
  else root.setAttribute('data-skin', skin)
}

export function cacheSkin(skin: SkinId): void {
  try {
    localStorage.setItem(SKIN_KEY, skin)
  } catch {
    /* 隐私模式写不进去也不影响使用 */
  }
}

export function watchSystemTheme(onChange: () => void): () => void {
  const media = window.matchMedia(DARK_QUERY)
  const handler = (): void => onChange()
  media.addEventListener('change', handler)
  return () => media.removeEventListener('change', handler)
}
