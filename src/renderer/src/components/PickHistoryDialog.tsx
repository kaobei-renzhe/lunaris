import { useEffect, useState } from 'react'
import {
  CheckCheck,
  FolderOpen,
  History,
  Images,
  Loader2,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import type { PickSessionItem, PickSessionSummary } from '@shared/types'
import { formatDate, thumbUrl } from '../lib/format'

interface PickHistoryDialogProps {
  onClose: () => void
  /** 打开导入结果弹窗，并预选这一单 */
  onOpenImport: (sessionId: number) => void
  /** 回主图库只看这一单客户选中的照片 */
  onViewSession: (sessionId: number) => void
  /** 删除记录后通知外面刷新统计与筛选 */
  onDeleted: (sessionId: number) => void
}

function pad3(value: number): string {
  return String(value).padStart(3, '0')
}

function ActionBadge({ action }: { action: PickSessionItem['action'] }) {
  if (action === 'keep') {
    return <span className="rounded bg-[var(--success)] px-1.5 py-0.5 text-[10px] text-white">要</span>
  }
  if (action === 'fix') {
    return <span className="rounded bg-[var(--warn)] px-1.5 py-0.5 text-[10px] text-white">要修</span>
  }
  if (action === 'reject') {
    return <span className="rounded bg-[var(--panel-3)] px-1.5 py-0.5 text-[10px] text-[var(--faint)]">不要</span>
  }
  return <span className="rounded bg-[var(--panel-3)] px-1.5 py-0.5 text-[10px] text-[var(--faint)]">待定</span>
}

export default function PickHistoryDialog({
  onClose,
  onOpenImport,
  onViewSession,
  onDeleted
}: PickHistoryDialogProps) {
  const [sessions, setSessions] = useState<PickSessionSummary[] | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [items, setItems] = useState<PickSessionItem[]>([])
  const [loadingItems, setLoadingItems] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.api
      .listPickSessions()
      .then((list) => {
        setSessions(list)
        setSelectedId(list[0]?.id ?? null)
      })
      .catch((err) => {
        setSessions([])
        setError(String((err as Error)?.message ?? err))
      })
  }, [])

  useEffect(() => {
    if (!selectedId) {
      setItems([])
      return
    }
    let cancelled = false
    setLoadingItems(true)
    window.api
      .listPickSessionItems(selectedId)
      .then((list) => {
        if (!cancelled) setItems(list)
      })
      .catch((err) => {
        if (!cancelled) setError(String((err as Error)?.message ?? err))
      })
      .finally(() => {
        if (!cancelled) setLoadingItems(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const selected = sessions?.find((item) => item.id === selectedId) ?? null
  const picked = selected ? selected.keep + selected.fix : 0

  const remove = async (): Promise<void> => {
    if (!selected) return
    const ok = await window.api.confirm(
      '删除这单选片记录？',
      '只删除记录和客户的选择，不会删除照片、文件夹或你自己的旗标。'
    )
    if (!ok) return
    await window.api.deletePickSession(selected.id)
    const rest = (sessions ?? []).filter((item) => item.id !== selected.id)
    setSessions(rest)
    setSelectedId(rest[0]?.id ?? null)
    onDeleted(selected.id)
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60" onClick={onClose}>
      <div
        className="w-[880px] h-[640px] max-h-[88vh] flex flex-col rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="h-[46px] shrink-0 px-4 flex items-center gap-2 border-b border-[var(--border)]">
          <History size={15} color="var(--accent-2)" />
          <span className="text-[13.5px] font-medium">选片记录</span>
          <span className="text-[11px] text-[var(--faint)]">
            {sessions ? `${sessions.length} 单` : '读取中…'}
          </span>
          <button className="btn btn-ghost h-7 px-1.5 ml-auto" onClick={onClose} title="关闭（Esc）">
            <X size={15} />
          </button>
        </div>

        {error && (
          <div className="shrink-0 border-b border-[var(--danger-border)] bg-[var(--danger-soft)] px-4 py-2 text-[11px] text-[var(--danger-text)]">
            {error}
          </div>
        )}

        <div className="flex-1 flex min-h-0">
          <div className="w-[248px] shrink-0 border-r border-[var(--border)] overflow-y-auto">
            {sessions === null ? (
              <div className="flex items-center gap-2 px-3 py-4 text-[11.5px] text-[var(--muted)]">
                <Loader2 size={13} className="animate-spin" /> 读取中…
              </div>
            ) : sessions.length === 0 ? (
              <div className="px-4 py-6 text-[11.5px] leading-5 text-[var(--faint)]">
                还没有选片记录。在相册里选中照片，点「生成选片页」就会在这里留一单。
              </div>
            ) : (
              sessions.map((session) => {
                const active = session.id === selectedId
                return (
                  <button
                    key={session.id}
                    className={`w-full border-b border-[var(--border)] px-3 py-2.5 text-left transition-colors ${
                      active ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--panel-2)]'
                    }`}
                    onClick={() => setSelectedId(session.id)}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[12px] text-[var(--text)]">{session.title}</span>
                      {session.receivedAt ? (
                        <CheckCheck size={12} className="shrink-0 text-[var(--success)]" />
                      ) : null}
                    </div>
                    <div className="mt-0.5 truncate text-[10.5px] text-[var(--faint)]">
                      {session.client || '未填客户'} · {session.photoCount} 张 ·{' '}
                      {formatDate(session.createdAt)}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[10px] tabular-nums">
                      <span className="text-[var(--success)]">要 {session.keep}</span>
                      <span className="text-[var(--warn)]">修 {session.fix}</span>
                      <span className="text-[var(--faint)]">待 {session.pending}</span>
                    </div>
                  </button>
                )
              })
            )}
          </div>

          <div className="flex-1 min-w-0 overflow-y-auto p-4">
            {!selected ? (
              <div className="h-full grid place-items-center text-[12px] text-[var(--faint)]">
                <div className="text-center">
                  <Images size={24} className="mx-auto mb-2 opacity-50" />
                  {sessions && sessions.length === 0 ? '还没有可回看的选片' : '从左边选一单'}
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[15px] text-[var(--text)]">{selected.title}</div>
                    <div className="mt-0.5 text-[11px] text-[var(--muted)]">
                      {selected.client || '未填客户'} · {selected.photoCount} 张 · 短码{' '}
                      {selected.token}
                    </div>
                    <div className="mt-1 text-[10.5px] text-[var(--faint)]">
                      导出 {formatDate(selected.sentAt ?? selected.createdAt)} · 回传{' '}
                      {selected.receivedAt ? formatDate(selected.receivedAt) : '还没收到'}
                      {selected.replyCount > 1 ? ` · 已回传 ${selected.replyCount} 次` : ''}
                    </div>
                  </div>
                  <div className="ml-auto flex shrink-0 items-center gap-1.5">
                    {selected.filePath && (
                      <button
                        className="btn btn-ghost h-7 px-2 text-[11px]"
                        onClick={() => void window.api.showInFolder(selected.filePath as string)}
                        title={selected.filePath}
                      >
                        <FolderOpen size={12} /> 文件夹
                      </button>
                    )}
                    <button
                      className="btn btn-ghost btn-danger h-7 px-2 text-[11px]"
                      onClick={() => void remove()}
                      title="只删除这单记录，不动照片"
                    >
                      <Trash2 size={12} /> 删除
                    </button>
                    <button
                      className="btn h-7 px-2 text-[11px]"
                      onClick={() => onOpenImport(selected.id)}
                    >
                      <Upload size={12} /> 导入 / 更新结果
                    </button>
                    <button
                      className="btn h-7 px-2 text-[11px]"
                      disabled={picked === 0}
                      onClick={() => onViewSession(selected.id)}
                      title="回到主图库，只看这一单客户要的 + 要修的"
                    >
                      <Images size={12} /> 看这一单
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px]">
                  <span className="text-[var(--success)]">要 {selected.keep}</span>
                  <span className="text-[var(--warn)]">要修 {selected.fix}</span>
                  <span className="text-[var(--faint)]">不要 {selected.reject}</span>
                  <span className="text-[var(--faint)]">待定 {selected.pending}</span>
                  {selected.watermark && (
                    <span className="truncate text-[10.5px] text-[var(--faint)]">
                      水印：{selected.watermark}
                    </span>
                  )}
                </div>

                {selected.clientNote && (
                  <div className="mt-3 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 py-2 text-[11.5px] leading-5 text-[var(--text)] whitespace-pre-wrap">
                    <span className="text-[10.5px] text-[var(--muted)]">客户备注：</span>
                    {selected.clientNote}
                  </div>
                )}

                {selected.receivedAt === null && (
                  <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-[11px] text-[var(--muted)]">
                    客户还没回传。收到文字后点右上角「导入 / 更新结果」粘进来即可。
                  </div>
                )}

                <div className="mt-3">
                  {loadingItems ? (
                    <div className="flex items-center gap-2 py-6 text-[11.5px] text-[var(--muted)]">
                      <Loader2 size={13} className="animate-spin" /> 读取照片…
                    </div>
                  ) : (
                    <div className="grid grid-cols-5 gap-2">
                      {items.map((item) => (
                        <div
                          key={item.seq}
                          className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel-2)]"
                          title={`${pad3(item.seq)} · ${item.name}`}
                        >
                          <div className="relative aspect-square bg-[var(--panel-3)]">
                            <img
                              src={thumbUrl(item.itemId, 'low')}
                              alt=""
                              className="h-full w-full object-cover"
                              loading="lazy"
                            />
                            <span className="absolute left-1 top-1 rounded bg-black/55 px-1 py-0.5 text-[9.5px] tabular-nums text-white">
                              {pad3(item.seq)}
                            </span>
                            <span className="absolute right-1 bottom-1">
                              <ActionBadge action={item.action} />
                            </span>
                          </div>
                          <div className="truncate px-1.5 py-1 text-[9.5px] text-[var(--faint)]">
                            {item.name}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
