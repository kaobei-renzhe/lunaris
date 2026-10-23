import { useEffect, useState } from 'react'
import { FolderSearch, History, TriangleAlert, X } from 'lucide-react'
import type { RelocatePair, RelocatePlan } from '@shared/types'
import { folderName } from '../lib/format'

interface RelocateDialogProps {
  onClose: () => void
  onFinished: (message: string) => void
}

export default function RelocateDialog({ onClose, onFinished }: RelocateDialogProps) {
  const [plan, setPlan] = useState<RelocatePlan | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [lastDir, setLastDir] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void window.api.lastRelocateDir().then(setLastDir)
  }, [])

  const runPlan = async (dir: string): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const next = await window.api.planRelocate(dir)
      setPlan(next)
      // 待确认项默认勾选，用户可取消
      setSelected(next.pending.map((item) => item.id))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const pick = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const next = await window.api.pickRelocateDir()
      if (next) {
        setPlan(next)
        setSelected(next.pending.map((item) => item.id))
        setLastDir(await window.api.lastRelocateDir())
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const toggle = (id: number): void => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))
  }

  const chosen: RelocatePair[] = plan
    ? [...plan.matched, ...plan.pending.filter((item) => selected.includes(item.id))]
    : []

  const apply = async (): Promise<void> => {
    if (chosen.length === 0) return
    setApplying(true)
    setError('')
    try {
      const result = await window.api.applyRelocate(chosen)
      onFinished(`已接回 ${result.relinked} 张${result.failed ? ` · 失败 ${result.failed}` : ''}`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60" onClick={onClose}>
      <div
        className="w-[660px] max-h-[84vh] flex flex-col rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-[48px] shrink-0 px-4 flex items-center gap-2 border-b border-[var(--border)]">
          <TriangleAlert size={15} color="var(--danger-text)" />
          <span className="text-[13.5px] font-medium">重新定位丢失文件</span>
          <button className="btn btn-ghost h-7 px-1.5 ml-auto" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="text-[11.5px] text-[var(--muted)] leading-5">
            选一个图片现在所在的文件夹，我会按「目录结构 → 文件名 + 大小 → 画面指纹 → EXIF
            拍摄信息」逐层匹配。只改数据库里的路径，不会移动、复制或删除任何磁盘文件。
          </div>

          {!plan && (
            <div className="space-y-2">
              <button
                className="btn btn-primary h-[38px] w-full justify-center"
                disabled={busy}
                onClick={() => void pick()}
              >
                <FolderSearch size={15} /> {busy ? '正在扫描匹配…' : '选择新文件夹…'}
              </button>
              {lastDir && (
                <button
                  className="btn h-[34px] w-full justify-center"
                  disabled={busy}
                  onClick={() => void runPlan(lastDir)}
                  title={lastDir}
                >
                  <History size={14} /> 沿用上次：{folderName(lastDir)}
                </button>
              )}
            </div>
          )}

          {plan && (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-[11.5px]">
                <span className="text-[var(--muted)]">扫描到 {plan.scanned} 个文件</span>
                <span className="text-[var(--success)]">自动接回 {plan.matched.length} 张</span>
                {plan.mapped > 0 && (
                  <span className="text-[var(--faint)]">其中目录映射 {plan.mapped}</span>
                )}
                {plan.pending.length > 0 && (
                  <span className="text-[var(--warn)]">待确认 {plan.pending.length} 张</span>
                )}
                <span className="text-[var(--muted)]">未匹配 {plan.unmatched}</span>
                {plan.conflicts > 0 && (
                  <span className="text-[var(--warn)]">冲突 {plan.conflicts}</span>
                )}
              </div>

              {plan.matched.length > 0 && (
                <div>
                  <div className="text-[11px] text-[var(--faint)] mb-1.5">可自动接回</div>
                  <div className="rounded-lg border border-[var(--border)] max-h-[190px] overflow-y-auto divide-y divide-[var(--border)]">
                    {plan.matched.slice(0, 40).map((pair) => (
                      <div key={pair.id} className="px-2.5 py-1.5">
                        <div className="text-[11.5px] text-[var(--text)] truncate">{pair.name}</div>
                        <div className="text-[10.5px] text-[var(--faint)] truncate" title={pair.oldPath}>
                          {pair.oldPath}
                        </div>
                        <div className="text-[10.5px] text-[var(--success)] truncate" title={pair.newPath}>
                          → {pair.newPath}
                        </div>
                      </div>
                    ))}
                  </div>
                  {plan.matched.length > 40 && (
                    <div className="mt-1 text-[10.5px] text-[var(--faint)]">
                      还有 {plan.matched.length - 40} 条没显示，应用时会一起处理
                    </div>
                  )}
                </div>
              )}

              {plan.pending.length > 0 && (
                <div>
                  <div className="text-[11px] text-[var(--faint)] mb-1.5">
                    待确认（默认勾选，不对的取消掉）
                  </div>
                  <div className="rounded-lg border border-[var(--warn-border)] bg-[var(--warn-soft)] max-h-[210px] overflow-y-auto divide-y divide-[var(--warn-border)]">
                    {plan.pending.map((pair) => {
                      const active = selected.includes(pair.id)
                      return (
                        <label
                          key={pair.id}
                          className="flex items-start gap-2 px-2.5 py-1.5 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={active}
                            onChange={() => toggle(pair.id)}
                            className="mt-[3px] accent-[var(--accent)]"
                          />
                          <div className="min-w-0">
                            <div className="text-[11.5px] text-[var(--text)] truncate">
                              {pair.name}
                              <span className="ml-2 text-[10.5px] text-[var(--warn)]">{pair.reason}</span>
                            </div>
                            <div className="text-[10.5px] text-[var(--faint)] truncate" title={pair.oldPath}>
                              {pair.oldPath}
                            </div>
                            <div className="text-[10.5px] text-[var(--success)] truncate" title={pair.newPath}>
                              → {pair.newPath}
                            </div>
                          </div>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}

              {plan.matched.length === 0 && plan.pending.length === 0 && (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-4 text-center text-[11.5px] text-[var(--muted)]">
                  这个文件夹里没找到能对上的文件，换一个目录再试试
                </div>
              )}
            </>
          )}

          {error && (
            <div className="rounded-lg border border-[var(--danger-border)] bg-[var(--danger-soft)] px-2.5 py-2 text-[11.5px] text-[var(--danger-text)]">
              {error}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-[var(--border)] flex items-center gap-2">
          {plan && (
            <button
              className="btn btn-ghost h-7 px-2 text-[11.5px]"
              disabled={busy || applying}
              onClick={() => void pick()}
            >
              <FolderSearch size={12} /> 换个文件夹
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button className="btn h-7 px-3 text-[12px]" onClick={onClose}>
              关闭
            </button>
            <button
              className="btn btn-primary h-7 px-4 text-[12px]"
              disabled={chosen.length === 0 || applying}
              onClick={() => void apply()}
            >
              {applying ? '接回中…' : `接回 ${chosen.length} 张`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
