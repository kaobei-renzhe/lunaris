import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, ClipboardPaste, Loader2, X } from 'lucide-react'
import type { PickApplyResult, PickReplyPreview, PickSessionSummary } from '@shared/types'
import { formatDate } from '../lib/format'

interface PickImportDialogProps {
  /** 从选片记录打开时预选那一单 */
  initialSessionId?: number | null
  onClose: () => void
  onApplied: (result: PickApplyResult, sessionId: number) => void
}

function cleanError(error: unknown): string {
  return String((error as Error)?.message ?? error).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    ''
  )
}

const SAMPLE = `【选片结果】小林 · 老门东街拍
客户：王女士

要的（3 张）：
001, 002, 015

要修的（1 张）：
008

不要的：其余

备注：
015 能不能再亮一点`

export default function PickImportDialog({
  initialSessionId,
  onClose,
  onApplied
}: PickImportDialogProps) {
  const [sessions, setSessions] = useState<PickSessionSummary[] | null>(null)
  const [sessionId, setSessionId] = useState<number | null>(null)
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<PickReplyPreview | null>(null)
  const [phase, setPhase] = useState<'idle' | 'parsing' | 'applying'>('idle')
  const [error, setError] = useState<string | null>(null)

  const session = useMemo(
    () => sessions?.find((item) => item.id === sessionId) ?? null,
    [sessions, sessionId]
  )

  useEffect(() => {
    void window.api
      .listPickSessions()
      .then((list) => {
        setSessions(list)
        const preferred = initialSessionId
          ? list.find((item) => item.id === initialSessionId)
          : null
        setSessionId(preferred?.id ?? list[0]?.id ?? null)
      })
      .catch((err) => {
        setSessions([])
        setError(cleanError(err))
      })
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && phase === 'idle') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, onClose])

  const unmatchedSet = useMemo(() => new Set(preview?.unmatched ?? []), [preview])
  const fixSet = useMemo(() => new Set(preview?.fix ?? []), [preview])
  // 同一张既写了要又写了要修时按要修算，和后端落库口径保持一致
  const matchedKeep = preview
    ? preview.keep.filter((seq) => !unmatchedSet.has(seq) && !fixSet.has(seq)).length
    : 0
  const matchedFix = preview ? preview.fix.filter((seq) => !unmatchedSet.has(seq)).length : 0
  const rejectCount = session && preview?.rejectRest ? session.photoCount - matchedKeep - matchedFix : 0

  const parse = async (): Promise<void> => {
    if (!sessionId || !text.trim() || phase !== 'idle') return
    setPhase('parsing')
    setError(null)
    setPreview(null)
    try {
      const result = await window.api.pickReplyPreview(sessionId, text)
      setPreview(result)
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setPhase('idle')
    }
  }

  const apply = async (): Promise<void> => {
    if (!sessionId || !preview || phase !== 'idle') return
    setPhase('applying')
    setError(null)
    try {
      const result = await window.api.pickApplyReply(sessionId, preview)
      onApplied(result, sessionId)
    } catch (err) {
      setError(cleanError(err))
      setPhase('idle')
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60" onClick={phase === 'idle' ? onClose : undefined}>
      <div
        className="w-[560px] max-h-[86vh] flex flex-col rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="h-[46px] shrink-0 px-4 flex items-center gap-2 border-b border-[var(--border)]">
          <ClipboardPaste size={15} color="var(--accent-2)" />
          <span className="text-[13.5px] font-medium">导入客户选片结果</span>
          <button className="btn btn-ghost h-7 px-1.5 ml-auto" onClick={onClose} title="关闭（Esc）">
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {sessions === null ? (
            <div className="flex items-center gap-2 py-6 text-[12px] text-[var(--muted)]">
              <Loader2 size={13} className="animate-spin" /> 正在读取选片记录…
            </div>
          ) : sessions.length === 0 ? (
            <div className="py-8 text-center text-[12px] text-[var(--faint)]">
              还没有导出过选片页。先在相册里选中照片，点「生成选片页」。
            </div>
          ) : (
            <>
              <label className="block text-[11px] text-[var(--muted)] mb-1">这是哪一单</label>
              <select
                className="input w-full"
                value={sessionId ?? ''}
                onChange={(event) => {
                  setSessionId(Number(event.target.value) || null)
                  setPreview(null)
                  setError(null)
                }}
              >
                {sessions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title} · {item.client || '未填客户'} · {item.photoCount} 张 ·{' '}
                    {formatDate(item.createdAt)}
                    {item.receivedAt ? ' · 已回传' : ''}
                  </option>
                ))}
              </select>

              {session && (
                <div className="mt-1.5 text-[10.5px] text-[var(--faint)]">
                  这一单共 {session.photoCount} 张
                  {session.receivedAt ? `，上次回传于 ${formatDate(session.receivedAt)}` : '，还没收到客户回复'}
                  。重新导入会覆盖上一次结果。
                </div>
              )}

              <label className="mt-3 block text-[11px] text-[var(--muted)] mb-1">粘贴客户发回来的文字</label>
              <textarea
                className="input w-full h-[150px] py-2 resize-none font-mono text-[11.5px] leading-5"
                placeholder={SAMPLE}
                value={text}
                onChange={(event) => {
                  setText(event.target.value)
                  setPreview(null)
                  setError(null)
                }}
              />

              <div className="mt-2 flex items-center gap-2">
                <button
                  className="btn h-7 px-2.5 text-[11.5px]"
                  disabled={phase !== 'idle' || !sessionId || !text.trim()}
                  onClick={() => void parse()}
                >
                  {phase === 'parsing' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                  {phase === 'parsing' ? '解析中…' : '解析'}
                </button>
                <span className="text-[10.5px] text-[var(--faint)]">
                  只认编号，中文逗号、换行、多余空格都没关系
                </span>
              </div>

              {preview && (
                <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px]">
                    <span className="text-[var(--success)]">要的 {matchedKeep} 张</span>
                    <span className="text-[var(--warn)]">要修 {matchedFix} 张</span>
                    {preview.rejectRest ? (
                      <span className="text-[var(--muted)]">其余 {Math.max(0, rejectCount)} 张标为不要</span>
                    ) : (
                      <span className="text-[var(--muted)]">其余照片保持未处理</span>
                    )}
                  </div>
                  {preview.note && (
                    <div className="mt-1.5 rounded border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-[11px] leading-5 text-[var(--text)] whitespace-pre-wrap">
                      客户备注：{preview.note}
                    </div>
                  )}
                  {preview.unmatched.length > 0 && (
                    <div className="mt-1.5 flex items-start gap-1.5 text-[10.5px] leading-4 text-[var(--warn)]">
                      <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                      <span>
                        {preview.unmatched.length} 个编号对不上：{preview.unmatched.join(', ')}
                        （可能客户手改过，确认后再导入）
                      </span>
                    </div>
                  )}
                </div>
              )}

              {error && (
                <div className="mt-3 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-soft)] px-3 py-2 text-[11.5px] leading-5 text-[var(--danger-text)]">
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        <div className="shrink-0 px-4 py-2.5 border-t border-[var(--border)] flex items-center gap-2">
          <span className="text-[10.5px] text-[var(--faint)]">
            客户的判断单独存，不会动你自己的旗标
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <button className="btn btn-ghost h-7 px-2.5 text-[11.5px]" onClick={onClose}>
              取消
            </button>
            <button
              className="btn h-7 px-2.5 text-[11.5px]"
              disabled={
                !preview ||
                phase !== 'idle' ||
                (!preview.keep.length &&
                  !preview.fix.length &&
                  !preview.rejectRest &&
                  !preview.note.trim())
              }
              onClick={() => void apply()}
            >
              {phase === 'applying' ? '写入中…' : '确认导入'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
