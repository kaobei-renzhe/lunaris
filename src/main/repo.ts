import { join } from 'node:path'
import { existsSync, unlinkSync } from 'node:fs'
import type { Database } from 'better-sqlite3'
import { getDb, getLibraryPath } from './db'
import { RAW_EXT } from '../shared/formats'
import type {
  DuplicateGroup,
  ExifData,
  FilterState,
  Folder,
  Item,
  SmartFolder,
  Stats,
  Tag
} from '../shared/types'

interface ItemRow {
  id: number
  path: string
  name: string
  ext: string
  size: number
  width: number
  height: number
  mtime: number
  added_at: number
  hash: string | null
  dominant: string | null
  color_family: string | null
  palette: string | null
  exif: string | null
  rating: number
  note: string
  url: string | null
  missing: number
  flag: number
  pair_key: string | null
  burst_key: string | null
  stack_id: number | null
  stack_cover: number
}

export function thumbPathFor(id: number, small = false): string {
  const bucket = String(id % 100).padStart(2, '0')
  return join(getLibraryPath(), 'thumbnails', bucket, `${id}${small ? '_s' : ''}.webp`)
}

export function previewPathFor(id: number): string {
  const bucket = String(id % 100).padStart(2, '0')
  return join(getLibraryPath(), 'previews', bucket, `${id}.jpg`)
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

function loadTagsFor(db: Database, ids: number[]): Map<number, Tag[]> {
  const map = new Map<number, Tag[]>()
  if (ids.length === 0) return map
  for (const part of chunk(ids, 400)) {
    const rows = db
      .prepare(
        `SELECT it.item_id, t.id, t.name, t.color
         FROM item_tags it JOIN tags t ON t.id = it.tag_id
         WHERE it.item_id IN (${part.map(() => '?').join(',')})`
      )
      .all(...part) as Array<{ item_id: number; id: number; name: string; color: string }>
    for (const r of rows) {
      const list = map.get(r.item_id) ?? []
      list.push({ id: r.id, name: r.name, color: r.color, count: 0 })
      map.set(r.item_id, list)
    }
  }
  return map
}

function loadFoldersFor(db: Database, ids: number[]): Map<number, number[]> {
  const map = new Map<number, number[]>()
  if (ids.length === 0) return map
  for (const part of chunk(ids, 400)) {
    const rows = db
      .prepare(
        `SELECT item_id, folder_id FROM item_folders
         WHERE item_id IN (${part.map(() => '?').join(',')})`
      )
      .all(...part) as Array<{ item_id: number; folder_id: number }>
    for (const r of rows) {
      const list = map.get(r.item_id) ?? []
      list.push(r.folder_id)
      map.set(r.item_id, list)
    }
  }
  return map
}

function mapItems(rows: ItemRow[]): Item[] {
  const db = getDb()
  const ids = rows.map((r) => r.id)
  const tagMap = loadTagsFor(db, ids)
  const folderMap = loadFoldersFor(db, ids)
  const { pairCounts, burstCounts, stackCounts } = loadGroupCounts(db, rows)
  return rows.map((r) => ({
    id: r.id,
    path: r.path,
    name: r.name,
    ext: r.ext,
    size: r.size,
    width: r.width,
    height: r.height,
    mtime: r.mtime,
    addedAt: r.added_at,
    rating: r.rating,
    note: r.note,
    url: r.url,
    flag: r.flag,
    pairCount: r.pair_key ? pairCounts.get(r.pair_key) ?? 1 : 1,
    burstCount: r.burst_key ? burstCounts.get(r.burst_key) ?? 1 : 1,
    stackId: r.stack_id,
    stackCount: r.stack_id ? stackCounts.get(r.stack_id) ?? 1 : 1,
    groupKey: r.stack_id ? `s${r.stack_id}` : r.burst_key,
    groupCount: r.stack_id
      ? stackCounts.get(r.stack_id) ?? 1
      : r.burst_key
        ? burstCounts.get(r.burst_key) ?? 1
        : 1,
    dominant: r.dominant,
    palette: parseJson<string[]>(r.palette) ?? [],
    exif: parseJson<ExifData>(r.exif),
    missing: r.missing,
    tags: tagMap.get(r.id) ?? [],
    folderIds: folderMap.get(r.id) ?? []
  }))
}

function loadGroupCounts(
  db: Database,
  rows: ItemRow[]
): {
  pairCounts: Map<string, number>
  burstCounts: Map<string, number>
  stackCounts: Map<number, number>
} {
  const pairKeys = Array.from(new Set(rows.map((r) => r.pair_key).filter((k): k is string => !!k)))
  const burstKeys = Array.from(new Set(rows.map((r) => r.burst_key).filter((k): k is string => !!k)))
  const stackIds = Array.from(new Set(rows.map((r) => r.stack_id).filter((k): k is number => !!k)))
  const pairCounts = new Map<string, number>()
  const burstCounts = new Map<string, number>()
  const stackCounts = new Map<number, number>()

  for (const part of chunk(pairKeys, 400)) {
    const found = db
      .prepare(
        `SELECT pair_key, COUNT(*) AS c FROM items
         WHERE trashed = 0 AND pair_key IN (${part.map(() => '?').join(',')})
         GROUP BY pair_key`
      )
      .all(...part) as Array<{ pair_key: string; c: number }>
    for (const row of found) pairCounts.set(row.pair_key, row.c)
  }

  for (const part of chunk(burstKeys, 400)) {
    const found = db
      .prepare(
        `SELECT burst_key, COUNT(*) AS c FROM items
         WHERE trashed = 0 AND burst_key IN (${part.map(() => '?').join(',')})
           AND (pair_key IS NULL OR pair_cover = 1)
         GROUP BY burst_key`
      )
      .all(...part) as Array<{ burst_key: string; c: number }>
    for (const row of found) burstCounts.set(row.burst_key, row.c)
  }

  for (const stackId of stackIds) {
    const found = db
      .prepare(
        `SELECT COUNT(*) AS c FROM items
         WHERE trashed = 0 AND missing = 0 AND stack_id = ?`
      )
      .get(stackId) as { c: number }
    stackCounts.set(stackId, found.c)
  }

  return { pairCounts, burstCounts, stackCounts }
}

function buildWhere(filter: FilterState, params: Array<string | number>): string[] {
  const where: string[] = ['i.trashed = 0']
  const expandedGroups = filter.expandedGroups ?? []
  const expandedBursts = expandedGroups.filter((key) => key.startsWith('b'))
  const expandedStacks = expandedGroups
    .filter((key) => key.startsWith('s'))
    .map((key) => Number(key.slice(1)))
    .filter((value) => Number.isFinite(value))

  if (filter.missing) {
    // 丢失视图不折叠分组，逐张展示才方便重新定位
    where.push('i.missing = 1')
  } else {
    where.push('i.missing = 0', '(i.pair_key IS NULL OR i.pair_cover = 1)')

    if (expandedStacks.length) {
      where.push(
        `(i.stack_id IS NULL OR i.stack_cover = 1 OR i.stack_id IN (${expandedStacks
          .map(() => '?')
          .join(',')}))`
      )
      params.push(...expandedStacks)
    } else {
      where.push('(i.stack_id IS NULL OR i.stack_cover = 1)')
    }

    if (!filter.expandBursts) {
      if (expandedBursts.length) {
        where.push(
          `(i.burst_key IS NULL OR i.burst_cover = 1 OR i.burst_key IN (${expandedBursts
            .map(() => '?')
            .join(',')}))`
        )
        params.push(...expandedBursts)
      } else {
        where.push('(i.burst_key IS NULL OR i.burst_cover = 1)')
      }
    }
  }
  if (filter.flag) {
    where.push('i.flag = ?')
    params.push(filter.flag)
  }

  if (filter.minRating && filter.minRating > 0) {
    where.push('i.rating >= ?')
    params.push(filter.minRating)
  }
  if (filter.colorFamily) {
    where.push('i.color_family = ?')
    params.push(filter.colorFamily)
  }
  if (filter.orientation === 'landscape') where.push('i.width > i.height')
  if (filter.orientation === 'portrait') where.push('i.height > i.width')
  if (filter.orientation === 'square') where.push('i.width = i.height')

  if (filter.folderId) {
    where.push('EXISTS (SELECT 1 FROM item_folders f WHERE f.item_id = i.id AND f.folder_id = ?)')
    params.push(filter.folderId)
  }

  for (const tagId of filter.tagIds ?? []) {
    where.push('EXISTS (SELECT 1 FROM item_tags it WHERE it.item_id = i.id AND it.tag_id = ?)')
    params.push(tagId)
  }

  const q = (filter.query ?? '').trim()
  if (q) {
    const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`
    if (q.length >= 3) {
      const fts = `"${q.replace(/"/g, '""')}"`
      where.push(
        `(i.id IN (SELECT rowid FROM items_fts WHERE items_fts MATCH ?)
          OR EXISTS (SELECT 1 FROM item_tags it2 JOIN tags t2 ON t2.id = it2.tag_id
                     WHERE it2.item_id = i.id AND t2.name LIKE ? ESCAPE '\\'))`
      )
      params.push(fts, like)
    } else {
      where.push(
        `(i.name LIKE ? ESCAPE '\\' OR i.note LIKE ? ESCAPE '\\' OR coalesce(i.url, '') LIKE ? ESCAPE '\\'
          OR EXISTS (SELECT 1 FROM item_tags it2 JOIN tags t2 ON t2.id = it2.tag_id
                     WHERE it2.item_id = i.id AND t2.name LIKE ? ESCAPE '\\'))`
      )
      params.push(like, like, like, like)
    }
  }

  return where
}

