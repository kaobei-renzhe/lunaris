import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeftRight,
  FolderOpen,
  Loader2,
  Plus,
  Search,
  X
} from 'lucide-react'
import type { LibrarySummary } from '@shared/types'
import { formatRelative, samePath } from '../lib/format'

interface LibrarySwitcherProps {
  current: string
  onClose: () => void
  onSwitched: (dir: string) => void
}

function cleanError(error: unknown): string {
  return String((error as Error)?.message ?? error)
    .replace(/^Error invoking remote method '[^']+':\s*/, '')
    .replace(/^Error:\s*/, '')
}

export default function LibrarySwitcher({ current, onClose, onSwitched }: LibrarySwitcherProps) {
  const [libraries, setLibraries] = useState<LibrarySummary[] | null>(null)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setLibraries(await window.api.listLibraries())
    } catch (err) {
      setLibraries([])
      setError(cleanError(err))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase()
    const list = libraries ?? []
    if (!text) return list
    return list.filter(
      (item) =>
        item.name.toLowerCase().includes(text) || item.path.toLowerCase().includes(text)
    )
  }, [libraries, query])

  useEffect(() => {
    setActiveIndex(0)
  }, [query, libraries])

  const openEntry = useCallback(
    async (entry: LibrarySummary): Promise<void> => {
      if (entry.status !== 'ok' || busy) return
      if (samePath(entry.path, current)) {
        onClose()
        return
      }
      setBusy(entry.id)
      setError(null)
      try {
        const dir = await window.api.openLibrary(entry.path)
        onSwitched(dir)
      } catch (err) {
        setError(cleanError(err))
      } finally {
        setBusy(null)
      }
    },
    [busy, current, onClose, onSwitched]
  )

  const openOther = async (): Promise<void> => {
    const dir = await window.api.pickLibraryDir()
    if (!dir) return
    setBusy('open')
    setError(null)
    try {
      const path = await window.api.openLibrary(dir)
      onSwitched(path)
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setBusy(null)
    }
  }

  const createNew = async (): Promise<void> => {
    const dir = await window.api.pickLibraryDir()
    if (!dir) return
    setBusy('new')
    setError(null)
    try {
      const path = await window.api.createLibrary(dir)
      onSwitched(path)
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setBusy(null)
    }
  }

  const relocate = async (entry: LibrarySummary): Promise<void> => {
    setBusy(entry.id)
    setError(null)
    try {
      const result = await window.api.relocateLibrary(entry.id)
      if (!result.ok && !result.cancelled) setError(result.message ?? '重新定位失败')
      if (result.ok) await refresh()
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveIndex((index) => (filtered.length ? (index + 1) % filtered.length : 0))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex((index) =>
          filtered.length ? (index - 1 + filtered.length) % filtered.length : 0
        )
        return
      }
      if (event.key === 'Enter') {
        const entry = filtered[activeIndex]
        if (entry) {
          event.preventDefault()
          void openEntry(entry)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeIndex, filtered, onClose, openEntry])

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60" onClick={onClose}>
      <div
        className="flex w-[560px] max-h-[76vh] flex-col rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex h-[46px] shrink-0 items-center gap-2 border-b border-[var(--border)] px-4">
          <ArrowLeftRight size={15} color="var(--accent-2)" />
          <span className="text-[13.5px] font-medium">切换图库</span>
          <span className="text-[11px] text-[var(--faint)]">
            {libraries ? `${libraries.length} 个` : '读取中…'}
          </span>
          <button className="btn btn-ghost ml-auto h-7 px-1.5" onClick={onClose} title="关闭（Esc）">
            <X size={15} />
          </button>
        </div>

        <div className="shrink-0 px-3 pt-3">
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)]"
            />
            <input
              className="input w-full pl-8"
              placeholder="搜库名或路径…"
              value={query}
              autoFocus
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>

        <div className="min-h-[160px] flex-1 overflow-y-auto p-2">
          {libraries === null ? (
            <div className="flex items-center gap-2 px-3 py-6 text-[12px] text-[var(--muted)]">
              <Loader2 size={13} className="animate-spin" /> 正在读取图库…
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-8 text-center text-[11.5px] text-[var(--faint)]">
              {query.trim() ? '没有匹配的图库' : '还没有其他图库'}
            </div>
          ) : (
            filtered.map((entry, index) => {
              const isCurrent = samePath(entry.path, current)
              const missing = entry.status !== 'ok'
              return (
                <div
                  key={entry.id}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 ${
                    index === activeIndex ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--panel-2)]'
                  } ${missing ? 'opacity-75' : ''}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => void openEntry(entry)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[12.5px] text-[var(--text)]">
                        {entry.name}
                      </span>
                      {isCurrent && (
                        <span className="rounded bg-[var(--accent-soft)] px-1 py-0.5 text-[9.5px] text-[var(--accent-text)]">
                          当前
                        </span>
                      )}
                      {entry.status === 'missing' && (
                        <span className="flex items-center gap-0.5 text-[9.5px] text-[var(--danger-text)]">
                          <AlertTriangle size={9} /> 目录不见了
                        </span>
                      )}
                      {entry.status === 'index-missing' && (
                        <span className="flex items-center gap-0.5 text-[9.5px] text-[var(--danger-text)]">
                          <AlertTriangle size={9} /> 索引丢失
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-[var(--faint)]" title={entry.path}>
                      {entry.path}
                    </div>
                  </div>
                  <span className="shrink-0 text-[10.5px] tabular-nums text-[var(--faint)]">
                    {entry.itemCount} 张 · {formatRelative(entry.lastOpened)}
                  </span>
                  {busy === entry.id ? (
                    <Loader2 size={13} className="shrink-0 animate-spin text-[var(--muted)]" />
                  ) : missing ? (
                    <button
                      className="btn btn-ghost h-6 shrink-0 px-1.5 text-[10.5px]"
                      onClick={(event) => {
                        event.stopPropagation()
                        void relocate(entry)
                      }}
                    >
                      重新定位
                    </button>
                  ) : null}
                </div>
              )
            })
          )}
        </div>

        {error && (
          <div className="shrink-0 border-t border-[var(--danger-border)] bg-[var(--danger-soft)] px-4 py-2 text-[11px] text-[var(--danger-text)]">
            {error}
          </div>
        )}

        <div className="flex shrink-0 items-center gap-2 border-t border-[var(--border)] px-3 py-2.5">
          <button
            className="btn btn-ghost h-7 px-2 text-[11.5px]"
            onClick={() => void createNew()}
            disabled={busy !== null}
          >
            {busy === 'new' ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            新建图库
          </button>
          <span className="text-[10px] text-[var(--faint)]">↑↓ 选择 · Enter 切换 · Esc 关闭</span>
          <button
            className="btn ml-auto h-7 px-2 text-[11.5px]"
            onClick={() => void openOther()}
            disabled={busy !== null}
          >
            {busy === 'open' ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <FolderOpen size={12} />
            )}
            打开其他图库…
          </button>
        </div>
      </div>
    </div>
  )
}
