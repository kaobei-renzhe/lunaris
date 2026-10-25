import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { closeLibrary, getIndexPath, getLibraryPath, openLibrary } from './db'
import { isImportRunning } from './importer'
import { log } from './logger'
import { libraryKey, setIndexDirFor } from './settings'

/** 索引包含的东西：数据库本体、WAL/SHM，以及缩略图与预览缓存 */
const INDEX_FILES = ['library.db', 'library.db-wal', 'library.db-shm']
const INDEX_DIRS = ['thumbnails', 'previews']

export interface MoveIndexResult {
  /** 搬完之后索引所在目录 */
  indexDir: string
  /** 复制过去的文件数 */
  files: number
  /** 旧位置的文件是否清理干净 */
  cleaned: boolean
}

function samePath(a: string, b: string): boolean {
  return libraryKey(a) === libraryKey(b)
}

/** child 是否在 parent 目录里（含自身） */
function isInside(child: string, parent: string): boolean {
  const a = libraryKey(child)
  const b = libraryKey(parent)
  if (a === b) return true
  return a.startsWith(b.endsWith('\\') ? b : `${b}\\`)
}

function countFiles(dir: string): number {
  if (!existsSync(dir)) return 0
  let count = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) count += countFiles(full)
    else count++
  }
  return count
}

/**
 * 把索引（library.db + WAL/SHM + thumbnails + previews）搬到 target 目录，
 * target 传 null 表示搬回图库目录。原图始终不动。
 *
 * 顺序：关库（含 checkpoint）→ 复制 → 改映射 → 重开 → 清理旧位置。
 * 任一步失败都会尽量恢复原来的索引位置，不把图库留在半残状态。
 */
export function moveIndexTo(target: string | null): MoveIndexResult {
  const library = getLibraryPath()
  if (!library) throw new Error('还没有打开图库')
  if (isImportRunning()) throw new Error('正在导入图片，等导入结束后再移动索引')

  const from = getIndexPath() || library
  const to = target ?? library
  if (samePath(from, to)) return { indexDir: from, files: 0, cleaned: false }
  // 装在应用目录里的索引会被覆盖安装整个清掉，直接拦下来
  if (!samePath(to, library) && isInside(to, dirname(app.getPath('exe')))) {
    throw new Error('索引不能放在应用安装目录里——升级安装会把它清掉，请换一个文件夹')
  }
  // 自定义目标必须是干净的；搬回图库目录时允许覆盖上次没清掉的残留
  if (!samePath(to, library) && existsSync(join(to, 'library.db'))) {
    throw new Error('目标文件夹里已经有 library.db，请换一个空文件夹')
  }

  mkdirSync(to, { recursive: true })
  // 关库时会 checkpoint，保证复制的是完整一致的数据
  closeLibrary()

  let files = 0
  try {
    for (const name of INDEX_FILES) {
      const source = join(from, name)
      if (!existsSync(source)) continue
      cpSync(source, join(to, name))
      files++
    }
    for (const name of INDEX_DIRS) {
      const source = join(from, name)
      if (!existsSync(source)) continue
      cpSync(source, join(to, name), { recursive: true, force: true })
      files += countFiles(source)
    }
  } catch (error) {
    // 复制途中失败：重新打开原来的索引，保持可用
    openLibrary(library)
    throw error
  }

  setIndexDirFor(library, samePath(to, library) ? null : to)
  try {
    openLibrary(library)
  } catch (error) {
    setIndexDirFor(library, samePath(from, library) ? null : from)
    openLibrary(library)
    throw error
  }

  let cleaned = true
  try {
    for (const name of INDEX_FILES) rmSync(join(from, name), { force: true })
    for (const name of INDEX_DIRS) rmSync(join(from, name), { recursive: true, force: true })
  } catch (error) {
    cleaned = false
    void log.warn('library', '旧索引文件清理失败', { from, error: (error as Error).message })
  }

  void log.info('library', '索引位置已迁移', { from, to, files, cleaned })
  return { indexDir: getIndexPath(), files, cleaned }
}
