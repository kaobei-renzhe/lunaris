import { describe, expect, it } from 'vitest'
import {
  isThumbQuality,
  isThumbQualityPref,
  pickThumbQuality,
  resolveThumbQuality,
  THUMB_QUALITY_OPTIONS,
  THUMB_SIZES,
  THUMB_SUFFIX,
  THUMB_WEBP_QUALITY
} from './thumbs'

describe('缩略图档位规格', () => {
  it('三档长边与文件后缀固定', () => {
    expect(THUMB_SIZES).toEqual({ low: 260, mid: 720, high: 1440 })
    expect(THUMB_SUFFIX).toEqual({ low: '_s', mid: '', high: '_l' })
    expect(THUMB_WEBP_QUALITY).toEqual({ low: 78, mid: 82, high: 82 })
  })

  it('设置项覆盖自动与三档', () => {
    expect(THUMB_QUALITY_OPTIONS.map((option) => option.id)).toEqual(['auto', 'low', 'mid', 'high'])
  })
})

describe('pickThumbQuality', () => {
  it('需求很小时用低档', () => {
    expect(pickThumbQuality(0)).toBe('low')
    expect(pickThumbQuality(200)).toBe('low')
  })

  it('留了 15% 余量：226 仍算低档，227 升中档', () => {
    // 226 × 1.15 = 259.9 ≤ 260；227 × 1.15 = 261.05 > 260
    expect(pickThumbQuality(226)).toBe('low')
    expect(pickThumbQuality(227)).toBe('mid')
  })

  it('中档边界：626 够用，627 升高清', () => {
    // 626 × 1.15 = 719.9 ≤ 720；627 × 1.15 = 721.05 > 720
    expect(pickThumbQuality(626)).toBe('mid')
    expect(pickThumbQuality(627)).toBe('high')
  })

  it('超过 1440 也顶格用高清，不会返回空档位', () => {
    expect(pickThumbQuality(1440)).toBe('high')
    expect(pickThumbQuality(5000)).toBe('high')
  })
})

describe('resolveThumbQuality', () => {
  it('自动档按需求挑', () => {
    expect(resolveThumbQuality('auto', 200)).toBe('low')
    expect(resolveThumbQuality('auto', 400)).toBe('mid')
    expect(resolveThumbQuality('auto', 900)).toBe('high')
  })

  it('手动档无视需求，强制锁定', () => {
    expect(resolveThumbQuality('low', 5000)).toBe('low')
    expect(resolveThumbQuality('mid', 100)).toBe('mid')
    expect(resolveThumbQuality('high', 100)).toBe('high')
  })
})

describe('档位校验', () => {
  it('isThumbQuality 只认三档', () => {
    expect(isThumbQuality('low')).toBe(true)
    expect(isThumbQuality('mid')).toBe(true)
    expect(isThumbQuality('high')).toBe(true)
    expect(isThumbQuality('auto')).toBe(false)
    expect(isThumbQuality('')).toBe(false)
    expect(isThumbQuality(undefined)).toBe(false)
  })

  it('isThumbQualityPref 额外认 auto', () => {
    expect(isThumbQualityPref('auto')).toBe(true)
    expect(isThumbQualityPref('high')).toBe(true)
    expect(isThumbQualityPref('AUTO')).toBe(false)
    expect(isThumbQualityPref(null)).toBe(false)
  })
})
