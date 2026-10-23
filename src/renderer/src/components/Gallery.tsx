import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from 'react'
import { ImagePlus, Sparkles } from 'lucide-react'
import type { Item } from '@shared/types'
import { RAW_EXT } from '@shared/formats'
import { thumbUrl } from '../lib/format'

const GAP = 12
const PAD = 14

interface GalleryProps {
  items: Item[]
  total: number
  selectedIds: number[]
  thumbSize: number
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  focusId: number | null
  expandedGroups: string[]
  hasFilter: boolean
  resetKey: string
  onSelect: (id: number, e: ReactMouseEvent) => void
  onOpen: (id: number) => void
  onExpandGroup: (key: string) => void
  onLoadMore: () => void
  onImportFiles: () => void
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

const Card = memo(function Card({
  item,
  box,
  small,
  selected,
  expanded,
  onSelect,
  onOpen,
  onDragStart,
  onExpandGroup
}: {
  item: Item
  box: Box
  small: boolean
  selected: boolean
  expanded: boolean
  onSelect: (id: number, e: ReactMouseEvent) => void
  onOpen: (id: number) => void
  onDragStart: (id: number, e: ReactDragEvent) => void
  onExpandGroup: (key: string) => void
}) {
  return (
    <div
      className={`card-thumb group ${selected ? 'selected' : ''}`}
      style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h }}
      draggable
      onDragStart={(e) => onDragStart(item.id, e)}
      onClick={(e) => onSelect(item.id, e)}
      onDoubleClick={() => onOpen(item.id)}
    >
      <img
        src={thumbUrl(item.id, small)}
        alt={item.name}
        loading="lazy"
        decoding="async"
        draggable={false}
        style={item.missing ? { opacity: 0.5, filter: 'grayscale(0.6)' } : undefined}
      />
      <div
        className="absolute inset-x-0 bottom-0 h-[42%] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
        style={{ background: 'linear-gradient(to top, rgba(5,7,10,0.72), rgba(5,7,10,0))' }}
      />
      <div className="absolute bottom-1.5 left-2 right-2 text-[11px] text-white/90 truncate opacity-0 group-hover:opacity-100 pointer-events-none">
        {item.name}
      </div>
      {item.flag !== 0 && (
        <span
          className="absolute top-1.5 right-2 text-[11px] font-semibold px-1 rounded"
          style={{
            color: item.flag > 0 ? '#8be9a8' : '#ff9aa2',
            background: 'rgba(0,0,0,0.45)'
          }}
        >
          {item.flag > 0 ? '✓' : '✕'}
        </span>
      )}
      {item.rating > 0 && (
        <div
          className="absolute right-2 text-[10.5px] text-amber-300 drop-shadow"
          style={{ top: item.flag !== 0 ? 26 : 6 }}
        >
          {'★'.repeat(item.rating)}
        </div>
      )}
      {item.tags.length > 0 && (
        <div className="absolute top-2 left-2 flex gap-1 pointer-events-none">
          {item.tags.slice(0, 4).map((t) => (
            <span
              key={t.id}
              className="w-[7px] h-[7px] rounded-full ring-1 ring-black/30"
              style={{ background: t.color }}
            />
          ))}
        </div>
      )}
      <div className="absolute bottom-1.5 right-2 flex items-center gap-1 pointer-events-none">
        {item.missing === 1 && (
          <span className="px-1 py-[1px] rounded bg-[#7a2b2f] text-[9px] tracking-wide text-[#ffd7da]">
            丢失
          </span>
        )}
        {item.groupCount > 1 && item.groupKey && (
          <button
            className="px-1 py-[1px] rounded bg-black/70 text-[9px] tracking-wide text-[#cfe0ff] hover:bg-black/90 pointer-events-auto"
            onClick={(e) => {
              e.stopPropagation()
              onExpandGroup(item.groupKey as string)
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            title={expanded ? '收起这一组' : '展开这一组'}
          >
            ×{item.groupCount} {expanded ? '收起' : '展开'}
          </button>
        )}
        {item.pairCount > 1 && (
          <span className="px-1 py-[1px] rounded bg-black/60 text-[9px] tracking-wide text-[#cfe0ff]">
            ＋{item.pairCount - 1}
          </span>
        )}
        {RAW_EXT.has(item.ext) && (
          <span className="px-1 py-[1px] rounded bg-black/55 text-[9px] tracking-wider text-white/75">
            RAW
          </span>
        )}
      </div>
    </div>
  )
})

export default function Gallery({
  items,
  total,
  selectedIds,
  thumbSize,
  loading,
  loadingMore,
  hasMore,
  focusId,
  expandedGroups,
  hasFilter,
  resetKey,
  onSelect,
  onOpen,
  onExpandGroup,
  onLoadMore,
  onImportFiles
}: GalleryProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [scrollTop, setScrollTop] = useState(0)

  // 空状态时不会渲染滚动容器，因此有数据后需要重新绑定观察器
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = (): void => setViewport({ width: el.clientWidth, height: el.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [items.length])

  // 换筛选/排序/搜索时回到顶部，避免停在空白区
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.scrollTop = 0
    setScrollTop(0)
  }, [resetKey])

