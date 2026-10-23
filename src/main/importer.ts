import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import sharp from 'sharp'
import exifr from 'exifr'
import { getDb } from './db'
import { addSources, findMissingMatch, previewPathFor, purgeItems, relinkItem, thumbPathFor } from './repo'
import { extractEmbeddedPreview } from './raw'
import { regroup } from './grouping'
import { RAW_EXT, SUPPORTED_EXT } from '../shared/formats'
import type { ExifData, ImportProgress, ImportResult } from '../shared/types'

const SKIP_DIRS = new Set(['node_modules', '.git', '$RECYCLE.BIN', 'System Volume Information'])

function walk(dir: string, out: string[], depth = 0): void {
  if (depth > 8) return
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

function collectFiles(paths: string[]): string[] {
  const out: string[] = []
  for (const p of paths) {
    try {
      const st = statSync(p)
      if (st.isDirectory()) walk(p, out)
      else if (SUPPORTED_EXT.has(extname(p).toLowerCase())) out.push(p)
    } catch {
      /* 跳过不存在或无权限的路径 */
    }
  }
  return Array.from(new Set(out))
}

async function makeThumb(
  source: string | Buffer,
  target: string,
  size: number,
  quality = 82
): Promise<void> {
  mkdirSync(dirname(target), { recursive: true })
  await sharp(source, { failOn: 'none', sequentialRead: true })
    .rotate()
    .resize(size, size, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality })
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
  const { data, info } = await sharp(source, { failOn: 'none' })
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
  const first = top[0] ?? { r: 128, g: 128, b: 128 }
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

  const large = thumbPathFor(id)
  const small = thumbPathFor(id, true)
  await makeThumb(source, large, 720)
  await makeThumb(source, small, 260, 78)

  const color = await analyzeColor(source)
  const hash = await computeDHash(source)

  db.prepare(
    `UPDATE items SET width = ?, height = ?, hash = ?, dominant = ?, color_family = ?,
       palette = ?, exif = ?, mtime = ?, size = ? WHERE id = ?`
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
    .prepare('SELECT id, path, ext FROM items WHERE trashed = 0 AND missing = 0 ORDER BY id')
    .all() as Array<{ id: number; path: string; ext: string }>

  const todo = rows.filter(
    (row) => !existsSync(thumbPathFor(row.id)) || !existsSync(thumbPathFor(row.id, true))
  )
  let done = 0
  let rebuilt = 0
  let failed = 0
  onProgress({ total: todo.length, done, current: '' })

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
      } else if (row.ext === '.tif' || row.ext === '.tiff') {
        const preview = previewPathFor(row.id)
        if (!existsSync(preview)) {
          mkdirSync(dirname(preview), { recursive: true })
          await sharp(row.path, { failOn: 'none' })
            .rotate()
            .resize(2560, 2560, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 88 })
            .toFile(preview)
        }
        source = preview
      }
      await makeThumb(source, thumbPathFor(row.id), 720)
      await makeThumb(source, thumbPathFor(row.id, true), 260, 78)
      rebuilt++
    } catch {
      failed++
    }
    done++
    onProgress({ total: todo.length, done, current: basename(row.path) })
  }

  return { rebuilt, failed }
}

export async function importPaths(
  paths: string[],
  onProgress: (p: ImportProgress) => void,
  registerSources = true
): Promise<ImportResult> {
  const db = getDb()
  const files = collectFiles(paths)
  const total = files.length
  let done = 0
  let added = 0
  let skipped = 0
  let failed = 0
  let relinked = 0

  const insert = db.prepare(
    `INSERT OR IGNORE INTO items(path, name, ext, size, mtime, added_at)
     VALUES(?, ?, ?, ?, ?, ?)`
  )
  const findId = db.prepare('SELECT id, width FROM items WHERE path = ?')

  onProgress({ total, done, current: '' })

  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < files.length) {
      const index = cursor++
      const filePath = files[index]
      let id = 0
      let isNew = false
      try {
        if (!existsSync(filePath)) {
          continue
        }
        const st = statSync(filePath)
        const ext = extname(filePath).toLowerCase()
        const name = basename(filePath)

        // 文件被移动/改名后，按「文件名 + 大小」接回旧记录，标签和评分都不会丢
        const orphan = findMissingMatch(name, st.size)
        if (orphan && relinkItem(orphan.id, filePath, name, ext)) {
          relinked++
          continue
        }

        const info = insert.run(filePath, name, ext, st.size, Math.round(st.mtimeMs), Date.now())
        if (info.changes === 0) {
          const existing = findId.get(filePath) as { id: number; width: number } | undefined
          if (existing && existing.width > 0) {
            skipped++
            continue
          }
          id = existing?.id ?? 0
        } else {
          id = Number(info.lastInsertRowid)
          isNew = true
        }
        if (!id) throw new Error('无法写入记录')
        await processItem(id, filePath)
        if (isNew) added++
      } catch (error) {
        failed++
        if (id) purgeItems([id])
        console.warn('[import] 跳过', filePath, (error as Error).message)
      } finally {
        done++
        onProgress({ total, done, current: basename(filePath) })
      }
    }
  }

  const workers = Array.from({ length: Math.min(4, Math.max(1, files.length)) }, () => worker())
  await Promise.all(workers)

  if (registerSources && paths.length > 0) {
    const entries: Array<{ path: string; recursive: boolean }> = []
    for (const p of paths) {
      try {
        entries.push(
          statSync(p).isDirectory()
            ? { path: p, recursive: true }
            : { path: dirname(p), recursive: false }
        )
      } catch {
        /* 忽略无法访问的路径 */
      }
    }
    if (entries.length) addSources(entries)
  }

  regroup()

  return { added, skipped, failed, relinked }
}
