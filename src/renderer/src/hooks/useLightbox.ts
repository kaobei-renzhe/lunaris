import { useCallback, useState } from 'react'

export interface LightboxController {
  lightboxId: number | null
  /** 递增时让瀑布流把当前项重新滚进视野（退出大图后用） */
  revealTick: number
  openLightbox: (id: number) => void
  closeLightbox: () => void
}

/**
 * 灯箱开关。
 * 关闭时把焦点交回图库：由调用方恢复选中项，并让瀑布流滚回那一张。
 */
export function useLightbox(restoreSelection: (id: number) => void): LightboxController {
  const [lightboxId, setLightboxId] = useState<number | null>(null)
  const [revealTick, setRevealTick] = useState(0)

  const openLightbox = useCallback((id: number) => setLightboxId(id), [])

  const closeLightbox = useCallback(() => {
    const id = lightboxId
    setLightboxId(null)
    if (id === null) return
    restoreSelection(id)
    setRevealTick((value) => value + 1)
  }, [lightboxId, restoreSelection])

  return { lightboxId, revealTick, openLightbox, closeLightbox }
}
