import { useState } from 'react'
import { Monitor, Moon, Settings as SettingsIcon, Sun, X } from 'lucide-react'
import type { ThemeMode } from '@shared/types'

interface SettingsDialogProps {
  theme: ThemeMode
  onChange: (mode: ThemeMode) => void
  onClose: () => void
}

const THEME_OPTIONS: Array<{
  value: ThemeMode
  label: string
  hint: string
  Icon: typeof Monitor
}> = [
  { value: 'system', label: '跟随系统', hint: '系统换成深色或浅色时，我也跟着变', Icon: Monitor },
  { value: 'dark', label: '深色模式', hint: '深灰背景，夜里看图不刺眼', Icon: Moon },
  { value: 'light', label: '浅色模式', hint: '亮色背景，白天看着更清爽', Icon: Sun }
]

export default function SettingsDialog({ theme, onChange, onClose }: SettingsDialogProps) {
  const [saving, setSaving] = useState(false)

  const pick = async (mode: ThemeMode): Promise<void> => {
    if (mode === theme || saving) return
    setSaving(true)
    try {
      onChange(await window.api.saveTheme(mode))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60" onClick={onClose}>
      <div
        className="w-[520px] rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-[48px] px-4 flex items-center gap-2 border-b border-[var(--border)]">
          <SettingsIcon size={15} color="var(--accent-2)" />
          <span className="text-[13.5px] font-medium">设置</span>
          <button className="btn btn-ghost h-7 px-1.5 ml-auto" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <div className="text-[11px] text-[var(--faint)] mb-1.5">外观</div>
            <div className="text-[12.5px] mb-2">主题</div>
            <div className="grid grid-cols-3 gap-1.5">
              {THEME_OPTIONS.map(({ value, label, hint, Icon }) => {
                const active = theme === value
                return (
                  <button
                    key={value}
                    className={`rounded-lg border px-2.5 py-2.5 text-left transition-colors ${
                      active
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                        : 'border-[var(--border)] bg-[var(--panel-2)] hover:border-[var(--border-strong)]'
                    }`}
                    disabled={saving}
                    onClick={() => void pick(value)}
                  >
                    <div className="flex items-center gap-1.5">
                      <Icon size={14} color={active ? 'var(--accent-2)' : 'var(--muted)'} />
                      <span
                        className={`text-[12px] ${active ? 'text-[var(--accent-text)]' : 'text-[var(--text)]'}`}
                      >
                        {label}
                      </span>
                    </div>
                    <div className="mt-1 text-[10.5px] leading-4 text-[var(--faint)]">{hint}</div>
                  </button>
                )
              })}
            </div>
            <div className="mt-2 text-[11px] leading-4 text-[var(--faint)]">
              选择后会立刻生效，下次启动也沿用这次的选择。
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
