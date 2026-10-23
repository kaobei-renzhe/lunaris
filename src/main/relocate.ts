import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative } from 'node:path'
import sharp from 'sharp'
import exifr from 'exifr'
import { getDb } from './db'
import { relinkItem } from './repo'
import { regroup } from './grouping'
import { readConfig, updateConfig } from './settings'
import { SUPPORTED_EXT } from '../shared/formats'
import type {
  RelocatePair,
  RelocatePending,
  RelocatePlan,
  RelocateResult
} from '../shared/types'

const SKIP_DIRS = new Set(['node_modules', '.git', '$RECYCLE.BIN', 'System Volume Information'])

// 目录过大时只处理前 N 个文件，避免重新定位卡死
const MAX_FILES = 20_000
const MAX_HASHES = 1_200
const MAX_METADATA = 2_500
const MAX_EXIF = 500

function walk(dir: string, out: string[], depth = 0): void {
  if (depth > 12) return
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue
      walk(full, out, depth + 1)
    } else if (SUPPORTED_EXT.has(extname(entry).toLowerCase())) {
      out.push(full)
    }
  }
}

function normalize(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase()
}

export function getLastRelocateDir(): string | null {
  const dir = readConfig().relocate?.lastDir
  return dir && existsSync(dir) ? dir : null
}

export function rememberRelocateDir(dir: string): void {
  updateConfig({ relocate: { lastDir: dir } })
}

/**
 * 所有丢失文件路径的公共目录前缀，用来把「旧目录结构」直接映射到新文件夹。
 */
function commonDirectory(paths: string[]): string | null {
  if (paths.length === 0) return null
  const dirs = paths.map((path) => dirname(path))
  if (dirs.length === 1) return dirs[0]
  const split = dirs.map((dir) => dir.split(/[\\/]+/).filter(Boolean))
  const first = split[0]
  if (!first.length) return null
  let length = 0
  while (
    length < first.length &&
    split.every((parts) => (parts[length] ?? '').toLowerCase() === first[length].toLowerCase())
  ) {
    length++
  }
  if (length === 0) return null
  return first.slice(0, length).join('\\')
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

async function dHashOf(path: string): Promise<string | null> {
  try {
    const { data } = await sharp(path, { failOn: 'none' })
      .resize(9, 8, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true })
    let bits = ''
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        bits += data[y * 9 + x] > data[y * 9 + x + 1] ? '1' : '0'
      }
    }
    let hex = ''
    for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
    return hex
  } catch {
    return null
  }
}

async function metaOf(path: string): Promise<{ width: number; height: number } | null> {
  try {
    const meta = await sharp(path, { failOn: 'none' }).metadata()
    const swap = meta.orientation !== undefined && meta.orientation >= 5 && meta.orientation <= 8
    const width = swap ? meta.height ?? 0 : meta.width ?? 0
    const height = swap ? meta.width ?? 0 : meta.height ?? 0
    if (!width || !height) return null
    return { width, height }
  } catch {
    return null
  }
}

async function exifOf(path: string): Promise<{ takenAt: number | null; camera: string | null }> {
  try {
    const raw = (await exifr.parse(path, {
      pick: ['Make', 'Model', 'DateTimeOriginal'],
      reviveValues: true
    })) as { Make?: string; Model?: string; DateTimeOriginal?: Date } | undefined
    if (!raw) return { takenAt: null, camera: null }
    const make = typeof raw.Make === 'string' ? raw.Make.trim() : ''
    const model = typeof raw.Model === 'string' ? raw.Model.trim() : ''
    const camera = [make, model].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() || null
    const takenAt =
      raw.DateTimeOriginal instanceof Date ? raw.DateTimeOriginal.getTime() : null
    return { takenAt, camera }
  } catch {
    return { takenAt: null, camera: null }
  }
}

interface MissingRow {
  id: number
  name: string
  size: number
  path: string
  hash: string | null
  width: number
  height: number
  exif: string | null
}

function storedExif(json: string | null): { takenAt: number | null; camera: string | null } {
  if (!json) return { takenAt: null, camera: null }
  try {
    const parsed = JSON.parse(json) as { takenAt?: string; camera?: string }
    const takenAt = parsed.takenAt ? Date.parse(parsed.takenAt) : null
    return {
      takenAt: takenAt && Number.isFinite(takenAt) ? takenAt : null,
      camera: parsed.camera?.trim() || null
    }
  } catch {
    return { takenAt: null, camera: null }
  }
}

