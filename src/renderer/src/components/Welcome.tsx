import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  FolderOpen,
  Loader2,
  MapPin,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2
} from 'lucide-react'
import type { LibrarySummary } from '@shared/types'
import { formatRelative } from '../lib/format'
import Logo from './Logo'

interface WelcomeProps {
  onReady: (dir: string) => void
  /** 从已有图库切过来时，可以不做任何操作直接返回 */
  onBack?: () => void
  backLabel?: string
  /** 上次的索引目录失效时的说明（原图还在，索引需要重建） */
  notice?: string | null
}

function cleanError(error: unknown): string {
  return String((error as Error)?.message ?? error)
    .replace(/^Error invoking remote method '[^']+':\s*/, '')
    .replace(/^Error:\s*/, '')
}

function coverStyle(id: string): CSSProperties {
  let hash = 0
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  const hue = hash % 360
  return {
    background: `linear-gradient(140deg, hsl(${hue} 38% 34%), hsl(${(hue + 28) % 360} 34% 22%))`
  }
}

function initial(name: string): string {
  return name.trim().charAt(0) || '库'
}

export default function Welcome({ onReady, onBack, backLabel, notice }: WelcomeProps) {
  const [libraries, setLibraries] = useState<LibrarySummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const menuRef = useRef<HTMLDivElement | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setLibraries(await window.api.listLibraries())
    } catch (err) {
      setError(cleanError(err))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // 点菜单外面收起
  useEffect(() => {
    if (!menuId) return
    const close = (event: MouseEvent): void => {
      if (!(event.target instanceof Node)) return
      if (menuRef.current?.contains(event.target)) return
      setMenuId(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuId])

  const createLibrary = async (): Promise<void> => {
    const dir = await window.api.pickLibraryDir()
    if (!dir) return
    setBusy('new')
    setError(null)
    try {
      const path = await window.api.createLibrary(dir)
      onReady(path)
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setBusy(null)
    }
  }

  const openOther = async (): Promise<void> => {
    const dir = await window.api.pickLibraryDir()
    if (!dir) return
    setBusy('pick')
    setError(null)
    try {
      const path = await window.api.openLibrary(dir)
      onReady(path)
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setBusy(null)
    }
  }

  const openEntry = async (entry: LibrarySummary): Promise<void> => {
    if (entry.status !== 'ok' || busy) return
    setBusy(entry.id)
    setError(null)
    try {
      const path = await window.api.openLibrary(entry.path)
      onReady(path)
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setBusy(null)
    }
  }

  const relocate = async (entry: LibrarySummary): Promise<void> => {
    setMenuId(null)
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

  const forget = async (entry: LibrarySummary, alsoDeleteData: boolean): Promise<void> => {
    setMenuId(null)
    const ok = await window.api.confirm(
      alsoDeleteData ? `删除「${entry.name}」的索引数据？` : `从列表移除「${entry.name}」？`,
      alsoDeleteData
        ? '会删除 library.db、缩略图和预览缓存。原图文件一张都不会动。'
        : '只从列表移除，磁盘上的图库、原图和标签都保持不变。'
    )
    if (!ok) return
    setError(null)
    try {
      await window.api.forgetLibrary(entry.id, alsoDeleteData)
      await refresh()
    } catch (err) {
      setError(cleanError(err))
    }
  }

  const startRename = (entry: LibrarySummary): void => {
    setMenuId(null)
    setEditingId(entry.id)
    setDraftName(entry.name)
  }

  const commitRename = async (): Promise<void> => {
    const id = editingId
    const name = draftName.trim()
    setEditingId(null)
    if (!id || !name) return
    try {
      await window.api.renameLibrary(id, name)
      await refresh()
    } catch (err) {
      setError(cleanError(err))
    }
  }

  const backButton = onBack ? (
    <div className="flex justify-start mb-4">
      <button className="btn btn-ghost h-7 px-2 text-[11.5px]" onClick={onBack}>
        <ArrowLeft size={13} /> 返回{backLabel ? `「${backLabel}」` : '当前图库'}
      </button>
    </div>
  ) : null

  const noticeBlock = notice ? (
    <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5 text-left text-[11.5px] leading-5 text-[var(--danger-text)]">
      上次的索引目录里找不到 library.db：
      <span className="break-all">{notice}</span>
      <div className="mt-1 text-[var(--muted)]">
        索引可能被移动或删除了。原图都还在图库里——打开图库后点「刷新图库」就能重建索引，但标签、评分等元数据无法恢复。
      </div>
    </div>
  ) : null

  const errorBlock = error ? (
    <div className="mt-4 text-[12px] text-[var(--danger)]">{error}</div>
  ) : null

  if (!libraries) {
    return (
      <div className="grid h-full place-items-center bg-[var(--bg)] text-[12px] text-[var(--faint)]">
        <span className="flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> 正在读取图库…
        </span>
      </div>
    )
  }

  if (libraries.length === 0) {
    return (
      <div className="h-full grid place-items-center bg-[var(--bg)]">
        <div className="w-[440px] text-center">
          {backButton}
          <div className="mx-auto mb-6 w-[64px] h-[64px]">
            <Logo size={64} />
          </div>
          <h1 className="text-[22px] font-semibold tracking-wide m-0">月相</h1>
          <p className="text-[13px] text-[var(--muted)] mt-2 mb-8">
            本地优先的图片素材库 · 照片、相机与文字都归在这里
          </p>

          <div className="flex flex-col gap-2">
            <button
              className="btn btn-primary h-[38px] justify-center"
              onClick={() => void createLibrary()}
              disabled={busy !== null}
            >
              {busy === 'new' ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              新建图库
            </button>
            <button
              className="btn h-[38px] justify-center"
              onClick={() => void openOther()}
              disabled={busy !== null}
            >
              {busy === 'pick' ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <FolderOpen size={16} />
              )}
              打开已有图库
            </button>
          </div>

          {noticeBlock}
          {errorBlock}

          <p className="mt-8 text-[11.5px] text-[var(--faint)] leading-5">
            图库就是一个普通文件夹
            <br />
            里面保存索引数据库与缩略图缓存，原图仍留在原位置
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto bg-[var(--bg)]">
      <div className="mx-auto w-full max-w-[860px] px-6 py-10">
        {backButton}
        <div className="mb-7 flex items-center gap-3">
          <div className="h-[44px] w-[44px]">
            <Logo size={44} />
          </div>
          <div>
            <div className="text-[20px] font-semibold tracking-wide text-[var(--text)]">月相</div>
            <div className="mt-0.5 text-[12px] text-[var(--muted)]">选择一个图库，或新建一个</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {libraries.map((entry) => (
            <div
              key={entry.id}
              className="relative rounded-xl border border-[var(--border)] bg-[var(--panel)]"
            >
              <div
                className={`overflow-hidden rounded-xl ${
                  entry.status === 'ok' ? 'cursor-pointer' : 'cursor-default opacity-80'
                }`}
                onClick={() => void openEntry(entry)}
              >
                <div className="relative h-[92px]" style={coverStyle(entry.id)}>
                  <span className="absolute bottom-2 left-3 text-[26px] font-semibold text-white/90">
                    {initial(entry.name)}
                  </span>
                  {entry.status !== 'ok' && (
                    <span className="absolute right-2 top-2 rounded bg-black/35 px-1.5 py-0.5 text-[10px] text-white/90">
                      !
                    </span>
                  )}
                </div>
                <div className="px-3 py-2.5">
                  <div className="truncate text-[12.5px] text-[var(--text)]" title={entry.path}>
                    {entry.name}
                  </div>
                  <div className="mt-0.5 text-[10.5px] tabular-nums text-[var(--faint)]">
                    {entry.itemCount} 张 · {formatRelative(entry.lastOpened)}
                  </div>
                  {entry.status === 'missing' && (
                    <div className="mt-1 flex items-center gap-1 text-[10px] text-[var(--danger-text)]">
                      <AlertTriangle size={10} /> 目录不见了
                    </div>
                  )}
                  {entry.status === 'index-missing' && (
                    <div className="mt-1 flex items-center gap-1 text-[10px] text-[var(--danger-text)]">
                      <AlertTriangle size={10} /> 索引丢失（原图还在）
                    </div>
                  )}
                  {entry.status !== 'ok' && (
                    <button
                      className="mt-1 text-[10.5px] text-[var(--accent-2)] hover:underline"
                      onClick={(event) => {
                        event.stopPropagation()
                        void relocate(entry)
                      }}
                    >
                      重新定位
                    </button>
                  )}
                </div>
              </div>

              <button
                className="btn btn-ghost absolute right-1.5 top-1.5 h-6 w-6 px-0 text-white/85 hover:bg-black/25"
                onClick={(event) => {
                  event.stopPropagation()
                  setMenuId(menuId === entry.id ? null : entry.id)
                }}
                title="图库操作"
              >
                {busy === entry.id ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <MoreHorizontal size={14} />
                )}
              </button>

              {editingId === entry.id && (
                <div className="absolute inset-x-2 top-1/2 z-20 -translate-y-1/2 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-2 shadow-xl">
                  <input
                    className="input h-7 w-full text-[12px]"
                    value={draftName}
                    autoFocus
                    onChange={(event) => setDraftName(event.target.value)}
                    onBlur={() => void commitRename()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur()
                      if (event.key === 'Escape') setEditingId(null)
                    }}
                  />
                </div>
              )}

              {menuId === entry.id && (
                <div
                  ref={menuRef}
                  className="absolute right-2 top-9 z-30 w-[156px] rounded-lg border border-[var(--border)] bg-[var(--panel)] p-1 shadow-2xl"
                >
                  <button
                    className="flex h-7 w-full items-center gap-2 rounded px-2 text-left text-[11.5px] text-[var(--text)] hover:bg-[var(--panel-2)]"
                    onClick={() => startRename(entry)}
                  >
                    <Pencil size={12} /> 重命名
                  </button>
                  <button
                    className="flex h-7 w-full items-center gap-2 rounded px-2 text-left text-[11.5px] text-[var(--text)] hover:bg-[var(--panel-2)]"
                    onClick={() => void relocate(entry)}
                  >
                    <MapPin size={12} /> 重新定位
                  </button>
                  <button
                    className="flex h-7 w-full items-center gap-2 rounded px-2 text-left text-[11.5px] text-[var(--text)] hover:bg-[var(--panel-2)]"
                    onClick={() => void forget(entry, false)}
                  >
                    <Trash2 size={12} /> 从列表移除
                  </button>
                  {entry.status === 'ok' && (
                    <button
                      className="flex h-7 w-full items-center gap-2 rounded px-2 text-left text-[11.5px] text-[var(--danger-text)] hover:bg-[var(--danger-soft)]"
                      onClick={() => void forget(entry, true)}
                    >
                      <Trash2 size={12} /> 删除索引数据
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}

          <div className="grid min-h-[150px] place-items-center rounded-xl border border-dashed border-[var(--border)] bg-[var(--panel-2)]/40">
            <div className="flex w-[150px] flex-col gap-2">
              <button
                className="btn h-8 justify-center text-[12px]"
                onClick={() => void createLibrary()}
                disabled={busy !== null}
              >
                {busy === 'new' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Plus size={14} />
                )}
                新建图库
              </button>
              <button
                className="btn btn-ghost h-8 justify-center text-[12px]"
                onClick={() => void openOther()}
                disabled={busy !== null}
              >
                {busy === 'pick' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <FolderOpen size={14} />
                )}
                打开已有
              </button>
            </div>
          </div>
        </div>

        {noticeBlock}
        {errorBlock}

        <p className="mt-8 text-[11.5px] leading-5 text-[var(--faint)]">
          图库就是一个普通文件夹，里面保存索引数据库与缩略图缓存，原图仍留在原位置。
        </p>
      </div>
    </div>
  )
}
