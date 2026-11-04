import { describe, expect, it } from 'vitest'
import { HEAVY_TOKEN_THRESHOLD, estimateBatchTokens, formatTokens } from './aiCost'

describe('estimateBatchTokens', () => {
  it('没有照片就不产生消耗', () => {
    expect(estimateBatchTokens('quality', 0)).toEqual({ tokens: 0, heavy: false })
    expect(estimateBatchTokens('smartFilter', 0)).toEqual({ tokens: 0, heavy: false })
  })

  it('评分：少量不警示，评满 12 张算大量', () => {
    expect(estimateBatchTokens('quality', 2).heavy).toBe(false)
    expect(estimateBatchTokens('quality', 12).heavy).toBe(true)
  })

  it('智能筛选：6 张一批不警示，30 张超过阈值', () => {
    expect(estimateBatchTokens('smartFilter', 6).heavy).toBe(false)
    const max = estimateBatchTokens('smartFilter', 30)
    expect(max.tokens).toBeGreaterThanOrEqual(HEAVY_TOKEN_THRESHOLD)
    expect(max.heavy).toBe(true)
  })
})

describe('formatTokens', () => {
  it('上万用万为单位，小量取百位粗估', () => {
    expect(formatTokens(10200)).toBe('约 1.0 万 token')
    expect(formatTokens(21399)).toBe('约 2.1 万 token')
    expect(formatTokens(1360)).toBe('约 1400 token')
    expect(formatTokens(12)).toBe('约 100 token')
  })
})
