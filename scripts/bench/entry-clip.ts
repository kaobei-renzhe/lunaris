import { app } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { closeLibrary, getDb, openLibrary } from '../../src/main/db'
import { activeModel } from '../../src/main/clip/embedder'
import {
  searchSimilar,
  appendClipVectors,
  clipSnapshotFile,
  invalidateClipCache
} from '../../src/main/embeddings'
import { filteredIds, getItemsByIds } from '../../src/main/repo'

/**
 * 语义检索基准：造 N 条随机归一化向量（与索引时的存储格式一致），
 * 走真实的 searchSimilar 路径，量冷启动解码、热扫描、过滤与取详情的耗时。
 */
const userData = process.env.BENCH_USER_DATA
if (userData) app.setPath('userData', userData)
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')

function emit(payload: Record<string, unknown>): void {
  console.log('BENCH_RESULT ' + JSON.stringify(payload))
}

function randomVector(dim: number): Float32Array {
  const vector = new Float32Array(dim)
  let norm = 0
  for (let i = 0; i < dim; i += 1) {
    const value = Math.random() * 2 - 1
    vector[i] = value
    norm += value * value
  }
  const scale = Math.sqrt(norm) || 1
  for (let i = 0; i < dim; i += 1) vector[i] /= scale
  return vector
}

function seed(count: number, dim: number, tag: string): void {
  const db = getDb()
  const insertItem = db.prepare(
    `INSERT INTO items(path, name, ext, size, width, height, mtime, added_at, rating, note, missing)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, 0, '', 0)`
  )
  const insertVector = db.prepare(
    'INSERT OR REPLACE INTO embeddings(item_id, model, dim, vec) VALUES(?, ?, ?, ?)'
  )
  const now = Date.now()
  db.exec('BEGIN')
  for (let i = 0; i < count; i += 1) {
    const id = i + 1
    insertItem.run(
      `C:/bench/clip/img-${id}.jpg`,
      `img-${id}.jpg`,
      '.jpg',
      1024,
      4000,
      3000,
      now - i * 1000,
      now - i * 1000
    )
    const vector = randomVector(dim)
    insertVector.run(id, tag, dim, Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength))
  }
  db.exec('COMMIT')
}

async function timeAsync(run: () => Promise<unknown>): Promise<number> {
  const startedAt = process.hrtime.bigint()
  await run()
  return Number(process.hrtime.bigint() - startedAt) / 1e6
}

function time<T>(run: () => T): { value: T; ms: number } {
  const startedAt = process.hrtime.bigint()
  const value = run()
  return { value, ms: Number(Number(process.hrtime.bigint() - startedAt) / 1e6) }
}

const round = (value: number): number => Math.round(value * 10) / 10

