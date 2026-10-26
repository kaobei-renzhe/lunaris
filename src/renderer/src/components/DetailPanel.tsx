import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Copy, FolderPlus, Gauge, Plus, ScanSearch, Sparkles, Star, X } from 'lucide-react'
import type { Folder, Item, Tag } from '@shared/types'
import { formatBytes, formatDate, scoreColor, thumbUrl } from '../lib/format'

interface DetailPanelProps {
  item: Item
  tags: Tag[]
  folders: Folder[]
  onClose: () => void
  onRefresh: () => void
  onOpenLightbox: () => void
  onPushUndo: (label: string, run: () => Promise<void>, showToast?: boolean) => void
  onUnstack: (stackId: number) => void
  onFindSimilar: () => void
  onAdvice: () => void
  onScore: () => void
  aiScoring: boolean
  /** 大模型总开关是否就绪；没就绪时相册里不出现任何 AI 入口 */
  aiReady: boolean
  /** 能力级开关：只有总开关就绪且该能力开启时才渲染入口 */
  canScore: boolean
  canAdvice: boolean
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-4">
      <div className="text-[10.5px] uppercase tracking-wider text-[var(--faint)] mb-1.5">{title}</div>
      {children}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 text-[11.5px] leading-5">
      <span className="w-[52px] shrink-0 text-[var(--faint)]">{label}</span>
      <span className="text-[var(--text)] break-all">{value}</span>
    </div>
  )
}

