import { existsSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { getDb, getLibraryPath, getMeta, resolveIndexDir, setMeta } from './db'
import { getIndexDirFor, libraryKey, readConfig, updateConfig, type AppConfig } from './settings'
import { log } from './logger'
import type {
  LibraryEntry,
  LibraryRelocateResult,
  LibraryStatus,
  LibrarySummary
} from '../shared/types'

const INDEX_FILES = ['library.db', 'library.db-wal', 'library.db-shm']
const INDEX_DIRS = ['thumbnails', 'previews']

function samePath(a: string, b: string): boolean {
  return libraryKey(a) === libraryKey(b)
}

/** 去掉末尾分隔符，避免同一个目录存成两种写法 */
function normalizePath(path: string): string {
  return path.replace(/[\\/]+$/, '')
}

function dedupe(entries: LibraryEntry[]): LibraryEntry[] {
  const paths = new Set<string>()
  const ids = new Set<string>()
  const out: LibraryEntry[] = []
  for (const entry of entries) {
    if (!entry?.id || !entry.path) continue
    const pathKey = libraryKey(entry.path)
    if (paths.has(pathKey) || ids.has(entry.id)) continue
    paths.add(pathKey)
    ids.add(entry.id)
    out.push(entry)
  }
  return out
}

function readDbInfo(file: string): { id: string | null; itemCount: number } | null {
  if (!existsSync(file)) return null
  let db: Database.Database | null = null
  try {
    db = new Database(file)
    let id: string | null = null
    let itemCount = 0
    try {
      const row = db
        .prepare("SELECT value FROM meta WHERE key = 'library_id'")
        .get() as { value: string } | undefined
      id = row?.value ?? null
    } catch {
      /* 老库没有 meta 表，按没有身份处理 */
    }
    try {
      itemCount = (
        db.prepare('SELECT COUNT(*) AS c FROM items WHERE trashed = 0').get() as { c: number }
      ).c
    } catch {
      /* 损坏的库读不出张数，保留 0 */
    }
    return { id, itemCount }
  } catch (error) {
    void log.warn('library', '读取图库信息失败', { file, error: (error as Error).message })
    return null
  } finally {
    db?.close()
  }
}

function readRawInfo(dir: string): { id: string | null; itemCount: number } | null {
  return readDbInfo(join(resolveIndexDir(dir), 'library.db'))
}

/** 给一个库写身份；已有条目时以库里的 id 为准 */
function writeIdAt(file: string, id: string): boolean {
  if (!existsSync(file)) return false
  let db: Database.Database | null = null
  try {
    db = new Database(file)
    db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)')
    db.prepare(
      "INSERT INTO meta(key, value) VALUES('library_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run(id)
    return true
  } catch (error) {
    void log.warn('library', '写入图库身份失败', { file, error: (error as Error).message })
    return false
  } finally {
    db?.close()
  }
}

function writeLibraryId(dir: string, id: string): boolean {
  return writeIdAt(join(resolveIndexDir(dir), 'library.db'), id)
}

/** 读取一个库的身份；没有就创建一个并写回去 */
function readOrCreateId(dir: string): string | null {
  const info = readRawInfo(dir)
  if (!info) return null
  if (info.id) return info.id
  const id = randomUUID()
  return writeLibraryId(dir, id) ? id : null
}

/** 当前已打开库的身份；首次会写进 meta */
function currentLibraryId(): string {
  const existing = getMeta('library_id')
  if (existing) return existing
  const id = randomUUID()
  setMeta('library_id', id)
  return id
}

/** 当前已经打开的那条库，优先走主连接，避免迁移时再开第二个连接 */
function currentRawInfo(dir: string): { id: string | null; itemCount: number } | null {
  const current = getLibraryPath()
  if (!current || !samePath(current, dir)) return null
  let id: string | null = null
  try {
    id = getMeta('library_id')
  } catch {
    id = null
  }
  let itemCount = 0
  try {
    itemCount = (
      getDb().prepare('SELECT COUNT(*) AS c FROM items WHERE trashed = 0').get() as { c: number }
    ).c
  } catch {
    itemCount = 0
  }
  return { id, itemCount }
}

/** 老配置迁移：没有 libraries 字段时，把上次打开的库包成一条 */
export function ensureLibraryRegistry(): LibraryEntry[] {
  const config = readConfig()
  if (Array.isArray(config.libraries)) return dedupe(config.libraries)

  const libraries: LibraryEntry[] = []
  if (config.library) {
    const live = currentRawInfo(config.library)
    const info = live ?? readRawInfo(config.library)
    let id = info?.id ?? null
    if (!id) {
      if (live) {
        id = randomUUID()
        try {
          setMeta('library_id', id)
        } catch {
          /* 写身份失败也不影响清单，重新定位时可以再补 */
        }
      } else {
        id = readOrCreateId(config.library) ?? randomUUID()
      }
    }
    libraries.push({
      id,
      path: normalizePath(config.library),
      name: basename(config.library) || config.library,
      lastOpened: Date.now(),
      itemCount: info?.itemCount ?? 0
    })
  }
  updateConfig({ libraries })
  return libraries
}

function toSummary(entry: LibraryEntry): LibrarySummary {
  const dirExists = existsSync(entry.path)
  const indexExists = dirExists && existsSync(join(resolveIndexDir(entry.path), 'library.db'))
  const status: LibraryStatus = !dirExists ? 'missing' : !indexExists ? 'index-missing' : 'ok'
  return { ...entry, status }
}

export function listLibraries(): LibrarySummary[] {
  return ensureLibraryRegistry()
    .map(toSummary)
    .sort((a, b) => b.lastOpened - a.lastOpened)
}

/**
 * 打开库时刷新注册表：补上新库、更新最后打开时间与张数。
 * 必须在 openLibrary 之后调用。
 */
export function touchLibrary(dir: string): void {
  const entries = ensureLibraryRegistry()
  const path = normalizePath(dir)
  const id = currentLibraryId()
  const itemCount = (
    getDb().prepare('SELECT COUNT(*) AS c FROM items WHERE trashed = 0').get() as { c: number }
  ).c
  const index = entries.findIndex((entry) => entry.id === id || samePath(entry.path, path))
  if (index >= 0) {
    const previous = entries[index]
    entries[index] = {
      ...previous,
      id,
      path,
      name: previous.name || basename(path) || path,
      lastOpened: Date.now(),
      itemCount
    }
  } else {
    entries.push({
      id,
      path,
      name: basename(path) || path,
      lastOpened: Date.now(),
      itemCount
    })
  }
  updateConfig({ libraries: dedupe(entries) })
}

export function renameLibrary(id: string, name: string): void {
  const nextName = String(name ?? '').trim().slice(0, 40)
  if (!nextName) throw new Error('库名不能为空')
  const entries = ensureLibraryRegistry()
  const index = entries.findIndex((entry) => entry.id === id)
  if (index < 0) throw new Error('图库记录不存在')
  entries[index] = { ...entries[index], name: nextName }
  updateConfig({ libraries: entries })
}

/**
 * 从清单移除。alsoDeleteData 只删索引（library.db / 缩略图 / 预览），
 * 原图一张都不动；当前正在使用的库不允许移除。
 */
export function forgetLibrary(id: string, alsoDeleteData = false): void {
  const config = readConfig()
  const entries = ensureLibraryRegistry()
  const entry = entries.find((item) => item.id === id)
  if (!entry) return

  const current = getLibraryPath()
  if (current && samePath(current, entry.path)) {
    throw new Error('当前正在使用的图库不能移除，请先切到别的图库')
  }

  const remaining = entries.filter((item) => item.id !== id)
  const patch: Partial<AppConfig> = { libraries: remaining }

  if (alsoDeleteData) {
    // 用配置里的索引目录，不用探活回退后的路径：索引被搬走时也能删对地方
    const indexDir = getIndexDirFor(entry.path)
    for (const name of INDEX_FILES) {
      rmSync(join(indexDir, name), { force: true })
    }
    for (const name of INDEX_DIRS) {
      rmSync(join(indexDir, name), { recursive: true, force: true })
    }
    const map = { ...(config.libraryIndex ?? {}) }
    delete map[libraryKey(entry.path)]
    patch.libraryIndex = map
    void log.info('library', '已删除图库索引数据（原图未动）', { path: entry.path, indexDir })
  }

  if (config.library && samePath(config.library, entry.path)) {
    const next = [...remaining].sort((a, b) => b.lastOpened - a.lastOpened)[0]
    patch.library = next?.path
  }

  updateConfig(patch)
}

/**
 * 目录搬家后重新定位：目标库里的 library_id 必须一致；
 * 目标库还没写过身份时，把当前 id 盖进去（旧库第一次迁移到新位置的情况）。
 */
export function relocateLibrary(id: string, dir: string): LibraryRelocateResult {
  const config = readConfig()
  const entries = ensureLibraryRegistry()
  const entry = entries.find((item) => item.id === id)
  if (!entry) return { ok: false, message: '图库记录不存在' }

  const path = normalizePath(dir)
  const directFile = join(path, 'library.db')
  const oldIndex = getIndexDirFor(entry.path)
  // 索引单独存放的用户：目录搬走后 library.db 可能还在老的外部索引目录里
  const externalIndex =
    !existsSync(directFile) && !samePath(oldIndex, entry.path) ? oldIndex : null
  const directInfo = readDbInfo(directFile)
  const externalInfo =
    !directInfo && externalIndex ? readDbInfo(join(externalIndex, 'library.db')) : null
  const info = directInfo ?? externalInfo
  if (!info) return { ok: false, message: '这个文件夹里没有图库（找不到 library.db）' }
  if (info.id && info.id !== id) {
    return { ok: false, message: `这个目录属于另一个图库，不是「${entry.name}」` }
  }
  const infoFile = directInfo ? directFile : join(externalIndex as string, 'library.db')
  if (!info.id && !writeIdAt(infoFile, id)) {
    return { ok: false, message: '这个图库无法写入身份标记，请检查文件权限' }
  }

  const remaining = entries.filter(
    (item) => item.id !== id && !samePath(item.path, path)
  )
  const updated: LibraryEntry = { ...entry, path }
  const map = { ...(config.libraryIndex ?? {}) }
  delete map[libraryKey(entry.path)]
  if (externalIndex) map[libraryKey(path)] = externalIndex
  else delete map[libraryKey(path)]
  const patch: Partial<AppConfig> = { libraries: [...remaining, updated], libraryIndex: map }
  if (config.library && samePath(config.library, entry.path)) patch.library = path
  updateConfig(patch)

  return { ok: true, entry: toSummary(updated) }
}
