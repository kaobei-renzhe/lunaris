import { describe, expect, it } from 'vitest'
import { pickSpatialNeighbor, type NavBox } from './spatialNav'

/** 三列瀑布流，列宽 200、间距 12，各列高度错开（模拟真实错位） */
const boxes: NavBox[] = [
  { id: 1, x: 0, y: 0, w: 200, h: 300 }, // 第 1 列
  { id: 2, x: 0, y: 312, w: 200, h: 260 },
  { id: 3, x: 0, y: 584, w: 200, h: 200 },
  { id: 4, x: 212, y: 0, w: 200, h: 220 }, // 第 2 列
  { id: 5, x: 212, y: 232, w: 200, h: 340 },
  { id: 6, x: 212, y: 584, w: 200, h: 180 },
  { id: 7, x: 424, y: 0, w: 200, h: 400 }, // 第 3 列
  { id: 8, x: 424, y: 412, w: 200, h: 300 }
]

const at = (id: number): NavBox => boxes.find((box) => box.id === id) as NavBox

describe('pickSpatialNeighbor', () => {
  it('向下留在同一列，不会被相邻列更近的卡片抢走', () => {
    expect(pickSpatialNeighbor(at(1), boxes, 'down')).toBe(2)
    expect(pickSpatialNeighbor(at(2), boxes, 'down')).toBe(3)
  })

  it('向上留在同一列', () => {
    expect(pickSpatialNeighbor(at(5), boxes, 'up')).toBe(4)
    expect(pickSpatialNeighbor(at(3), boxes, 'up')).toBe(2)
  })

  it('向右跨到相邻列里纵向最接近的那张', () => {
    expect(pickSpatialNeighbor(at(1), boxes, 'right')).toBe(4)
    expect(pickSpatialNeighbor(at(5), boxes, 'right')).toBe(8)
  })

  it('向左跨列时取纵向最接近的那张', () => {
    expect(pickSpatialNeighbor(at(8), boxes, 'left')).toBe(6)
    expect(pickSpatialNeighbor(at(4), boxes, 'left')).toBe(1)
  })

  it('该方向没有卡片时返回 null，交给调用方回退', () => {
    expect(pickSpatialNeighbor(at(7), boxes, 'up')).toBeNull()
    expect(pickSpatialNeighbor(at(6), boxes, 'down')).toBeNull()
    expect(pickSpatialNeighbor(at(1), boxes, 'left')).toBeNull()
  })
})
