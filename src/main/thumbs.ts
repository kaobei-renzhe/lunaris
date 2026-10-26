import { existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs'
import { readdir, stat, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import sharp from 'sharp'
import { getItemFile, thumbPathFor } from './repo'
import { getIndexPath } from './db'
import { getThumbCacheLimitMB } from './settings'
import { log } from './logger'
import {
  THUMB_SIZES,
  THUMB_WEBP_QUALITY,
  type ThumbCacheClearResult,
  type ThumbCacheStats,
  type ThumbCacheTarget,
  type ThumbQuality
} from '../shared/thumbs'

/** 同一张图的同一档并发请求时只生成一次 */
const pending = new Map<string, Promise<void>>()

/** 相机原图解码很吃内存，切档时整屏并发会顶到峰值，这里限流 */
const MAX_CONCURRENT = 3
let active = 0
const waiters: Array<() => void> = []

/** 清理缓存时递增，让正在生成的旧结果作废，避免删完又被写回去 */
let epoch = 0

/**
 * 队列里的请求被唤醒时直接接管前一个让出的槽位（不再 active++），
 * 否则唤醒到执行的间隙里新请求挤进来，并发会短暂超过上限。
 */
async function withSlot<T>(task: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiters.push(resolve))
  else active++
  try {
    return await task()
  } finally {
    const next = waiters.shift()
    if (next) next()
    else active--
  }
}

async function render(id: number, quality: ThumbQuality, runEpoch: number): Promise<void> {
  const target = thumbPathFor(id, quality)
  if (existsSync(target)) return

  // 低档是缩图，直接拿中档当输入更快；中/高档要细节，必须回原图
  const mid = thumbPathFor(id, 'mid')
  const source = quality === 'low' && existsSync(mid) ? mid : getItemFile(id)
  if (!source || !existsSync(source)) return

  mkdirSync(dirname(target), { recursive: true })
  const temp = `${target}.tmp`
  try {
    await withSlot(() =>
      sharp(source, { failOn: 'none' })
        .rotate()
        .resize(THUMB_SIZES[quality], THUMB_SIZES[quality], { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: THUMB_WEBP_QUALITY[quality] })
        .toFile(temp)
    )
    // 生成期间用户清过缓存：这份结果已经过时，直接丢掉
    if (runEpoch !== epoch) {
      unlinkSync(temp)
      return
    }
    // 先写临时文件再改名，避免读到写了一半的缩略图
    renameSync(temp, target)
  } catch (error) {
    // 失败时别把半截文件留在缩略图目录里
    try {
      if (existsSync(temp)) unlinkSync(temp)
    } catch {
      /* 清理失败不影响主流程 */
    }
    throw error
  }
}

/**
 * 按需生成缩略图。导入时只预生成中档与低档，
 * 高档（以及老图库缺失的低档）在真正要显示时才补，失败只告警、协议层会逐级回退。
 */
export function ensureThumb(id: number, quality: ThumbQuality): Promise<void> {
  if (existsSync(thumbPathFor(id, quality))) return Promise.resolve()
  const key = `${id}:${quality}`
  const running = pending.get(key)
  if (running) return running

  const task = render(id, quality, epoch)
    .catch((error) => {
      void log.warn('thumb', '生成缩略图失败', { id, quality, error: (error as Error).message })
    })
    .finally(() => {
      pending.delete(key)
    })

  pending.set(key, task)
  return task
}

const CHUNK = 64

interface ThumbFile {
  file: string
  quality: ThumbQuality
}

/** 列出缩略图目录里的所有文件（含可能的 .tmp 残片） */
async function listThumbFiles(): Promise<ThumbFile[]> {
  const root = join(getIndexPath(), 'thumbnails')
  const out: ThumbFile[] = []
  let buckets: string[]
  try {
    buckets = await readdir(root)
  } catch {
    return out
  }
  for (const bucket of buckets) {
    let names: string[]
    try {
      names = await readdir(join(root, bucket))
    } catch {
      continue
    }
    for (const name of names) {
      const quality: ThumbQuality = name.endsWith('_s.webp')
        ? 'low'
        : name.endsWith('_l.webp')
          ? 'high'
          : 'mid'
      out.push({ file: join(root, bucket, name), quality })
    }
  }
  return out
}

/** 几万文件时串行 stat 会卡住主进程，分批并行 */
async function eachChunk<T>(items: T[], run: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += CHUNK) {
    await Promise.all(items.slice(i, i + CHUNK).map((item) => run(item)))
  }
}

