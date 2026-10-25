import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Copy, Loader2, RefreshCw, Settings, Sparkles, X } from 'lucide-react'
import type { Item } from '@shared/types'
import type { LlmErrorCode, PhotoAdvice } from '@shared/llm'
import { thumbUrl } from '../lib/format'
import { llmHint } from '../lib/llmHint'

interface AdviceDialogProps {
  item: Item
  onClose: () => void
  onOpenSettings: () => void
}

type Phase = 'idle' | 'loading' | 'done' | 'error'

function toPlainText(advice: PhotoAdvice): string {
  const lines = [`后期建议 · ${advice.summary}`, '']
  if (advice.directions.length) {
    lines.push('修图方向：')
    advice.directions.forEach((entry, index) => lines.push(`${index + 1}. ${entry}`))
    lines.push('')
  }
  if (advice.parameters.length) {
    lines.push('参数建议：')
    advice.parameters.forEach((entry) => lines.push(`- ${entry.name} ${entry.value}：${entry.why}`))
    lines.push('')
  }
  if (advice.styleRefs.length) lines.push(`风格参考：${advice.styleRefs.join('、')}`)
  return lines.join('\n').trim()
}

export default function AdviceDialog({ item, onClose, onOpenSettings }: AdviceDialogProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [advice, setAdvice] = useState<PhotoAdvice | null>(null)
  const [error, setError] = useState<{ code: LlmErrorCode; message: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const run = useCallback(async () => {
    setPhase('loading')
    setError(null)
    setCopied(false)
    const outcome = await window.api.llmRun('photo.advice', { itemId: item.id })
    if (outcome.ok) {
      setAdvice(outcome.data as PhotoAdvice)
      setPhase('done')
    } else {
      setError({ code: outcome.code, message: outcome.message })
      setPhase('error')
    }
  }, [item.id])

  // 不在打开时自动请求：只有用户点「生成建议」才会花 token
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const copy = async (): Promise<void> => {
    if (!advice) return
    await navigator.clipboard.writeText(toPlainText(advice))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const needsSettings = error?.code === 'not_configured' || error?.code === 'auth'

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60" onClick={onClose}>
      <div
        className="w-[520px] max-h-[82vh] flex flex-col rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="h-[46px] shrink-0 px-4 flex items-center gap-2 border-b border-[var(--border)]">
          <Sparkles size={15} color="var(--accent-2)" />
          <span className="text-[13.5px] font-medium">后期建议</span>
          <span className="truncate text-[11.5px] text-[var(--faint)]" title={item.name}>
            {item.name}
          </span>
          <button className="btn btn-ghost h-7 px-1.5 ml-auto" onClick={onClose} title="关闭（Esc）">
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex items-center gap-3">
            <div className="w-[64px] h-[64px] shrink-0 rounded-lg overflow-hidden border border-[var(--border)]">
              <img src={thumbUrl(item.id)} alt={item.name} className="w-full h-full object-cover" />
            </div>
            <div className="min-w-0 text-[11px] leading-5 text-[var(--faint)]">
              <div>
                {item.width} × {item.height}
                {item.ext ? ` · ${item.ext.replace('.', '').toUpperCase()}` : ''}
              </div>
              {item.exif?.camera && <div className="truncate">{item.exif.camera}</div>}
              {item.exif?.focal && (
                <div className="truncate">
                  {item.exif.focal}
                  {item.exif.aperture ? ` · ${item.exif.aperture}` : ''}
                  {item.exif.shutter ? ` · ${item.exif.shutter}` : ''}
                  {item.exif.iso ? ` · ISO ${item.exif.iso}` : ''}
                </div>
              )}
            </div>
          </div>

          {phase === 'idle' && (
            <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-3 text-[11.5px] leading-5 text-[var(--muted)]">
              点下面的「生成建议」才会把这张图发给模型，每次请求都会消耗 token；不点就不会产生费用。
            </div>
          )}

          {phase === 'loading' && (
            <div className="mt-5 flex items-center gap-2 text-[12px] text-[var(--muted)]">
              <Loader2 size={14} className="animate-spin" />
              正在看这张照片，整理修图方向…
            </div>
          )}

          {phase === 'error' && error && (
            <div className="mt-4 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-soft)] px-3 py-2.5">
              <div className="flex items-start gap-1.5 text-[11.5px] leading-5 text-[var(--danger-text)]">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span>{llmHint(error.code, error.message)}</span>
              </div>
              <div className="mt-1 text-[10.5px] leading-4 text-[var(--danger-text)] opacity-70">
                {error.message}
              </div>
            </div>
          )}

          {phase === 'done' && advice && (
            <div className="mt-4 space-y-3">
              {advice.summary && (
                <div className="rounded-lg border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 py-2.5 text-[12px] leading-5 text-[var(--accent-text)]">
                  {advice.summary}
                </div>
              )}

              {advice.directions.length > 0 && (
                <div>
                  <div className="text-[10.5px] uppercase tracking-wider text-[var(--faint)] mb-1.5">
                    修图方向
                  </div>
                  <ol className="space-y-1">
                    {advice.directions.map((entry, index) => (
                      <li key={index} className="flex gap-2 text-[12px] leading-5 text-[var(--text)]">
                        <span className="w-[16px] shrink-0 text-[var(--accent-2)]">{index + 1}.</span>
                        <span>{entry}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {advice.parameters.length > 0 && (
                <div>
                  <div className="text-[10.5px] uppercase tracking-wider text-[var(--faint)] mb-1.5">
                    参数建议
                  </div>
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] divide-y divide-[var(--border)]">
                    {advice.parameters.map((param, index) => (
                      <div key={index} className="px-2.5 py-2 flex items-start gap-2">
                        <span className="w-[64px] shrink-0 text-[11.5px] text-[var(--muted)]">
                          {param.name}
                        </span>
                        <span className="w-[54px] shrink-0 text-[11.5px] text-[var(--accent-text)]">
                          {param.value}
                        </span>
                        <span className="text-[11px] leading-4 text-[var(--faint)]">{param.why}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {advice.styleRefs.length > 0 && (
                <div>
                  <div className="text-[10.5px] uppercase tracking-wider text-[var(--faint)] mb-1.5">
                    风格参考
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {advice.styleRefs.map((entry) => (
                      <span
                        key={entry}
                        className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10.5px] text-[var(--muted)]"
                      >
                        {entry}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {!advice.summary &&
                advice.directions.length === 0 &&
                advice.parameters.length === 0 && (
                  <div className="text-[11.5px] text-[var(--faint)]">
                    模型这次没给出有效内容，换个模型或再生成一次试试。
                  </div>
                )}
            </div>
          )}
        </div>

        <div className="shrink-0 px-4 py-2.5 border-t border-[var(--border)] flex items-center gap-2">
          <span className="text-[10.5px] text-[var(--faint)]">
            {phase === 'done' ? '建议由大模型生成，仅供参考' : '不点按钮就不会发请求'}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            {phase === 'done' && (
              <button className="btn btn-ghost h-7 px-2 text-[11.5px]" onClick={() => void copy()}>
                <Copy size={12} /> {copied ? '已复制' : '复制'}
              </button>
            )}
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
            <button
              className="btn h-7 px-2 text-[11.5px]"
              disabled={phase === 'loading'}
              onClick={() => void run()}
            >
              <RefreshCw size={12} />
              {phase === 'idle' ? '生成建议' : phase === 'loading' ? '生成中…' : '重新生成'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
