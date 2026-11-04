import type { ThumbQuality } from '@shared/thumbs'

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

export function thumbUrl(id: number, quality: ThumbQuality = 'mid'): string {
  return `thumb://item/${id}?q=${quality}`
}

export function photoUrl(id: number): string {
  return `photo://item/${id}`
}

export function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

/** Windows 路径大小写不敏感，去掉末尾分隔符再比较 */
export function samePath(a: string, b: string): boolean {
  const normalize = (path: string): string =>
    path.replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase()
  return normalize(a) === normalize(b)
}

/** 图库卡片的「最后打开」：刚刚 / N 分钟前 / N 天前 / N 个月前 */
export function formatRelative(ms: number): string {
  if (!ms) return '从未打开'
  const diff = Date.now() - ms
  if (diff < 60_000) return '刚刚'
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} 个月前`
  return `${Math.floor(months / 12)} 年前`
}

/** AI 评分配色：80 以上绿、60 以上黄、其余红，卡片与详情共用一套标准 */
export function scoreColor(score: number): string {
  if (score >= 80) return 'var(--success)'
  if (score >= 60) return 'var(--warn)'
  return 'var(--danger-text)'
}
