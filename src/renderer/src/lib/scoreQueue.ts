/**
 * AI 评分队列：按星级门槛挑出可以送评的照片。
 * 门槛为 0 表示全部照片；大于 0 时只保留 rating >= 门槛，未标星（0 星）和低于门槛的一律跳过。
 */
export function pickScorable(
  ids: number[],
  ratings: Map<number, number>,
  minRating: number
): number[] {
  if (!(minRating > 0)) return [...ids]
  return ids.filter((id) => (ratings.get(id) ?? 0) >= minRating)
}