export function listItems(
  filter: FilterState,
  offset = 0,
  limit = 200
): { items: Item[]; total: number } {
  const db = getDb()
  const params: Array<string | number> = []
  const where = buildWhere(filter, params)
  const whereSql = `WHERE ${where.join(' AND ')}`
  const orderMap: Record<string, string> = {
    added: 'i.added_at DESC, i.id DESC',
    name: 'i.name COLLATE NOCASE ASC',
    mtime: 'i.mtime DESC',
    rating: 'i.rating DESC, i.added_at DESC',
    size: 'i.size DESC'
  }
  const order = orderMap[filter.sort ?? 'added'] ?? orderMap.added

  const total = (db.prepare(`SELECT COUNT(*) AS c FROM items i ${whereSql}`).get(...params) as {
    c: number
  }).c

  const rows = db
    .prepare(`SELECT i.* FROM items i ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as ItemRow[]

  return { items: mapItems(rows), total }
}

/**
 * 当前筛选条件下所有可见条目的 id（语义搜图用来限定候选范围）。
 */
export function filteredIds(filter: FilterState): Set<number> {
  const db = getDb()
  const params: Array<string | number> = []
  const where = buildWhere(filter, params)
  const rows = db
    .prepare(`SELECT i.id FROM items i WHERE ${where.join(' AND ')}`)
    .all(...params) as Array<{ id: number }>
  return new Set(rows.map((row) => row.id))
}

export function getItemsByIds(ids: number[]): Item[] {
  if (ids.length === 0) return []
  const db = getDb()
  const found = new Map<number, Item>()
  for (const part of chunk(ids, 400)) {
    const rows = db
      .prepare(`SELECT * FROM items WHERE id IN (${part.map(() => '?').join(',')})`)
      .all(...part) as ItemRow[]
    for (const item of mapItems(rows)) found.set(item.id, item)
  }
  return ids.map((id) => found.get(id)).filter((item): item is Item => !!item)
}

export function getItem(id: number): Item | null {
  const row = getDb().prepare('SELECT * FROM items WHERE id = ?').get(id) as ItemRow | undefined
  if (!row) return null
  return mapItems([row])[0] ?? null
}

/**
 * 灯箱/详情页真正要显示的文件：RAW 用导入时抽出的内嵌预览，TIFF 用转好的 JPEG 预览。
 */
export function getItemFile(id: number): string | null {
  const row = getDb().prepare('SELECT path, ext FROM items WHERE id = ?').get(id) as
    | { path: string; ext: string }
    | undefined
  if (!row) return null
  if (RAW_EXT.has(row.ext) || row.ext === '.tif' || row.ext === '.tiff') {
    const preview = previewPathFor(id)
    if (existsSync(preview)) return preview
  }
  return row.path
}

/**
 * 灯箱专用：TIFF 没有预览时退到大缩略图，避免 Chromium 直接渲染原图导致空白。
 */
export function getLightboxFile(id: number): string | null {
  const row = getDb().prepare('SELECT path, ext FROM items WHERE id = ?').get(id) as
    | { path: string; ext: string }
    | undefined
  if (!row) return null
  if (row.ext === '.tif' || row.ext === '.tiff') {
    const preview = previewPathFor(id)
    if (existsSync(preview)) return preview
    const thumb = thumbPathFor(id)
    if (existsSync(thumb)) return thumb
  }
  return getItemFile(id)
}

export function updateItem(
  id: number,
  patch: { rating?: number; note?: string; url?: string; flag?: number }
): void {
  const sets: string[] = []
  const params: Array<string | number> = []
  if (patch.rating !== undefined) {
    sets.push('rating = ?')
    params.push(patch.rating)
  }
  if (patch.flag !== undefined) {
    sets.push('flag = ?')
    params.push(patch.flag)
  }
  if (patch.note !== undefined) {
    sets.push('note = ?')
    params.push(patch.note)
  }
  if (patch.url !== undefined) {
    sets.push('url = ?')
    params.push(patch.url)
  }
  if (sets.length === 0) return
  params.push(id)
  getDb().prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).run(...params)
}

/**
 * 移入回收站（软删除）：记录和缩略图都保留，方便 Ctrl+Z 撤销。
 */
export function trashItems(ids: number[]): void {
  const db = getDb()
  const stmt = db.prepare('UPDATE items SET trashed = 1 WHERE id = ?')
  const tx = db.transaction((list: number[]) => {
    for (const id of list) stmt.run(id)
  })
  tx(ids)
}

export function restoreItems(ids: number[]): void {
  const db = getDb()
  const stmt = db.prepare('UPDATE items SET trashed = 0 WHERE id = ?')
  const tx = db.transaction((list: number[]) => {
    for (const id of list) stmt.run(id)
  })
  tx(ids)
}

/**
 * 彻底删除记录与缓存文件，仅用于导入失败时的清理。
 */
export function purgeItems(ids: number[]): void {
  const db = getDb()
  const del = db.prepare('DELETE FROM items WHERE id = ?')
  const delTags = db.prepare('DELETE FROM item_tags WHERE item_id = ?')
  const delFolders = db.prepare('DELETE FROM item_folders WHERE item_id = ?')
  const delVectors = db.prepare('DELETE FROM embeddings WHERE item_id = ?')
  const delAutoTags = db.prepare('DELETE FROM auto_tags WHERE item_id = ?')
  const tx = db.transaction((list: number[]) => {
    for (const id of list) {
      del.run(id)
      delTags.run(id)
      delFolders.run(id)
      delVectors.run(id)
      delAutoTags.run(id)
      for (const p of [thumbPathFor(id), thumbPathFor(id, true), previewPathFor(id)]) {
        try {
          if (existsSync(p)) unlinkSync(p)
        } catch {
          /* 缩略图清理失败不影响记录删除 */
        }
      }
    }
  })
  tx(ids)
}

export interface Source {
  path: string
  recursive: number
}

/**
 * 手动堆叠：把选中的图片收成一组，封面取评分最高的一张。
 * 手动堆叠优先于自动连拍，成员原有的连拍标记会被清掉。
 */
export function createStack(ids: number[]): number {
  const db = getDb()
  const clean = Array.from(new Set(ids))
  if (clean.length < 2) throw new Error('至少选择两张图片')

  const rows = db
    .prepare(
      `SELECT id, rating FROM items
       WHERE trashed = 0 AND id IN (${clean.map(() => '?').join(',')})`
    )
    .all(...clean) as Array<{ id: number; rating: number }>
  if (rows.length < 2) throw new Error('可用的图片不足两张')

  const info = db.prepare('INSERT INTO stacks(name, created_at) VALUES(NULL, ?)').run(Date.now())
  const stackId = Number(info.lastInsertRowid)
  const cover = [...rows].sort((a, b) => b.rating - a.rating || a.id - b.id)[0]

  const update = db.prepare(
    `UPDATE items SET stack_id = ?, stack_cover = ?, burst_key = NULL, burst_cover = 0 WHERE id = ?`
  )
  const tx = db.transaction(() => {
    for (const row of rows) update.run(stackId, row.id === cover.id ? 1 : 0, row.id)
  })
  tx()
  return stackId
}

export function unstack(stackId: number): void {
  const db = getDb()
  const tx = db.transaction(() => {
    db.prepare('UPDATE items SET stack_id = NULL, stack_cover = 0 WHERE stack_id = ?').run(stackId)
    db.prepare('DELETE FROM stacks WHERE id = ?').run(stackId)
  })
  tx()
}

export function listSources(): Source[] {
  return getDb().prepare('SELECT path, recursive FROM sources').all() as Source[]
}

export function addSources(entries: Array<{ path: string; recursive: boolean }>): void {
  const db = getDb()
  const stmt = db.prepare('INSERT OR IGNORE INTO sources(path, recursive) VALUES(?, ?)')
  const tx = db.transaction(() => {
    for (const entry of entries) stmt.run(entry.path, entry.recursive ? 1 : 0)
  })
  tx()
}

export function markMissingByPath(paths: string[]): number {
  const db = getDb()
  const stmt = db.prepare('UPDATE items SET missing = 1 WHERE path = ? AND trashed = 0')
  let changed = 0
  const tx = db.transaction(() => {
    for (const p of paths) changed += stmt.run(p).changes
  })
  tx()
  return changed
}

/**
 * 文件被移动/改名后，把新路径接回原来的记录，保住标签和评分。
 * 优先按「文件名 + 大小」匹配；改名场景下名字会变，退化成「同大小且旧路径已不存在」的唯一候选。
 */
export function findMissingMatch(name: string, size: number): { id: number; path: string } | null {
  const rows = getDb()
    .prepare(
      `SELECT id, path, name, missing FROM items
       WHERE trashed = 0 AND size = ?
       ORDER BY (name = ?) DESC, missing DESC LIMIT 20`
    )
    .all(size, name) as Array<{ id: number; path: string; name: string; missing: number }>

  const orphans = rows.filter((row) => !existsSync(row.path))
  const sameName = orphans.find((row) => row.name === name)
  if (sameName) return sameName
  // 只有唯一孤儿时才认领，避免把同尺寸的另一张图错接过来
  return orphans.length === 1 ? orphans[0] : null
}

export function relinkItem(id: number, path: string, name: string, ext: string): boolean {
  try {
    getDb()
      .prepare('UPDATE items SET path = ?, name = ?, ext = ?, missing = 0 WHERE id = ?')
      .run(path, name, ext, id)
    return true
  } catch {
    // 新路径已被别的记录占用
    return false
  }
}

export function rescan(): { missing: number; restored: number } {
  const db = getDb()
  const rows = db.prepare('SELECT id, path, missing FROM items WHERE trashed = 0').all() as Array<{
    id: number
    path: string
    missing: number
  }>
  const upd = db.prepare('UPDATE items SET missing = ? WHERE id = ?')
  let missing = 0
  let restored = 0
  const tx = db.transaction(() => {
    for (const row of rows) {
      const gone = existsSync(row.path) ? 0 : 1
      if (gone !== row.missing) {
        upd.run(gone, row.id)
        if (gone) missing++
        else restored++
      } else if (gone) {
        missing++
      }
    }
  })
  tx()
  return { missing, restored }
}

export function stats(): Stats {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT
         coalesce(SUM(CASE WHEN missing = 0 THEN 1 ELSE 0 END), 0) AS total,
         coalesce(SUM(CASE WHEN missing = 0 THEN size ELSE 0 END), 0) AS bytes
       FROM items
       WHERE trashed = 0
         AND (pair_key IS NULL OR pair_cover = 1)
         AND (burst_key IS NULL OR burst_cover = 1)
         AND (stack_id IS NULL OR stack_cover = 1)`
    )
    .get() as { total: number; bytes: number }
  // 丢失数量按“逐张”统计，和「文件丢失」视图里的条数保持一致
  const missing = (
    db.prepare('SELECT COUNT(*) AS c FROM items WHERE trashed = 0 AND missing = 1').get() as {
      c: number
    }
  ).c
  const tags = (db.prepare('SELECT COUNT(*) AS c FROM tags').get() as { c: number }).c
  const folders = (db.prepare('SELECT COUNT(*) AS c FROM folders').get() as { c: number }).c
  return { total: row.total, missing, bytes: row.bytes, tags, folders }
}

