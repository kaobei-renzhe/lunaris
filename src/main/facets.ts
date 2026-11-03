import { getDb } from './db'
import { createTag } from './repo'
import type { Facet, FacetValue } from '../shared/types'

interface FacetRow {
  id: string
  name: string
  multi: number
  sort: number
  tag_id: number | null
  tag_name: string | null
  tag_color: string | null
  count: number
}

/** 维度 + 取值 + 每个取值的照片数（不含回收站与丢失记录） */
export function listFacets(): Facet[] {
  const rows = getDb()
    .prepare(
      `SELECT f.id, f.name, f.multi, f.sort,
              t.id AS tag_id, t.name AS tag_name, t.color AS tag_color,
              coalesce(SUM(CASE WHEN i.id IS NULL THEN 0 ELSE 1 END), 0) AS count
       FROM facets f
       LEFT JOIN tags t ON t.facet_id = f.id
       LEFT JOIN item_tags it ON it.tag_id = t.id
       LEFT JOIN items i ON i.id = it.item_id AND i.trashed = 0 AND i.missing = 0
       GROUP BY f.id, t.id
       ORDER BY f.sort, f.name COLLATE NOCASE, t.name COLLATE NOCASE`
    )
    .all() as FacetRow[]

  const map = new Map<string, Facet>()
  for (const row of rows) {
    let facet = map.get(row.id)
    if (!facet) {
      facet = { id: row.id, name: row.name, multi: row.multi === 1, sort: row.sort, values: [] }
      map.set(row.id, facet)
    }
    if (row.tag_id !== null && row.tag_name) {
      facet.values.push({
        id: row.tag_id,
        name: row.tag_name,
        color: row.tag_color ?? '#7aa2f7',
        count: row.count
      })
    }
  }
  return [...map.values()]
}

export function createFacet(name: string): Facet {
  const clean = name.trim()
  if (!clean) throw new Error('维度名不能为空')
  const db = getDb()
  const exists = db.prepare('SELECT id FROM facets WHERE name = ?').get(clean)
  if (exists) throw new Error('已经有同名维度了')
  const id = `facet_${Date.now().toString(36)}`
  const sort = (
    db.prepare('SELECT coalesce(MAX(sort), 0) + 1 AS next FROM facets').get() as { next: number }
  ).next
  db.prepare('INSERT INTO facets(id, name, multi, sort, builtin) VALUES(?, ?, 1, ?, 0)').run(
    id,
    clean,
    sort
  )
  return { id, name: clean, multi: true, sort, values: [] }
}

export function renameFacet(id: string, name: string): void {
  const clean = name.trim()
  if (!clean) throw new Error('维度名不能为空')
  const db = getDb()
  const clash = db.prepare('SELECT id FROM facets WHERE name = ? AND id <> ?').get(clean, id)
  if (clash) throw new Error('已经有同名维度了')
  db.prepare('UPDATE facets SET name = ? WHERE id = ?').run(clean, id)
}

/** 删维度只解除标签归属，标签本身与照片上的标记都保留，降级成普通标签 */
export function deleteFacet(id: string): void {
  const db = getDb()
  const tx = db.transaction(() => {
    db.prepare('UPDATE tags SET facet_id = NULL WHERE facet_id = ?').run(id)
    db.prepare('DELETE FROM facets WHERE id = ?').run(id)
  })
  tx()
}

export function createFacetValue(facetId: string, name: string): FacetValue {
  const clean = name.trim()
  if (!clean) throw new Error('取值不能为空')
  const db = getDb()
  const facet = db.prepare('SELECT id FROM facets WHERE id = ?').get(facetId)
  if (!facet) throw new Error('维度不存在')
  const existing = db.prepare('SELECT id, facet_id FROM tags WHERE name = ?').get(clean) as
    | { id: number; facet_id: string | null }
    | undefined
  if (existing && existing.facet_id && existing.facet_id !== facetId) {
    throw new Error('同名标签已属于其他维度')
  }
  const tag = createTag(clean)
  db.prepare('UPDATE tags SET facet_id = ? WHERE id = ?').run(facetId, tag.id)
  return { id: tag.id, name: tag.name, color: tag.color, count: tag.count ?? 0 }
}

function facetValueIds(facetId: string): number[] {
  return (
    getDb().prepare('SELECT id FROM tags WHERE facet_id = ?').all(facetId) as Array<{ id: number }>
  ).map((row) => row.id)
}

/** 单张照片：整体替换某个维度的取值（multi=false 时传一个即可） */
export function setItemFacet(itemId: number, facetId: string, tagIds: number[]): void {
  const db = getDb()
  const allowed = new Set(facetValueIds(facetId))
  const picked = tagIds.filter((id) => allowed.has(id))
  const all = [...allowed]
  const tx = db.transaction(() => {
    const remove = db.prepare('DELETE FROM item_tags WHERE item_id = ? AND tag_id = ?')
    for (const tagId of all) remove.run(itemId, tagId)
    const insert = db.prepare('INSERT OR IGNORE INTO item_tags(item_id, tag_id) VALUES(?, ?)')
    for (const tagId of picked) insert.run(itemId, tagId)
  })
  tx()
}

/** 批量：给多张照片加/去某一个维度的取值 */
export function bulkSetFacetValue(
  itemIds: number[],
  facetId: string,
  tagId: number,
  add: boolean
): void {
  const allowed = new Set(facetValueIds(facetId))
  if (!allowed.has(tagId)) throw new Error('取值不属于该维度')
  const db = getDb()
  const stmt = add
    ? db.prepare('INSERT OR IGNORE INTO item_tags(item_id, tag_id) VALUES(?, ?)')
    : db.prepare('DELETE FROM item_tags WHERE item_id = ? AND tag_id = ?')
  const tx = db.transaction(() => {
    for (const itemId of itemIds) stmt.run(itemId, tagId)
  })
  tx()
}
