import { app } from 'electron'
import { appendFile, mkdir, rename, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * 极简文件日志：写 userData/logs/lunaris.log，超过上限按 .1…N 轮转。
 * 原则：日志失败绝不影响主流程，所以每个环节都吞掉异常。
 */
export type LogLevel = 'info' | 'warn' | 'error'

const MAX_BYTES =
  Number(process.env.LUNARIS_LOG_MAX_BYTES ?? process.env.MOONNEST_LOG_MAX_BYTES) ||
  5 * 1024 * 1024
const KEEP_ROTATED = 4
const MAX_META_CHARS = 1000

/** 串行写队列，保证顺序，也避免并发轮转打架 */
let queue: Promise<void> = Promise.resolve()

function logDir(): string {
  return join(app.getPath('userData'), 'logs')
}

function logFile(): string {
  return join(logDir(), 'lunaris.log')
}

/** 日志可能被贴到公开地方，先把用户目录替换掉 */
function redact(text: string): string {
  const home = process.env.USERPROFILE || process.env.HOME
  return home ? text.split(home).join('%USERPROFILE%') : text
}

function formatMeta(meta?: Record<string, unknown>): string {
  if (!meta) return ''
  try {
    const seen = new WeakSet<object>()
    const json = JSON.stringify(meta, (_key, value) => {
      // 字符串在这里就脱敏：JSON.stringify 会把反斜杠转义成 \\，之后再替换就匹配不到了
      if (typeof value === 'string') return redact(value)
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[circular]'
        seen.add(value)
      }
      return value
    })
    if (!json || json === '{}') return ''
    return json.length > MAX_META_CHARS ? `${json.slice(0, MAX_META_CHARS)}…` : json
  } catch {
    return '[meta 无法序列化]'
  }
}

async function rotateIfNeeded(incomingBytes: number): Promise<void> {
  const file = logFile()
  const info = await stat(file).catch(() => null)
  if (!info || info.size + incomingBytes <= MAX_BYTES) return

  await unlink(`${file}.${KEEP_ROTATED}`).catch(() => undefined)
  for (let index = KEEP_ROTATED - 1; index >= 1; index--) {
    await rename(`${file}.${index}`, `${file}.${index + 1}`).catch(() => undefined)
  }
  await rename(file, `${file}.1`).catch(() => undefined)
}

function write(level: LogLevel, scope: string, message: string, meta?: Record<string, unknown>): Promise<void> {
  const metaText = formatMeta(meta)
  const line =
    `${new Date().toISOString()} [${level}] ${scope}: ${redact(message)}` + (metaText ? ` ${redact(metaText)}` : '') + '\n'

  queue = queue.then(async () => {
    try {
      await mkdir(logDir(), { recursive: true })
      await rotateIfNeeded(Buffer.byteLength(line))
      await appendFile(logFile(), line, 'utf8')
    } catch {
      // 磁盘只读、权限不足、目录被占 —— 都不该让业务失败
    }
  })
  return queue
}

export const log = {
  info: (scope: string, message: string, meta?: Record<string, unknown>) => write('info', scope, message, meta),
  warn: (scope: string, message: string, meta?: Record<string, unknown>) => write('warn', scope, message, meta),
  error: (scope: string, message: string, meta?: Record<string, unknown>) => write('error', scope, message, meta)
}

/** 供"打开日志目录"这类入口使用（日志目录可能还没创建） */
export async function ensureLogDir(): Promise<string> {
  const dir = logDir()
  await mkdir(dir, { recursive: true }).catch(() => undefined)
  return dir
}

/** 崩溃退出前等日志落盘，最多等 500ms，避免日志把退出卡住 */
export async function flushLogs(timeoutMs = 500): Promise<void> {
  await Promise.race([queue, new Promise((resolve) => setTimeout(resolve, timeoutMs))])
}

export function currentLogFile(): string {
  return logFile()
}