/** 统计三档缩略图各占多少 */
export async function thumbCacheStats(): Promise<ThumbCacheStats> {
  const stats: ThumbCacheStats = {
    low: { count: 0, bytes: 0 },
    mid: { count: 0, bytes: 0 },
    high: { count: 0, bytes: 0 }
  }
  const files = await listThumbFiles()
  await eachChunk(files, async ({ file, quality }) => {
    if (!file.endsWith('.webp')) return
    try {
      const info = await stat(file)
      stats[quality].count++
      stats[quality].bytes += info.size
    } catch {
      /* 统计期间被删掉，忽略 */
    }
  })
  return stats
}

/**
 * 清理缩略图缓存。target=high 只删高清档（自动档按需生成的那份），
 * target=all 会连中/低档一起删，下次显示时按需重新生成。
 */
export async function clearThumbCache(target: ThumbCacheTarget = 'high'): Promise<ThumbCacheClearResult> {
  epoch++
  const files = await listThumbFiles()
  let removed = 0
  let freed = 0
  await eachChunk(files, async ({ file, quality }) => {
    const stale = file.endsWith('.tmp')
    if (!stale && target !== 'all' && quality !== target) return
    try {
      const info = await stat(file)
      await unlink(file)
      removed++
      freed += info.size
    } catch {
      /* 已经被别的流程删掉 */
    }
  })
  return { removed, freed }
}

/** 高清档最近一次被看到的时刻（只放内存，重启后靠文件 mtime 兜底） */
const highTouch = new Map<number, number>()
const TOUCH_MAX = 20000

/** 命中的时候记一笔，给 LRU 淘汰排序用 */
export function touchHighThumb(id: number): void {
  if (!Number.isFinite(id) || id <= 0) return
  highTouch.delete(id)
  highTouch.set(id, Date.now())
  if (highTouch.size > TOUCH_MAX) {
    const oldest = highTouch.keys().next()
    if (!oldest.done) highTouch.delete(oldest.value)
  }
}

/** 检查间隔：滚动时每次请求都触发，必须节流 */
const PRUNE_INTERVAL = 5 * 60 * 1000
let lastPruneAt = 0
let pruning = false

/**
 * 超过上限就按「最久未用」淘汰高清档，只动 `_l`，中/低档不碰。
 * 淘汰到上限的 80%，留一点缓冲，免得每加一张就清一次。
 */
export async function pruneHighCache(force = false): Promise<number> {
  const limitMB = getThumbCacheLimitMB()
  if (limitMB <= 0) return 0
  const now = Date.now()
  if (!force && now - lastPruneAt < PRUNE_INTERVAL) return 0
  if (pruning) return 0
  pruning = true
  lastPruneAt = now
  try {
    const files = (await listThumbFiles()).filter((entry) => entry.quality === 'high')
    if (files.length === 0) return 0

    const entries: Array<{ file: string; id: number; size: number; at: number }> = []
    let total = 0
    await eachChunk(files, async ({ file }) => {
      try {
        const info = await stat(file)
        const id = Number(basename(file, '.webp').replace(/_l$/, ''))
        entries.push({ file, id, size: info.size, at: highTouch.get(id) ?? info.mtimeMs })
        total += info.size
      } catch {
        /* 文件刚被删，忽略 */
      }
    })

    const limit = limitMB * 1024 * 1024
    if (total <= limit) return 0

    const target = Math.floor(limit * 0.8)
    entries.sort((a, b) => a.at - b.at)
    let freed = 0
    for (const entry of entries) {
      if (total - freed <= target) break
      try {
        await unlink(entry.file)
        freed += entry.size
        highTouch.delete(entry.id)
      } catch {
        /* 删不掉就跳过，下次再说 */
      }
    }
    if (freed > 0) {
      void log.info('thumb', '高清缓存超出上限，已按最久未用清理', {
        limitMB,
        freedMB: Math.round(freed / 1048576),
        leftMB: Math.round((total - freed) / 1048576)
      })
    }
    return freed
  } finally {
    pruning = false
  }
}
