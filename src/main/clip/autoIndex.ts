import { powerMonitor } from 'electron'
import { getLibraryPath } from '../db'
import { getClipAutoIndex } from '../settings'
import { isImportRunning } from '../importer'
import { isIndexing, isTagging } from '../taskLock'
import { clipStatus, indexEmbeddings } from '../embeddings'
import { resolveModelDir } from './embedder'
import type { ClipStatus } from '../../shared/types'

/** 多久检查一次是否适合开跑 */
const CHECK_INTERVAL_MS = 30_000
/** 系统连续多久没有键鼠操作才算「闲时」 */
const IDLE_SECONDS = 120
/** 每批处理多少张，跑完歇一会儿 */
const BATCH_SIZE = 16
const BATCH_GAP_MS = 3_000
const STARTUP_DELAY_MS = 15_000

let timer: NodeJS.Timeout | null = null
let startupTimer: NodeJS.Timeout | null = null
let cycling = false
let disposed = false
let notify: ((status: ClipStatus) => void) | null = null

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function isIdle(): boolean {
  try {
    if (powerMonitor.isOnBatteryPower()) return false
    return powerMonitor.getSystemIdleTime() >= IDLE_SECONDS
  } catch {
    return false
  }
}

function canRun(): boolean {
  if (disposed) return false
  if (!getClipAutoIndex()) return false
  if (!getLibraryPath()) return false
  if (!resolveModelDir()) return false
  if (isIndexing() || isTagging()) return false
  if (isImportRunning()) return false
  return true
}

async function runCycle(): Promise<void> {
  if (cycling || !canRun()) return
  if (!isIdle()) return

  let status: ClipStatus
  try {
    status = clipStatus()
  } catch {
    return
  }
  if (status.indexed >= status.total) return

  cycling = true
  try {
    // 只要还在闲时、还有没索引的照片，就一小批一小批地来
    while (canRun() && isIdle()) {
      const before = clipStatus()
      if (before.indexed >= before.total) break

      const result = await indexEmbeddings(() => undefined, {
        limit: BATCH_SIZE,
        shouldContinue: () => canRun() && isIdle()
      })
      notify?.(clipStatus())
      if (result.cancelled) break
      if (result.indexed === 0 && result.failed === 0) break
      await sleep(BATCH_GAP_MS)
    }
  } catch {
    /* 模型/数据库暂时不可用，下个周期再试 */
  } finally {
    cycling = false
    try {
      notify?.(clipStatus())
    } catch {
      /* 图库可能已经关了 */
    }
  }
}

export function startAutoClipIndex(onStatus: (status: ClipStatus) => void): void {
  stopAutoClipIndex()
  disposed = false
  notify = onStatus
  timer = setInterval(() => {
    void runCycle()
  }, CHECK_INTERVAL_MS)
  startupTimer = setTimeout(() => {
    void runCycle()
  }, STARTUP_DELAY_MS)
}

export function stopAutoClipIndex(): void {
  disposed = true
  if (timer) clearInterval(timer)
  if (startupTimer) clearTimeout(startupTimer)
  timer = null
  startupTimer = null
  notify = null
}
