import { useEffect } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import type { Item } from '@shared/types'
import { photoUrl } from '../lib/format'

interface LightboxProps {
  items: Item[]
  index: number
  onClose: () => void
  onNavigate: (index: number) => void
}

export default function Lightbox({ items, index, onClose, onNavigate }: LightboxProps) {
  const item = items[index]

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowLeft' && index > 0) onNavigate(index - 1)
      if (e.key === 'ArrowRight' && index < items.length - 1) onNavigate(index + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, items.length, onNavigate])

  if (!item) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[rgba(5,7,10,0.94)]">
      <div className="h-[46px] shrink-0 px-4 flex items-center gap-3 text-[12.5px]">
        <span className="truncate text-[var(--text)]">{item.name}</span>
        <span className="text-[var(--faint)] tabular-nums">
          {index + 1} / {items.length}
        </span>
        <button className="btn btn-ghost h-7 px-2 ml-auto" onClick={onClose} title="关闭 (Esc)">
          <X size={15} />
        </button>
      </div>

      <div className="flex-1 min-h-0 relative flex items-center justify-center px-14 pb-8">
        <img
          src={photoUrl(item.id)}
          alt={item.name}
          className="max-w-full max-h-full object-contain select-none"
          draggable={false}
        />
        {index > 0 && (
          <button
            className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/8 hover:bg-white/16 grid place-items-center text-white/80"
            onClick={() => onNavigate(index - 1)}
            title="上一张"
          >
            <ChevronLeft size={20} />
          </button>
        )}
        {index < items.length - 1 && (
          <button
            className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/8 hover:bg-white/16 grid place-items-center text-white/80"
            onClick={() => onNavigate(index + 1)}
            title="下一张"
          >
            <ChevronRight size={20} />
          </button>
        )}
      </div>

      <div className="h-[34px] shrink-0 px-4 flex items-center gap-3 text-[11px] text-[var(--faint)] border-t border-white/8">
        <span>
          {item.width} × {item.height}
        </span>
        {item.exif?.camera && <span>{item.exif.camera}</span>}
        {item.exif?.lens && <span className="truncate max-w-[280px]">{item.exif.lens}</span>}
        {item.exif?.aperture && <span>{item.exif.aperture}</span>}
        {item.exif?.shutter && <span>{item.exif.shutter}</span>}
        {item.exif?.iso && <span>ISO {item.exif.iso}</span>}
        <span className="ml-auto">← → 切换 · Esc 关闭</span>
      </div>
    </div>
  )
}
