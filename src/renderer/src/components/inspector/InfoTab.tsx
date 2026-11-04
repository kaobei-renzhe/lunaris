import { useEffect, useState } from 'react'
import { BookOpen, ChevronRight, Copy, FolderPlus, Plus, ScanSearch, Star, X } from 'lucide-react'
import type { Folder, Item, Tag } from '@shared/types'
import { formatBytes, formatDate, thumbUrl } from '../../lib/format'
import { Row, Section, type PushUndo } from './ui'

export interface InfoTabProps {
  item: Item
  tags: Tag[]
  folders: Folder[]
  compact?: boolean
  showPreview?: boolean
  onRefresh: () => void
  onPushUndo: PushUndo
  onOpenLightbox?: () => void
  onFindSimilar?: () => void
  onUnstack?: (stackId: number) => void
  /** 切到研读 Tab；不传就不显示笔记数入口 */
  onOpenStudy?: () => void
}

export default function InfoTab({
  item,
  tags,
  folders,
  compact,
  showPreview = true,
  onRefresh,
  onPushUndo,
  onOpenLightbox,
  onFindSimilar,
  onUnstack,
  onOpenStudy
}: InfoTabProps) {
  const [tagInput, setTagInput] = useState('')
  const [note, setNote] = useState(item.note)
  const [noteCount, setNoteCount] = useState(0)

  useEffect(() => {
    setNote(item.note)
    setTagInput('')
  }, [item.id, item.note])

  // 笔记数只在进这个 Tab 时取一次，不塞进全局 stats
  useEffect(() => {
    let cancelled = false
    void window.api.notes
      .count(item.id)
      .then((count) => {
        if (!cancelled) setNoteCount(count)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [item.id])

  const toggleReference = async (): Promise<void> => {
    await window.api.notes.setReference(item.id, item.reference !== 1)
    onRefresh()
  }

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
    const existing = tags.find((tag) => tag.name.toLowerCase() === name.toLowerCase())
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
      `加入「${folders.find((folder) => folder.id === folderId)?.name ?? ''}」`,
      async () => {
        await window.api.removeFromFolder([item.id], folderId)
      },
      false
    )
    onRefresh()
  }

  return (
    <div className={compact ? 'p-2.5' : 'p-3'}>
      {showPreview && (
        <div
          className={`mx-auto w-fit max-w-full overflow-hidden rounded-xl border border-[var(--border)] ${
            onOpenLightbox ? 'cursor-zoom-in' : ''
          }`}
          onClick={onOpenLightbox}
          title={onOpenLightbox ? '点击查看大图' : undefined}
        >
          <img
            src={thumbUrl(item.id)}
            alt={item.name}
            className="block max-h-[340px] max-w-full object-contain"
            draggable={false}
          />
        </div>
      )}

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

      <label className="mt-2.5 flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2.5 py-1.5">
        <input
          type="checkbox"
          className="h-3.5 w-3.5 accent-[var(--accent)]"
          checked={item.reference === 1}
          onChange={() => void toggleReference()}
        />
        <span className="text-[11.5px] text-[var(--text)]">这是参考片</span>
        <span className="ml-auto text-[10px] text-[var(--faint)]">研读别人怎么拍</span>
      </label>

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
          className={`btn h-6 px-2 text-[11px] ${
            item.flag > 0 ? 'border-[var(--success-border)] text-[var(--success)]' : ''
          }`}
          onClick={() => void setFlag(1)}
          title="留用（P）"
        >
          ✓ 留用
        </button>
        <button
          className={`btn h-6 px-2 text-[11px] ${
            item.flag < 0 ? 'border-[var(--danger-border)] text-[var(--danger-text)]' : ''
          }`}
          onClick={() => void setFlag(-1)}
          title="淘汰（X）"
        >
          ✕ 淘汰
        </button>
        {item.flag !== 0 && (
          <button
            className="btn btn-ghost h-6 px-1.5 text-[11px]"
            onClick={() => void setFlag(0)}
            title="清除（U）"
          >
            清除
          </button>
        )}
        {onFindSimilar && (
          <button
            className="btn btn-ghost ml-auto h-6 px-2 text-[11px]"
            onClick={onFindSimilar}
            title="以图搜图：找出画面相近的图片"
          >
            <ScanSearch size={12} /> 找相似
          </button>
        )}
      </div>

      <Section title="标签" compact={compact}>
        <div className="flex flex-wrap gap-1.5">
          {item.tags.map((tag) => (
            <span
              key={tag.id}
              className="inline-flex h-[22px] items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--panel-2)] pl-1.5 pr-1 text-[11.5px]"
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
        <div className="mt-1.5 flex items-center gap-1">
          <input
            className="input h-7 flex-1 text-[12px]"
            placeholder="输入标签名，回车添加"
            value={tagInput}
            onChange={(event) => setTagInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void commitTag()
            }}
            list="tag-suggestions"
          />
          <datalist id="tag-suggestions">
            {tags.map((tag) => (
              <option key={tag.id} value={tag.name} />
            ))}
          </datalist>
          <button className="btn h-7 px-2" onClick={() => void commitTag()}>
            <Plus size={12} />
          </button>
        </div>
      </Section>

      <Section title="文件夹" compact={compact}>
        <div className="flex flex-wrap gap-1.5">
          {item.folderIds.map((id) => {
            const folder = folders.find((entry) => entry.id === id)
            if (!folder) return null
            return (
              <span
                key={id}
                className="inline-flex h-[22px] items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-1.5 text-[11.5px]"
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
            <label className="inline-flex h-[22px] cursor-pointer items-center gap-1 rounded-md border border-dashed border-[var(--border-strong)] px-1.5 text-[11.5px] text-[var(--muted)]">
              <FolderPlus size={11} />
              <select
                className="cursor-pointer border-0 bg-transparent text-[11.5px] text-[var(--muted)] outline-none"
                value=""
                onChange={(event) => void addFolder(Number(event.target.value))}
              >
                <option value="">加入</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </Section>

      <Section title="文件信息" compact={compact}>
        <Row label="格式" value={item.ext.replace('.', '').toUpperCase()} />
        <Row label="大小" value={formatBytes(item.size)} />
        <Row label="拍摄" value={formatDate(item.mtime)} />
        <Row label="导入" value={formatDate(item.addedAt)} />
      </Section>

      {(item.pairCount > 1 || item.burstCount > 1 || item.stackCount > 1) && (
        <Section title="分组" compact={compact}>
          {item.stackCount > 1 && item.stackId && (
            <div className="flex items-center gap-2 text-[11.5px] leading-5">
              <span className="w-[52px] shrink-0 text-[var(--faint)]">堆叠</span>
              <span className="text-[var(--text)]">手动堆叠 · {item.stackCount} 张</span>
              {onUnstack && (
                <button
                  className="btn ml-auto h-5 px-1.5 text-[10.5px]"
                  onClick={() => onUnstack(item.stackId as number)}
                >
                  拆开
                </button>
              )}
            </div>
          )}
          {item.pairCount > 1 && (
            <Row label="配对" value={`RAW + JPEG，共 ${item.pairCount} 个文件`} />
          )}
          {item.burstCount > 1 && (
            <Row label="连拍" value={`${item.burstCount} 张（点角标 ×N 展开）`} />
          )}
        </Section>
      )}

      {item.exif && Object.values(item.exif).some(Boolean) && (
        <Section title="拍摄参数" compact={compact}>
          {item.exif.camera && <Row label="机身" value={item.exif.camera} />}
          {item.exif.lens && <Row label="镜头" value={item.exif.lens} />}
          {item.exif.focal && <Row label="焦段" value={item.exif.focal} />}
          {item.exif.aperture && <Row label="光圈" value={item.exif.aperture} />}
          {item.exif.shutter && <Row label="快门" value={item.exif.shutter} />}
          {item.exif.iso && <Row label="ISO" value={String(item.exif.iso)} />}
        </Section>
      )}

      {item.palette.length > 0 && (
        <Section title="主色" compact={compact}>
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

      <Section title="备注 · 用途" compact={compact}>
        <textarea
          className="input h-[64px] w-full resize-none py-1.5 leading-5"
          placeholder="客户要求、这张给谁用、拍摄备忘…"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          onBlur={() => void saveNote()}
        />
      </Section>

      <Section title="位置" compact={compact}>
        <div className="break-all text-[11px] leading-4 text-[var(--muted)]">{item.path}</div>
        <div className="mt-1.5 flex gap-1.5">
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
        <div className="mt-1.5 text-[10.5px] leading-4 text-[var(--faint)]">
          提示：按住 Alt 拖拽卡片，可以直接拖到资源管理器或其它应用
        </div>
      </Section>

      {onOpenStudy && (
        <button
          className="mt-3 flex w-full items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2.5 py-2 text-[11.5px] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--text)]"
          onClick={onOpenStudy}
          title="切到研读 Tab"
        >
          <BookOpen size={12} />
          研读笔记 · {noteCount} 条
          <ChevronRight size={12} className="ml-auto" />
        </button>
      )}
    </div>
  )
}