export function listTags(): Tag[] {
  return getDb()
    .prepare(
      `SELECT t.id, t.name, t.color,
              coalesce(SUM(CASE WHEN i.id IS NULL THEN 0 ELSE 1 END), 0) AS count
       FROM tags t
       LEFT JOIN item_tags it ON it.tag_id = t.id
       LEFT JOIN items i ON i.id = it.item_id AND i.trashed = 0 AND i.missing = 0
       GROUP BY t.id ORDER BY t.name COLLATE NOCASE`
    )
    .all() as Tag[]
}

export function createTag(name: string, color = '#7aa2f7'): Tag {
  const db = getDb()
  const clean = name.trim()
  const existing = db.prepare('SELECT id, name, color FROM tags WHERE name = ?').get(clean) as
    | { id: number; name: string; color: string }
    | undefined
  if (existing) return { ...existing, count: 0 }
  const info = db
    .prepare('INSERT INTO tags(name, color, created_at) VALUES(?, ?, ?)')
    .run(clean, color, Date.now())
  return { id: Number(info.lastInsertRowid), name: clean, color, count: 0 }
}

export function deleteTag(id: number): void {
  const db = getDb()
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM item_tags WHERE tag_id = ?').run(id)
    db.prepare('DELETE FROM tags WHERE id = ?').run(id)
  })
  tx()
}

