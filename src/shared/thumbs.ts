/** 瀑布流缩略图清晰度：低 = 260px，中 = 720px，高 = 1440px */
export type ThumbQuality = 'low' | 'mid' | 'high'

/** 用户偏好：自动按卡片实际像素选档，或强制锁定某一档 */
export type ThumbQualityPref = 'auto' | ThumbQuality

export const THUMB_QUALITY_DEFAULT: ThumbQualityPref = 'auto'

/** 各档缩略图的长边像素 */
export const THUMB_SIZES: Record<ThumbQuality, number> = {
  low: 260,
  mid: 720,
  high: 1440
}

/** 文件名后缀：<id>_s.webp / <id>.webp / <id>_l.webp */
export const THUMB_SUFFIX: Record<ThumbQuality, string> = {
  low: '_s',
  mid: '',
  high: '_l'
}

/**
 * 各档 webp 编码质量。低档本来就小，压狠一点更省；中/高档保清晰。
 * 导入与按需生成共用这一张表，别再各写各的数字。
 */
export const THUMB_WEBP_QUALITY: Record<ThumbQuality, number> = {
  low: 78,
  mid: 82,
  high: 82
}

/** 留一点余量，避免「刚好擦边」时被放大插值 */
const NEED_MARGIN = 1.15

/**
 * 按这张卡片真正要显示的物理像素挑最小够用的档位。
 * 竖构图的横向像素只有长边的 w/h，所以调用方要用 contain 后的显示尺寸来算。
 */
export function pickThumbQuality(needPx: number): ThumbQuality {
  if (needPx * NEED_MARGIN <= THUMB_SIZES.low) return 'low'
  if (needPx * NEED_MARGIN <= THUMB_SIZES.mid) return 'mid'
  return 'high'
}

export function resolveThumbQuality(pref: ThumbQualityPref, needPx: number): ThumbQuality {
  return pref === 'auto' ? pickThumbQuality(needPx) : pref
}

export function isThumbQuality(value: unknown): value is ThumbQuality {
  return value === 'low' || value === 'mid' || value === 'high'
}

export function isThumbQualityPref(value: unknown): value is ThumbQualityPref {
  return value === 'auto' || isThumbQuality(value)
}

export interface ThumbCacheStats {
  low: { count: number; bytes: number }
  mid: { count: number; bytes: number }
  high: { count: number; bytes: number }
}

export interface ThumbCacheClearResult {
  removed: number
  freed: number
}

/** 清理目标：只清高清档，或整份重来 */
export type ThumbCacheTarget = 'high' | 'all'

/** 高清缓存上限（MB），0 = 不限 */
export const THUMB_CACHE_LIMIT_DEFAULT = 2048

export const THUMB_CACHE_LIMIT_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: '不限' },
  { value: 1024, label: '1 GB' },
  { value: 2048, label: '2 GB' },
  { value: 5120, label: '5 GB' },
  { value: 10240, label: '10 GB' }
]

export interface ThumbCacheLimitResult {
  limit: number
  /** 设置上限时顺带清掉的字节数 */
  freed: number
}

export interface ThumbQualityOption {
  id: ThumbQualityPref
  label: string
  hint: string
}

export const THUMB_QUALITY_OPTIONS: ThumbQualityOption[] = [
  {
    id: 'auto',
    label: '自动',
    hint: '按卡片大小和屏幕像素密度选档；缩略图拉大、竖构图会自动上高清'
  },
  { id: 'low', label: '低', hint: '260px，最省资源；卡片放大后会偏糊，适合超大图库快速过图' },
  { id: 'mid', label: '中', hint: '720px，固定中档；小卡片够用，竖构图或拉大后仍会偏软' },
  { id: 'high', label: '高', hint: '1440px，最锐利；首次显示会生成缓存，更占磁盘' }
]
