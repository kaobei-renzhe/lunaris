export type SkinId = 'classic' | 'eclipse' | 'aurora' | 'paper' | 'graphite' | 'mist'

export interface SkinDefinition {
  id: SkinId
  name: string
  hint: string
  /** 决定原生控件与窗口底色；classic 跟随系统设置 */
  mode: 'auto' | 'dark' | 'light'
  /** 首屏/窗口底色，避免加载时闪白 */
  base: string
  /** 设置面板里的三色预览（背景 / 面板 / 强调色） */
  swatches: [string, string, string]
}

export const SKINS: SkinDefinition[] = [
  {
    id: 'classic',
    name: '经典',
    hint: '当前外观，跟随系统深浅',
    mode: 'auto',
    base: '#0b0d11',
    swatches: ['#0b0d11', '#101319', '#7aa2f7']
  },
  {
    id: 'eclipse',
    name: '月蚀',
    hint: '夜色紫黑 · 月光紫',
    mode: 'dark',
    base: '#09070f',
    swatches: ['#09070f', '#0d0a15', '#a78bfa']
  },
  {
    id: 'aurora',
    name: '夜航',
    hint: '深色玻璃 · 青绿光晕',
    mode: 'dark',
    base: '#05080f',
    swatches: ['#05080f', '#0b1520', '#5eead4']
  },
  {
    id: 'graphite',
    name: '墨岩',
    hint: '中性深灰 · 低饱和极简',
    mode: 'dark',
    base: '#0f1113',
    swatches: ['#0f1113', '#17191c', '#9aa7b8']
  },
  {
    id: 'paper',
    name: '柔光',
    hint: '浅色画册 · 暖白陶土',
    mode: 'light',
    base: '#f6f4f0',
    swatches: ['#f6f4f0', '#fbfaf8', '#b4764a']
  },
  {
    id: 'mist',
    name: '雾蓝',
    hint: '冷调浅色 · 清透蓝灰',
    mode: 'light',
    base: '#f2f6fb',
    swatches: ['#f2f6fb', '#ffffff', '#4f7fd4']
  }
]

export const DEFAULT_SKIN: SkinId = 'classic'

export function isSkinId(value: unknown): value is SkinId {
  return typeof value === 'string' && SKINS.some((skin) => skin.id === value)
}

export function findSkin(id: string): SkinDefinition {
  return SKINS.find((skin) => skin.id === id) ?? SKINS[0]
}