export function setTag(itemIds: number[], tagId: number, add: boolean): void {
  const db = getDb()
  const stmt = add
    ? db.prepare('INSERT OR IGNORE INTO item_tags(item_id, tag_id) VALUES(?, ?)')
    : db.prepare('DELETE FROM item_tags WHERE item_id = ? AND tag_id = ?')
  const tx = db.transaction(() => {
    for (const itemId of itemIds) stmt.run(itemId, tagId)
  })
  tx()
}

export function listFolders(): Folder[] {
  return getDb()
    .prepare(
      `SELECT f.id, f.name,
              coalesce(SUM(CASE WHEN i.id IS NULL THEN 0 ELSE 1 END), 0) AS count
       FROM folders f
       LEFT JOIN item_folders fi ON fi.folder_id = f.id
       LEFT JOIN items i ON i.id = fi.item_id AND i.trashed = 0 AND i.missing = 0
       GROUP BY f.id ORDER BY f.name COLLATE NOCASE`
    )
    .all() as Folder[]
}

export function createFolder(name: string): Folder {
  const db = getDb()
  const clean = name.trim()
  if (!clean) throw new Error('文件夹名不能为空')
  const existing = db
    .prepare('SELECT id, name FROM folders WHERE name = ?')
    .get(clean) as { id: number; name: string } | undefined
  if (existing) throw new Error('已经有同名文件夹了')
  const info = db
    .prepare('INSERT INTO folders(name, created_at) VALUES(?, ?)')
    .run(clean, Date.now())
  return { id: Number(info.lastInsertRowid), name: clean, count: 0 }
}

