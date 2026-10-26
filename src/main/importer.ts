import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import type { Dirent } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, dirname, extname, join } from 'node:path'
import { nativeImage } from 'electron'
import sharp from 'sharp'
import exifr from 'exifr'
import { getDb, getMeta, setMeta } from './db'
import {
  addSources,
  findMissingMatch,
  markItemError,
  previewPathFor,
  relinkItem,
  thumbPathFor
} from './repo'
import { extractEmbeddedPreview } from './raw'
import { regroup } from './grouping'
import { log } from './logger'
import { HEIF_EXT, RAW_EXT, SUPPORTED_EXT } from '../shared/formats'
import { THUMB_SIZES, THUMB_WEBP_QUALITY, type ThumbQuality } from '../shared/thumbs'
import type {
  ExifData,
  ImportErrorInfo,
  ImportOptions,
  ImportProgress,
  ImportResult,
  PendingImport
} from '../shared/types'

const SKIP_DIRS = new Set(['node_modules', '.git', '$RECYCLE.BIN', 'System Volume Information'])
const MAX_DEPTH = 32
const MAX_ERRORS = 100

export const DEFAULT_IMPORT_OPTIONS: ImportOptions = {
  recursive: true,
  skipDuplicates: true
}

interface ImportState {
  running: boolean
  paused: boolean
  cancelled: boolean
  progress: ImportProgress | null
}

const state: ImportState = {
  running: false,
  paused: false,
  cancelled: false,
  progress: null
}

type ProgressFn = (progress: ImportProgress) => void

function emit(onProgress: ProgressFn, progress: ImportProgress): void {
  state.progress = progress
  onProgress(progress)
}

export function pauseImport(): void {
  if (!state.running || state.cancelled) return
  state.paused = true
  if (state.progress) state.progress = { ...state.progress, paused: true }
}

export function resumeImport(): void {
  if (!state.running) return
  state.paused = false
  if (state.progress) state.progress = { ...state.progress, paused: false }
}

export function cancelImport(): void {
  if (state.running) state.cancelled = true
  state.paused = false
}

export function importStatus(): ImportProgress | null {
  return state.progress
}

export function isImportRunning(): boolean {
  return state.running
}

const PENDING_KEY = 'pending-import'

/**
 * 未完成的导入任务存在图库自己的 meta 表里，
 * 关掉软件或崩溃也不会丢，下次打开可以接着导。
 */
export function getPendingImport(): PendingImport | null {
  try {
    const raw = getMeta(PENDING_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PendingImport
    if (!Array.isArray(parsed.paths) || parsed.paths.length === 0) return null
    return parsed
  } catch {
    return null
  }
}

export function clearPendingImport(): void {
  try {
    setMeta(PENDING_KEY, '')
  } catch {
    /* 图库没打开时忽略 */
  }
}

const idle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

interface ScanState {
  files: string[]
  folders: number
}

/**
 * 递归扫描目录。大量文件时会定期让出事件循环，避免主进程假死。
 */
async function walk(
  dir: string,
  recursive: boolean,
  scan: ScanState,
  emitScan: () => void,
  depth = 0
): Promise<void> {
  if (depth > MAX_DEPTH || state.cancelled) return

  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (state.cancelled) return
    // 扫描阶段也支持暂停，大目录扫到一半可以先停下来
    while (state.paused && !state.cancelled) {
      emitScan()
      await sleep(150)
    }
    if (state.cancelled) return
    const name = entry.name
    if (entry.isSymbolicLink()) continue

    if (entry.isDirectory()) {
      if (!recursive) continue
      if (SKIP_DIRS.has(name) || name.startsWith('.')) continue
      await walk(join(dir, name), recursive, scan, emitScan, depth + 1)
      continue
    }

    if (!SUPPORTED_EXT.has(extname(name).toLowerCase())) continue
    scan.files.push(join(dir, name))
    if (scan.files.length % 120 === 0) {
      emitScan()
      await idle()
    }
  }

  scan.folders++
  if (scan.folders % 40 === 0) {
    emitScan()
    await idle()
  }
}