  const { boxes, totalHeight } = useMemo(() => {
    const usable = Math.max(120, viewport.width - PAD * 2)
    const columns = Math.max(1, Math.floor((usable + GAP) / (thumbSize + GAP)))
    const colWidth = (usable - GAP * (columns - 1)) / columns
    const heights = new Array<number>(columns).fill(0)
    const result: Box[] = []

    for (const item of items) {
      let target = 0
      for (let i = 1; i < columns; i++) if (heights[i] < heights[target]) target = i
      const rawRatio = item.width > 0 && item.height > 0 ? item.height / item.width : 1
      const ratio = Math.min(2.4, Math.max(0.4, rawRatio))
      const h = Math.round(colWidth * ratio)
      result.push({ x: PAD + target * (colWidth + GAP), y: heights[target], w: colWidth, h })
      heights[target] += h + GAP
    }
    return { boxes: result, totalHeight: Math.max(0, ...heights) }
  }, [items, thumbSize, viewport.width])

  const visible = useMemo(() => {
    const top = scrollTop - 700
    const bottom = scrollTop + (viewport.height || 800) + 700
    const out: Array<{ item: Item; box: Box }> = []
    for (let i = 0; i < items.length; i++) {
      const box = boxes[i]
      if (!box) continue
      if (box.y + box.h >= top && box.y <= bottom) out.push({ item: items[i], box })
    }
    return out
  }, [items, boxes, scrollTop, viewport.height])

  const onScroll = (): void => {
    const el = containerRef.current
    if (!el) return
    setScrollTop(el.scrollTop)
    if (hasMore && !loadingMore && el.scrollTop + el.clientHeight > totalHeight - 700) {
      onLoadMore()
    }
  }

  // 触底加载：用哨兵元素 + IntersectionObserver，后台窗口也可靠
  useEffect(() => {
    if (!hasMore || loadingMore) return
    const root = containerRef.current
    const sentinel = sentinelRef.current
    if (!root || !sentinel) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onLoadMore()
      },
      { root, rootMargin: '600px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, loadingMore, onLoadMore, items.length])

  // 键盘 J/K 切换时把当前项滚进视野
  useEffect(() => {
    if (!focusId) return
    const index = items.findIndex((i) => i.id === focusId)
    const box = boxes[index]
    const el = containerRef.current
    if (!box || !el) return
    const top = box.y
    const bottom = box.y + box.h
    if (top < el.scrollTop + 40 || bottom > el.scrollTop + el.clientHeight - 40) {
      el.scrollTo({ top: Math.max(0, top - el.clientHeight / 2 + box.h / 2), behavior: 'smooth' })
    }
  }, [focusId, items, boxes])

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])

  const handleDragStart = (id: number, e: ReactDragEvent): void => {
    // Alt + 拖拽交给系统原生拖拽，可以直接拖进资源管理器或其它应用
    if (e.altKey) {
      e.preventDefault()
      window.api.startDrag(id)
      return
    }
    const ids = selectedSet.has(id) ? selectedIds : [id]
    e.dataTransfer.setData('application/x-imagenest-items', JSON.stringify(ids))
    e.dataTransfer.effectAllowed = 'copyMove'
  }

  if (items.length === 0 && !loading) {
    return (
      <div className="flex-1 grid place-items-center">
        <div className="text-center max-w-[360px]">
          <div className="mx-auto mb-4 w-12 h-12 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] grid place-items-center">
            {hasFilter ? (
              <Sparkles size={20} color="var(--muted)" />
            ) : (
              <ImagePlus size={20} color="var(--muted)" />
            )}
          </div>
          <div className="text-[14px] text-[var(--text)]">
            {hasFilter ? '没有符合筛选条件的图片' : '图库还是空的'}
          </div>
          <div className="text-[12px] text-[var(--muted)] mt-1.5 leading-5">
            {hasFilter ? '换个关键词，或清空筛选再找找看' : '把图片或文件夹拖进窗口，也可以点击下面的按钮'}
          </div>
          {!hasFilter && (
            <button className="btn btn-primary mt-5" onClick={onImportFiles}>
              选择图片导入
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto relative" onScroll={onScroll}>
      <div style={{ height: totalHeight + PAD, position: 'relative' }}>
        {visible.map(({ item, box }) => (
          <Card
            key={item.id}
            item={item}
            box={box}
            small={thumbSize <= 260}
            selected={selectedSet.has(item.id)}
            expanded={!!item.groupKey && expandedGroups.includes(item.groupKey)}
            onSelect={onSelect}
            onOpen={onOpen}
            onDragStart={handleDragStart}
            onExpandGroup={onExpandGroup}
          />
        ))}
      </div>
      {(hasMore || loadingMore) && (
        <div className="py-6 text-center text-[11.5px] text-[var(--faint)]">
          {loadingMore ? '正在加载更多…' : `已加载 ${items.length} / ${total} 张，继续下滑加载`}
        </div>
      )}
      <div ref={sentinelRef} style={{ height: 1 }} />
    </div>
  )
}
