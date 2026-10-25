import { existsSync, readdirSync, statSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { extname, join, sep } from 'node:path'
import { getDb, getLibraryPath } from './db'
import { importPaths, isImportRunning, reprocessPaths } from './importer'
import { listSources, markMissingByPath } from './repo'
import { regroup } from './grouping'
import { SUPPORTED_EXT } from '../shared/formats'
import type { ImportOptions, ImportProgress, SyncResult } from '../shared/types'

const SKIP_DIRS = new Set(['node_modules', '.git', '$RECYCLE.BIN', 'System Volume Information'])
const MAX_DEPTH = 32

const idle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

interface SyncRoot {
  path: string
  recursive: boolean
}

/**
 * 手动刷新图库：扫一遍源目录，和数据库对账。
 * - 新文件：走导入流程（已存在的会被跳过）
 * - 删掉的文件：标记为「文件丢失」，记录和标签保留
 * - 找回的文件：取消丢失标记
 * - 被覆盖修改的文件：重算缩略图、EXIF、尺寸
 * 平时不做任何轮询，只有点「刷新图库」时才跑。
 */
export async function syncLibrary(
  onProgress: (progress: ImportProgress) => void,
  options: ImportOptions
): Promise<SyncResult> {
  if (isImportRunning()) throw new Error('正在导入，等当前任务结束再刷新')

  const db = getDb()
  const report = (current: string, total: number): void => {
    onProgress({
      phase: 'scanning',
      total,
      done: 0,
      remaining: 0,
      added: 0,
      skipped: 0,
      failed: 0,
      current,
      paused: false
    })
  }

  const missingRoots: string[] = []
  const rootMap = new Map<string, SyncRoot>()
  const addRoot = (path: string, recursive: boolean): void => {
    const key = path.toLowerCase().replace(/[\\/]+$/, '')
    if (!rootMap.has(key)) rootMap.set(key, { path, recursive })
  }

  for (const source of listSources()) {
    if (!source.path) continue
    if (!existsSync(source.path)) {
      missingRoots.push(source.path)
      continue
    }
    addRoot(source.path, source.recursive === 1)
  }

  // 老图库可能没有来源记录：退而扫描每张照片所在目录（非递归），保证不漏
  const dirs = db
    .prepare(
      `SELECT DISTINCT dir FROM items
       WHERE trashed = 0 AND dir IS NOT NULL AND dir <> ''`
    )
    .all() as Array<{ dir: string }>
  const roots = [...rootMap.values()]
  for (const row of dirs) {
    const lower = row.dir.toLowerCase()
    const covered = roots.some(
      (root) =>
        root.recursive &&
        (lower === root.path.toLowerCase() ||
          lower.startsWith(`${root.path.toLowerCase()}${sep}`))
    )
    if (!covered) addRoot(row.dir, false)
  }
  // 索引被清空过（没有来源记录、也没有任何图片）时按图库根目录兜底扫一遍，
  // 让「刷新图库」能把丢掉的索引重新建起来
  if (rootMap.size === 0) {
    const library = getLibraryPath()
    if (library && existsSync(library)) addRoot(library, options.recursive !== false)
  }

  const found = new Map<string, string>()
  const scannedRoots = [...rootMap.values()]

  const walk = async (dir: string, recursive: boolean, depth = 0): Promise<void> => {
    if (depth > MAX_DEPTH) return
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const name = entry.name
      if (entry.isDirectory()) {
        if (!recursive) continue
        if (SKIP_DIRS.has(name) || name.startsWith('.')) continue
        await walk(join(dir, name), recursive, depth + 1)
        continue
      }
      if (!SUPPORTED_EXT.has(extname(name).toLowerCase())) continue
      const full = join(dir, name)
      found.set(full.toLowerCase(), full)
      if (found.size % 200 === 0) {
        report(dir, found.size)
        await idle()
      }
    }
  }

  report(scannedRoots[0]?.path ?? '', 0)
  for (const root of scannedRoots) {
    report(root.path, found.size)
    await walk(root.path, root.recursive)
  }

  const rows = db
    .prepare('SELECT id, path, size, file_mtime, missing FROM items WHERE trashed = 0')
    .all() as Array<{ id: number; path: string; size: number; file_mtime: number; missing: number }>
  const known = new Set(rows.map((row) => row.path.toLowerCase()))

  const newFiles: string[] = []
  for (const [lower, actual] of found) {
    if (!known.has(lower)) newFiles.push(actual)
  }

  const deleted: string[] = []
  const restoredIds: number[] = []
  const modified: string[] = []

  for (const row of rows) {
    const hit = found.get(row.path.toLowerCase())
    if (!hit) {
      if (!existsSync(row.path)) deleted.push(row.path)
      continue
    }
    if (row.missing === 1) {
      restoredIds.push(row.id)
      continue
    }
    try {
      const stat = statSync(row.path)
      const changed =
        stat.size !== row.size ||
        (row.file_mtime > 0 && Math.round(stat.mtimeMs) !== row.file_mtime)
      if (changed) modified.push(row.path)
    } catch {
      /* 刚删掉的文件留到下次刷新处理 */
    }
  }

  if (restoredIds.length > 0) {
    const update = db.prepare('UPDATE items SET missing = 0 WHERE id = ?')
    db.transaction(() => {
      for (const id of restoredIds) update.run(id)
    })()
  }

  const missing = deleted.length > 0 ? markMissingByPath(deleted) : 0

  let added = 0
  let failed = 0
  let refreshed = 0
  let cancelled = false

  if (newFiles.length > 0) {
    const result = await importPaths(newFiles, onProgress, false, options)
    added = result.added
    failed += result.failed
    cancelled = result.cancelled
  }

  if (!cancelled && modified.length > 0) {
    const result = await reprocessPaths(modified, onProgress)
    refreshed = result.refreshed
    failed += result.failed
  }

  // importPaths 内部会 regroup；只处理修改/丢失时这里补一次
  if (newFiles.length === 0) regroup()

  return {
    scanned: found.size,
    added,
    missing,
    restored: restoredIds.length,
    refreshed,
    failed,
    missingRoots
  }
}
