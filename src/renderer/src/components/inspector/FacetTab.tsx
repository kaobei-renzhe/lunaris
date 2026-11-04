import { Plus, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { Facet, FacetValue, Item } from '@shared/types'

export interface FacetTabProps {
  item: Item
  compact?: boolean
  /** 人像工作台多选时批量作用到这些照片 */
  targetIds?: number[]
  /** 宿主自己处理批量逻辑；不传就只作用在当前照片 */
  onApplyValue?: (facet: Facet, value: FacetValue, add: boolean) => Promise<void>
  onChanged?: () => void
}

function assignedValues(facet: Facet, item: Item): FacetValue[] {
  return facet.values.filter((value) => item.tags.some((tag) => tag.id === value.id))
}

export default function FacetTab({
  item,
  compact,
  targetIds,
  onApplyValue,
  onChanged
}: FacetTabProps) {
  const [facets, setFacets] = useState<Facet[]>([])
  const [openPicker, setOpenPicker] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const targets = targetIds?.length ? targetIds : [item.id]

  const loadFacets = useCallback(async (): Promise<void> => {
    setFacets(await window.api.listFacets())
  }, [])

  useEffect(() => {
    void loadFacets().catch((error) => setMessage(`读取维度失败：${(error as Error).message}`))
  }, [loadFacets])

  const applyValue = async (
    facet: Facet,
    value: FacetValue,
    add: boolean
  ): Promise<void> => {
    setMessage('')
    try {
      if (onApplyValue) {
        await onApplyValue(facet, value, add)
      } else {
        const before = assignedValues(facet, item).map((entry) => entry.id)
        const next = facet.multi
          ? add
            ? [...before, value.id]
            : before.filter((id) => id !== value.id)
          : add
            ? [value.id]
            : []
        await window.api.setItemFacet(item.id, facet.id, [...new Set(next)])
        onChanged?.()
      }
      await loadFacets()
    } catch (error) {
      setMessage(`标记失败：${(error as Error).message}`)
    }
  }

  return (
    <div className={compact ? 'space-y-2 p-2.5' : 'space-y-3 p-3'}>
      <div className="text-[10.5px] leading-4 text-[var(--faint)]">
        维度本质是带分类的标签，和主图库的标签筛选共用一套数据。
      </div>

      {targets.length > 1 && (
        <div className="rounded-lg border border-[var(--accent-border)] bg-[var(--accent-soft)] px-2 py-1.5 text-[10.5px] leading-4 text-[var(--accent-text)]">
          已选 {targets.length} 张，下面的操作会批量应用。
        </div>
      )}

      {facets.length === 0 && (
        <div className="text-[11px] text-[var(--faint)]">还没有维度，可在人像工作台左侧新建。</div>
      )}

      {facets.map((facet) => {
        const assigned = assignedValues(facet, item)
        const open = openPicker === facet.id
        const remaining = facet.values.filter(
          (value) => !assigned.some((entry) => entry.id === value.id)
        )
        return (
          <div
            key={facet.id}
            className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2.5 py-2"
          >
            <div className="flex items-center gap-2">
              <span className="text-[10.5px] text-[var(--faint)]">{facet.name}</span>
              <span className="text-[9.5px] text-[var(--faint)] opacity-70">
                {facet.multi ? '多选' : '单选'}
              </span>
              <button
                className="ml-auto grid h-5 w-5 place-items-center rounded text-[var(--faint)] hover:bg-[var(--panel)] hover:text-[var(--text)]"
                onClick={() => setOpenPicker(open ? null : facet.id)}
                title="添加取值"
              >
                <Plus size={12} />
              </button>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {assigned.length === 0 && (
                <span className="text-[10.5px] text-[var(--faint)]">未标注</span>
              )}
              {assigned.map((value) => (
                <button
                  key={value.id}
                  className="inline-flex h-[21px] items-center gap-1 rounded-md border border-[var(--accent)] bg-[var(--accent-soft)] px-1.5 text-[10.5px]"
                  onClick={() => void applyValue(facet, value, false)}
                  title="点一下移除"
                >
                  <span
                    className="h-[5px] w-[5px] rounded-full"
                    style={{ background: value.color }}
                  />
                  {value.name}
                  <X size={9} />
                </button>
              ))}
            </div>
            {open && (
              <div className="mt-1.5 flex flex-wrap gap-1 border-t border-[var(--border)] pt-1.5">
                {remaining.map((value) => (
                  <button
                    key={value.id}
                    className="inline-flex h-[21px] items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--panel)] px-1.5 text-[10.5px] text-[var(--faint)] hover:text-[var(--text)]"
                    onClick={() => void applyValue(facet, value, true)}
                  >
                    <span
                      className="h-[5px] w-[5px] rounded-full"
                      style={{ background: value.color }}
                    />
                    {value.name}
                  </button>
                ))}
                {remaining.length === 0 && (
                  <span className="text-[10.5px] text-[var(--faint)]">这个维度没有更多取值</span>
                )}
              </div>
            )}
          </div>
        )
      })}

      {message && (
        <div className="text-[10.5px] leading-4 text-[var(--danger-text)]">{message}</div>
      )}
    </div>
  )
}
