import { describe, expect, it } from 'vitest'
import { pickScorable } from './scoreQueue'

const ratings = new Map([
  [1, 0],
  [2, 1],
  [3, 3],
  [4, 5]
])
const ids = [1, 2, 3, 4, 99]

describe('pickScorable', () => {
  it('门槛为 0 时全部照片都参与', () => {
    expect(pickScorable(ids, ratings, 0)).toEqual(ids)
  })

  it('门槛大于 0 时只保留达标的照片，未标星与未知 id 都跳过', () => {
    expect(pickScorable(ids, ratings, 3)).toEqual([3, 4])
  })

  it('门槛高于所有星级时队列为空', () => {
    expect(pickScorable(ids, ratings, 5)).toEqual([4])
    expect(pickScorable(ids, ratings, 6)).toEqual([])
  })
})
