import { existsSync, mkdirSync, openSync, closeSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import { getDb, getIndexPath } from './db'
import { filteredIds, getItem, getItemFile, getItemsByIds, thumbPathFor } from './repo'
import {
  activeModel,
  embedImage,
  embedText,
  resolveModelDir
} from './clip/embedder'
import { EMBEDDING_MODELS, modelTotalBytes } from './clip/models'
import { beginIndexing, endIndexing, isTagging } from './taskLock'
import { log } from './logger'
import type { ClipStatus, EmbeddingModelInfo, FilterState, Item } from '../shared/types'

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

/**
 * 向量缓存：所有向量拼成一块连续内存，扫描时按 offset 顺序访问。
 * 之前是 Map<id, Float32Array>，每条向量一个独立对象，内存是本体 2.5 倍、扫描也慢。
 */
interface VectorCache {
  tag: string
  dim: number
  ids: Int32Array
  data: Float32Array
  count: number
  /** 已缓存 id，增量追加时用来去重（索引中途检索过可能导致同一条被追加两次） */
  idSet: Set<number>
}

let cache: VectorCache | null = null

export function invalidateClipCache(): void {
  cache = null
}

/** BLOB → Float32Array；better-sqlite3 的 Buffer 可能带非 4 字节对齐的偏移，对不上就先拷一份 */
function viewFloats(buffer: Buffer): Float32Array {
  if (buffer.byteOffset % 4 === 0) {
    return new Float32Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.byteLength / 4))
  }
  const copy = new Uint8Array(buffer.byteLength)
  copy.set(buffer)
  return new Float32Array(copy.buffer)
}

/** 前 K 名的小顶堆：避免对几万条分数做全量排序 */
class TopK {
  private readonly scores: number[] = []
  private readonly ids: number[] = []
  private readonly size: number

  constructor(size: number) {
    this.size = Math.max(1, Math.floor(size))
  }

  push(score: number, id: number): void {
    if (this.scores.length < this.size) {
      this.scores.push(score)
      this.ids.push(id)
      this.siftUp(this.scores.length - 1)
      return
    }
    // 比堆顶还小就进不了前 K，直接丢掉（绝大多数都会走到这里）
    if (score <= this.scores[0]) return
    this.scores[0] = score
    this.ids[0] = id
    this.siftDown(0)
  }

  result(): Array<{ id: number; score: number }> {
    const out = this.scores.map((score, index) => ({ id: this.ids[index], score }))
    out.sort((a, b) => b.score - a.score)
    return out
  }

  private siftUp(start: number): void {
    let index = start
    while (index > 0) {
      const parent = (index - 1) >> 1
      if (this.scores[parent] <= this.scores[index]) break
      this.swap(parent, index)
      index = parent
    }
  }

  private siftDown(start: number): void {
    let index = start
    const length = this.scores.length
    for (;;) {
      const left = index * 2 + 1
      if (left >= length) return
      const right = left + 1
      const smallest = right < length && this.scores[right] < this.scores[left] ? right : left
      if (this.scores[index] <= this.scores[smallest]) return
      this.swap(index, smallest)
      index = smallest
    }
  }

  private swap(a: number, b: number): void {
    const score = this.scores[a]
    this.scores[a] = this.scores[b]
    this.scores[b] = score
    const id = this.ids[a]
    this.ids[a] = this.ids[b]
    this.ids[b] = id
  }
}

/* ─────────────── 向量快照文件 ─────────────── */

/**
 * 快照格式（小端）：
 *   magic(8) 'LUNVEC01' · version(u32) · dim(u32) · count(u32) · maxId(u32)  = 24 字节头
 *   ids:   Int32Array(count)
 *   data:  Float32Array(count * dim)
 * 逐行读 6 万条 BLOB 要 1.7 s，读一个 117 MB 的连续文件只要百毫秒级。
 */
const SNAPSHOT_MAGIC = 'LUNVEC01'
const SNAPSHOT_VERSION = 1
const SNAPSHOT_HEADER = 24

interface VectorStats {
  count: number
  maxId: number
}

function snapshotFile(tag: string): string {
  return join(getIndexPath(), 'vectors', `${tag.replace(/[^\w.-]/g, '_')}.bin`)
}

/** 当前模型的快照文件路径（基准与「清理语义缓存」用） */
export function clipSnapshotFile(tag = activeModel().tag): string {
  return snapshotFile(tag)
}

/** 库里的真实条数与最大 id，用来判断快照是否过期 */
function vectorStats(tag: string): VectorStats {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS c, COALESCE(MAX(item_id), 0) AS m FROM embeddings WHERE model = ?')
    .get(tag) as { c: number; m: number }
  return { count: row.c, maxId: row.m }
}

