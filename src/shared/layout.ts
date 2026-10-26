/** 左中右三栏的自定义宽度（CSS 像素）；中间栏始终自适应 */
export interface LayoutSizes {
  sidebar: number
  detail: number
}

export const LAYOUT_DEFAULT: LayoutSizes = { sidebar: 236, detail: 320 }

export const LAYOUT_LIMITS = {
  sidebarMin: 180,
  sidebarMax: 400,
  detailMin: 280,
  detailMax: 520,
  /** 中间图片区至少留这么宽，拖到底也不能把网格挤没 */
  centerMin: 480
} as const

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 把存下来的宽度收进合法范围；配置文件被手改也不会把界面搞崩 */
export function normalizeLayout(input: Partial<LayoutSizes> | undefined): LayoutSizes {
  return {
    sidebar: clamp(
      Math.round(input?.sidebar ?? LAYOUT_DEFAULT.sidebar),
      LAYOUT_LIMITS.sidebarMin,
      LAYOUT_LIMITS.sidebarMax
    ),
    detail: clamp(
      Math.round(input?.detail ?? LAYOUT_DEFAULT.detail),
      LAYOUT_LIMITS.detailMin,
      LAYOUT_LIMITS.detailMax
    )
  }
}
