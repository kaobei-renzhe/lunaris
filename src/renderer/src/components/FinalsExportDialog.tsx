import { useEffect, useState } from 'react'
import { Check, FolderOpen, HardDriveDownload, Loader2, X } from 'lucide-react'
import type {
  FinalsExportMode,
  FinalsExportProgress,
  FinalsExportResult,
  FinalsNaming,
  PickWatermarkStyle
} from '@shared/types'
import {
  PICK_WATERMARK_DEFAULT,
  PICK_WATERMARK_POSITIONS,
  normalizePickWatermark
} from '@shared/pick'
import { formatBytes } from '../lib/format'

interface FinalsExportDialogProps {
  itemIds: number[]
  onClose: () => void
  onExported: (result: FinalsExportResult) => void
}

const EDGES: Array<{ value: string; label: string }> = [
  { value: 'origin', label: '原尺寸' },
  { value: '2560', label: '长边 2560' },
  { value: '2048', label: '长边 2048' },
  { value: '1600', label: '长边 1600' },
  { value: '1200', label: '长边 1200' }
]

function cleanError(error: unknown): string {
  return String((error as Error)?.message ?? error).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    ''
  )
}

export default function FinalsExportDialog({
  itemIds,
  onClose,
  onExported
}: FinalsExportDialogProps) {
  const [mode, setMode] = useState<FinalsExportMode>('jpeg')
  const [edge, setEdge] = useState('origin')
  const [quality, setQuality] = useState(90)
  const [naming, setNaming] = useState<FinalsNaming>('original')
  const [prefix, setPrefix] = useState('')
  const [watermarkOn, setWatermarkOn] = useState(false)
  const [watermark, setWatermark] = useState('')
  const [style, setStyle] = useState<PickWatermarkStyle>(PICK_WATERMARK_DEFAULT)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<FinalsExportProgress | null>(null)
  const [result, setResult] = useState<FinalsExportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.api.finalsDefaults().then((defaults) => {
      setMode(defaults.mode)
      setEdge(defaults.maxEdge ? String(defaults.maxEdge) : 'origin')
      setQuality(defaults.quality)
      setNaming(defaults.naming)
      setPrefix(defaults.prefix)
      setStyle(defaults.watermarkStyle)
      setWatermark(defaults.watermark)
      setWatermarkOn(Boolean(defaults.watermark))
    })
  }, [])

  useEffect(() => window.api.onFinalsProgress(setProgress), [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !running) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [running, onClose])

  const patchStyle = (next: Partial<PickWatermarkStyle>): void =>
    setStyle((prev) => normalizePickWatermark({ ...prev, ...next }))

  const run = async (): Promise<void> => {
    if (running || itemIds.length === 0) return
    setRunning(true)
    setProgress(null)
    setError(null)
    setResult(null)
    try {
      const exported = await window.api.finalsExport({
        itemIds,
        mode,
        maxEdge: mode === 'jpeg' && edge !== 'origin' ? Number(edge) : null,
        quality,
        naming,
        prefix,
        watermark: mode === 'jpeg' && watermarkOn ? watermark.trim() : '',
        watermarkStyle: style
      })
      if (exported) {
        setResult(exported)
        onExported(exported)
      }
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60"
      onClick={running ? undefined : onClose}
    >
      <div
        className="flex max-h-[86vh] w-[520px] flex-col rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex h-[46px] shrink-0 items-center gap-2 border-b border-[var(--border)] px-4">
          <HardDriveDownload size={15} color="var(--accent-2)" />
          <span className="text-[13.5px] font-medium">导出成品</span>
          <span className="text-[11px] text-[var(--faint)]">已选 {itemIds.length} 张</span>
          <button
            className="btn btn-ghost ml-auto h-7 px-1.5"
            onClick={onClose}
            disabled={running}
            title="关闭（Esc）"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {result ? (
            <div>
              <div className="flex items-start gap-2 rounded-lg border border-[var(--success)]/40 bg-[var(--panel-2)] px-3 py-3">
                <Check size={16} className="mt-0.5 shrink-0 text-[var(--success)]" />
                <div className="min-w-0">
                  <div className="text-[12.5px] text-[var(--text)]">
                    已导出 {result.count} 张 · {formatBytes(result.bytes)}
                    {result.renamed > 0 && ` · ${result.renamed} 张重名已加序号`}
                  </div>
                  <div className="mt-1 break-all text-[10.5px] leading-4 text-[var(--faint)]">
                    {result.dir}
                  </div>
                </div>
              </div>

              {result.failed.length > 0 && (
                <div className="mt-3 rounded-lg border border-[var(--warn)]/40 bg-[var(--panel-2)] px-3 py-2.5">
                  <div className="text-[11.5px] text-[var(--warn)]">
                    {result.failed.length} 张没能导出
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {result.failed.slice(0, 5).map((item) => (
                      <div key={item.id} className="truncate text-[10.5px] text-[var(--faint)]">
                        {item.name} · {item.message}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-1">
                <span className="w-[52px] text-[11px] text-[var(--muted)]">方式</span>
                <div className="flex rounded-md border border-[var(--border)] p-0.5">
                  {(
                    [
                      { id: 'jpeg', label: '转成 JPEG' },
                      { id: 'copy', label: '原件复制' }
                    ] as Array<{ id: FinalsExportMode; label: string }>
                  ).map((entry) => (
                    <button
                      key={entry.id}
                      className={`h-6 rounded px-2 text-[11px] transition-colors ${
                        mode === entry.id
                          ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]'
                          : 'text-[var(--faint)] hover:text-[var(--text)]'
                      }`}
                      onClick={() => setMode(entry.id)}
                      disabled={running}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
                <span className="ml-auto text-[10px] leading-4 text-[var(--faint)]">
                  {mode === 'copy' ? '原样复制，保留 RAW 与 EXIF' : '重新编码，会去掉 EXIF'}
                </span>
              </div>

              {mode === 'jpeg' && (
                <div className="mt-3 flex items-center gap-2">
                  <span className="w-[52px] text-[11px] text-[var(--muted)]">尺寸</span>
                  <select
                    className="input h-7 w-[130px] text-[11.5px]"
                    value={edge}
                    onChange={(event) => setEdge(event.target.value)}
                    disabled={running}
                  >
                    {EDGES.map((entry) => (
                      <option key={entry.value} value={entry.value}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                  <span className="ml-2 text-[11px] text-[var(--muted)]">质量</span>
                  <select
                    className="input h-7 w-[72px] text-[11.5px]"
                    value={quality}
                    onChange={(event) => setQuality(Number(event.target.value))}
                    disabled={running}
                  >
                    {[80, 85, 90, 95].map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="mt-3 flex items-center gap-2">
                <span className="w-[52px] text-[11px] text-[var(--muted)]">命名</span>
                <div className="flex rounded-md border border-[var(--border)] p-0.5">
                  {(
                    [
                      { id: 'original', label: '原名' },
                      { id: 'prefix', label: '前缀序号' }
                    ] as Array<{ id: FinalsNaming; label: string }>
                  ).map((entry) => (
                    <button
                      key={entry.id}
                      className={`h-6 rounded px-2 text-[11px] transition-colors ${
                        naming === entry.id
                          ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]'
                          : 'text-[var(--faint)] hover:text-[var(--text)]'
                      }`}
                      onClick={() => setNaming(entry.id)}
                      disabled={running}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
                {naming === 'prefix' && (
                  <input
                    className="input h-7 flex-1 text-[11.5px]"
                    value={prefix}
                    onChange={(event) => setPrefix(event.target.value)}
                    placeholder="例如：小林-街拍"
                    disabled={running}
                  />
                )}
              </div>
              {naming === 'prefix' && (
                <div className="mt-1 pl-[60px] text-[10px] text-[var(--faint)]">
                  输出如 {prefix.trim() || 'export'}-001.jpg
                </div>
              )}

              {mode === 'jpeg' && (
                <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-[var(--accent)]"
                      checked={watermarkOn}
                      onChange={(event) => setWatermarkOn(event.target.checked)}
                      disabled={running}
                    />
                    <span className="text-[11.5px] text-[var(--text)]">加水印</span>
                    <span className="ml-auto text-[10px] text-[var(--faint)]">烘焙进像素，去不掉</span>
                  </label>

                  {watermarkOn && (
                    <div className="mt-2 space-y-2">
                      <input
                        className="input h-7 w-full text-[11.5px]"
                        value={watermark}
                        onChange={(event) => setWatermark(event.target.value)}
                        placeholder="水印文字，例如：银月影像"
                        disabled={running}
                      />
                      <div className="flex items-center gap-2">
                        <span className="w-[36px] text-[10.5px] text-[var(--muted)]">位置</span>
                        <select
                          className="input h-7 flex-1 text-[11.5px]"
                          value={style.position}
                          onChange={(event) =>
                            patchStyle({
                              position: event.target.value as PickWatermarkStyle['position']
                            })
                          }
                          disabled={running}
                        >
                          {PICK_WATERMARK_POSITIONS.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                        <span className="text-[10.5px] text-[var(--muted)]">透明度</span>
                        <input
                          type="range"
                          min={20}
                          max={100}
                          step={5}
                          value={Math.round(style.opacity * 100)}
                          onChange={(event) =>
                            patchStyle({ opacity: Number(event.target.value) / 100 })
                          }
                          className="w-[86px] accent-[var(--accent)]"
                          disabled={running}
                        />
                        <span className="w-8 text-right text-[10.5px] tabular-nums text-[var(--faint)]">
                          {Math.round(style.opacity * 100)}%
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <p className="mt-3 text-[10.5px] leading-5 text-[var(--faint)]">
                导出到所选文件夹，同名文件不会覆盖，会自动加 -2、-3。
                {mode === 'jpeg' ? ' JPEG 会按上面的尺寸和质量重新编码。' : ''}
              </p>

              {running && (
                <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5">
                  <div className="flex items-center justify-between text-[11.5px] text-[var(--muted)]">
                    <span className="flex items-center gap-1.5">
                      <Loader2 size={12} className="animate-spin" />
                      正在导出
                    </span>
                    <span className="tabular-nums">
                      {progress ? `${progress.done}/${progress.total}` : '准备中…'}
                    </span>
                  </div>
                  <div className="mt-2 h-[4px] overflow-hidden rounded-full bg-[var(--panel-3)]">
                    <div
                      className="h-full bg-[var(--accent)] transition-[width] duration-200"
                      style={{
                        width: `${
                          progress && progress.total
                            ? Math.round((progress.done / progress.total) * 100)
                            : 0
                        }%`
                      }}
                    />
                  </div>
                  <div className="mt-1.5 truncate text-[10.5px] text-[var(--faint)]">
                    {progress?.current ?? '正在准备…'}
                  </div>
                </div>
              )}

              {error && (
                <div className="mt-3 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-soft)] px-3 py-2 text-[11.5px] leading-5 text-[var(--danger-text)]">
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-[var(--border)] px-4 py-2.5">
          <span className="text-[10.5px] text-[var(--faint)]">
            {result ? '要发给客户就直接开文件夹' : '导出过程中别关窗口'}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            {result ? (
              <>
                <button
                  className="btn h-7 px-2.5 text-[11.5px]"
                  onClick={() => void window.api.showInFolder(result.dir)}
                >
                  <FolderOpen size={12} /> 打开文件夹
                </button>
                <button className="btn h-7 px-2.5 text-[11.5px]" onClick={onClose}>
                  完成
                </button>
              </>
            ) : (
              <>
                <button
                  className="btn btn-ghost h-7 px-2.5 text-[11.5px]"
                  onClick={onClose}
                  disabled={running}
                >
                  取消
                </button>
                <button
                  className="btn h-7 px-2.5 text-[11.5px]"
                  disabled={
                    running ||
                    itemIds.length === 0 ||
                    (mode === 'jpeg' && watermarkOn && !watermark.trim()) ||
                    (naming === 'prefix' && !prefix.trim())
                  }
                  onClick={() => void run()}
                >
                  {running ? '导出中…' : '选择文件夹并导出'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
