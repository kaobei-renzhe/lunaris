import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { ArrowLeft, Camera, Folder as FolderIcon, Images, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import type { Facet, FacetValue, Folder, Item } from '@shared/types'
import { photoUrl, thumbUrl } from './lib/format'
import Lightbox from './components/Lightbox'

interface PortraitWorkspaceProps {
  onBack: () => void
}

const PAGE_LIMIT = 500

/**
 * 人像工作台：左维度 / 中瀑布流 / 右详情。
 * 维度与取值本质是带 facet_id 的普通标签，所以照片上已有的标记、筛选都能直接复用。
 */
export default function PortraitWorkspace({ onBack }: PortraitWorkspaceProps) {
  const [facets, setFacets] = useState<Facet[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  /** 文件夹与维度条件叠加：先用文件夹缩小范围，再按维度细筛 */
  const [folderId, setFolderId] = useState<number | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [picked, setPicked] = useState<Record<string, number[]>>({})
  const [selection, setSelection] = useState<number[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [lightIndex, setLightIndex] = useState<number | null>(null)
  const [openPicker, setOpenPicker] = useState<string | null>(null)
  const [addingValueFor, setAddingValueFor] = useState<string | null>(null)
  const [valueDraft, setValueDraft] = useState('')
  const [creatingFacet, setCreatingFacet] = useState(false)
  const [facetDraft, setFacetDraft] = useState('')
  const [message, setMessage] = useState('')

  const loadFacets = useCallback(async () => {
    setFacets(await window.api.listFacets())
  }, [])

  const loadFolders = useCallback(async () => {
    setFolders(await window.api.listFolders())
  }, [])

  const loadItems = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.api.listItems(
        { facets: picked, folderId, sort: 'added' },
        0,
        PAGE_LIMIT
      )
      setItems(result.items)
      setTotal(result.total)
    } catch (error) {
      setMessage(`读取照片失败：${(error as Error).message}`)
    } finally {
      setLoading(false)
    }
  }, [picked, folderId])

  useEffect(() => {
    void loadFacets().catch((error) => setMessage(`读取维度失败：${(error as Error).message}`))
  }, [loadFacets])

  useEffect(() => {
    void loadFolders().catch((error) => setMessage(`读取文件夹失败：${(error as Error).message}`))
  }, [loadFolders])

  useEffect(() => {
    void loadItems()
  }, [loadItems])

  // 当前照片被筛掉时清空详情，避免右侧显示一张已经不在列表里的图
  useEffect(() => {
    if (activeId !== null && !items.some((item) => item.id === activeId)) {
      setActiveId(null)
      setSelection([])
    }
  }, [items, activeId])

  const current = useMemo(
    () => items.find((item) => item.id === activeId) ?? null,
    [items, activeId]
  )
  const targets = selection.length ? selection : activeId ? [activeId] : []
  const valueName = useMemo(() => {
    const map = new Map<number, { name: string; color: string }>()
    for (const facet of facets) {
      for (const value of facet.values) map.set(value.id, { name: value.name, color: value.color })
    }
    return map
  }, [facets])
  const activeFolder = folderId !== null ? folders.find((folder) => folder.id === folderId) : null

  const toggleFilter = (facetId: string, valueId: number): void => {
    setPicked((prev) => {
      const list = prev[facetId] ?? []
      const next = list.includes(valueId)
        ? list.filter((id) => id !== valueId)
        : [...list, valueId]
      const merged = { ...prev, [facetId]: next }
      if (!next.length) delete merged[facetId]
      return merged
    })
  }

  const selectCard = (item: Item, event: ReactMouseEvent): void => {
    setActiveId(item.id)
    if (event.ctrlKey || event.metaKey) {
      setSelection((prev) =>
        prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id]
      )
    } else {
      setSelection([item.id])
    }
  }

  const assignedValues = (facet: Facet, item: Item | null): FacetValue[] => {
    if (!item) return []
    return facet.values.filter((value) => item.tags.some((tag) => tag.id === value.id))
  }

  /** 给当前目标加/去某个取值；单选维度会自动替换，多选维度按加法处理 */
  const applyValue = async (facet: Facet, value: FacetValue, add: boolean): Promise<void> => {
    if (!targets.length) return
    setMessage('')
    try {
      if (targets.length === 1) {
        const item = items.find((entry) => entry.id === targets[0])
        if (!item) return
        const before = assignedValues(facet, item).map((entry) => entry.id)
        const next = facet.multi
          ? add
            ? [...before, value.id]
            : before.filter((id) => id !== value.id)
          : add
            ? [value.id]
            : []
        await window.api.setItemFacet(item.id, facet.id, [...new Set(next)])
      } else {
        await window.api.bulkSetFacetValue(targets, facet.id, value.id, add)
      }
      await Promise.all([loadItems(), loadFacets()])
    } catch (error) {
      setMessage(`标记失败：${(error as Error).message}`)
    }
  }

  const addValue = async (facetId: string): Promise<void> => {
    const name = valueDraft.trim()
    if (!name) return
    try {
      await window.api.createFacetValue(facetId, name)
      setValueDraft('')
      setAddingValueFor(null)
      await loadFacets()
    } catch (error) {
      setMessage(`新增取值失败：${(error as Error).message}`)
    }
  }

  const addFacet = async (): Promise<void> => {
    const name = facetDraft.trim()
    if (!name) return
    try {
      await window.api.createFacet(name)
      setFacetDraft('')
      setCreatingFacet(false)
      await loadFacets()
    } catch (error) {
      setMessage(`新建维度失败：${(error as Error).message}`)
    }
  }

  const removeFacet = async (facet: Facet): Promise<void> => {
    const ok = await window.api.confirm(
      `删除维度「${facet.name}」？`,
      '只解除标签归属，照片上的标记与标签本身都会保留，之后可以在标签里继续用。'
    )
    if (!ok) return
    try {
      await window.api.deleteFacet(facet.id)
      setPicked((prev) => {
        const next = { ...prev }
        delete next[facet.id]
        return next
      })
      await Promise.all([loadFacets(), loadItems()])
    } catch (error) {
      setMessage(`删除失败：${(error as Error).message}`)
    }
  }

  const pickedCount = Object.values(picked).reduce((sum, list) => sum + list.length, 0)
  const lightboxItem = lightIndex !== null ? items[lightIndex] : null

  return (
    <div className="h-full flex flex-col bg-[var(--bg)]">
      <header className="h-[52px] shrink-0 px-3 flex items-center gap-2 border-b border-[var(--border)] bg-[var(--panel)]">
        <button className="btn btn-ghost h-7 px-2 text-[11.5px]" onClick={onBack}>
          <ArrowLeft size={13} /> 返回图库
        </button>
        <Camera size={15} color="var(--accent-2)" />
        <span className="text-[13.5px] font-medium">人像工作台</span>
        <div className="flex items-center gap-1 ml-3 flex-wrap">
          {activeFolder && (
            <button
              className="inline-flex items-center gap-1 h-[22px] px-1.5 rounded-md border border-[var(--accent)] bg-[var(--accent-soft)] text-[11px]"
              onClick={() => setFolderId(null)}
              title="移除文件夹条件"
            >
              <FolderIcon size={11} />
              {activeFolder.name}
              <X size={10} />
            </button>
          )}
          {facets.flatMap((facet) =>
            (picked[facet.id] ?? []).map((valueId) => {
              const value = facet.values.find((entry) => entry.id === valueId)
              if (!value) return null
              return (
                <button
                  key={`${facet.id}-${valueId}`}
                  className="inline-flex items-center gap-1 h-[22px] px-1.5 rounded-md border border-[var(--accent)] bg-[var(--accent-soft)] text-[11px]"
                  onClick={() => toggleFilter(facet.id, valueId)}
                  title="移除这个条件"
                >
                  <span className="w-[6px] h-[6px] rounded-full" style={{ background: value.color }} />
                  {value.name}
                  <X size={10} />
                </button>
              )
            })
          )}
          {pickedCount > 0 && (
            <button className="text-[11px] text-[var(--faint)] hover:text-[var(--text)]" onClick={() => setPicked({})}>
              清空条件
            </button>
          )}
        </div>
        <span className="ml-auto text-[11.5px] text-[var(--faint)] tabular-nums">
          {loading ? '读取中…' : `${items.length} / ${total} 张`}
        </span>
        <button
          className="btn h-7 px-2 text-[11.5px]"
          onClick={() => void Promise.all([loadItems(), loadFacets(), loadFolders()])}
          title="重新读取文件夹、维度与照片"
        >
          <RefreshCw size={12} /> 刷新
        </button>
      </header>

      {message && (
        <div className="shrink-0 px-3 py-1.5 text-[11.5px] text-[var(--danger-text)] bg-[var(--danger-soft)] border-b border-[var(--danger-border)]">
          {message}
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* 左：文件夹 + 维度 */}
        <aside className="w-[228px] shrink-0 border-r border-[var(--border)] overflow-y-auto px-2 py-3">
          <div className="mb-3">
            <div className="flex items-center gap-1.5 px-1 mb-1.5">
              <FolderIcon size={12} className="text-[var(--faint)]" />
              <span className="text-[11.5px] text-[var(--text)]">文件夹</span>
              <span className="ml-auto text-[10px] text-[var(--faint)] tabular-nums">
                {folders.length}
              </span>
            </div>
            <button
              className={`w-full flex items-center gap-1.5 h-[26px] px-1.5 rounded-md text-[11.5px] transition-colors ${
                folderId === null
                  ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]'
                  : 'text-[var(--muted)] hover:bg-[var(--panel-2)] hover:text-[var(--text)]'
              }`}
              onClick={() => setFolderId(null)}
            >
              <Images size={12} />
              全部照片
            </button>
            {folders.map((folder) => {
              const active = folderId === folder.id
              return (
                <button
                  key={folder.id}
                  className={`w-full flex items-center gap-1.5 h-[26px] px-1.5 rounded-md text-[11.5px] transition-colors ${
                    active
                      ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]'
                      : 'text-[var(--muted)] hover:bg-[var(--panel-2)] hover:text-[var(--text)]'
                  }`}
                  onClick={() => setFolderId(active ? null : folder.id)}
                  title={folder.name}
                >
                  <FolderIcon size={12} />
                  <span className="truncate">{folder.name}</span>
                  <span className="ml-auto text-[10px] text-[var(--faint)] tabular-nums">
                    {folder.count}
                  </span>
                </button>
              )
            })}
            {folders.length === 0 && (
              <div className="px-1 py-0.5 text-[10.5px] text-[var(--faint)]">
                还没有文件夹，可在图库里新建
              </div>
            )}
          </div>
          <div className="my-3 border-t border-[var(--border)]" />

          {facets.map((facet) => {
            const active = picked[facet.id] ?? []
            return (
              <div key={facet.id} className="mb-4">
                <div className="flex items-center gap-1.5 px-1 mb-1.5">
                  <span className="text-[11.5px] text-[var(--text)]">{facet.name}</span>
                  <span className="text-[10px] text-[var(--faint)]">{facet.multi ? '多选' : '单选'}</span>
                  <button
                    className="ml-auto w-5 h-5 rounded grid place-items-center text-[var(--faint)] hover:text-[var(--text)] hover:bg-[var(--panel-2)]"
                    onClick={() => {
                      setAddingValueFor(addingValueFor === facet.id ? null : facet.id)
                      setValueDraft('')
                    }}
                    title="新增取值"
                  >
                    <Plus size={12} />
                  </button>
                  <button
                    className="w-5 h-5 rounded grid place-items-center text-[var(--faint)] hover:text-[var(--danger-text)] hover:bg-[var(--panel-2)]"
                    onClick={() => void removeFacet(facet)}
                    title="删除维度"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {facet.values.map((value) => {
                    const on = active.includes(value.id)
                    return (
                      <button
                        key={value.id}
                        className={`inline-flex items-center gap-1 h-[22px] px-1.5 rounded-md border text-[11px] transition-colors ${
                          on
                            ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text)]'
                            : 'border-[var(--border)] bg-[var(--panel-2)] text-[var(--faint)] hover:text-[var(--text)]'
                        }`}
                        onClick={() => toggleFilter(facet.id, value.id)}
                      >
                        <span
                          className="w-[6px] h-[6px] rounded-full"
                          style={{ background: value.color, opacity: on ? 1 : 0.5 }}
                        />
                        {value.name}
                        {value.count > 0 && <span className="tabular-nums opacity-60">{value.count}</span>}
                      </button>
                    )
                  })}
                  {facet.values.length === 0 && (
                    <span className="text-[10.5px] text-[var(--faint)] px-1">还没有取值</span>
                  )}
                </div>
                {addingValueFor === facet.id && (
                  <div className="flex items-center gap-1 mt-1.5">
                    <input
                      className="input h-6 text-[11px] min-w-0 flex-1"
                      value={valueDraft}
                      autoFocus
                      placeholder="新取值"
                      onChange={(e) => setValueDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void addValue(facet.id)
                        if (e.key === 'Escape') setAddingValueFor(null)
                      }}
                    />
                    <button className="btn h-6 px-1.5 text-[11px]" onClick={() => void addValue(facet.id)}>
                      加
                    </button>
                  </div>
                )}
              </div>
            )
          })}

          {creatingFacet ? (
            <div className="flex items-center gap-1 px-1">
              <input
                className="input h-6 text-[11px] min-w-0 flex-1"
                value={facetDraft}
                autoFocus
                placeholder="维度名，如 道具"
                onChange={(e) => setFacetDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void addFacet()
                  if (e.key === 'Escape') setCreatingFacet(false)
                }}
              />
              <button className="btn h-6 px-1.5 text-[11px]" onClick={() => void addFacet()}>
                建
              </button>
            </div>
          ) : (
            <button
              className="btn btn-ghost h-7 px-2 text-[11.5px] w-full justify-center"
              onClick={() => setCreatingFacet(true)}
            >
              <Plus size={12} /> 新建维度
            </button>
          )}
        </aside>

        {/* 中：瀑布流 */}
        <main className="flex-1 min-w-0 overflow-y-auto px-3 py-3">
          {loading && items.length === 0 ? (
            <div className="text-[12px] text-[var(--faint)] px-1">读取中…</div>
          ) : items.length === 0 ? (
            <div className="h-full grid place-items-center">
              <div className="text-center text-[12px] text-[var(--faint)] max-w-[300px] leading-5">
                当前条件下没有照片。
                <br />
                换几个维度取值，或先在图库里导入人像。
              </div>
            </div>
          ) : (
            <div className="columns-2 md:columns-3 xl:columns-4 gap-3">
              {items.map((item, index) => {
                const on = selection.includes(item.id)
                const marks = item.tags
                  .filter((tag) => valueName.has(tag.id))
                  .slice(0, 3)
                return (
                  <button
                    key={item.id}
                    data-gallery-id={item.id}
                    className={`block w-full mb-3 break-inside-avoid text-left rounded-lg overflow-hidden border transition-colors ${
                      on
                        ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]'
                        : 'border-[var(--border)] hover:border-[var(--border-strong)]'
                    }`}
                    onClick={(event) => selectCard(item, event)}
                    onDoubleClick={() => setLightIndex(index)}
                  >
                    <img
                      src={thumbUrl(item.id, 'mid')}
                      alt={item.name}
                      loading="lazy"
                      draggable={false}
                      className="w-full block bg-[var(--panel-2)]"
                      style={{ aspectRatio: item.width > 0 && item.height > 0 ? `${item.width} / ${item.height}` : '3 / 4' }}
                    />
                    <div className="px-2 py-1.5 bg-[var(--panel)]">
                      <div className="text-[10.5px] text-[var(--text)] truncate">{item.name}</div>
                      {marks.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {marks.map((tag) => (
                            <span
                              key={tag.id}
                              className="inline-flex items-center gap-1 text-[9.5px] text-[var(--faint)]"
                            >
                              <span
                                className="w-[5px] h-[5px] rounded-full"
                                style={{ background: valueName.get(tag.id)?.color ?? '#7aa2f7' }}
                              />
                              {valueName.get(tag.id)?.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </main>

        {/* 右：详情 */}
        <aside className="w-[306px] shrink-0 border-l border-[var(--border)] overflow-y-auto px-3 py-3">
          {!current ? (
            <div className="text-[11.5px] text-[var(--faint)] leading-5">
              点一张照片查看细节，Ctrl / Cmd 点可选多张。
              <br />
              选中后在下方按维度打标，多选时批量生效。
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg overflow-hidden border border-[var(--border)] bg-[var(--panel-2)]">
                <img
                  src={photoUrl(current.id)}
                  alt={current.name}
                  className="w-full max-h-[190px] object-contain bg-black/20"
                  draggable={false}
                />
              </div>
              <div>
                <div className="text-[12px] text-[var(--text)] truncate">{current.name}</div>
                <div className="text-[10.5px] text-[var(--faint)] mt-0.5 tabular-nums">
                  {current.width} × {current.height}
                  {current.rating > 0 ? ` · ${'★'.repeat(current.rating)}` : ''}
                </div>
              </div>

              {targets.length > 1 && (
                <div className="text-[10.5px] text-[var(--accent-text)] leading-4">
                  已选 {targets.length} 张，下面的操作会批量应用到这些照片。
                </div>
              )}

              {facets.map((facet) => {
                const assigned = assignedValues(facet, current)
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
                        className="ml-auto w-5 h-5 rounded grid place-items-center text-[var(--faint)] hover:text-[var(--text)] hover:bg-[var(--panel)]"
                        onClick={() => setOpenPicker(open ? null : facet.id)}
                        title="添加取值"
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {assigned.length === 0 && (
                        <span className="text-[10.5px] text-[var(--faint)]">未标注</span>
                      )}
                      {assigned.map((value) => (
                        <button
                          key={value.id}
                          className="inline-flex items-center gap-1 h-[21px] px-1.5 rounded-md border border-[var(--accent)] bg-[var(--accent-soft)] text-[10.5px]"
                          onClick={() => void applyValue(facet, value, false)}
                          title="点一下移除"
                        >
                          <span
                            className="w-[5px] h-[5px] rounded-full"
                            style={{ background: value.color }}
                          />
                          {value.name}
                          <X size={9} />
                        </button>
                      ))}
                    </div>
                    {open && (
                      <div className="flex flex-wrap gap-1 mt-1.5 pt-1.5 border-t border-[var(--border)]">
                        {remaining.map((value) => (
                          <button
                            key={value.id}
                            className="inline-flex items-center gap-1 h-[21px] px-1.5 rounded-md border border-[var(--border)] bg-[var(--panel)] text-[10.5px] text-[var(--faint)] hover:text-[var(--text)]"
                            onClick={() => void applyValue(facet, value, true)}
                          >
                            <span
                              className="w-[5px] h-[5px] rounded-full"
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
            </div>
          )}
        </aside>
      </div>

      {lightboxItem && lightIndex !== null && (
        <Lightbox
          items={items}
          index={lightIndex}
          onClose={() => setLightIndex(null)}
          onNavigate={setLightIndex}
        />
      )}
    </div>
  )
}