async function readSnapshot(
  tag: string,
  dim: number,
  expected: VectorStats
): Promise<VectorCache | null> {
  const file = snapshotFile(tag)
  if (!existsSync(file)) return null
  try {
    const buffer = await readFile(file)
    if (buffer.byteLength < SNAPSHOT_HEADER) return null
    if (buffer.toString('latin1', 0, 8) !== SNAPSHOT_MAGIC) return null
    const version = buffer.readUInt32LE(8)
    const fileDim = buffer.readUInt32LE(12)
    const count = buffer.readUInt32LE(16)
    const maxId = buffer.readUInt32LE(20)
    // 条数或最大 id 对不上说明库变过了（删图、新索引），直接退回读库
    if (version !== SNAPSHOT_VERSION || fileDim !== dim) return null
    if (count !== expected.count || maxId !== expected.maxId) return null
    const idsOffset = SNAPSHOT_HEADER
    const dataOffset = idsOffset + count * 4
    if (buffer.byteLength !== dataOffset + count * dim * 4) return null

    const aligned = (offset: number): boolean => (buffer.byteOffset + offset) % 4 === 0
    // 对齐时直接做视图，不复制；文件 Buffer 由 ArrayBuffer 引用着，不会被回收
    const ids = aligned(idsOffset)
      ? new Int32Array(buffer.buffer, buffer.byteOffset + idsOffset, count)
      : copyInt32(buffer, idsOffset, count)
    const data = aligned(dataOffset)
      ? new Float32Array(buffer.buffer, buffer.byteOffset + dataOffset, count * dim)
      : copyFloat32(buffer, dataOffset, count * dim)
    const idSet = new Set<number>()
    for (let i = 0; i < count; i += 1) idSet.add(ids[i])
    return { tag, dim, ids, data, count, idSet }
  } catch {
    return null
  }
}

function copyInt32(buffer: Buffer, offset: number, length: number): Int32Array {
  const copy = Buffer.allocUnsafe(length * 4)
  buffer.copy(copy, 0, offset, offset + length * 4)
  return new Int32Array(copy.buffer, copy.byteOffset, length)
}

function copyFloat32(buffer: Buffer, offset: number, length: number): Float32Array {
  const copy = Buffer.allocUnsafe(length * 4)
  buffer.copy(copy, 0, offset, offset + length * 4)
  return new Float32Array(copy.buffer, copy.byteOffset, length)
}

/** 同步落盘：一次写完，下次启动直接读文件；失败只记日志，不影响检索 */
function writeSnapshot(vectors: VectorCache): void {
  const file = snapshotFile(vectors.tag)
  const temp = `${file}.tmp`
  const header = Buffer.alloc(SNAPSHOT_HEADER)
  header.write(SNAPSHOT_MAGIC, 0, 'latin1')
  header.writeUInt32LE(SNAPSHOT_VERSION, 8)
  header.writeUInt32LE(vectors.dim, 12)
  header.writeUInt32LE(vectors.count, 16)
  let maxId = 0
  for (let i = 0; i < vectors.count; i += 1) {
    if (vectors.ids[i] > maxId) maxId = vectors.ids[i]
  }
  header.writeUInt32LE(maxId, 20)

  try {
    mkdirSync(dirname(file), { recursive: true })
    const fd = openSync(temp, 'w')
    try {
      writeSync(fd, header)
      writeSync(
        fd,
        Buffer.from(vectors.ids.buffer, vectors.ids.byteOffset, vectors.count * 4)
      )
      writeSync(
        fd,
        Buffer.from(
          vectors.data.buffer,
          vectors.data.byteOffset,
          vectors.count * vectors.dim * 4
        )
      )
    } finally {
      closeSync(fd)
    }
    renameSync(temp, file)
  } catch (error) {
    try {
      if (existsSync(temp)) unlinkSync(temp)
    } catch {
      /* 清理失败不影响检索 */
    }
    void log.warn('clip', '向量快照写入失败', { error: (error as Error).message })
  }
}

/** 从库里逐行读；读完顺手写一份快照，下次启动就快了 */
function buildFromDb(tag: string, dim: number, total: number): VectorCache {
  const ids = new Int32Array(Math.max(total, 0))
  const data = new Float32Array(Math.max(total, 0) * dim)
  const idSet = new Set<number>()

  // 逐行迭代：一次性 all() 会把几万条 BLOB 同时留在内存里
  const rows = getDb()
    .prepare('SELECT item_id, vec FROM embeddings WHERE model = ?')
    .iterate(tag) as Iterable<{ item_id: number; vec: Buffer }>
  let count = 0
  for (const row of rows) {
    if (count >= ids.length) break
    const vector = viewFloats(row.vec)
    if (vector.length !== dim) continue
    ids[count] = row.item_id
    data.set(vector, count * dim)
    idSet.add(row.item_id)
    count += 1
  }
  return { tag, dim, ids, data, count, idSet }
}

