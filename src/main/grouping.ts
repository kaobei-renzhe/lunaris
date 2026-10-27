import { getDb } from './db'
import { buildGroupPlans, type GroupRow } from './groupingRules'

/**
 * 重算分组：
 * 1. 配对：同目录同主名、且同时存在 RAW 与普通图的，合成一组（RAW 当封面）。
 * 2. 连拍：同一机身、相邻拍摄时间 ≤2 秒且至少 3 张的，合成一组（封面取评分最高）。
 * 只写有变化的行，避免每次开库都刷全表。
 * 分组规则本身在 groupingRules.ts（纯函数、可单测），这里只负责取数与写回。
 */
export function regroup(): void {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT id, path, ext, mtime, rating, exif, is_raw, pair_key, pair_cover, burst_key, burst_cover,
              stack_id, stack_cover
       FROM items WHERE trashed = 0 AND missing = 0`
    )
    .all() as GroupRow[]

  if (rows.length === 0) return

  const plans = buildGroupPlans(rows)

  // 手动堆叠：封面失效时补一个，空堆叠直接清掉
  const stacks = new Map<number, GroupRow[]>()
  for (const row of rows) {
    if (!row.stack_id) continue
    const list = stacks.get(row.stack_id) ?? []
    list.push(row)
    stacks.set(row.stack_id, list)
  }
  for (const [stackId, members] of stacks) {
    if (members.some((member) => member.stack_cover === 1)) continue
    const cover = [...members].sort((a, b) => b.rating - a.rating || a.id - b.id)[0]
    db.prepare(
      'UPDATE items SET stack_cover = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE stack_id = ?'
    ).run(cover.id, stackId)
  }
  const allStacks = db.prepare('SELECT id FROM stacks').all() as Array<{ id: number }>
  for (const stack of allStacks) {
    if (stacks.has(stack.id)) continue
    db.prepare('UPDATE items SET stack_id = NULL, stack_cover = 0 WHERE stack_id = ?').run(stack.id)
    db.prepare('DELETE FROM stacks WHERE id = ?').run(stack.id)
  }

  // 写入（只写变化行）
  const update = db.prepare(
    `UPDATE items SET is_raw = ?, pair_key = ?, pair_cover = ?, burst_key = ?, burst_cover = ?
     WHERE id = ?`
  )
  const tx = db.transaction(() => {
    for (const row of rows) {
      const plan = plans.get(row.id)
      if (!plan) continue
      const changed =
        row.is_raw !== plan.isRaw ||
        (row.pair_key ?? null) !== plan.pairKey ||
        row.pair_cover !== plan.pairCover ||
        (row.burst_key ?? null) !== plan.burstKey ||
        row.burst_cover !== plan.burstCover
      if (changed) {
        update.run(plan.isRaw, plan.pairKey, plan.pairCover, plan.burstKey, plan.burstCover, row.id)
      }
    }
  })
  tx()
}