/**
 * 重新定位计划：
 * 1. 同名 + 同大小（整目录搬家）
 * 2. 同大小 + dHash ≤4（改名但内容没动）
 * 3. 同尺寸 + dHash ≤6（重新导出/尺寸微调，进待确认）
 * 4. EXIF 拍摄时间 + 机型 + 尺寸一致（进待确认）
 * 只算计划，不动数据库。
 */
export async function buildRelocatePlan(dir: string): Promise<RelocatePlan> {
  const db = getDb()
  const missing = db
    .prepare(
      `SELECT id, name, size, path, hash, width, height, exif
       FROM items WHERE trashed = 0 AND missing = 1 ORDER BY id`
    )
    .all() as MissingRow[]
  if (missing.length === 0) {
    return { matched: [], pending: [], mapped: 0, unmatched: 0, conflicts: 0, scanned: 0 }
  }

  // 网络盘断开 / 权限不足时给出明确提示，而不是默默返回 0
  let rootStat
  try {
    rootStat = statSync(dir)
  } catch {
    throw new Error('文件夹不存在或无法访问（网络盘可能已断开）')
  }
  if (!rootStat.isDirectory()) throw new Error('请选择一个文件夹')

  const files: string[] = []
  walk(dir, files)
  const pool = files.slice(0, MAX_FILES)

  const sizeOf = new Map<string, number>()
  const bySize = new Map<number, string[]>()
  for (const path of pool) {
    let size = 0
    try {
      size = statSync(path).size
    } catch {
      continue
    }
    sizeOf.set(path, size)
    const list = bySize.get(size)
    if (list) list.push(path)
    else bySize.set(size, [path])
  }

  const tracked = new Set(
    (db.prepare('SELECT path FROM items').all() as Array<{ path: string }>).map((row) =>
      normalize(row.path)
    )
  )
  const used = new Set<string>()
  const matched: RelocatePair[] = []
  const pending: RelocatePending[] = []
  const unresolved: MissingRow[] = []
  let conflicts = 0

  const pairOf = (row: MissingRow, path: string): RelocatePair => ({
    id: row.id,
    name: row.name,
    oldPath: row.path,
    newPath: path
  })

  // 0. 目录结构映射：旧公共前缀 → 新文件夹，相对路径原样拼过去
  const mappedIds = new Set<number>()
  const prefix = commonDirectory(missing.map((row) => row.path))
  if (prefix) {
    for (const row of missing) {
      const rel = relative(prefix, row.path)
      if (!rel || rel.startsWith('..') || isAbsolute(rel)) continue
      const candidate = join(dir, rel)
      if (!existsSync(candidate) || used.has(candidate) || tracked.has(normalize(candidate))) continue
      used.add(candidate)
      matched.push(pairOf(row, candidate))
      mappedIds.add(row.id)
    }
  }
  const mapped = matched.length

  // 1. 同名 + 同大小
  for (const row of missing) {
    if (mappedIds.has(row.id)) continue
    const all = (bySize.get(row.size) ?? []).filter(
      (path) => basename(path).toLowerCase() === row.name.toLowerCase()
    )
    const usable = all.filter((path) => !used.has(path) && !tracked.has(normalize(path)))
    if (all.length > 0 && usable.length === 0) conflicts++
    if (usable.length > 0) {
      used.add(usable[0])
      matched.push(pairOf(row, usable[0]))
    } else {
      unresolved.push(row)
    }
  }

  // 2. 同大小 + dHash ≤4（改名）
  const hashes = new Map<string, string | null>()
  let hashBudget = MAX_HASHES
  const hashOf = async (path: string): Promise<string | null> => {
    if (hashes.has(path)) return hashes.get(path) ?? null
    if (hashBudget <= 0) return null
    hashBudget--
    const value = await dHashOf(path)
    hashes.set(path, value)
    return value
  }

  const afterHash: MissingRow[] = []
  for (const row of unresolved) {
    if (!row.hash) {
      afterHash.push(row)
      continue
    }
    const candidates = (bySize.get(row.size) ?? []).filter(
      (path) => !used.has(path) && !tracked.has(normalize(path))
    )
    let hit: { path: string; distance: number } | null = null
    for (const candidate of candidates.slice(0, 200)) {
      const hash = await hashOf(candidate)
      if (!hash) continue
      const distance = hamming(row.hash, hash)
      if (distance <= 4) {
        hit = { path: candidate, distance }
        break
      }
    }
    if (hit) {
      used.add(hit.path)
      matched.push(pairOf(row, hit.path))
    } else {
      afterHash.push(row)
    }
  }

  // 3. 同尺寸 + dHash ≤6（尺寸/体积变了，进待确认）
  const metas = new Map<string, { width: number; height: number } | null>()
  let metaBudget = MAX_METADATA
  const metaOfCached = async (path: string): Promise<{ width: number; height: number } | null> => {
    if (metas.has(path)) return metas.get(path) ?? null
    if (metaBudget <= 0) return null
    metaBudget--
    const value = await metaOf(path)
    metas.set(path, value)
    return value
  }

  const afterShape: MissingRow[] = []
  for (const row of afterHash) {
    if (!row.hash || !row.width || !row.height) {
      afterShape.push(row)
      continue
    }
    const extension = extname(row.path).toLowerCase()
    const candidates = pool
      .filter(
        (path) =>
          !used.has(path) &&
          !tracked.has(normalize(path)) &&
          extname(path).toLowerCase() === extension
      )
      .sort(
        (a, b) =>
          Math.abs((sizeOf.get(a) ?? 0) - row.size) - Math.abs((sizeOf.get(b) ?? 0) - row.size)
      )
      .slice(0, 120)

    let hit: { path: string; distance: number } | null = null
    for (const candidate of candidates) {
      const meta = await metaOfCached(candidate)
      if (!meta || meta.width !== row.width || meta.height !== row.height) continue
      const hash = await hashOf(candidate)
      if (!hash) continue
      const distance = hamming(row.hash, hash)
      if (distance <= 6) {
        hit = { path: candidate, distance }
        break
      }
    }
    if (hit) {
      used.add(hit.path)
      pending.push({
        ...pairOf(row, hit.path),
        reason: `画面相近（差异 ${hit.distance}/64）`,
        score: hit.distance
      })
    } else {
      afterShape.push(row)
    }
  }

  // 4. EXIF 拍摄时间 + 机型 + 尺寸（进待确认）
  let exifBudget = MAX_EXIF
  for (const row of afterShape) {
    const stored = storedExif(row.exif)
    if (!stored.takenAt || !stored.camera || !row.width || !row.height) continue
    const extension = extname(row.path).toLowerCase()
    const candidates = pool
      .filter(
        (path) =>
          !used.has(path) &&
          !tracked.has(normalize(path)) &&
          extname(path).toLowerCase() === extension
      )
      .slice(0, 200)

    let hit: string | null = null
    for (const candidate of candidates) {
      if (exifBudget <= 0) break
      const meta = await metaOfCached(candidate)
      if (!meta || meta.width !== row.width || meta.height !== row.height) continue
      exifBudget--
      const info = await exifOf(candidate)
      if (!info.takenAt || !info.camera) continue
      if (info.camera === stored.camera && Math.abs(info.takenAt - stored.takenAt) <= 2000) {
        hit = candidate
        break
      }
    }
    if (hit) {
      used.add(hit)
      pending.push({
        ...pairOf(row, hit),
        reason: 'EXIF 拍摄时间与机型一致',
        score: 0
      })
    }
  }

  matched.sort((a, b) => a.name.localeCompare(b.name))
  pending.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
  return {
    matched,
    pending,
    mapped,
    unmatched: missing.length - matched.length - pending.length,
    conflicts,
    scanned: files.length
  }
}

export function applyRelocate(pairs: RelocatePair[]): RelocateResult {
  let relinked = 0
  let failed = 0
  for (const pair of pairs) {
    if (!existsSync(pair.newPath)) {
      failed++
      continue
    }
    const name = basename(pair.newPath)
    const ext = extname(pair.newPath).toLowerCase()
    if (relinkItem(pair.id, pair.newPath, name, ext)) relinked++
    else failed++
  }
  if (relinked > 0) regroup()
  return { relinked, failed }
}
