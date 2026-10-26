import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Loader2, Search, Settings, Sparkles, X } from 'lucide-react'
import type { Item } from '@shared/types'
import type { LlmErrorCode, SmartFilterResult } from '@shared/llm'
import { thumbUrl } from '../lib/format'
import { llmHint } from '../lib/llmHint'

interface SmartFilterDialogProps {
  /** 当前已加载的图片，用来做候选与展示名字/缩略图 */
  items: Item[]
  /** 当前筛选下的总数，用于说明"只看了样本" */
  total: number
  onApply: (rule: string, ids: number[]) => void
  onClose: () => void
  onOpenSettings: () => void
}

const MAX_ITEMS = 30
type Phase = 'idle' | 'loading' | 'done' | 'error'

export default function SmartFilterDialog({
  items,
  total,
  onApply,
  onClose,
  onOpenSettings
}: SmartFilterDialogProps) {
  const [rule, setRule] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [result, setResult] = useState<SmartFilterResult | null>(null)
  const [error, setError] = useState<{ code: LlmErrorCode; message: string } | null>(null)

  const candidates = useMemo(() => items.slice(0, MAX_ITEMS), [items])
  const itemMap = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const reasonMap = useMemo(
    () => new Map((result?.reasons ?? []).map((entry) => [entry.itemId, entry.reason])),
    [result]
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const run = async (): Promise<void> => {
    const text = rule.trim()
    if (!text || phase === 'loading' || candidates.length === 0) return
    setPhase('loading')
    setError(null)
    const outcome = await window.api.llmRun('photo.smartFilter', {
      rule: text,
      itemIds: candidates.map((item) => item.id)
    })
    if (outcome.ok) {
      setResult(outcome.data as SmartFilterResult)
      setPhase('done')
    } else {
      setResult(null)
      setError({ code: outcome.code, message: outcome.message })
      setPhase('error')
    }
  }

  const needsSettings = error?.code === 'not_configured' || error?.code === 'auth'
  const matched = result?.matchedIds ?? []

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60" onClick={onClose}>
      <div
        className="w-[560px] max-h-[84vh] flex flex-col rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="h-[46px] shrink-0 px-4 flex items-center gap-2 border-b border-[var(--border)]">
          <Sparkles size={15} color="var(--accent-2)" />
          <span className="text-[13.5px] font-medium">AI 智能筛选</span>
          <button className="btn btn-ghost h-7 px-1.5 ml-auto" onClick={onClose} title="关闭（Esc）">
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <textarea
            className="input w-full h-[66px] py-2 resize-none leading-5 text-[12.5px]"
            placeholder="用一句话描述要挑哪些图，比如：画面里有海、低饱和冷色调、主体清晰不手抖"
            value={rule}
            onChange={(event) => {
              setRule(event.target.value)
              // 改了规则就作废旧结果，避免"新规则 + 旧命中"混在一起被应用
              if (phase !== 'loading') {
                setPhase('idle')
                setResult(null)
                setError(null)
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void run()
            }}
          />

          <div className="mt-2 flex items-center gap-2 text-[10.5px] text-[var(--faint)]">
            <span>
              当前视图 {total} 张，一次最多看 {MAX_ITEMS} 张
              {items.length < total ? '（取已加载的前 30 张）' : ''}
            </span>
            <button
              className="btn h-7 px-2.5 text-[11.5px] ml-auto"
              disabled={!rule.trim() || phase === 'loading' || candidates.length === 0}
              onClick={() => void run()}
              title="开始筛选（Ctrl+Enter）"
            >
              {phase === 'loading' ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
              {phase === 'loading' ? '筛选中…' : '开始筛选'}
            </button>
          </div>

          {phase === 'error' && error && (
            <div className="mt-3 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-soft)] px-3 py-2.5">
              <div className="flex items-start gap-1.5 text-[11.5px] leading-5 text-[var(--danger-text)]">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span>{llmHint(error.code, error.message)}</span>
              </div>
              <div className="mt-1 text-[10.5px] leading-4 text-[var(--danger-text)] opacity-70">
                {error.message}
              </div>
            </div>
          )}

          {phase === 'done' && result && (
            <div className="mt-3">
              <div className="text-[11.5px] text-[var(--muted)]">
                看了 {result.evaluated} 张，命中 <span className="text-[var(--accent-2)]">{matched.length}</span> 张
              </div>
              {result.errors?.length ? (
                <div className="mt-1 text-[10.5px] leading-4 text-[var(--warn)]">
                  {result.errors.join('；')}
                </div>
              ) : null}

              {matched.length === 0 ? (
                <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-4 text-center text-[11.5px] text-[var(--faint)]">
                  这批里没有符合规则的图。可以换个说法，或先把候选范围缩小再筛。
                </div>
              ) : (
                <div className="mt-2 space-y-1">
                  {matched.map((id) => {
                    const item = itemMap.get(id)
                    return (
                      <div
                        key={id}
                        className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1.5"
                      >
                        <div className="w-[38px] h-[38px] shrink-0 rounded overflow-hidden border border-[var(--border)]">
                          <img src={thumbUrl(id, 'low')} alt="" className="w-full h-full object-cover" />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-[11.5px] text-[var(--text)]">
                            {item?.name ?? `#${id}`}
                          </div>
                          <div className="truncate text-[10.5px] leading-4 text-[var(--faint)]">
                            {reasonMap.get(id) ?? '模型没有给出理由'}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 px-4 py-2.5 border-t border-[var(--border)] flex items-center gap-2">
          <span className="text-[10.5px] text-[var(--faint)]">
            点「开始筛选」才会发请求，一次会带上这 {candidates.length} 张图（消耗 token）
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            {needsSettings && (
              <button
                className="btn h-7 px-2 text-[11.5px]"
                onClick={() => {
                  onOpenSettings()
                  onClose()
                }}
              >
                <Settings size={12} /> 去设置
              </button>
            )}
            <button className="btn btn-ghost h-7 px-2 text-[11.5px]" onClick={onClose}>
              关闭
            </button>
            <button
              className="btn h-7 px-2 text-[11.5px]"
              disabled={matched.length === 0}
              onClick={() => onApply(rule.trim(), matched)}
            >
              只看这些
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
