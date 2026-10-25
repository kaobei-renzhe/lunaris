import { AlertTriangle, CheckCircle2, Pause, Play, Upload, X } from 'lucide-react'
import type { ImportProgress, ImportResult } from '@shared/types'

interface ImportStatusCardProps {
  progress: ImportProgress | null
  running: boolean
  result: ImportResult | null
  onPause: () => void
  onResume: () => void
  onCancel: () => void
  onDismiss: () => void
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg bg-[var(--panel-2)] border border-[var(--border)] px-2 py-1.5">
      <div className="text-[10.5px] text-[var(--faint)]">{label}</div>
      <div className={`text-[14px] tabular-nums ${tone ?? 'text-[var(--text)]'}`}>{value}</div>
    </div>
  )
}

export default function ImportStatusCard({
  progress,
  running,
  result,
  onPause,
  onResume,
  onCancel,
  onDismiss
}: ImportStatusCardProps) {
  if (!running && !result) return null

  if (running) {
    const total = progress?.total ?? 0
    const done = progress?.done ?? 0
    const scanning = !progress || progress.phase === 'scanning'
    const percent = total > 0 ? Math.round((done / total) * 100) : 0

    return (
      <div className="absolute bottom-4 right-4 z-40 w-[360px] rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3 shadow-2xl">
        <div className="flex items-center gap-2 text-[12px]">
          <Upload size={13} className="text-[var(--accent-2)]" />
          <span className="text-[var(--text)]">
            {progress?.paused ? '导入已暂停' : scanning ? '正在扫描文件夹…' : '正在导入照片'}
          </span>
          <span className="ml-auto tabular-nums text-[var(--muted)]">
            {scanning ? `${progress?.total ?? 0} 个文件` : `${done}/${total}`}
          </span>
        </div>

        <div className="mt-2 h-[4px] rounded-full bg-[var(--panel-3)] overflow-hidden">
          <div
            className="h-full bg-[var(--accent)] transition-[width] duration-200"
            style={{ width: `${percent}%` }}
          />
        </div>

        {!scanning && (
          <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
            <Stat label="已导入" value={progress?.added ?? 0} tone="text-[var(--success)]" />
            <Stat label="跳过重复" value={progress?.skipped ?? 0} />
            <Stat label="失败" value={progress?.failed ?? 0} tone="text-[var(--danger-text)]" />
          </div>
        )}

        <div className="mt-2 text-[11px] text-[var(--muted)] truncate" title={progress?.current ?? ''}>
          {progress?.current || '准备中…'}
        </div>

        {!scanning && (
          <div className="mt-1 text-[11px] text-[var(--faint)] tabular-nums">
            剩余 {progress?.remaining ?? 0} 个文件
          </div>
        )}

        <div className="mt-2.5 flex items-center gap-1.5">
          <button
            className="btn h-6 px-2 text-[11px]"
            onClick={progress?.paused ? onResume : onPause}
          >
            {progress?.paused ? <Play size={11} /> : <Pause size={11} />}
            {progress?.paused ? '继续' : '暂停'}
          </button>
          <button className="btn btn-ghost btn-danger h-6 px-2 text-[11px]" onClick={onCancel}>
            取消导入
          </button>
          <span className="ml-auto text-[10.5px] text-[var(--faint)]">可以在后台继续操作</span>
        </div>
      </div>
    )
  }

  const summary = result as ImportResult
  return (
    <div className="absolute bottom-4 right-4 z-40 w-[380px] rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3 shadow-2xl">
      <div className="flex items-center gap-2">
        {summary.cancelled ? (
          <AlertTriangle size={14} className="text-amber-300" />
        ) : (
          <CheckCircle2 size={14} className="text-[var(--success)]" />
        )}
        <span className="text-[12.5px] text-[var(--text)]">
          {summary.cancelled ? '导入已取消' : '导入完成'}
        </span>
        <button className="btn btn-ghost h-6 px-1.5 ml-auto" onClick={onDismiss} title="关闭">
          <X size={13} />
        </button>
      </div>

      <div className="mt-2 grid grid-cols-4 gap-1.5 text-center">
        <Stat label="成功导入" value={summary.added} tone="text-[var(--success)]" />
        <Stat label="跳过重复" value={summary.skipped} />
        <Stat label="失败" value={summary.failed} tone="text-[var(--danger-text)]" />
        <Stat label="找回" value={summary.relinked} />
      </div>

      <div className="mt-2 text-[11px] text-[var(--faint)]">
        共扫描 {summary.scanned} 个文件
        {summary.roots.length === 1 ? ' · 已切换到导入的文件夹' : ''}
      </div>

      {summary.errors.length > 0 && (
        <div className="mt-2 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-soft)] px-2 py-1.5">
          <div className="text-[10.5px] text-[var(--danger-text)] mb-1">
            以下文件无法读取，已标记为异常
          </div>
          <div className="max-h-[92px] overflow-y-auto space-y-0.5">
            {summary.errors.map((error) => (
              <div key={error.path} className="text-[10.5px] text-[var(--danger-text)] truncate">
                {error.name} · {error.message}
              </div>
            ))}
          </div>
          {summary.failed > summary.errors.length && (
            <div className="text-[10px] text-[var(--faint)] mt-0.5">
              还有 {summary.failed - summary.errors.length} 个未列出
            </div>
          )}
        </div>
      )}
    </div>
  )
}
