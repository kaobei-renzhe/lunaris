import { useEffect, useState } from 'react'
import { Archive, Clock, X } from 'lucide-react'
import type { AutoBackupSettings } from '@shared/types'
import { formatDate } from '../lib/format'

interface AutoBackupDialogProps {
  onClose: () => void
  onSaved: (settings: AutoBackupSettings) => void
}

const INTERVALS: Array<{ days: number; label: string }> = [
  { days: 1, label: '每天' },
  { days: 3, label: '每 3 天' },
  { days: 7, label: '每周' },
  { days: 14, label: '每两周' }
]

const KEEPS = [3, 5, 10]

export default function AutoBackupDialog({ onClose, onSaved }: AutoBackupDialogProps) {
  const [settings, setSettings] = useState<AutoBackupSettings | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void window.api.getAutoBackup().then(setSettings)
  }, [])

  if (!settings) {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-black/60">
        <div className="text-[12.5px] text-[var(--muted)]">读取设置…</div>
      </div>
    )
  }

  const patch = (next: Partial<AutoBackupSettings>): void =>
    setSettings({ ...settings, ...next })

  const chooseDir = async (): Promise<void> => {
    const dir = await window.api.pickAutoBackupDir()
    if (dir) patch({ directory: dir })
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const saved = await window.api.saveAutoBackup({
        enabled: settings.enabled,
        intervalDays: settings.intervalDays,
        keep: settings.keep,
        directory: settings.directory
      })
      onSaved(saved)
      onClose()
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
          <Archive size={15} color="var(--accent-2)" />
          <span className="text-[13.5px] font-medium">自动备份</span>
          <button className="btn btn-ghost h-7 px-1.5 ml-auto" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex items-center gap-3">
            <div>
              <div className="text-[12.5px]">启用自动备份</div>
              <div className="text-[11px] text-[var(--faint)] mt-0.5">仅在应用运行时检查并执行</div>
            </div>
            <button
              className={`ml-auto w-[38px] h-[21px] rounded-full relative transition-colors ${
                settings.enabled ? 'bg-[var(--accent)]' : 'bg-[var(--border-strong)]'
              }`}
              onClick={() => patch({ enabled: !settings.enabled })}
              aria-pressed={settings.enabled}
            >
              <span
                className={`absolute top-[2px] w-[17px] h-[17px] rounded-full bg-white transition-all ${
                  settings.enabled ? 'left-[19px]' : 'left-[2px]'
                }`}
              />
            </button>
          </div>

          <div className={settings.enabled ? '' : 'opacity-45 pointer-events-none'}>
            <div className="text-[11px] text-[var(--faint)] mb-1.5">备份周期</div>
            <div className="flex gap-1.5">
              {INTERVALS.map((option) => (
                <button
                  key={option.days}
                  className={`btn h-7 px-3 text-[11.5px] ${
                    settings.intervalDays === option.days
                      ? 'border-[var(--accent)] text-[var(--accent-2)]'
                      : ''
                  }`}
                  onClick={() => patch({ intervalDays: option.days })}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="text-[11px] text-[var(--faint)] mt-3 mb-1.5">保留最近</div>
            <div className="flex gap-1.5">
              {KEEPS.map((count) => (
                <button
                  key={count}
                  className={`btn h-7 px-3 text-[11.5px] ${
                    settings.keep === count ? 'border-[var(--accent)] text-[var(--accent-2)]' : ''
                  }`}
                  onClick={() => patch({ keep: count })}
                >
                  {count} 份
                </button>
              ))}
            </div>

            <div className="text-[11px] text-[var(--faint)] mt-3 mb-1.5">保存位置</div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2.5 py-2">
              <div className="text-[11.5px] text-[var(--muted)] break-all leading-4">
                {settings.directory ?? '默认：图库旁边的 image-nest-backups 文件夹'}
              </div>
              <div className="flex gap-1.5 mt-1.5">
                <button className="btn h-6 px-2 text-[11px]" onClick={() => void chooseDir()}>
                  更改…
                </button>
                {settings.directory && (
                  <button
                    className="btn btn-ghost h-6 px-2 text-[11px]"
                    onClick={() => patch({ directory: null })}
                  >
                    恢复默认
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 text-[11.5px] text-[var(--faint)]">
            <Clock size={12} />
            上次自动备份：{settings.lastRunAt ? formatDate(settings.lastRunAt) : '还没有执行过'}
          </div>

          <div className="text-[11px] text-[var(--faint)] leading-4">
            自动备份只打包索引数据库（标签、评分、备注、文件夹、堆叠），不包含原图与缩略图，体积很小。
          </div>
        </div>

        <div className="px-4 py-3 border-t border-[var(--border)] flex justify-end gap-2">
          <button className="btn h-7 px-3 text-[12px]" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary h-7 px-4 text-[12px]" onClick={() => void save()} disabled={saving}>
            保存设置
          </button>
        </div>
      </div>
    </div>
  )
}
