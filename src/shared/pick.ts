import type { PickWatermarkPosition, PickWatermarkStyle } from './types'

export const PICK_WATERMARK_DEFAULT: PickWatermarkStyle = {
  position: 'southeast',
  opacity: 0.85,
  logo: null,
  logoScale: 0.18,
  fontScale: 0.024
}

export const PICK_WATERMARK_POSITIONS: Array<{
  id: PickWatermarkPosition
  label: string
}> = [
  { id: 'southeast', label: '右下角' },
  { id: 'southwest', label: '左下角' },
  { id: 'northeast', label: '右上角' },
  { id: 'northwest', label: '左上角' },
  { id: 'center', label: '居中' }
]

const POSITIONS = new Set<PickWatermarkPosition>(PICK_WATERMARK_POSITIONS.map((item) => item.id))

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

/** 配置与 IPC 都从同一处收口，非法值一律退回默认，不让渲染层传什么就用什么 */
export function normalizePickWatermark(
  value: Partial<PickWatermarkStyle> | null | undefined
): PickWatermarkStyle {
  const logo = typeof value?.logo === 'string' ? value.logo.trim() : ''
  return {
    position:
      value?.position && POSITIONS.has(value.position)
        ? value.position
        : PICK_WATERMARK_DEFAULT.position,
    opacity: clamp(Number(value?.opacity ?? PICK_WATERMARK_DEFAULT.opacity), 0.15, 1),
    logo: logo || null,
    logoScale: clamp(
      Number(value?.logoScale ?? PICK_WATERMARK_DEFAULT.logoScale),
      0.08,
      0.35
    ),
    fontScale: clamp(
      Number(value?.fontScale ?? PICK_WATERMARK_DEFAULT.fontScale),
      0.014,
      0.05
    )
  }
}