export function deleteFolder(id: number): void {
  const db = getDb()
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM item_folders WHERE folder_id = ?').run(id)
    db.prepare('DELETE FROM folders WHERE id = ?').run(id)
  })
  tx()
}

export function addToFolder(itemIds: number[], folderId: number): void {
  const db = getDb()
  const stmt = db.prepare('INSERT OR IGNORE INTO item_folders(item_id, folder_id) VALUES(?, ?)')
  const tx = db.transaction(() => {
    for (const id of itemIds) stmt.run(id, folderId)
  })
  tx()
}

export function removeFromFolder(itemIds: number[], folderId: number): void {
  const db = getDb()
  const stmt = db.prepare('DELETE FROM item_folders WHERE item_id = ? AND folder_id = ?')
  const tx = db.transaction(() => {
    for (const id of itemIds) stmt.run(id, folderId)
  })
  tx()
}

export function listSmart(): SmartFolder[] {
  const rows = getDb().prepare('SELECT id, name, filter FROM smart_folders ORDER BY id').all() as Array<{
    id: number
    name: string
    filter: string
  }>
  return rows.map((r) => ({ id: r.id, name: r.name, filter: parseJson<FilterState>(r.filter) ?? {} }))
}

export function saveSmart(name: string, filter: FilterState): SmartFolder {
  const db = getDb()
  const info = db
    .prepare(
      `INSERT INTO smart_folders(name, filter) VALUES(?, ?)
       ON CONFLICT(name) DO UPDATE SET filter = excluded.filter`
    )
    .run(name.trim(), JSON.stringify(filter))
  const id =
    Number(info.lastInsertRowid) ||
    (db.prepare('SELECT id FROM smart_folders WHERE name = ?').get(name.trim()) as { id: number }).id
  return { id, name: name.trim(), filter }
}

