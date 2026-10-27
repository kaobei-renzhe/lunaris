import { basename, dirname, extname } from 'node:path'
import { RAW_EXT } from '../shared/formats'

export interface GroupRow {
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

export interface GroupPlan {
  isRaw: number
  pairKey: string | null
  pairCover: number
  burstKey: string | null
  burstCover: number
}

/** 连拍判定：相邻两张不超过 2 秒，且一组至少 3 张 */
export const BURST_GAP_MS = 2000
export const BURST_MIN = 3

export function cameraOf(exifJson: string | null): string | null {
  if (!exifJson) return null
  try {
    const parsed = JSON.parse(exifJson) as { camera?: string }
    return parsed.camera?.trim() || null
  } catch {
    return null
  }
}

/** 同目录 + 同主名（不含扩展名），统一小写，Windows 下大小写不敏感 */
export function pairBaseKey(path: string): string {
  const dir = dirname(path).toLowerCase()
  const name = basename(path, extname(path)).toLowerCase()
  return `${dir}|${name}`
}

function isRawExt(ext: string): boolean {
  return RAW_EXT.has(ext.toLowerCase())
}

/** 连拍组 key：取组内最早一张的 id，出问题时方便定位 */
export function burstKeyOf(firstId: number): string {
  return `b${firstId}`
}

/**
 * 算出每一行该写什么分组字段（纯计算，不碰数据库）：
 * 1. 配对：同目录同主名、且同时存在 RAW 与普通图的合成一组，RAW 当封面（多张 RAW 取 id 最小）。
 * 2. 连拍：只看各组代表张（有手动堆叠的、配对里的副件都不参与），
 *    同一机身、相邻拍摄时间 ≤2 秒且至少 3 张，封面取评分最高（同分取 id 小）。
 * 3. 配对里的副件跟着封面进同一个连拍组。
 */
export function buildGroupPlans(rows: GroupRow[]): Map<number, GroupPlan> {
  const plans = new Map<number, GroupPlan>()
  for (const row of rows) {
    plans.set(row.id, {
      isRaw: isRawExt(row.ext) ? 1 : 0,
      pairKey: null,
      pairCover: 0,
      burstKey: null,
      burstCover: 0
    })
  }

  // 1. RAW + JPEG 配对
  const byBase = new Map<string, GroupRow[]>()
  for (const row of rows) {
    const key = pairBaseKey(row.path)
    const list = byBase.get(key) ?? []
    list.push(row)
    byBase.set(key, list)
  }

  for (const [key, members] of byBase) {
    if (members.length < 2) continue
    const raws = members.filter((member) => isRawExt(member.ext))
    const others = members.filter((member) => !isRawExt(member.ext))
    if (raws.length === 0 || others.length === 0) continue

    const cover = [...raws].sort((a, b) => a.id - b.id)[0]
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
      // 没有机身信息的连拍无法确认是同一台机器，宁可不合并
      if (camera) {
        const cover = [...group].sort((a, b) => b.rating - a.rating || a.id - b.id)[0]
        const burstKey = burstKeyOf(group[0].id)
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

  // 3. 配对里的副件跟着封面走同一个连拍组
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

  return plans
}
