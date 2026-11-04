import { describe, expect, it } from 'vitest'
import { inAiScope, outOfScopeText } from './aiScope'

const scope = { minRating: 3, folderIds: [7] }
const inScopeItem = { rating: 4, folderIds: [7, 9] }
const lowRating = { rating: 2, folderIds: [7] }
const otherFolder = { rating: 5, folderIds: [8] }
const noFolder = { rating: 3, folderIds: [] }

describe('inAiScope', () => {
  it('星级与文件夹都满足才在范围内', () => {
    expect(inAiScope(inScopeItem, scope)).toBe(true)
    expect(inAiScope(lowRating, scope)).toBe(false)
    expect(inAiScope(otherFolder, scope)).toBe(false)
  })

  it('门槛为 0 且没选文件夹时全部放行', () => {
    expect(inAiScope(lowRating, { minRating: 0, folderIds: [] })).toBe(true)
    expect(inAiScope(noFolder, { minRating: 0, folderIds: [] })).toBe(true)
  })
})

describe('outOfScopeText', () => {
  it('先说星级，再说文件夹', () => {
    expect(outOfScopeText(lowRating, scope)).toContain('只有 2 星')
    expect(outOfScopeText({ rating: 0, folderIds: [7] }, scope)).toContain('还没标星')
    expect(outOfScopeText(otherFolder, scope)).toContain('不在「AI 处理范围」选中的文件夹里')
  })
})