export function deleteSmart(id: number): void {
  getDb().prepare('DELETE FROM smart_folders WHERE id = ?').run(id)
}

export interface ExportRow {
  name: string
  path: string
  ext: string
  size: number
  width: number
  height: number
  takenAt: number
  rating: number
  flag: number
  note: string
  url: string | null
  missing: number
  tags: string[]
  folders: string[]
  exif: ExifData | null
  pairCount: number
  burstCount: number
  stackCount: number
}

export function exportRows(): ExportRow[] {
  const db = getDb()
  const rows = db
    .prepare('SELECT * FROM items WHERE trashed = 0 ORDER BY added_at DESC')
    .all() as ItemRow[]
  const ids = rows.map((r) => r.id)
  const tagMap = loadTagsFor(db, ids)
  const folderMap = loadFoldersFor(db, ids)
  const { pairCounts, burstCounts, stackCounts } = loadGroupCounts(db, rows)
  const folderNames = new Map(listFolders().map((folder) => [folder.id, folder.name]))

  return rows.map((row) => ({
    name: row.name,
    path: row.path,
    ext: row.ext,
    size: row.size,
    width: row.width,
    height: row.height,
    takenAt: row.mtime,
    rating: row.rating,
    flag: row.flag,
    note: row.note,
    url: row.url,
    missing: row.missing,
    tags: (tagMap.get(row.id) ?? []).map((tag) => tag.name),
    folders: (folderMap.get(row.id) ?? [])
      .map((id) => folderNames.get(id))
      .filter((name): name is string => !!name),
    exif: parseJson<ExifData>(row.exif),
    pairCount: row.pair_key ? pairCounts.get(row.pair_key) ?? 1 : 1,
    burstCount: row.burst_key ? burstCounts.get(row.burst_key) ?? 1 : 1,
    stackCount: row.stack_id ? stackCounts.get(row.stack_id) ?? 1 : 1
  }))
}

