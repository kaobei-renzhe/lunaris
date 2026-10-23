import { basename, dirname, extname } from 'node:path'
import { getDb } from './db'
import { RAW_EXT } from '../shared/formats'

interface GroupRow {
  id: number
  path: string
  ext: string
  mtime: number
  rating: number
  exif: string | null
  is_raw: number
  pair_key: string | null
  pair_cover: number
  burst_key: string | null
  burst_cover: number
  stack_id: number | null
  stack_cover: number
}

interface Plan {
  isRaw: number
  pairKey: string | null
  pairCover: number
  burstKey: string | null
  burstCover: number
}

const BURST_GAP_MS = 2000
const BURST_MIN = 3

function cameraOf(exifJson: string | null): string | null {
  if (!exifJson) return null
  try {
    const parsed = JSON.parse(exifJson) as { camera?: string }
    return parsed.camera?.trim() || null
  } catch {
    return null
  }
}

function baseKey(path: string): string {
  const dir = dirname(path).toLowerCase()
  const name = basename(path, extname(path)).toLowerCase()
  return `${dir}|${name}`
}

/**
 * 重算分组：
 * 1. 配对：同目录同主名、且同时存在 RAW 与普通图的，合成一组（RAW 当封面）。
 * 2. 连拍：同一机身、相邻拍摄时间 ≤2 秒且至少 3 张的，合成一组（封面取评分最高）。
 * 只写有变化的行，避免每次开库都刷全表。
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

  const plans = new Map<number, Plan>()
  for (const row of rows) {
    plans.set(row.id, {
      isRaw: RAW_EXT.has(row.ext.toLowerCase()) ? 1 : 0,
      pairKey: null,
      pairCover: 0,
      burstKey: null,
      burstCover: 0
    })
  }

  // 1. RAW + JPEG 配对
  const byBase = new Map<string, GroupRow[]>()
  for (const row of rows) {
    const key = baseKey(row.path)
    const list = byBase.get(key) ?? []
    list.push(row)
    byBase.set(key, list)
  }

  for (const [key, members] of byBase) {
    if (members.length < 2) continue
    const raws = members.filter((m) => RAW_EXT.has(m.ext.toLowerCase()))
    const others = members.filter((m) => !RAW_EXT.has(m.ext.toLowerCase()))
    if (raws.length === 0 || others.length === 0) continue

    const cover = raws.sort((a, b) => a.id - b.id)[0]
    for (const member of members) {
      const plan = plans.get(member.id)
      if (!plan) continue
      plan.pairKey = key
      plan.pairCover = member.id === cover.id ? 1 : 0
    }
  }

  // 2. 连拍堆叠（只看每组的代表张；手动堆叠的成员不参与自动连拍）
  const representatives = rows.filter((row) => {
    if (row.stack_id) return false
    const plan = plans.get(row.id)
    return plan && (plan.pairKey === null || plan.pairCover === 1)
  })

  const sorted = [...representatives].sort((a, b) => a.mtime - b.mtime || a.id - b.id)
  let group: GroupRow[] = []

  const flush = (): void => {
    if (group.length >= BURST_MIN) {
      const camera = cameraOf(group[0].exif)
      if (camera) {
        const cover = [...group].sort((a, b) => b.rating - a.rating || a.id - b.id)[0]
        const burstKey = `b${group[0].id}`
        for (const member of group) {
          const plan = plans.get(member.id)
          if (!plan) continue
          plan.burstKey = burstKey
          plan.burstCover = member.id === cover.id ? 1 : 0
        }
      }
    }
    group = []
  }

  for (const row of sorted) {
    if (!row.mtime) {
      flush()
      continue
    }
    if (group.length === 0) {
      group = [row]
      continue
    }
    const previous = group[group.length - 1]
    const sameCamera = cameraOf(previous.exif) === cameraOf(row.exif)
    const close = row.mtime - previous.mtime <= BURST_GAP_MS
    if (sameCamera && close) {
      group.push(row)
    } else {
      flush()
      group = [row]
    }
  }
  flush()

  // 配对里的副件跟着封面走同一个连拍组
  const pairCoverByKey = new Map<string, GroupRow>()
  for (const row of rows) {
    const plan = plans.get(row.id)
    if (plan?.pairKey && plan.pairCover === 1) pairCoverByKey.set(plan.pairKey, row)
  }
  for (const row of rows) {
    const plan = plans.get(row.id)
    if (!plan || !plan.pairKey || plan.pairCover === 1) continue
    const coverRow = pairCoverByKey.get(plan.pairKey)
    if (!coverRow) continue
    const coverPlan = plans.get(coverRow.id)
    if (!coverPlan) continue
    plan.burstKey = coverPlan.burstKey
    plan.burstCover = 0
  }

  // 3. 手动堆叠：封面失效时补一个，空堆叠直接清掉
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

  // 4. 写入（只写变化行）
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