async function loadVectors(): Promise<VectorCache> {
  const model = activeModel()
  if (cache && cache.tag === model.tag) return cache

  const stats = vectorStats(model.tag)
  const fromFile = await readSnapshot(model.tag, model.dim, stats)
  if (fromFile) {
    cache = fromFile
    return cache
  }

  const built = buildFromDb(model.tag, model.dim, stats.count)
  cache = built
  writeSnapshot(built)
  return cache
}

/** 索引过程中把新向量追加进缓存，避免每完成一批就整表重建 */
export function appendClipVectors(entries: Array<{ id: number; vec: Float32Array }>): void {
  const current = cache
  if (!current || entries.length === 0) return
  if (current.tag !== activeModel().tag) {
    cache = null
    return
  }
  const dim = current.dim
  const fresh = entries.filter(
    (entry) => entry.vec.length === dim && !current.idSet.has(entry.id)
  )
  if (fresh.length === 0) return

  let ids = current.ids
  let data = current.data
  const needed = current.count + fresh.length
  if (needed > ids.length) {
    const capacity = Math.max(needed, Math.ceil(ids.length * 1.5), 256)
    const nextIds = new Int32Array(capacity)
    nextIds.set(ids.subarray(0, current.count))
    const nextData = new Float32Array(capacity * dim)
    nextData.set(data.subarray(0, current.count * dim))
    ids = nextIds
    data = nextData
  }

  let row = current.count
  for (const entry of fresh) {
    ids[row] = entry.id
    data.set(entry.vec, row * dim)
    current.idSet.add(entry.id)
    row += 1
  }
  cache = { tag: current.tag, dim, ids, data, count: row, idSet: current.idSet }
}

export function clipStatus(): ClipStatus {
  const db = getDb()
  const model = activeModel()
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
      .get(model.tag) as { c: number }
  ).c
  return {
    modelReady: resolveModelDir(model.id) !== null,
    modelId: model.id,
    modelLabel: model.label,
    modelBytes: modelTotalBytes(model.id),
    indexed,
    total,
    running,
    dim: model.dim
  }
}

/** 设置页展示用：每个模型的下载状态、当前是否启用、索引进度 */
export function listEmbeddingModels(): EmbeddingModelInfo[] {
  const db = getDb()
  const total = (
    db.prepare('SELECT COUNT(*) AS c FROM items WHERE trashed = 0 AND missing = 0').get() as {
      c: number
    }
  ).c
  const active = activeModel()
  const countIndexed = db.prepare(
    `SELECT COUNT(*) AS c FROM embeddings e
     JOIN items i ON i.id = e.item_id
     WHERE e.model = ? AND i.trashed = 0 AND i.missing = 0`
  )
  return Object.values(EMBEDDING_MODELS).map((spec) => ({
    id: spec.id,
    label: spec.label,
    note: spec.note,
    bytes: modelTotalBytes(spec.id),
    dim: spec.dim,
    ready: resolveModelDir(spec.id) !== null,
    active: spec.id === active.id,
    indexed: (countIndexed.get(spec.tag) as { c: number }).c,
    total
  }))
}

export function cancelClipIndex(): void {
  cancelRequested = true
}

export interface IndexOptions {
  /** 只处理前 N 张（闲时小批量用，不传表示全部） */
  limit?: number
  /** 每张之前检查一次，返回 false 就提前收工（用户回来 / 开始导入） */
  shouldContinue?: () => boolean
}