async function collectFiles(
  paths: string[],
  recursive: boolean,
  report: ProgressFn
): Promise<ScanState> {
  const scan: ScanState = { files: [], folders: 0 }
  let current = ''

  const emitScan = (): void => {
    emit(report, {
      phase: 'scanning',
      total: scan.files.length,
      done: 0,
      remaining: 0,
      added: 0,
      skipped: 0,
      failed: 0,
      current: current || '正在扫描文件夹…',
      paused: state.paused
    })
  }

  for (const path of paths) {
    if (state.cancelled) break
    current = path
    emitScan()
    while (state.paused && !state.cancelled) {
      await sleep(150)
    }
    if (state.cancelled) break
    try {
      const stat = statSync(path)
      if (stat.isDirectory()) {
        await walk(path, recursive, scan, emitScan)
      } else if (SUPPORTED_EXT.has(extname(path).toLowerCase())) {
        scan.files.push(path)
        emitScan()
      }
    } catch (error) {
      // 无权限或不存在的路径直接跳过，但要留痕，避免"少导入了却不知道原因"
      void log.warn('import', '扫描路径失败', { path, error: (error as Error).message })
    }
  }

  scan.files = Array.from(new Set(scan.files))
  return scan
}

async function makeThumb(source: string | Buffer, target: string, quality: ThumbQuality): Promise<void> {
  const size = THUMB_SIZES[quality]
  mkdirSync(dirname(target), { recursive: true })
  await sharp(source, { failOn: 'none', sequentialRead: true })
    .rotate()
    .resize(size, size, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: THUMB_WEBP_QUALITY[quality] })
    .toFile(target)
}