/** 参照实现：直接读库、逐条点积、全量排序，用来核对优化后的堆排名没有排错 */
function referenceTop(itemId: number, dim: number, tag: string, limit: number): number[] {
  const db = getDb()
  const own = db
    .prepare('SELECT vec FROM embeddings WHERE item_id = ? AND model = ?')
    .get(itemId, tag) as { vec: Buffer } | undefined
  if (!own) return []
  const query = new Float32Array(own.vec.byteLength / 4)
  Buffer.from(query.buffer).set(own.vec)

  const scored: Array<{ id: number; score: number }> = []
  const rows = db
    .prepare('SELECT item_id, vec FROM embeddings WHERE model = ?')
    .iterate(tag) as Iterable<{ item_id: number; vec: Buffer }>
  for (const row of rows) {
    if (row.item_id === itemId) continue
    const vector = new Float32Array(row.vec.byteLength / 4)
    Buffer.from(vector.buffer).set(row.vec)
    let sum = 0
    const length = Math.min(dim, vector.length)
    for (let d = 0; d < length; d += 1) sum += vector[d] * query[d]
    scored.push({ id: row.item_id, score: sum })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((entry) => entry.id)
}

/** 增量追加：塞三条几乎等于查询向量的新向量，验证能立刻被搜到，且重复追加不会翻倍 */
async function checkAppend(
  count: number,
  dim: number,
  tag: string
): Promise<{ appendOk: boolean; appendDuplicateFree: boolean }> {
  const db = getDb()
  const own = db
    .prepare('SELECT vec FROM embeddings WHERE item_id = 1 AND model = ?')
    .get(tag) as { vec: Buffer } | undefined
  if (!own) return { appendOk: false, appendDuplicateFree: false }
  const base = new Float32Array(own.vec.byteLength / 4)
  Buffer.from(base.buffer).set(own.vec)

  const insertItem = db.prepare(
    `INSERT INTO items(path, name, ext, size, width, height, mtime, added_at, rating, note, missing)
     VALUES(?, ?, ?, 1024, 4000, 3000, ?, ?, 0, '', 0)`
  )
  const entries: Array<{ id: number; vec: Float32Array }> = []
  const scales = [0.999, 0.998, 0.997]
  for (let i = 0; i < scales.length; i += 1) {
    const id = count + 1 + i
    const now = Date.now()
    insertItem.run(`C:/bench/clip/appended-${id}.jpg`, `appended-${id}.jpg`, '.jpg', now, now)
    const vector = new Float32Array(dim)
    for (let d = 0; d < dim; d += 1) vector[d] = base[d] * scales[i]
    entries.push({ id, vec: vector })
  }

  appendClipVectors(entries)
  // 再追加一遍同样的：有去重就不该多出一份
  appendClipVectors(entries)

  const result = await searchSimilar(1, 10)
  const ids = result.items.map((item) => item.id)
  const appendOk = entries.every((entry, index) => ids[index] === entry.id)
  const appendDuplicateFree = new Set(ids).size === ids.length
  return { appendOk, appendDuplicateFree }
}

async function main(): Promise<void> {
  const library = process.env.BENCH_LIB
  if (!library) throw new Error('缺少 BENCH_LIB 环境变量')
  const count = Math.max(1000, Math.floor(Number(process.env.BENCH_N) || 30000))

  openLibrary(library)
  const model = activeModel()
  // 第二遍（BENCH_SEED=0）复用上一遍的库与快照，只量「读快照」的冷启动
  const seedMode = process.env.BENCH_SEED !== '0'
  const snapshotBefore = existsSync(clipSnapshotFile(model.tag))
    ? Math.round((statSync(clipSnapshotFile(model.tag)).size / 1024 / 1024) * 10) / 10
    : 0
  let seedMs = 0
  if (seedMode) {
    const seededAt = Date.now()
    seed(count, model.dim, model.tag)
    seedMs = Date.now() - seededAt
  }

  const rssBefore = process.memoryUsage().rss
  const coldMs = await timeAsync(() => searchSimilar(1, 200))
  const rssAfter = process.memoryUsage().rss

  const warm: number[] = []
  let hits = 0
  let lastIds: number[] = []
  for (let i = 0; i < 5; i += 1) {
    const ms = await timeAsync(async () => {
      const result = await searchSimilar(1, 200)
      hits = result.items.length
      lastIds = result.items.map((item) => item.id)
    })
    warm.push(ms)
  }
  warm.sort((a, b) => a - b)

  const allIds = time(() => filteredIds({}))
  const filtered = time(() => filteredIds({ minRating: 3 }))
  const beforeDetails = Date.now()
  getItemsByIds(Array.from({ length: 200 }, (_, index) => index + 2))
  const detailsMs = Date.now() - beforeDetails

  // 和参照实现对一下：前 20 名的 id 与顺序必须完全一致。
  // 放在最后跑：它会读一遍全表、造一堆临时向量，提前跑会干扰上面的计时。
  const expected = referenceTop(1, model.dim, model.tag, 20)
  const got = lastIds.slice(0, 20)
  const matchTop = expected.length === got.length && expected.every((id, i) => id === got[i])

  // 增量追加：往缓存里塞三条「几乎等于查询向量」的新向量，验证能立刻被搜到、且重复追加不会翻倍
  // 只在造数据的这一遍做：它会往 items 里插三条记录
  const appendCheck = seedMode
    ? await checkAppend(count, model.dim, model.tag)
    : { appendOk: true, appendDuplicateFree: true }

  // 快照失效：删掉一条向量后清缓存再查，必须回退读库、且结果与参照一致
  let staleOk = true
  if (!seedMode) {
    getDb()
      .prepare('DELETE FROM embeddings WHERE item_id = 2 AND model = ?')
      .run(model.tag)
    invalidateClipCache()
    const after = await searchSimilar(1, 20)
    const afterIds = after.items.map((item) => item.id)
    const afterExpected = referenceTop(1, model.dim, model.tag, 20)
    staleOk =
      afterIds.length === 20 &&
      !afterIds.includes(2) &&
      afterExpected.every((id, index) => id === afterIds[index])
  }

  closeLibrary()
  emit({
    kind: 'clip',
    n: count,
    dim: model.dim,
    model: model.id,
    seedMs,
    snapshotBeforeMb: snapshotBefore,
    coldMs: round(coldMs),
    warmMedianMs: round(warm[Math.floor(warm.length / 2)]),
    warmMinMs: round(warm[0]),
    warmMaxMs: round(warm[warm.length - 1]),
    warmAll: warm.map(round),
    filteredIdsMs: round(allIds.ms),
    filteredIdsCount: allIds.value.size,
    filteredIdsRatedMs: round(filtered.ms),
    filteredIdsRatedCount: filtered.value.size,
    details200Ms: round(detailsMs),
    hits,
    matchTop,
    appendOk: appendCheck.appendOk,
    appendDuplicateFree: appendCheck.appendDuplicateFree,
    staleOk,
    rssBeforeMb: Math.round((rssBefore / 1024 / 1024) * 10) / 10,
    rssAfterMb: Math.round((rssAfter / 1024 / 1024) * 10) / 10,
    rssDeltaMb: Math.round(((rssAfter - rssBefore) / 1024 / 1024) * 10) / 10,
    vectorBytesMb:
      Math.round(((count * model.dim * 4) / 1024 / 1024) * 10) / 10
  })
  app.quit()
}

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error('BENCH_ERROR ' + (error as Error).message)
    app.exit(1)
  })
