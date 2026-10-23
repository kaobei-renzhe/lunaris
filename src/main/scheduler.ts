import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createBackup } from './backup'
import { getLibraryPath } from './db'
import { getAutoBackup, saveAutoBackup } from './settings'

export interface AutoBackupResult {
  ok: boolean
  path?: string
  size?: number
  error?: string
}

const CHECK_INTERVAL_MS = 60_000
const STARTUP_DELAY_MS = 20_000
const RETRY_DELAY_MS = 10 * 60_000
const PREFIX = 'image-nest-auto-'

let timer: NodeJS.Timeout | null = null
let startupTimer: NodeJS.Timeout | null = null
let running = false
let lastFailureAt = 0

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
}

function backupDirectory(fallbackLibrary: string, configured: string | null): string {
  return configured ?? join(dirname(fallbackLibrary), 'image-nest-backups')
}

function prune(directory: string, keep: number): void {
  try {
    const files = readdirSync(directory)
      .filter((name) => name.startsWith(PREFIX) && name.endsWith('.zip'))
      .sort()
      .reverse()
    for (const file of files.slice(keep)) {
      rmSync(join(directory, file), { force: true })
    }
  } catch {
    /* 清理失败不影响本次备份 */
  }
}

async function tick(onResult: (result: AutoBackupResult) => void): Promise<void> {
  if (running) return
  // 失败后别每分钟重试+弹提示，隔 10 分钟再试
  if (lastFailureAt && Date.now() - lastFailureAt < RETRY_DELAY_MS) return
  const settings = getAutoBackup()
  if (!settings.enabled) return

  const library = getLibraryPath()
  if (!library) return

  const dueAt = settings.lastRunAt + settings.intervalDays * 24 * 60 * 60 * 1000
  if (Date.now() < dueAt) return

  running = true
  try {
    const directory = backupDirectory(library, settings.directory)
    mkdirSync(directory, { recursive: true })
    const target = join(directory, `${PREFIX}${stamp()}.zip`)
    const result = await createBackup(target, false)
    prune(directory, Math.max(1, settings.keep))
    saveAutoBackup({ lastRunAt: Date.now() })
    lastFailureAt = 0
    onResult({ ok: true, path: result.path, size: result.size })
  } catch (error) {
    lastFailureAt = Date.now()
    onResult({ ok: false, error: (error as Error).message })
  } finally {
    running = false
  }
}

export function startAutoBackup(onResult: (result: AutoBackupResult) => void): void {
  if (timer) clearInterval(timer)
  if (startupTimer) clearTimeout(startupTimer)
  timer = setInterval(() => {
    void tick(onResult)
  }, CHECK_INTERVAL_MS)
  startupTimer = setTimeout(() => {
    void tick(onResult)
  }, STARTUP_DELAY_MS)
}