interface ColorInfo {
  dominant: string
  family: string
  palette: string[]
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

function classifyColor(r: number, g: number, b: number): string {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const light = (max + min) / 2
  const delta = max - min
  const sat = delta === 0 ? 0 : delta / (1 - Math.abs(2 * light - 1))

  if (light < 0.12) return 'black'
  if (light > 0.92 && sat < 0.12) return 'white'
  if (sat < 0.12) return 'gray'

  let hue = 0
  if (max === rn) hue = ((gn - bn) / delta) % 6
  else if (max === gn) hue = (bn - rn) / delta + 2
  else hue = (rn - gn) / delta + 4
  hue = (hue * 60 + 360) % 360

  if (hue < 15 || hue >= 345) return 'red'
  if (hue < 45) return 'orange'
  if (hue < 70) return 'yellow'
  if (hue < 160) return 'green'
  if (hue < 195) return 'cyan'
  if (hue < 260) return 'blue'
  if (hue < 300) return 'purple'
  return 'pink'
}

async function analyzeColor(source: string | Buffer): Promise<ColorInfo> {
  const { data } = await sharp(source, { failOn: 'none' })
    .resize(24, 24, { fit: 'inside' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const counts = new Map<string, { n: number; r: number; g: number; b: number }>()
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const key = `${r >> 5}-${g >> 5}-${b >> 5}`
    const cur = counts.get(key)
    if (cur) {
      cur.n++
      cur.r += r
      cur.g += g
      cur.b += b
    } else {
      counts.set(key, { n: 1, r, g, b })
    }
  }
  const top = [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 6)
  const palette = top.map((c) =>
    rgbToHex(Math.round(c.r / c.n), Math.round(c.g / c.n), Math.round(c.b / c.n))
  )
  const first = top[0] ?? { n: 1, r: 128, g: 128, b: 128 }
  const dr = Math.round(first.r / first.n)
  const dg = Math.round(first.g / first.n)
  const db = Math.round(first.b / first.n)
  return {
    dominant: rgbToHex(dr, dg, db),
    family: classifyColor(dr, dg, db),
    palette
  }
}

async function computeDHash(source: string | Buffer): Promise<string> {
  const { data } = await sharp(source, { failOn: 'none' })
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
  for (let i = 0; i < 64; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
  }
  return hex
}

function formatExposure(value?: number): string | undefined {
  if (!value || !Number.isFinite(value)) return undefined
  if (value >= 1) return `${Number(value.toFixed(1))}s`
  return `1/${Math.round(1 / value)}s`
}

async function readExif(
  source: string,
  fallbackTime: number
): Promise<{ exif: ExifData; takenAt: number; width?: number; height?: number }> {
  try {
    const raw = (await exifr.parse(source, {
      pick: [
        'Make',
        'Model',
        'LensModel',
        'ISO',
        'FNumber',
        'ExposureTime',
        'FocalLength',
        'DateTimeOriginal',
        'ExifImageWidth',
        'ExifImageHeight',
        'ImageWidth',
        'ImageHeight'
      ],
      reviveValues: true
    })) as Record<string, unknown> | undefined
    if (!raw) return { exif: {}, takenAt: fallbackTime }

    const make = typeof raw.Make === 'string' ? raw.Make.trim() : ''
    const model = typeof raw.Model === 'string' ? raw.Model.trim() : ''
    const camera = [make, model].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
    const lens = typeof raw.LensModel === 'string' ? raw.LensModel.trim() : ''
    const fnumber = typeof raw.FNumber === 'number' ? raw.FNumber : undefined
    const focal = typeof raw.FocalLength === 'number' ? raw.FocalLength : undefined
    const taken = raw.DateTimeOriginal instanceof Date ? raw.DateTimeOriginal : undefined
    const exifWidth = typeof raw.ExifImageWidth === 'number' ? raw.ExifImageWidth : undefined
    const exifHeight = typeof raw.ExifImageHeight === 'number' ? raw.ExifImageHeight : undefined

    const exif: ExifData = {
      camera: camera || undefined,
      lens: lens || undefined,
      iso: typeof raw.ISO === 'number' ? raw.ISO : undefined,
      aperture: fnumber ? `f/${Number(fnumber.toFixed(1))}` : undefined,
      shutter: formatExposure(typeof raw.ExposureTime === 'number' ? raw.ExposureTime : undefined),
      focal: focal ? `${Math.round(focal)}mm` : undefined,
      takenAt: taken ? taken.toISOString() : undefined
    }
    return {
      exif,
      takenAt: taken ? taken.getTime() : fallbackTime,
      width: exifWidth,
      height: exifHeight
    }
  } catch {
    return { exif: {}, takenAt: fallbackTime }
  }
}

/**
 * sharp 的预编译包没有 HEVC 解码，HEIC/HEIF 用系统图像编解码转一份 JPEG 预览，
 * 之后缩略图、主色、指纹都基于这份预览计算。
 */
function makeHeifPreview(filePath: string, target: string): void {
  const image = nativeImage.createFromPath(filePath)
  if (image.isEmpty()) {
    throw new Error('无法解码 HEIC（系统缺少 HEVC 图像扩展）')
  }
  const { width, height } = image.getSize()
  const longest = Math.max(width, height)
  const scaled =
    longest > 2560
      ? image.resize({ width: Math.round((width * 2560) / longest), quality: 'good' })
      : image
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, scaled.toJPEG(90))
}

async function processItem(id: number, filePath: string): Promise<void> {
  const db = getDb()
  const ext = extname(filePath).toLowerCase()
  const isRaw = RAW_EXT.has(ext)
  let source: string | Buffer = filePath

  if (isRaw) {
    const preview = await extractEmbeddedPreview(filePath)
    if (!preview) throw new Error('RAW 中没有找到可用的内嵌预览')
    source = preview
    // 存一份全尺寸预览，灯箱与详情页都讀它
    const previewTarget = previewPathFor(id)
    mkdirSync(dirname(previewTarget), { recursive: true })
    writeFileSync(previewTarget, preview)
  } else if (ext === '.tif' || ext === '.tiff') {
    // Chromium 不认 TIFF，灯箱用这份 JPEG 预览
    const previewTarget = previewPathFor(id)
    mkdirSync(dirname(previewTarget), { recursive: true })
    await sharp(filePath, { failOn: 'none' })
      .rotate()
      .resize(2560, 2560, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toFile(previewTarget)
  } else if (HEIF_EXT.has(ext)) {
    const previewTarget = previewPathFor(id)
    makeHeifPreview(filePath, previewTarget)
    source = previewTarget
  }

  const meta = await sharp(source, { failOn: 'none' }).metadata()
  const swap = meta.orientation !== undefined && meta.orientation >= 5 && meta.orientation <= 8
  let width = swap ? meta.height ?? 0 : meta.width ?? 0
  let height = swap ? meta.width ?? 0 : meta.height ?? 0

  const stat = statSync(filePath)
  const { exif, takenAt, width: exifWidth, height: exifHeight } = await readExif(filePath, stat.mtimeMs)
  // RAW 的原始像素尺寸往往比内嵌预览大，用 EXIF 里的真实尺寸
  if (exifWidth && exifHeight && exifWidth * exifHeight > width * height) {
    width = swap ? exifHeight : exifWidth
    height = swap ? exifWidth : exifHeight
  }

  const large = thumbPathFor(id, 'mid')
  const small = thumbPathFor(id, 'low')
  await makeThumb(source, large, 'mid')
  await makeThumb(source, small, 'low')

  const color = await analyzeColor(source)
  const hash = await computeDHash(source)

  db.prepare(
    `UPDATE items SET width = ?, height = ?, hash = ?, dominant = ?, color_family = ?,
       palette = ?, exif = ?, mtime = ?, size = ?, file_mtime = ?, error = NULL WHERE id = ?`
  ).run(
    width,
    height,
    hash,
    color.dominant,
    color.family,
    JSON.stringify(color.palette),
    JSON.stringify(exif),
    Math.round(takenAt),
    stat.size,
    Math.round(stat.mtimeMs),
    id
  )
}

/**
 * 备份里可能没带缩略图（自动备份就是），恢复后统一补齐。
 * 已经存在的缩略图会被跳过，所以正常打开也能安全调用。
 */
export async function rebuildThumbs(
  onProgress: (p: ImportProgress) => void
): Promise<{ rebuilt: number; failed: number }> {
  const db = getDb()
  const rows = db
    .prepare(
      'SELECT id, path, ext FROM items WHERE trashed = 0 AND missing = 0 AND error IS NULL ORDER BY id'
    )
    .all() as Array<{ id: number; path: string; ext: string }>

  const todo = rows.filter(
    (row) => !existsSync(thumbPathFor(row.id, 'mid')) || !existsSync(thumbPathFor(row.id, 'low'))
  )
  let done = 0
  let rebuilt = 0
  let failed = 0
  const emitProgress = (current: string): void =>
    onProgress({
      phase: 'importing',
      total: todo.length,
      done,
      remaining: Math.max(0, todo.length - done),
      added: 0,
      skipped: 0,
      failed,
      current,
      paused: false
    })
  emitProgress('')

  for (const row of todo) {
    try {
      let source: string | Buffer = row.path
      if (RAW_EXT.has(row.ext.toLowerCase())) {
        const preview = previewPathFor(row.id)
        if (!existsSync(preview)) {
          const embedded = await extractEmbeddedPreview(row.path)
          if (!embedded) throw new Error('RAW 预览不可用')
          mkdirSync(dirname(preview), { recursive: true })
          writeFileSync(preview, embedded)
        }
        source = preview
      } else if (row.ext === '.tif' || row.ext === '.tiff' || HEIF_EXT.has(row.ext.toLowerCase())) {
        const preview = previewPathFor(row.id)
        if (!existsSync(preview)) {
          if (HEIF_EXT.has(row.ext.toLowerCase())) {
            makeHeifPreview(row.path, preview)
          } else {
            mkdirSync(dirname(preview), { recursive: true })
            await sharp(row.path, { failOn: 'none' })
              .rotate()
              .resize(2560, 2560, { fit: 'inside', withoutEnlargement: true })
              .jpeg({ quality: 88 })
              .toFile(preview)
          }
        }
        source = preview
      }
      await makeThumb(source, thumbPathFor(row.id, 'mid'), 'mid')
      await makeThumb(source, thumbPathFor(row.id, 'low'), 'low')
      rebuilt++
    } catch {
      failed++
    }
    done++
    emitProgress(basename(row.path))
  }

  return { rebuilt, failed }
}

/** 快速内容指纹：文件大小 + 头 128KB + 尾 64KB，足够分辨「同一张照片」 */
function quickHash(filePath: string, size: number): string {
  const fd = openSync(filePath, 'r')
  try {
    const headSize = Math.min(131072, size)
    const head = Buffer.alloc(headSize)
    if (headSize > 0) readSync(fd, head, 0, headSize, 0)
    const tailSize = Math.min(65536, size)
    const tail = Buffer.alloc(tailSize)
    if (tailSize > 0) readSync(fd, tail, 0, tailSize, Math.max(0, size - tailSize))
    return createHash('sha1').update(String(size)).update(head).update(tail).digest('hex')
  } finally {
    closeSync(fd)
  }
}

export async function importPaths(
  paths: string[],
  onProgress: ProgressFn,
  registerSources = true,
  options: Partial<ImportOptions> = {}
): Promise<ImportResult> {
  if (state.running) throw new Error('已有导入任务正在进行，请等它结束')

  const settings: ImportOptions = { ...DEFAULT_IMPORT_OPTIONS, ...options }
  const db = getDb()

  state.running = true
  state.paused = false
  state.cancelled = false
  state.progress = null

  let added = 0
  let skipped = 0
  let failed = 0
  let relinked = 0
  const errors: ImportErrorInfo[] = []

  const startedAt = Date.now()
  const taskPaths = [...paths]
  let persistedAt = 0
  let finished = false

  /** 只有用户主动发起的导入才记断点；监听目录的自动导入不覆盖续传任务 */
  const persistPending = (done: number, total: number): void => {
    if (!registerSources) return
    try {
      const task: PendingImport = {
        paths: taskPaths,
        options: settings,
        startedAt,
        total,
        done
      }
      setMeta(PENDING_KEY, JSON.stringify(task))
    } catch {
      /* 断点写入失败不影响导入 */
    }
  }

  // 先落一条底：哪怕扫到一半关掉软件，也知道要重扫哪些目录
  persistPending(0, 0)

  // 本次导入内部的重复检测：文件大小 -> 已收下的路径
  const runImported = new Map<number, string[]>()
  const hashCache = new Map<string, string>()

  const findSameSize = db.prepare(
    `SELECT path FROM items
     WHERE size = ? AND trashed = 0 AND error IS NULL AND path <> ?
     LIMIT 40`
  )

  try {
    const scan = await collectFiles(paths, settings.recursive, onProgress)
    const files = scan.files
    const total = files.length
    let done = 0
    persistPending(0, total)

    const report = (current: string): void => {
      emit(onProgress, {
        phase: state.paused ? 'paused' : 'importing',
        total,
        done,
        remaining: Math.max(0, total - done),
        added,
        skipped,
        failed,
        current,
        paused: state.paused
      })
      // 断点进度最多每秒写一次，避免每张照片都写库
      const now = Date.now()
      if (now - persistedAt > 1000) {
        persistedAt = now
        persistPending(done, total)
      }
    }
    report('')

    const insert = db.prepare(
      `INSERT OR IGNORE INTO items(path, name, ext, size, mtime, added_at, dir)
       VALUES(?, ?, ?, ?, ?, ?, ?)`
    )
    const findId = db.prepare('SELECT id, width, error FROM items WHERE path = ?')

    let cursor = 0
    const worker = async (): Promise<void> => {
      for (;;) {
        if (state.cancelled) return
        while (state.paused && !state.cancelled) {
          await sleep(150)
        }
        if (state.cancelled) return
        // 暂停会让出事件循环，期间别的 worker 可能已经把队列取空，
        // 所以必须在这里重新确认索引，不能沿用循环开头的判断
        const index = cursor
        if (index >= files.length) return
        cursor = index + 1
        const filePath = files[index]
        let id = 0
        let isNew = false
        let size = 0

        try {
          if (!existsSync(filePath)) throw new Error('文件已不存在')
          const stat = statSync(filePath)
          size = stat.size
          const ext = extname(filePath).toLowerCase()
          const name = basename(filePath)

          // 文件被移动/改名后，按「文件名 + 大小」接回旧记录，标签和评分都不会丢
          const orphan = findMissingMatch(name, size)
          if (orphan && relinkItem(orphan.id, filePath, name, ext)) {
            relinked++
            continue
          }

          const info = insert.run(
            filePath,
            name,
            ext,
            size,
            Math.round(stat.mtimeMs),
            Date.now(),
            dirname(filePath)
          )
          if (info.changes === 0) {
            const existing = findId.get(filePath) as
              | { id: number; width: number; error: string | null }
              | undefined
            if (existing && existing.width > 0 && !existing.error) {
              skipped++
              continue
            }
            id = existing?.id ?? 0
          } else {
            id = Number(info.lastInsertRowid)
            isNew = true
          }
          if (!id) throw new Error('无法写入记录')

          if (settings.skipDuplicates) {
            try {
              const candidates = [
                ...(findSameSize.all(size, filePath) as Array<{ path: string }>).map((r) => r.path),
                ...(runImported.get(size) ?? [])
              ].filter((candidate) => candidate !== filePath && existsSync(candidate))

              if (candidates.length > 0) {
                const incoming = quickHash(filePath, size)
                let duplicate = false
                for (const candidate of candidates) {
                  let other = hashCache.get(candidate)
                  if (!other) {
                    other = quickHash(candidate, size)
                    hashCache.set(candidate, other)
                  }
                  if (other === incoming) {
                    duplicate = true
                    break
                  }
                }
                if (duplicate) {
                  skipped++
                  // 命中重复的文件不留在库里，避免出现空记录
                  if (isNew && id) db.prepare('DELETE FROM items WHERE id = ?').run(id)
                  continue
                }
              }
            } catch {
              // 读不出指纹就放弃这次查重，不影响正常导入
            }
          }

          // 先占位，避免并发 worker 把同一张照片同时收进来
          const bucket = runImported.get(size)
          if (bucket) bucket.push(filePath)
          else runImported.set(size, [filePath])

          await processItem(id, filePath)
          added++
        } catch (error) {
          failed++
          const message = (error as Error).message || '未知错误'
          if (id) {
            markItemError(id, message)
          }
          if (errors.length < MAX_ERRORS) {
            errors.push({ path: filePath, name: basename(filePath), message })
          }
          console.warn('[import] 跳过', filePath, message)
          void log.warn('import', '文件处理失败', { path: filePath, message })
        } finally {
          done++
          report(basename(filePath))
        }
      }
    }

    const workers = Array.from(
      { length: Math.min(4, Math.max(1, files.length)) },
      () => worker()
    )
    await Promise.all(workers)

    // 取消后仍然要收尾：已导入的部分要参与分组，目录要纳入监听
    if (registerSources && paths.length > 0) {
      const entries: Array<{ path: string; recursive: boolean }> = []
      for (const p of paths) {
        try {
          entries.push(
            statSync(p).isDirectory()
              ? { path: p, recursive: settings.recursive }
              : { path: dirname(p), recursive: false }
          )
        } catch {
          /* 忽略无法访问的路径 */
        }
      }
      if (entries.length) addSources(entries)
    }

    regroup()

    finished = true
    // 失败与跳过只在汇总里留一条，避免每张图刷日志
    if (failed > 0 || skipped > 0) {
      void log.warn('import', '导入完成但有跳过或失败', {
        added,
        skipped,
        failed,
        scanned: files.length,
        roots: rootsOf(paths).length
      })
    }
    return {
      added,
      skipped,
      failed,
      relinked,
      scanned: files.length,
      cancelled: state.cancelled,
      errors,
      roots: rootsOf(paths)
    }
  } finally {
    state.running = false
    state.paused = false
    state.cancelled = false
    state.progress = null
    // 正常结束或用户主动取消才清断点；异常退出保留，下次还能继续
    if (finished) clearPendingImport()
  }
}

function rootsOf(paths: string[]): string[] {
  const roots = new Set<string>()
  for (const path of paths) {
    try {
      roots.add(statSync(path).isDirectory() ? path : dirname(path))
    } catch {
      /* 不存在的路径不计入 */
    }
  }
  return [...roots]
}

/**
 * 只重新处理已有记录（照片被原地覆盖修改时用）：
 * 不新增记录、不查重，重算缩略图、EXIF、尺寸和色彩。
 */
export async function reprocessPaths(
  paths: string[],
  onProgress: ProgressFn
): Promise<{ refreshed: number; failed: number }> {
  if (state.running) throw new Error('已有导入任务正在进行，请等它结束')

  const db = getDb()
  const find = db.prepare('SELECT id FROM items WHERE path = ?')
  state.running = true
  state.paused = false
  state.cancelled = false
  state.progress = null

  const total = paths.length
  let done = 0
  let refreshed = 0
  let failed = 0

  const report = (current: string): void => {
    emit(onProgress, {
      phase: state.paused ? 'paused' : 'importing',
      total,
      done,
      remaining: Math.max(0, total - done),
      added: 0,
      skipped: 0,
      failed,
      current,
      paused: state.paused
    })
  }
  report('')

  try {
    for (const filePath of paths) {
      if (state.cancelled) break
      while (state.paused && !state.cancelled) await sleep(150)
      if (state.cancelled) break

      const row = find.get(filePath) as { id: number } | undefined
      if (!row) {
        failed++
        done++
        report(basename(filePath))
        continue
      }

      try {
        // 先清掉旧尺寸与缓存，交给 processItem 整份重算
        db.prepare('UPDATE items SET width = 0, height = 0, error = NULL WHERE id = ?').run(row.id)
        for (const cached of [
          thumbPathFor(row.id, 'mid'),
          thumbPathFor(row.id, 'low'),
          thumbPathFor(row.id, 'high'),
          previewPathFor(row.id)
        ]) {
          try {
            if (existsSync(cached)) unlinkSync(cached)
          } catch {
            /* 删不掉就让 processItem 覆盖写 */
          }
        }
        await processItem(row.id, filePath)
        refreshed++
      } catch (error) {
        failed++
        markItemError(row.id, (error as Error).message || '未知错误')
      }
      done++
      report(basename(filePath))
    }
  } finally {
    state.running = false
    state.paused = false
    state.cancelled = false
    state.progress = null
  }

  return { refreshed, failed }
}
