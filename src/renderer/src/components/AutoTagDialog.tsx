import { useEffect, useState } from 'react'
import { Sparkles, Tags, Trash2, X } from 'lucide-react'
import type {
  AutoTagCategory,
  AutoTagProgress,
  AutoTagResult,
  AutoTagSettings,
  AutoTagStatus
} from '@shared/types'

interface AutoTagDialogProps {
  onClose: () => void
  onFinished: (message: string) => void
}

export default function AutoTagDialog({ onClose, onFinished }: AutoTagDialogProps) {
  const [categories, setCategories] = useState<AutoTagCategory[]>([])
  const [settings, setSettings] = useState<AutoTagSettings | null>(null)
  const [status, setStatus] = useState<AutoTagStatus | null>(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<AutoTagProgress | null>(null)
  const [result, setResult] = useState<AutoTagResult | null>(null)
  const [error, setError] = useState('')
  const [clearing, setClearing] = useState(false)

  useEffect(() => {
    void Promise.all([
      window.api.autoTagCategories(),
      window.api.getAutoTagSettings(),
      window.api.autoTagStatus()
    ]).then(([list, saved, current]) => {
      setCategories(list)
      setSettings(saved)
      setStatus(current)
    })
    return window.api.onAutoTagProgress(setProgress)
  }, [])

  const refreshStatus = async (): Promise<void> => {
    setStatus(await window.api.autoTagStatus())
  }

  if (!settings) {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-black/60">
        <div className="text-[12.5px] text-[var(--muted)]">读取设置…</div>
      </div>
    )
  }

  const patch = (next: Partial<AutoTagSettings>): void => {
    const merged = { ...settings, ...next }
    setSettings(merged)
    void window.api.saveAutoTagSettings(next)
  }

  const toggleCategory = (name: string): void => {
    const active = settings.categories.includes(name)
    const next = active
      ? settings.categories.filter((item) => item !== name)
      : [...settings.categories, name]
    if (next.length === 0) return
    patch({ categories: next })
  }

  const start = async (): Promise<void> => {
    setRunning(true)
    setError('')
    setResult(null)
    setProgress({ phase: 'prepare', done: 0, total: 0, current: '' })
    try {
      const outcome = await window.api.autoTag()
      setResult(outcome)
      await refreshStatus()
      onFinished(`自动分类完成 · ${outcome.assigned}/${outcome.total} 张已归类`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }

  const clear = async (): Promise<void> => {
    const ok = await window.api.confirm(
      '清除自动分类？',
      '只会移除自动生成的分类标签，手动添加的标签不受影响。'
    )
    if (!ok) return
    setClearing(true)
    try {
      const outcome = await window.api.clearAutoTags()
      setResult(null)
      await refreshStatus()
      onFinished(`已清除 ${outcome.removed} 张图片的自动分类`)
    } finally {
      setClearing(false)
    }
  }

  const counts = result
    ? Object.entries(result.counts).sort((a, b) => b[1] - a[1])
    : []

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60" onClick={onClose}>
      <div
        className="w-[560px] max-h-[82vh] flex flex-col rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-[48px] shrink-0 px-4 flex items-center gap-2 border-b border-[var(--border)]">
          <Tags size={15} color="var(--accent-2)" />
          <span className="text-[13.5px] font-medium">自动分类</span>
          <button className="btn btn-ghost h-7 px-1.5 ml-auto" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="text-[11.5px] text-[var(--muted)] leading-5">
            用本地语义模型判断图片属于哪一类，结果会写成普通标签，可以照常筛选、改名、删除。
            目前 {status ? `已索引 ${status.indexed}/${status.total} 张，已自动分类 ${status.tagged} 张` : '读取中…'}
          </div>

          {status && status.indexed < status.total && (
            <div className="rounded-lg border border-[var(--warn-border)] bg-[var(--warn-soft)] px-2.5 py-2 text-[11.5px] text-[var(--warn)]">
              还有 {status.total - status.indexed} 张图片没有语义索引，它们不会参与分类。先在侧栏点「语义索引」补齐。
            </div>
          )}

          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[11px] text-[var(--faint)]">判定阈值</span>
              <span className="text-[11.5px] text-[var(--text)] tabular-nums">
                {settings.threshold.toFixed(2)}
              </span>
              <span className="text-[11px] text-[var(--faint)] ml-auto">越高越严格，越低越容易归类</span>
            </div>
            <input
              type="range"
              min={0.15}
              max={0.35}
              step={0.01}
              value={settings.threshold}
              disabled={running}
              onChange={(e) => patch({ threshold: Number(e.target.value) })}
              className="w-full accent-[var(--accent)]"
            />
          </div>

          <div>
            <div className="text-[11px] text-[var(--faint)] mb-1.5">
              参与分类的类目（{settings.categories.length}/{categories.length}）
            </div>
            <div className="flex flex-wrap gap-1.5">
              {categories.map((category) => {
                const active = settings.categories.includes(category.name)
                return (
                  <button
                    key={category.name}
                    disabled={running}
                    onClick={() => toggleCategory(category.name)}
                    className={`inline-flex items-center gap-1.5 h-[26px] px-2 rounded-md border text-[11.5px] transition-colors ${
                      active
                        ? 'border-[var(--accent)] text-[var(--text)] bg-[var(--accent-soft)]'
                        : 'border-[var(--border)] text-[var(--faint)] bg-[var(--panel-2)]'
                    }`}
                  >
                    <span
                      className="w-[7px] h-[7px] rounded-full"
                      style={{ background: category.color, opacity: active ? 1 : 0.4 }}
                    />
                    {category.name}
                  </button>
                )
              })}
            </div>
          </div>

          {running && progress && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5">
              <div className="flex items-center gap-2 text-[11.5px] mb-1.5">
                <span className="text-[var(--muted)]">
                  {progress.phase === 'prepare'
                    ? `准备类目向量${progress.current ? ` · ${progress.current}` : ''}`
                    : '正在归类图片'}
                </span>
                <span className="ml-auto text-[var(--text)] tabular-nums">
                  {progress.total ? `${progress.done}/${progress.total}` : '…'}
                </span>
              </div>
              <div className="h-[4px] rounded-full bg-[var(--panel-3)] overflow-hidden">
                <div
                  className="h-full bg-[var(--accent)] transition-[width] duration-200"
                  style={{
                    width: `${
                      progress.total ? Math.round((progress.done / progress.total) * 100) : 8
                    }%`
                  }}
                />
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-[var(--danger-border)] bg-[var(--danger-soft)] px-2.5 py-2 text-[11.5px] text-[var(--danger-text)]">
              {error}
            </div>
          )}

          {result && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5">
              <div className="text-[11.5px] text-[var(--text)]">
                共 {result.total} 张 · 已归类 {result.assigned} 张
                {result.total > result.assigned
                  ? ` · ${result.total - result.assigned} 张低于阈值`
                  : ''}
              </div>
              {counts.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {counts.map(([name, count]) => {
                    const color = categories.find((c) => c.name === name)?.color ?? '#7aa2f7'
                    return (
                      <span
                        key={name}
                        className="inline-flex items-center gap-1 h-[22px] px-1.5 rounded-md bg-[var(--panel)] border border-[var(--border)] text-[11px]"
                      >
                        <span className="w-[6px] h-[6px] rounded-full" style={{ background: color }} />
                        {name}
                        <span className="text-[var(--faint)] tabular-nums">{count}</span>
                      </span>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          <div className="text-[11px] text-[var(--faint)] leading-4">
            每张图只会归到一个最相似的类目；只对已建立语义索引的图片生效，重复运行会按新阈值重新归类，不会重复打标签。
          </div>
        </div>

        <div className="px-4 py-3 border-t border-[var(--border)] flex items-center gap-2">
          {status && status.tagged > 0 && (
            <button
              className="btn btn-ghost h-7 px-2 text-[11.5px]"
              disabled={running || clearing}
              onClick={() => void clear()}
            >
              <Trash2 size={12} /> 清除自动分类
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button className="btn h-7 px-3 text-[12px]" onClick={onClose}>
              关闭
            </button>
            <button
              className="btn btn-primary h-7 px-4 text-[12px]"
              disabled={running}
              onClick={() => void start()}
            >
              <Sparkles size={12} /> {running ? '分类中…' : '开始分类'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
