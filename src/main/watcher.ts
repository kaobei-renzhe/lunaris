import { existsSync, statSync, watch } from 'node:fs'
import type { FSWatcher } from 'node:fs'
import { extname, join } from 'node:path'
import { SUPPORTED_EXT } from '../shared/formats'
import { listSources, markMissingByPath } from './repo'
import { importPaths } from './importer'
import { regroup } from './grouping'

const DEBOUNCE_MS = 800

let watchers: FSWatcher[] = []
let pendingAdds = new Set<string>()
let pendingRemovals = new Set<string>()
let timer: NodeJS.Timeout | null = null

export function stopWatching(): void {
  for (const watcher of watchers) {
    try {
      watcher.close()
    } catch {
      /* 关闭失败忽略 */
    }
  }
  watchers = []
  pendingAdds.clear()
  pendingRemovals.clear()
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}

export function startWatching(onChanged: (info: { added: number; missing: number }) => void): void {
  stopWatching()

  const sources = listSources()
  for (const source of sources) {
    if (!existsSync(source.path)) continue
    try {
      const watcher = watch(
        source.path,
        { recursive: source.recursive === 1 },
        (eventType, filename) => {
          if (!filename) return
          const full = join(source.path, filename.toString())
          if (!SUPPORTED_EXT.has(extname(full).toLowerCase())) return
          if (existsSync(full)) {
            try {
              if (statSync(full).isDirectory()) return
            } catch {
              return
            }
            pendingRemovals.delete(full)
            pendingAdds.add(full)
          } else {
            pendingAdds.delete(full)
            pendingRemovals.add(full)
          }
          schedule(onChanged)
        }
      )
      watcher.on('error', () => undefined)
      watchers.push(watcher)
    } catch {
      // 个别目录不支持递归监听，跳过即可
    }
  }
}

function schedule(onChanged: (info: { added: number; missing: number }) => void): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void flush(onChanged)
  }, DEBOUNCE_MS)
}

async function flush(onChanged: (info: { added: number; missing: number }) => void): Promise<void> {
  const addCandidates = [...pendingAdds]
  const removeCandidates = [...pendingRemovals]
  pendingAdds.clear()
  pendingRemovals.clear()

  // 事件到达和文件系统真实状态可能差一拍，落盘前再核对一次
  const adds = addCandidates.filter((p) => existsSync(p))
  const removes = Array.from(
    new Set([
      ...removeCandidates.filter((p) => !existsSync(p)),
      ...addCandidates.filter((p) => !existsSync(p))
    ])
  )

  let missing = 0
  if (removes.length) {
    missing = markMissingByPath(removes)
    // 封面缺失后要重新选一张，否则整组会从列表里消失
    regroup()
  }

  let added = 0
  if (adds.length) {
    try {
      const result = await importPaths(adds, () => undefined, false)
      added = result.added + result.relinked
    } catch {
      /* 单个文件失败不影响其它事件 */
    }
  }

  if (added || missing) onChanged({ added, missing })
}
