export type Direction = 'up' | 'down' | 'left' | 'right'

export interface NavBox {
  id: number
  x: number
  y: number
  w: number
  h: number
}

/**
 * 九宫格式方向导航：从 from 出发，在 direction 方向上挑最合适的一块。
 * 评分 = 主方向距离 + 2.5 × 侧向偏移，并过滤掉偏角过大的斜对角目标，
 * 这样瀑布流里 ↑↓ 会留在同一列，←→ 才跨列。
 */
export function pickSpatialNeighbor(
  from: NavBox,
  candidates: NavBox[],
  direction: Direction
): number | null {
  const cx = from.x + from.w / 2
  const cy = from.y + from.h / 2
  const horizontal = direction === 'left' || direction === 'right'
  let bestId: number | null = null
  let bestScore = Number.POSITIVE_INFINITY

  for (const box of candidates) {
    if (box.id === from.id) continue
    const dx = box.x + box.w / 2 - cx
    const dy = box.y + box.h / 2 - cy
    const forward =
      direction === 'right' ? dx : direction === 'left' ? -dx : direction === 'down' ? dy : -dy
    // 必须真的落在目标方向上，留 4px 容差给取整误差
    if (forward <= 4) continue
    const lateral = horizontal ? Math.abs(dy) : Math.abs(dx)
    // 偏得太多的斜对角不要：竖向只认正上下方，横向只认同排附近的卡片
    if (lateral > forward * 1.2 + 8) continue
    const score = forward + lateral * 2.5
    if (score < bestScore) {
      bestScore = score
      bestId = box.id
    }
  }
  return bestId
}