export default function DetailPanel({
  item,
  tags,
  folders,
  onClose,
  onRefresh,
  onOpenLightbox,
  onPushUndo,
  onUnstack,
  onFindSimilar,
  onAdvice,
  onScore,
  aiScoring,
  aiReady,
  canScore,
  canAdvice
}: DetailPanelProps) {
  const [tagInput, setTagInput] = useState('')
  const [note, setNote] = useState(item.note)

  useEffect(() => {
    setNote(item.note)
    setTagInput('')
  }, [item.id, item.note])

  const setRating = async (value: number): Promise<void> => {
    const next = item.rating === value ? 0 : value
    const previous = item.rating
    await window.api.updateItem(item.id, { rating: next })
    onPushUndo(
      `评分改为 ${next} 星`,
      async () => {
        await window.api.updateItem(item.id, { rating: previous })
      },
      false
    )
    onRefresh()
  }

  const setFlag = async (flag: number): Promise<void> => {
    const previous = item.flag
    await window.api.updateItem(item.id, { flag })
    onPushUndo(
      `旗标：${flag > 0 ? '留用' : flag < 0 ? '淘汰' : '清除'}`,
      async () => {
        await window.api.updateItem(item.id, { flag: previous })
      },
      false
    )
    onRefresh()
  }

  const attachTag = async (tagId: number, tagName: string): Promise<void> => {
    await window.api.setTag([item.id], tagId, true)
    onPushUndo(
      `添加标签「${tagName}」`,
      async () => {
        await window.api.setTag([item.id], tagId, false)
      },
      false
    )
    onRefresh()
  }

  const removeTag = async (tagId: number, tagName: string): Promise<void> => {
    await window.api.setTag([item.id], tagId, false)
    onPushUndo(
      `移除标签「${tagName}」`,
      async () => {
        await window.api.setTag([item.id], tagId, true)
      },
      false
    )
    onRefresh()
  }

  const commitTag = async (): Promise<void> => {
    const name = tagInput.trim()
    if (!name) return
    const existing = tags.find((t) => t.name.toLowerCase() === name.toLowerCase())
    const tag = existing ?? (await window.api.createTag(name))
    await attachTag(tag.id, tag.name)
    setTagInput('')
  }

  const saveNote = async (): Promise<void> => {
    if (note === item.note) return
    await window.api.updateItem(item.id, { note })
    onRefresh()
  }

  const addFolder = async (folderId: number): Promise<void> => {
    if (!folderId) return
    await window.api.addToFolder([item.id], folderId)
    onPushUndo(
      `加入「${folders.find((f) => f.id === folderId)?.name ?? ''}」`,
      async () => {
        await window.api.removeFromFolder([item.id], folderId)
      },
      false
    )
    onRefresh()
  }

  return (
    <aside
      className="shrink-0 border-l border-[var(--border)] bg-[var(--panel)] flex flex-col min-h-0 overflow-x-hidden"
      style={{ width: 'var(--detail-w, 320px)' }}
    >
      <div className="h-[42px] shrink-0 px-3 border-b border-[var(--border)] flex items-center gap-2">
        <div className="truncate text-[12.5px] font-medium" title={item.name}>
          {item.name}
        </div>
        <button className="btn btn-ghost h-6 px-1.5 ml-auto" onClick={onClose} title="关闭">
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <div
          className="rounded-xl overflow-hidden border border-[var(--border)] cursor-zoom-in mx-auto w-fit max-w-full"
          onClick={onOpenLightbox}
          title="点击查看大图"
        >
          <img
            src={thumbUrl(item.id)}
            alt={item.name}
            className="block max-h-[340px] max-w-full object-contain"
            draggable={false}
          />
        </div>

        {item.missing === 1 && (
          <div className="mt-2 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-soft)] px-2.5 py-2 text-[11px] leading-4 text-[var(--danger-text)]">
            原文件已丢失，这里显示的是缓存缩略图。可以在侧栏「重新定位」里选个新文件夹把它接回来。
          </div>
        )}

        {item.error && (
          <div className="mt-2 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-soft)] px-2.5 py-2 text-[11px] leading-4 text-[var(--danger-text)]">
            导入失败：{item.error}
            <div className="mt-1 text-[10.5px] opacity-80">
              文件可能损坏或格式暂不支持；修复后重新导入同一目录即可。
            </div>
          </div>
        )}

        <div className="mt-2.5 flex items-center gap-1">
          <div className="stars">
            {[1, 2, 3, 4, 5].map((n) => (
              <Star
                key={n}
                size={15}
                onClick={() => void setRating(n)}
                fill={item.rating >= n ? 'var(--star)' : 'transparent'}
                color={item.rating >= n ? 'var(--star)' : 'var(--faint)'}
                strokeWidth={1.6}
              />
            ))}
          </div>
          <span className="ml-auto text-[11px] text-[var(--faint)]">
            {item.width} × {item.height}
          </span>
        </div>

        <div className="mt-2 flex items-center gap-1.5">
          <button
            className={`btn h-6 px-2 text-[11px] ${item.flag > 0 ? 'border-[var(--success-border)] text-[var(--success)]' : ''}`}
            onClick={() => void setFlag(1)}
            title="留用（P）"
          >
            ✓ 留用
          </button>
          <button
            className={`btn h-6 px-2 text-[11px] ${item.flag < 0 ? 'border-[var(--danger-border)] text-[var(--danger-text)]' : ''}`}
            onClick={() => void setFlag(-1)}
            title="淘汰（X）"
          >
            ✕ 淘汰
          </button>
          {item.flag !== 0 && (
            <button className="btn btn-ghost h-6 px-1.5 text-[11px]" onClick={() => void setFlag(0)} title="清除（U）">
              清除
            </button>
          )}
          <button
            className="btn btn-ghost h-6 px-2 text-[11px] ml-auto"
            onClick={onFindSimilar}
            title="以图搜图：找出画面相近的图片"
          >
            <ScanSearch size={12} /> 找相似
          </button>
        </div>

        {aiReady && (canScore || canAdvice) && (
          <div className={`mt-1.5 grid gap-1.5 ${canScore && canAdvice ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {canScore && (
              <button
                className="btn h-7 px-2 text-[11.5px]"
                onClick={onScore}
                disabled={aiScoring}
                title="用大模型评估构图、曝光、色彩、清晰度，结果存进图库（会消耗 token）"
              >
                <Gauge size={12} color="var(--accent-2)" />
                {aiScoring ? '评分中…' : item.quality ? '重新评分' : 'AI 评分'}
              </button>
            )}
            {canAdvice && (
              <button
                className="btn h-7 px-2 text-[11.5px]"
                onClick={onAdvice}
                title="让大模型给出修图方向、参数调整与风格参考（会消耗 token）"
              >
                <Sparkles size={12} color="var(--accent-2)" /> AI 后期建议
              </button>
            )}
          </div>
        )}

        <Section title="标签">
          <div className="flex flex-wrap gap-1.5">
            {item.tags.map((tag) => (
              <span
                key={tag.id}
                className="inline-flex items-center gap-1 h-[22px] pl-1.5 pr-1 rounded-md bg-[var(--panel-2)] border border-[var(--border)] text-[11.5px]"
              >
                <span className="tag-dot" style={{ background: tag.color }} />
                {tag.name}
                <button
                  className="text-[var(--faint)] hover:text-[var(--danger)]"
                  onClick={() => void removeTag(tag.id, tag.name)}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
          <div className="flex items-center gap-1 mt-1.5">
            <input
              className="input flex-1 h-7 text-[12px]"
              placeholder="输入标签名，回车添加"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitTag()
              }}
              list="tag-suggestions"
            />
            <datalist id="tag-suggestions">
              {tags.map((t) => (
                <option key={t.id} value={t.name} />
              ))}
            </datalist>
            <button className="btn h-7 px-2" onClick={() => void commitTag()}>
              <Plus size={12} />
            </button>
          </div>
        </Section>

        <Section title="文件夹">
          <div className="flex flex-wrap gap-1.5">
            {item.folderIds.map((id) => {
              const folder = folders.find((f) => f.id === id)
              if (!folder) return null
              return (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 h-[22px] px-1.5 rounded-md bg-[var(--panel-2)] border border-[var(--border)] text-[11.5px]"
                >
                  {folder.name}
                  <button
                    className="text-[var(--faint)] hover:text-[var(--danger)]"
                    onClick={async () => {
                      await window.api.removeFromFolder([item.id], id)
                      onPushUndo(
                        `移出「${folder.name}」`,
                        async () => {
                          await window.api.addToFolder([item.id], id)
                        },
                        false
                      )
                      onRefresh()
                    }}
                  >
                    <X size={10} />
                  </button>
                </span>
              )
            })}
            {folders.length > 0 && (
              <label className="inline-flex items-center gap-1 h-[22px] px-1.5 rounded-md border border-dashed border-[var(--border-strong)] text-[11.5px] text-[var(--muted)] cursor-pointer">
                <FolderPlus size={11} />
                <select
                  className="bg-transparent border-0 outline-none text-[11.5px] text-[var(--muted)] cursor-pointer"
                  value=""
                  onChange={(e) => void addFolder(Number(e.target.value))}
                >
                  <option value="">加入</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </Section>

        <Section title="文件信息">
          <Row label="格式" value={item.ext.replace('.', '').toUpperCase()} />
          <Row label="大小" value={formatBytes(item.size)} />
          <Row label="拍摄" value={formatDate(item.mtime)} />
          <Row label="导入" value={formatDate(item.addedAt)} />
        </Section>

        {item.quality && (
          <Section title="AI 评分">
            <div className="flex items-baseline gap-1.5">
              <span
                className="text-[22px] font-semibold leading-none tabular-nums"
                style={{ color: scoreColor(item.quality.overall) }}
              >
                {item.quality.overall}
              </span>
              <span className="text-[10.5px] text-[var(--faint)]">/ 100</span>
              {aiReady && canScore && (
                <button
                  className="ml-auto text-[10.5px] text-[var(--faint)] hover:text-[var(--text)]"
                  onClick={onScore}
                  disabled={aiScoring}
                  title="重新调用一次评分（会消耗 token）"
                >
                  重评
                </button>
              )}
            </div>
            <div className="mt-2 space-y-1.5">
              {(
                [
                  ['构图', item.quality.composition],
                  ['曝光', item.quality.exposure],
                  ['色彩', item.quality.color],
                  ['清晰度', item.quality.sharpness]
                ] as Array<[string, number]>
              ).map(([label, value]) => (
                <div key={label} className="flex items-center gap-2">
                  <span className="w-[42px] shrink-0 text-[10.5px] text-[var(--faint)]">{label}</span>
                  <span className="h-[4px] flex-1 rounded-full bg-[var(--panel-2)] overflow-hidden">
                    <span
                      className="block h-full rounded-full"
                      style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: scoreColor(value) }}
                    />
                  </span>
                  <span className="w-[22px] shrink-0 text-right text-[10.5px] tabular-nums text-[var(--muted)]">
                    {value}
                  </span>
                </div>
              ))}
            </div>
            {item.quality.comment && (
              <div className="mt-2 text-[11px] leading-4 text-[var(--muted)]">
                {item.quality.comment}
              </div>
            )}
            <div className="mt-1.5 text-[10px] text-[var(--faint)] leading-4">
              {item.quality.model || '未知模型'} · {formatDate(item.quality.updatedAt)}
            </div>
          </Section>
        )}

        {(item.pairCount > 1 || item.burstCount > 1 || item.stackCount > 1) && (
          <Section title="分组">
            {item.stackCount > 1 && item.stackId && (
              <div className="flex items-center gap-2 text-[11.5px] leading-5">
                <span className="w-[52px] shrink-0 text-[var(--faint)]">堆叠</span>
                <span className="text-[var(--text)]">手动堆叠 · {item.stackCount} 张</span>
                <button
                  className="btn h-5 px-1.5 text-[10.5px] ml-auto"
                  onClick={() => onUnstack(item.stackId as number)}
                >
                  拆开
                </button>
              </div>
            )}
            {item.pairCount > 1 && <Row label="配对" value={`RAW + JPEG，共 ${item.pairCount} 个文件`} />}
            {item.burstCount > 1 && (
              <Row label="连拍" value={`${item.burstCount} 张（点角标 ×N 展开）`} />
            )}
          </Section>
        )}

        {item.exif && Object.values(item.exif).some(Boolean) && (
          <Section title="拍摄参数">
            {item.exif.camera && <Row label="机身" value={item.exif.camera} />}
            {item.exif.lens && <Row label="镜头" value={item.exif.lens} />}
            {item.exif.focal && <Row label="焦段" value={item.exif.focal} />}
            {item.exif.aperture && <Row label="光圈" value={item.exif.aperture} />}
            {item.exif.shutter && <Row label="快门" value={item.exif.shutter} />}
            {item.exif.iso && <Row label="ISO" value={String(item.exif.iso)} />}
          </Section>
        )}

        {item.palette.length > 0 && (
          <Section title="主色">
            <div className="flex gap-1.5">
              {item.palette.map((hex) => (
                <button
                  key={hex}
                  className="h-[26px] flex-1 rounded-md border border-[var(--border)]"
                  style={{ background: hex }}
                  title={`${hex}（点击复制）`}
                  onClick={() => void navigator.clipboard.writeText(hex)}
                />
              ))}
            </div>
          </Section>
        )}

        <Section title="备注">
          <textarea
            className="input w-full h-[64px] py-1.5 resize-none leading-5"
            placeholder="写点备注…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => void saveNote()}
          />
        </Section>

        <Section title="位置">
          <div className="text-[11px] text-[var(--muted)] break-all leading-4">{item.path}</div>
          <div className="flex gap-1.5 mt-1.5">
            <button
              className="btn h-7 px-2 text-[11.5px]"
              onClick={() => void window.api.copyImage(item.id)}
              title="把图片复制到剪贴板（Ctrl+C）"
            >
              <Copy size={12} /> 复制图片
            </button>
            <button
              className="btn h-7 px-2 text-[11.5px]"
              onClick={() => void window.api.showInFolder(item.path)}
            >
              在资源管理器中显示
            </button>
          </div>
          <div className="mt-1.5 text-[10.5px] text-[var(--faint)] leading-4">
            提示：按住 Alt 拖拽卡片，可以直接拖到资源管理器或其它应用
          </div>
        </Section>
      </div>
    </aside>
  )
}
