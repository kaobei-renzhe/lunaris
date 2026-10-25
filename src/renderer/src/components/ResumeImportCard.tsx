import { History, Upload, X } from 'lucide-react'
import type { PendingImport } from '@shared/types'
import { folderName } from '../lib/format'

interface ResumeImportCardProps {
  pending: PendingImport
  onResume: () => void
  onDiscard: () => void
}

export default function ResumeImportCard({ pending, onResume, onDiscard }: ResumeImportCardProps) {
  const label =
    pending.paths.length > 1
      ? `${folderName(pending.paths[0])} 等 ${pending.paths.length} 个位置`
      : folderName(pending.paths[0])

  return (
    <div className="absolute bottom-4 right-4 z-40 w-[344px] rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3 shadow-2xl">
      <div className="flex items-center gap-2">
        <History size={14} className="text-[var(--accent-2)]" />
        <span className="text-[12.5px] text-[var(--text)]">上次导入未完成</span>
        <button
          className="btn btn-ghost h-6 px-1.5 ml-auto"
          onClick={onDiscard}
          title="忽略这次未完成的导入"
        >
          <X size={13} />
        </button>
      </div>

      <div className="mt-1.5 text-[11.5px] text-[var(--text)] truncate" title={pending.paths.join('\n')}>
        {label}
      </div>
      <div className="mt-1 text-[11px] text-[var(--faint)] tabular-nums">
        {pending.total > 0
          ? `上次进度 ${Math.min(pending.done, pending.total)}/${pending.total}`
          : '上次还在扫描阶段'}
      </div>

      <div className="mt-2.5 flex items-center gap-1.5">
        <button className="btn btn-primary h-6 px-3 text-[11px]" onClick={onResume}>
          <Upload size={11} /> 继续导入
        </button>
        <button className="btn btn-ghost h-6 px-2 text-[11px]" onClick={onDiscard}>
          忽略
        </button>
      </div>

      <div className="mt-1.5 text-[10.5px] text-[var(--faint)] leading-4">
        继续时会跳过已经导入的照片，只处理剩下的文件。
      </div>
    </div>
  )
}
