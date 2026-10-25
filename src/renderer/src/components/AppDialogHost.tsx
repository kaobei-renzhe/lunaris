import { useEffect, useRef, useState } from 'react'
import { CircleHelp, Info, TriangleAlert } from 'lucide-react'
import type { AppDialogRequest } from '@shared/types'

const ICON_STYLE: Record<string, { Icon: typeof Info; color: string }> = {
  question: { Icon: CircleHelp, color: 'var(--accent-2)' },
  warning: { Icon: TriangleAlert, color: 'var(--warn)' },
  error: { Icon: TriangleAlert, color: 'var(--danger)' },
  info: { Icon: Info, color: 'var(--accent-2)' }
}

/**
 * 应用内确认弹窗：主进程通过 ui:dialog-request 发起，这里渲染并回传结果。
 * 用 CSS 变量取色，跟随当前界面风格；系统弹窗只在窗口不存在时兜底。
 */
export default function AppDialogHost() {
  const [queue, setQueue] = useState<AppDialogRequest[]>([])
  const [checked, setChecked] = useState(false)
  const confirmRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    return window.api.onDialogRequest((request) => {
      setQueue((prev) => [...prev, request])
    })
  }, [])

  const current = queue[0]

  const reply = (confirmed: boolean): void => {
    if (!current) return
    window.api.replyDialog(current.id, { confirmed, checked })
    setQueue((prev) => prev.slice(1))
  }

  useEffect(() => {
    if (!current) return
    setChecked(Boolean(current.checkboxChecked))
    // 弹窗一出现就把焦点放到确认按钮，回车即可继续
    const timer = window.setTimeout(() => confirmRef.current?.focus(), 30)
    return () => window.clearTimeout(timer)
  }, [current])

  useEffect(() => {
    if (!current) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        reply(false)
        return
      }
      // 焦点在复选框上时把回车留给复选框自己
      if (event.key === 'Enter' && !(document.activeElement instanceof HTMLInputElement)) {
        event.preventDefault()
        reply(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!current) return null

  const { Icon, color } = ICON_STYLE[current.kind ?? 'question'] ?? ICON_STYLE.question

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/55"
      onClick={() => reply(Boolean(current.onlyConfirm))}
      role="dialog"
      aria-modal="true"
      aria-label={current.title}
    >
      <div
        className="w-[420px] rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-4 pt-4 pb-3">
          <Icon size={17} color={color} className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium leading-5 text-[var(--text)]">{current.title}</div>
            {current.detail && (
              <div className="mt-1.5 text-[11.5px] leading-5 text-[var(--muted)]">{current.detail}</div>
            )}
            {current.checkboxLabel && (
              <label className="mt-3 flex items-start gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="mt-[2px] accent-[var(--accent)]"
                  checked={checked}
                  onChange={(event) => setChecked(event.target.checked)}
                />
                <span className="text-[11.5px] leading-4 text-[var(--muted)]">{current.checkboxLabel}</span>
              </label>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--border)] bg-[var(--panel-2)]">
          {!current.onlyConfirm && (
            <button className="btn" onClick={() => reply(false)}>
              {current.cancelText ?? '取消'}
            </button>
          )}
          <button
            ref={confirmRef}
            className={`btn ${current.danger ? '' : 'btn-primary'}`}
            style={
              current.danger
                ? { background: 'transparent', borderColor: 'var(--danger-border)', color: 'var(--danger-text)' }
                : undefined
            }
            onClick={() => reply(true)}
          >
            {current.confirmText ?? '确定'}
          </button>
        </div>
      </div>
    </div>
  )
}
