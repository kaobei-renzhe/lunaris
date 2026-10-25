import { useState } from 'react'
import { FolderOpen, ImagePlus, Upload, X } from 'lucide-react'
import type { ImportOptions } from '@shared/types'

interface ImportDialogProps {
  options: ImportOptions
  onOptions: (options: ImportOptions) => void
  onPickFolder: () => Promise<void>
  onPickFiles: () => Promise<void>
  onClose: () => void
}

function Toggle({
  label,
  hint,
  checked,
  onChange
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0">
        <div className="text-[12.5px]">{label}</div>
        <div className="text-[11px] text-[var(--faint)] mt-0.5 leading-4">{hint}</div>
      </div>
      <button
        className={`ml-auto mt-0.5 w-[38px] h-[21px] rounded-full relative shrink-0 transition-colors ${
          checked ? 'bg-[var(--accent)]' : 'bg-[var(--border-strong)]'
        }`}
        onClick={() => onChange(!checked)}
        aria-pressed={checked}
        type="button"
      >
        <span
          className={`absolute top-[2px] w-[17px] h-[17px] rounded-full bg-white transition-all ${
            checked ? 'left-[19px]' : 'left-[2px]'
          }`}
        />
      </button>
    </div>
  )
}

export default function ImportDialog({
  options,
  onOptions,
  onPickFolder,
  onPickFiles,
  onClose
}: ImportDialogProps) {
  const [busy, setBusy] = useState<'folder' | 'files' | null>(null)

  const start = async (kind: 'folder' | 'files'): Promise<void> => {
    setBusy(kind)
    try {
      if (kind === 'folder') await onPickFolder()
      else await onPickFiles()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60" onClick={onClose}>
      <div
        className="w-[500px] rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="h-[48px] px-4 flex items-center gap-2 border-b border-[var(--border)]">
          <Upload size={15} color="var(--accent-2)" />
          <span className="text-[13.5px] font-medium">导入照片</span>
          <button className="btn btn-ghost h-7 px-1.5 ml-auto" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="text-[11.5px] text-[var(--muted)] leading-5">
            选择一个文件夹，月巢会扫描并识别其中的照片（JPG、PNG、RAW、HEIC、TIFF 等）。
            导入在后台进行，期间可以继续浏览和整理其它照片。
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-3 space-y-3">
            <Toggle
              label="包含子文件夹"
              hint="递归扫描所有层级，不用一张张挑"
              checked={options.recursive}
              onChange={(recursive) => onOptions({ ...options, recursive })}
            />
            <Toggle
              label="跳过重复照片"
              hint="按文件内容比对，已经收过的同一张照片不会重复导入"
              checked={options.skipDuplicates}
              onChange={(skipDuplicates) => onOptions({ ...options, skipDuplicates })}
            />
          </div>

          <div className="text-[11px] text-[var(--faint)]">
            这些选项会自动记住，下次导入沿用上次的设置。
          </div>

          <div className="rounded-lg border border-[var(--border)] px-3 py-2.5 text-[11px] text-[var(--faint)] leading-4">
            导入完成后会按原文件夹结构归档，损坏或无法读取的文件会单独标记，不会中断整个导入。
          </div>
        </div>

        <div className="px-4 py-3 border-t border-[var(--border)] flex justify-end gap-2">
          <button className="btn h-7 px-3 text-[12px]" onClick={onClose}>
            取消
          </button>
          <button
            className="btn h-7 px-3 text-[12px]"
            onClick={() => void start('files')}
            disabled={busy !== null}
          >
            <ImagePlus size={13} /> 选择图片
          </button>
          <button
            className="btn btn-primary h-7 px-4 text-[12px]"
            onClick={() => void start('folder')}
            disabled={busy !== null}
          >
            <FolderOpen size={13} /> 选择文件夹
          </button>
        </div>
      </div>
    </div>
  )
}
