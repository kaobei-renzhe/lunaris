import { extname } from 'node:path'
import { SUPPORTED_EXT } from '../shared/formats'

/** 扫描时整目录跳过的名字（依赖目录、版本库、回收站、系统卷信息） */
const SKIP_DIRS = new Set(['node_modules', '.git', '$RECYCLE.BIN', 'System Volume Information'])

/** 目录名是否该跳过：系统目录，以及所有点开头的隐藏目录 */
export function shouldSkipDir(name: string): boolean {
  return SKIP_DIRS.has(name) || name.startsWith('.')
}

/** 文件是否是可导入的图片：只看扩展名，忽略大小写 */
export function isSupportedFile(name: string): boolean {
  return SUPPORTED_EXT.has(extname(name).toLowerCase())
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/**
 * 把主色 RGB 归到色系：
 * 先按亮度判黑/白，再看饱和度判灰，剩下的按色相分段。
 */
export function classifyColor(r: number, g: number, b: number): string {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const light = (max + min) / 2
  const delta = max - min
  const sat = delta === 0 ? 0 : delta / (1 - Math.abs(2 * light - 1))

  if (light < 0.12) return 'black'
  if (light > 0.92 && sat < 0.12) return 'white'
  if (sat < 0.12) return 'gray'

  let hue = 0
  if (max === rn) hue = ((gn - bn) / delta) % 6
  else if (max === gn) hue = (bn - rn) / delta + 2
  else hue = (rn - gn) / delta + 4
  hue = (hue * 60 + 360) % 360

  if (hue < 15 || hue >= 345) return 'red'
  if (hue < 45) return 'orange'
  if (hue < 70) return 'yellow'
  if (hue < 160) return 'green'
  if (hue < 195) return 'cyan'
  if (hue < 260) return 'blue'
  if (hue < 300) return 'purple'
  return 'pink'
}

/** 快门速度：1 秒及以上显示 2.5s，更快的显示 1/125s */
export function formatExposure(value?: number): string | undefined {
  if (!value || !Number.isFinite(value)) return undefined
  if (value >= 1) return `${Number(value.toFixed(1))}s`
  return `1/${Math.round(1 / value)}s`
}
