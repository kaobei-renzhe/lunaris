import { getDb } from './db'
import type {
  CreateNoteInput,
  NoteAuthor,
  NoteKind,
  NoteMode,
  NoteRegion,
  NoteThread,
  PhotoNote
} from '../shared/types'

interface NoteRow {
  id: number
  item_id: number
  parent_id: number | null
  kind: string
  mode: string
  body: string
  region: string | null
  author: string
  tags: string
  created_at: number
}

const KINDS: NoteKind[] = ['question', 'answer', 'insight', 'intent', 'tech']
const MODES: NoteMode[] = ['study', 'review']
const AUTHORS: NoteAuthor[] = ['me', 'ai']

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

/** 坐标一律夹到 0-1 之间；宽高为 0 视为无效（等于没框选） */
function parseRegion(raw: string | null): NoteRegion | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Record<string, unknown>
    const clamp = (n: unknown): number => {
      const num = Number(n)
      return Number.isFinite(num) ? Math.min(1, Math.max(0, num)) : 0
    }
    const region = { x: clamp(v.x), y: clamp(v.y), w: clamp(v.w), h: clamp(v.h) }
    return region.w > 0.001 && region.h > 0.001 ? region : null
  } catch {
    return null
  }
}

function parseTags(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown
    return Array.isArray(value) ? value.map(String).filter(Boolean).slice(0, 8) : []
  } catch {
    return []
  }
}

function toNote(row: NoteRow): PhotoNote {
  return {
    id: row.id,
    itemId: row.item_id,
    parentId: row.parent_id,
    kind: pick(row.kind, KINDS, 'question'),
    mode: pick(row.mode, MODES, 'study'),
    body: row.body,
    region: parseRegion(row.region),
    author: pick(row.author, AUTHORS, 'me'),
    tags: parseTags(row.tags),
    createdAt: row.created_at
  }
}

const SELECT_COLUMNS =
  'id, item_id, parent_id, kind, mode, body, region, author, tags, created_at'

/** 一张照片的全部笔记，按时间正序 */
export function listNotes(itemId: number): PhotoNote[] {
  const rows = getDb()
    .prepare(`SELECT ${SELECT_COLUMNS} FROM photo_notes WHERE item_id = ? ORDER BY id ASC`)
    .all(Number(itemId)) as NoteRow[]
  return rows.map(toNote)
}

/** 按线程分组：根笔记在前，追问挂在后面，前端直接渲染 */
export function listThreads(itemId: number): NoteThread[] {
  const notes = listNotes(itemId)
  const threads = new Map<number, NoteThread>()
  for (const note of notes) {
    if (note.parentId === null) threads.set(note.id, { root: note, replies: [] })
  }
  for (const note of notes) {
    if (note.parentId === null) continue
    const thread = threads.get(note.parentId)
    // 父笔记被单独删掉时，孤儿回复降级成独立线程，不让他凭空消失
    if (thread) thread.replies.push(note)
    else threads.set(note.id, { root: { ...note, parentId: null }, replies: [] })
  }
  return [...threads.values()]
}

export function countNotes(itemId: number): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS c FROM photo_notes WHERE item_id = ?')
    .get(Number(itemId)) as { c: number }
  return row.c
}

/** 全库有笔记的照片数，用于侧栏角标 */
export function countNotedItems(): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(DISTINCT n.item_id) AS c
       FROM photo_notes n JOIN items i ON i.id = n.item_id
       WHERE i.trashed = 0 AND i.missing = 0`
    )
    .get() as { c: number }
  return row.c
}

export function createNote(input: CreateNoteInput): PhotoNote {
  const itemId = Number(input?.itemId)
  if (!Number.isInteger(itemId)) throw new Error('缺少有效的图片编号')
  const body = String(input.body ?? '').trim()
  if (!body) throw new Error('笔记内容不能为空')

  const parentId =
    input.parentId === undefined || input.parentId === null ? null : Number(input.parentId)
  const region = input.region ? parseRegion(JSON.stringify(input.region)) : null
  const tags = Array.isArray(input.tags) ? input.tags.map(String).filter(Boolean).slice(0, 8) : []

  const info = getDb()
    .prepare(
      `INSERT INTO photo_notes(item_id, parent_id, kind, mode, body, region, author, tags, created_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      itemId,
      parentId,
      pick(input.kind, KINDS, 'question'),
      pick(input.mode, MODES, 'study'),
      body.slice(0, 4000),
      region ? JSON.stringify(region) : null,
      pick(input.author, AUTHORS, 'me'),
      JSON.stringify(tags),
      Date.now()
    )

  const row = getDb()
    .prepare(`SELECT ${SELECT_COLUMNS} FROM photo_notes WHERE id = ?`)
    .get(Number(info.lastInsertRowid)) as NoteRow
  return toNote(row)
}

export function updateNote(
  id: number,
  patch: Partial<Pick<PhotoNote, 'body' | 'kind' | 'tags'>>
): PhotoNote | null {
  const sets: string[] = []
  const values: unknown[] = []
  if (patch.body !== undefined) {
    const body = String(patch.body).trim()
    if (!body) throw new Error('笔记内容不能为空')
    sets.push('body = ?')
    values.push(body.slice(0, 4000))
  }
  if (patch.kind !== undefined) {
    sets.push('kind = ?')
    values.push(pick(patch.kind, KINDS, 'question'))
  }
  if (patch.tags !== undefined && Array.isArray(patch.tags)) {
    sets.push('tags = ?')
    values.push(JSON.stringify(patch.tags.map(String).filter(Boolean).slice(0, 8)))
  }
  if (!sets.length) return getNote(id)
  getDb()
    .prepare(`UPDATE photo_notes SET ${sets.join(', ')} WHERE id = ?`)
    .run(...values, Number(id))
  return getNote(id)
}

export function getNote(id: number): PhotoNote | null {
  const row = getDb()
    .prepare(`SELECT ${SELECT_COLUMNS} FROM photo_notes WHERE id = ?`)
    .get(Number(id)) as NoteRow | undefined
  return row ? toNote(row) : null
}

/** 删除一条笔记，连带它下面所有追问 */
export function deleteNote(id: number): void {
  getDb()
    .prepare(
      `DELETE FROM photo_notes WHERE id IN (
         WITH RECURSIVE sub(id) AS (
           SELECT ?
           UNION ALL
           SELECT n.id FROM photo_notes n JOIN sub ON n.parent_id = sub.id
         )
         SELECT id FROM sub
       )`
    )
    .run(Number(id))
}

/** 把某个区域的坐标回写成相对整图的归一化值（前端在 canvas 上换算后调用） */
export function updateNoteRegion(id: number, region: NoteRegion | null): PhotoNote | null {
  getDb()
    .prepare('UPDATE photo_notes SET region = ? WHERE id = ?')
    .run(region ? JSON.stringify(parseRegion(JSON.stringify(region))) : null, Number(id))
  return getNote(id)
}

/** 照片转成参考片 / 自己的片子，决定默认走研读还是复盘 */
export function setItemReference(itemId: number, reference: boolean): void {
  getDb()
    .prepare('UPDATE items SET reference = ? WHERE id = ?')
    .run(reference ? 1 : 0, Number(itemId))
}
