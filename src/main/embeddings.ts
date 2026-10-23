import { existsSync } from 'node:fs'
import { getDb } from './db'
import { filteredIds, getItem, getItemFile, getItemsByIds } from './repo'
import { dot, embedImage, embedText, MODEL_TAG, resolveModelDir } from './clip/embedder'
import { beginIndexing, endIndexing, isTagging } from './taskLock'
import type { FilterState, Item } from '../shared/types'

export interface ClipStatus {
  modelReady: boolean
  indexed: number
  total: number
  running: boolean
  dim: number
}

export interface ClipProgress {
  done: number
  total: number
  current: string
}

export interface ClipSearchResult {
  items: Item[]
  scores: number[]
}

let running = false
let cancelRequested = false
let cache: Map<number, Float32Array> | null = null

export function invalidateClipCache(): void {
  cache = null
}

export function clipStatus(): ClipStatus {
  const db = getDb()
  const total = (
    db.prepare('SELECT COUNT(*) AS c FROM items WHERE trashed = 0 AND missing = 0').get() as {
      c: number
    }
  ).c
  const indexed = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM embeddings e
         JOIN items i ON i.id = e.item_id
         WHERE e.model = ? AND i.trashed = 0 AND i.missing = 0`
      )
      .get(MODEL_TAG) as { c: number }
  ).c
  return { modelReady: resolveModelDir() !== null, indexed, total, running, dim: 512 }
}

export function cancelClipIndex(): void {
  cancelRequested = true
}

export async function indexEmbeddings(
  onProgress: (progress: ClipProgress) => void
): Promise<{ indexed: number; failed: number; cancelled: boolean }> {
  if (running) return { indexed: 0, failed: 0, cancelled: true }
  if (isTagging()) throw new Error('正在做自动分类，等它完成再建索引')
  if (!resolveModelDir()) throw new Error('语义模型还没下载')

  running = true
  beginIndexing()
  cancelRequested = false
  const db = getDb()

  try {
    const rows = db
      .prepare(
        `SELECT i.id, i.name FROM items i
         WHERE i.trashed = 0 AND i.missing = 0
           AND NOT EXISTS (SELECT 1 FROM embeddings e WHERE e.item_id = i.id AND e.model = ?)
         ORDER BY i.id`
      )
      .all(MODEL_TAG) as Array<{ id: number; name: string }>

    const total = rows.length
    const insert = db.prepare(
      'INSERT OR REPLACE INTO embeddings(item_id, model, dim, vec) VALUES(?, ?, ?, ?)'
    )
    let indexed = 0
    let failed = 0
    let done = 0
    onProgress({ done, total, current: '' })

    for (const row of rows) {
      if (cancelRequested) break
      const file = getItemFile(row.id)
      try {
        if (!file || !existsSync(file)) throw new Error('文件不可用')
        const vector = await embedImage(file)
        insert.run(
          row.id,
          MODEL_TAG,
          vector.length,
          Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength)
        )
        indexed++
      } catch {
        failed++
      }
      done++
      onProgress({ done, total, current: row.name })
    }

    return { indexed, failed, cancelled: cancelRequested }
  } finally {
    running = false
    cache = null
    endIndexing()
  }
}

function loadVectors(): Map<number, Float32Array> {
  if (cache) return cache
  const rows = getDb()
    .prepare('SELECT item_id, vec FROM embeddings WHERE model = ?')
    .all(MODEL_TAG) as Array<{ item_id: number; vec: Buffer }>
  const map = new Map<number, Float32Array>()
  for (const row of rows) {
    const copy = new Float32Array(row.vec.byteLength / 4)
    Buffer.from(copy.buffer).set(row.vec)
    map.set(row.item_id, copy)
  }
  cache = map
  return map
}

function rank(
  vector: Float32Array,
  filter: FilterState,
  limit: number,
  excludeId?: number
): ClipSearchResult {
  const vectors = loadVectors()
  const allowed = filteredIds({ ...filter, query: '' })
  const scored: Array<{ id: number; score: number }> = []
  for (const [id, candidate] of vectors) {
    if (id === excludeId) continue
    if (!allowed.has(id)) continue
    scored.push({ id, score: dot(vector, candidate) })
  }
  scored.sort((a, b) => b.score - a.score)
  const top = scored.slice(0, limit)
  return {
    items: getItemsByIds(top.map((entry) => entry.id)),
    scores: top.map((entry) => Number(entry.score.toFixed(3)))
  }
}

export async function searchByText(
  query: string,
  filter: FilterState,
  limit = 200
): Promise<ClipSearchResult> {
  const text = query.trim()
  if (!text) return { items: [], scores: [] }
  const vector = await embedText(text)
  return rank(vector, filter, limit)
}

export async function searchSimilar(itemId: number, limit = 200): Promise<ClipSearchResult> {
  const row = getDb()
    .prepare('SELECT vec FROM embeddings WHERE item_id = ? AND model = ?')
    .get(itemId, MODEL_TAG) as { vec: Buffer } | undefined
  if (!row) {
    const item = getItem(itemId)
    throw new Error(item ? '这张图还没有语义索引' : '图片不存在')
  }
  const vector = new Float32Array(row.vec.byteLength / 4)
  Buffer.from(vector.buffer).set(row.vec)
  return rank(vector, {}, limit, itemId)
}