export function findDuplicates(): DuplicateGroup[] {
  const rows = getDb()
    .prepare(
      `SELECT id, hash FROM items
       WHERE hash IS NOT NULL AND hash <> '' AND trashed = 0 AND missing = 0
       ORDER BY id`
    )
    .all() as Array<{ id: number; hash: string }>
  const valid = rows.filter((row) => /^[0-9a-f]{16}$/i.test(row.hash))
  if (valid.length < 2) return []

  // 64 位哈希按 8 个字节分别掩码建桶：
  // 差异 ≤6 bit 时必然至少有一个字节完全一致，这样既不会漏报，也不用全量两两比较。
  const buckets = new Map<string, number[]>()
  for (let index = 0; index < valid.length; index++) {
    const hash = valid[index].hash
    for (let byte = 0; byte < 8; byte++) {
      const key = `${hash.slice(0, byte * 2)}*${hash.slice(byte * 2 + 2)}`
      const list = buckets.get(key)
      if (list) list.push(index)
      else buckets.set(key, [index])
    }
  }

  const parent = valid.map((_, index) => index)
  const find = (start: number): number => {
    let root = start
    while (parent[root] !== root) root = parent[root]
    let cursor = start
    while (parent[cursor] !== root) {
      const next = parent[cursor]
      parent[cursor] = root
      cursor = next
    }
    return root
  }
  const union = (a: number, b: number): void => {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parent[rootB] = rootA
  }

  for (const list of buckets.values()) {
    if (list.length < 2) continue
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (find(list[i]) === find(list[j])) continue
        if (hamming(valid[list[i]].hash, valid[list[j]].hash) <= 6) union(list[i], list[j])
      }
    }
  }

  const grouped = new Map<number, number[]>()
  for (let index = 0; index < valid.length; index++) {
    const root = find(index)
    const list = grouped.get(root) ?? []
    list.push(index)
    grouped.set(root, list)
  }

  const groups: DuplicateGroup[] = []
  for (const [root, indexes] of grouped) {
    if (indexes.length < 2) continue
    const items = getItemsByIds(indexes.map((index) => valid[index].id))
    if (items.length > 1) groups.push({ hash: valid[root].hash, items })
  }
  return groups.sort((a, b) => b.items.length - a.items.length)
}

function hamming(a: string, b: string): number {
  let diff = 0
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`)
  while (x > 0n) {
    diff += Number(x & 1n)
    x >>= 1n
  }
  return diff
}
