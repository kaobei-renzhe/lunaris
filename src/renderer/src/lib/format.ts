import type { ColorFamily } from '@shared/types'

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatDate(ms: number): string {
  if (!ms) return '—'
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function thumbUrl(id: number, small = false): string {
  return `thumb://item/${id}${small ? '?s=1' : ''}`
}

export function photoUrl(id: number): string {
  return `photo://item/${id}`
}

export const COLOR_OPTIONS: Array<{ value: ColorFamily; label: string; hex: string }> = [
  { value: 'black', label: '黑', hex: '#1a1c21' },
  { value: 'gray', label: '灰', hex: '#8b93a3' },
  { value: 'white', label: '白', hex: '#e8ecf3' },
  { value: 'red', label: '红', hex: '#e5534b' },
  { value: 'orange', label: '橙', hex: '#e8873a' },
  { value: 'yellow', label: '黄', hex: '#dfc04a' },
  { value: 'green', label: '绿', hex: '#57a773' },
  { value: 'cyan', label: '青', hex: '#4bb8c9' },
  { value: 'blue', label: '蓝', hex: '#4f7fd4' },
  { value: 'purple', label: '紫', hex: '#8a6bd1' },
  { value: 'pink', label: '粉', hex: '#d96b9c' }
]

export function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

/** AI 评分配色：80 以上绿、60 以上黄、其余红，卡片与详情共用一套标准 */
export function scoreColor(score: number): string {
  if (score >= 80) return 'var(--success)'
  if (score >= 60) return 'var(--warn)'
  return 'var(--danger-text)'
}
