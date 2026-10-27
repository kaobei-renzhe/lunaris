import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { clamp, LAYOUT_DEFAULT, LAYOUT_LIMITS, type LayoutSizes } from '@shared/layout'

export type ResizeSide = 'sidebar' | 'detail'

export interface LayoutController {
  layout: LayoutSizes
  layoutRef: RefObject<LayoutSizes>
  resizeRef: RefObject<{ side: ResizeSide; origin: number } | null>
  resizeLayout: (side: ResizeSide, delta: number) => void
  commitResize: () => void
  resetLayout: () => void
}

/**
 * 左右栏宽度。
 * 拖动期间只改 CSS 变量（React 不重渲染、整棵树不跟着刷），松手才进 state 并落盘；
 * 窗口变窄时按「中间至少 centerMin」重新分配两侧。
 */
export function useLayoutSizes(
  shellRef: RefObject<HTMLDivElement | null>,
  library: string | null
): LayoutController {
  const [layout, setLayout] = useState<LayoutSizes>(LAYOUT_DEFAULT)
  const layoutRef = useRef<LayoutSizes>(LAYOUT_DEFAULT)
  const resizeRef = useRef<{ side: ResizeSide; origin: number } | null>(null)

  const applyLayout = useCallback(
    (next: LayoutSizes) => {
      const shell = shellRef.current
      if (!shell) return
      shell.style.setProperty('--sidebar-w', `${next.sidebar}px`)
      shell.style.setProperty('--detail-w', `${next.detail}px`)
    },
    [shellRef]
  )

  useEffect(() => {
    void window.api
      .getLayout()
      .then((next) => {
        layoutRef.current = next
        setLayout(next)
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    layoutRef.current = layout
  }, [layout])

  /** 按当前窗口宽度收一收两侧，保证中间图片区至少 centerMin */
  const syncLayout = useCallback(() => {
    const room = window.innerWidth - LAYOUT_LIMITS.centerMin - 12
    const current = layoutRef.current
    const sidebar = Math.min(current.sidebar, Math.max(LAYOUT_LIMITS.sidebarMin, room - current.detail))
    const detail = Math.min(current.detail, Math.max(LAYOUT_LIMITS.detailMin, room - sidebar))
    applyLayout({ sidebar, detail })
  }, [applyLayout])

  // 布局变化、窗口缩放、图库刚打开时都重新算一次（只改 CSS 变量，不触发重渲染）
  useEffect(() => {
    syncLayout()
  }, [syncLayout, layout, library])

  useEffect(() => {
    window.addEventListener('resize', syncLayout)
    return () => window.removeEventListener('resize', syncLayout)
  }, [syncLayout])

  const resizeLayout = useCallback(
    (side: ResizeSide, delta: number) => {
      const drag = resizeRef.current
      if (!drag || drag.side !== side) return
      const current = layoutRef.current
      const room = window.innerWidth - LAYOUT_LIMITS.centerMin - 12
      if (side === 'sidebar') {
        const max = Math.max(
          LAYOUT_LIMITS.sidebarMin,
          Math.min(LAYOUT_LIMITS.sidebarMax, room - current.detail)
        )
        const width = Math.round(clamp(drag.origin + delta, LAYOUT_LIMITS.sidebarMin, max))
        layoutRef.current = { ...current, sidebar: width }
      } else {
        const max = Math.max(LAYOUT_LIMITS.detailMin, Math.min(LAYOUT_LIMITS.detailMax, room - current.sidebar))
        const width = Math.round(clamp(drag.origin - delta, LAYOUT_LIMITS.detailMin, max))
        layoutRef.current = { ...current, detail: width }
      }
      applyLayout(layoutRef.current)
    },
    [applyLayout]
  )

  const commitResize = useCallback(() => {
    if (!resizeRef.current) return
    resizeRef.current = null
    const next = layoutRef.current
    setLayout(next)
    void window.api.saveLayout(next).catch(() => undefined)
  }, [])

  const resetLayout = useCallback(() => {
    resizeRef.current = null
    layoutRef.current = LAYOUT_DEFAULT
    setLayout(LAYOUT_DEFAULT)
    applyLayout(LAYOUT_DEFAULT)
    void window.api.saveLayout(LAYOUT_DEFAULT).catch(() => undefined)
  }, [applyLayout])

  return { layout, layoutRef, resizeRef, resizeLayout, commitResize, resetLayout }
}
