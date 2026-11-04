import { describe, expect, it } from 'vitest'
import { PICK_WATERMARK_DEFAULT, normalizePickWatermark } from './pick'

describe('normalizePickWatermark', () => {
  it('空值退回默认模板', () => {
    expect(normalizePickWatermark(null)).toEqual(PICK_WATERMARK_DEFAULT)
  })

  it('透传合法值并去掉 logo 路径两端空格', () => {
    expect(
      normalizePickWatermark({
        position: 'northwest',
        opacity: 0.6,
        logo: '  C:\\logo.png  ',
        logoScale: 0.25,
        fontScale: 0.03
      })
    ).toEqual({
      position: 'northwest',
      opacity: 0.6,
      logo: 'C:\\logo.png',
      logoScale: 0.25,
      fontScale: 0.03
    })
  })

  it('非法位置与越界数值被收回安全范围', () => {
    const style = normalizePickWatermark({
      position: 'bottom' as never,
      opacity: 8,
      logoScale: 0.01,
      fontScale: 99
    })
    expect(style.position).toBe(PICK_WATERMARK_DEFAULT.position)
    expect(style.opacity).toBe(1)
    expect(style.logoScale).toBe(0.08)
    expect(style.fontScale).toBe(0.05)
  })
})