export async function indexEmbeddings(
  onProgress: (progress: ClipProgress) => void,
  options: IndexOptions = {}
): Promise<{ indexed: number; failed: number; cancelled: boolean; stopped: boolean }> {
  if (running) return { indexed: 0, failed: 0, cancelled: true, stopped: false }
  if (isTagging()) throw new Error('正在做自动分类，等它完成再建索引')
  const model = activeModel()
  if (!resolveModelDir(model.id)) throw new Error(`${model.label} 模型还没下载`)

  running = true
  beginIndexing()
  cancelRequested = false
  const db = getDb()
  // 索引是后台任务：libvips 线程压到 1，别和界面刷新、鼠标响应抢 CPU
  const prevConcurrency = sharp.concurrency()
  sharp.concurrency(1)

  try {
    const rows = db
      .prepare(
        `SELECT i.id, i.name FROM items i
         WHERE i.trashed = 0 AND i.missing = 0
           AND NOT EXISTS (SELECT 1 FROM embeddings e WHERE e.item_id = i.id AND e.model = ?)
         ORDER BY i.id
         LIMIT ?`
      )
      .all(model.tag, options.limit && options.limit > 0 ? Math.floor(options.limit) : -1) as Array<{
      id: number
      name: string
    }>

    const total = rows.length
    const insert = db.prepare(
      'INSERT OR REPLACE INTO embeddings(item_id, model, dim, vec) VALUES(?, ?, ?, ?)'
    )
    /** 写入攒够这么多条再提交；每张单独提交会 fsync 一次，几万张就是几万次磁盘抖动 */
    const COMMIT_BATCH = 32
    let indexed = 0
    let failed = 0
    let done = 0
    let stopped = false
    let pending = 0
    let current = ''
    let lastReport = 0
    const failureSamples: string[] = []
    /** 本批已提交、但还没进缓存的向量 */
    const batch: Array<{ id: number; vec: Float32Array }> = []

    /** 进度也别每张都发：每 16 张、且两次之间至少隔 1 秒，界面不会被消息刷屏 */
    const REPORT_EVERY = 16
    const REPORT_GAP_MS = 1000
    const report = (force = false): void => {
      const now = Date.now()
      if (!force && done % REPORT_EVERY !== 0 && now - lastReport < REPORT_GAP_MS) return
      lastReport = now
      onProgress({ done, total, current })
    }
    report(true)

    db.exec('BEGIN')
    let committed = false
    try {
      for (const row of rows) {
        if (cancelRequested) break
        if (options.shouldContinue && !options.shouldContinue()) {
          stopped = true
          break
        }
        // 缩略图已经压到 720px，解码成本比原图低一个数量级；缺失时才回退到原图
        let source = thumbPathFor(row.id)
        if (!existsSync(source)) source = getItemFile(row.id) ?? ''
        try {
          if (!source || !existsSync(source)) throw new Error('文件不可用')
          const vector = await embedImage(source, model.id)
          insert.run(
            row.id,
            model.tag,
            vector.length,
            Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength)
          )
          indexed++
          batch.push({ id: row.id, vec: vector })
          if (++pending >= COMMIT_BATCH) {
            db.exec('COMMIT')
            db.exec('BEGIN')
            pending = 0
            // 提交成功才进缓存，避免把回滚掉的向量留在里面
            appendClipVectors(batch)
            batch.length = 0
          }
        } catch (error) {
          failed++
          // 只留前几条原因，够定位就行，避免日志被上万条刷爆
          if (failureSamples.length < 3) failureSamples.push((error as Error).message || '未知错误')
        }
        done++
        current = row.name
        report()
        // 让出一次事件循环，主进程才有空处理 IPC 与界面刷新
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
      db.exec('COMMIT')
      committed = true
      appendClipVectors(batch)
      batch.length = 0
    } finally {
      if (!committed) {
        try {
          db.exec('ROLLBACK')
        } catch {
          /* 没有活动事务时忽略 */
        }
      }
    }
    report(true)

    // 索引结束顺手刷新快照，下次启动直接读文件；条数对不上就等下次检索重建
    if (cache && cache.tag === model.tag && cache.count === vectorStats(model.tag).count) {
      writeSnapshot(cache)
    }

    if (failed > 0) {
      void log.warn('clip', '语义索引部分失败', { indexed, failed, total, samples: failureSamples })
    }
    return { indexed, failed, cancelled: cancelRequested, stopped }
  } finally {
    sharp.concurrency(prevConcurrency)
    running = false
    endIndexing()
  }
}

async function rank(
  vector: Float32Array,
  filter: FilterState,
  limit: number,
  excludeId?: number
): Promise<ClipSearchResult> {
  const { ids, data, dim, count } = await loadVectors()
  const allowed = filteredIds({ ...filter, query: '' })
  const queryLength = Math.min(dim, vector.length)
  const top = new TopK(limit)
  for (let row = 0; row < count; row += 1) {
    const id = ids[row]
    if (id === excludeId) continue
    if (!allowed.has(id)) continue
    const offset = row * dim
    let sum = 0
    for (let d = 0; d < queryLength; d += 1) sum += vector[d] * data[offset + d]
    top.push(sum, id)
  }
  const ranked = top.result()
  return {
    items: getItemsByIds(ranked.map((entry) => entry.id)),
    scores: ranked.map((entry) => Number(entry.score.toFixed(3)))
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
  const model = activeModel()
  const row = getDb()
    .prepare('SELECT vec FROM embeddings WHERE item_id = ? AND model = ?')
    .get(itemId, model.tag) as { vec: Buffer } | undefined
  if (!row) {
    const item = getItem(itemId)
    throw new Error(
      item ? `这张图还没有 ${model.label} 索引，先重建一次语义索引` : '图片不存在'
    )
  }
  const vector = new Float32Array(row.vec.byteLength / 4)
  Buffer.from(vector.buffer).set(row.vec)
  return rank(vector, {}, limit, itemId)
}
