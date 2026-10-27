import { useCallback, useEffect, useState } from 'react'
import type { ThemeMode } from '@shared/types'
import { THUMB_QUALITY_DEFAULT, type ThumbQualityPref } from '@shared/thumbs'
import type { SkinId } from '@shared/skins'
import { applySkin, applyTheme, cacheSkin, cacheTheme, watchSystemTheme } from '../lib/theme'

export interface AppearanceController {
  theme: ThemeMode
  changeTheme: (mode: ThemeMode) => void
  skin: SkinId
  changeSkin: (id: SkinId) => void
  thumbQuality: ThumbQualityPref
  changeThumbQuality: (pref: ThumbQualityPref) => void
}

/**
 * 主题、皮肤、瀑布流清晰度。
 * 启动时从主进程配置读一次；主题跟随系统时监听系统变化。
 * 主题/皮肤真正落盘在设置面板里做（saveTheme / saveSkin），这里只负责应用与缓存首屏用色。
 */
export function useAppearance(): AppearanceController {
  const [theme, setTheme] = useState<ThemeMode>('system')
  const [skin, setSkin] = useState<SkinId>('classic')
  const [thumbQuality, setThumbQuality] = useState<ThumbQualityPref>(THUMB_QUALITY_DEFAULT)

  useEffect(() => {
    window.api
      .getTheme()
      .then((mode) => {
        setTheme(mode)
        cacheTheme(mode)
        applyTheme(mode)
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    window.api
      .getSkin()
      .then((id) => {
        setSkin(id)
        applySkin(id)
        cacheSkin(id)
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    window.api
      .getThumbQuality()
      .then((pref) => setThumbQuality(pref))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    applyTheme(theme)
    return watchSystemTheme(() => {
      if (theme === 'system') applyTheme('system')
    })
  }, [theme])

  const changeTheme = useCallback((mode: ThemeMode) => {
    setTheme(mode)
    cacheTheme(mode)
    applyTheme(mode)
  }, [])

  const changeSkin = useCallback((id: SkinId) => {
    setSkin(id)
    applySkin(id)
    cacheSkin(id)
  }, [])

  const changeThumbQuality = useCallback((pref: ThumbQualityPref) => {
    setThumbQuality(pref)
    void window.api.saveThumbQuality(pref).catch(() => undefined)
  }, [])

  return { theme, changeTheme, skin, changeSkin, thumbQuality, changeThumbQuality }
}
