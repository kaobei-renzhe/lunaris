import { useCallback, useEffect, useState } from 'react'
import { Copy, Trash2, X } from 'lucide-react'
import type { DuplicateGroup } from '@shared/types'
import { formatBytes, thumbUrl } from '../lib/format'

interface DuplicatesDialogProps {
  onClose: () => void
  onRemove: (ids: number[]) => Promise<void>
}

export default function DuplicatesDialog({ onClose, onRemove }: DuplicatesDialogProps) {
  const [groups, setGroups] = useState<DuplicateGroup[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setGroups(await window.api.findDuplicates())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const removeDuplicates = async (group: DuplicateGroup): Promise<void> => {
    await onRemove(group.items.slice(1).map((i) => i.id))
    await load()
  }

  const total = groups.reduce((sum, g) => sum + g.items.length - 1, 0)

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60" onClick={onClose}>
      <div
        className="w-[760px] max-h-[80vh] rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-[48px] shrink-0 px-4 flex items-center gap-2 border-b border-[var(--border)]">
          <Copy size={15} color="var(--accent-2)" />
          <span className="text-[13.5px] font-medium">重复图片</span>
          {!loading && (
            <span className="text-[11.5px] text-[var(--faint)]">
              {groups.length} 组 · 可清理 {total} 张
            </span>
          )}
          <button className="btn btn-ghost h-7 px-1.5 ml-auto" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading && <div className="py-16 text-center text-[12.5px] text-[var(--muted)]">正在比对…</div>}

          {!loading && groups.length === 0 && (
            <div className="py-16 text-center text-[12.5px] text-[var(--muted)]">
              没有发现重复或高度相似的图片
            </div>
          )}

          <div className="space-y-4">
            {groups.map((group) => (
              <div key={group.hash} className="rounded-lg border border-[var(--border)] p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[11.5px] text-[var(--muted)]">{group.items.length} 张相似</span>
                  <button
                    className="btn btn-ghost h-6 px-2 ml-auto text-[11.5px] btn-danger"
                    onClick={() => void removeDuplicates(group)}
                  >
                    <Trash2 size={12} /> 保留第一张，移除其余
                  </button>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {group.items.map((item, i) => (
                    <div key={item.id} className="w-[132px] shrink-0">
                      <div className="h-[96px] rounded-md overflow-hidden bg-[var(--panel-2)] grid place-items-center">
                        <img
                          src={thumbUrl(item.id)}
                          alt={item.name}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      </div>
                      <div className="mt-1 text-[10.5px] text-[var(--muted)] truncate" title={item.path}>
                        {i === 0 ? '保留 · ' : ''}
                        {item.name}
                      </div>
                      <div className="text-[10px] text-[var(--faint)]">{formatBytes(item.size)}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
