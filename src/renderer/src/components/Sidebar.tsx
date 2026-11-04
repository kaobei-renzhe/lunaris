import { useEffect, useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent, ReactNode } from 'react'
import {
  Archive,
  ArrowLeftRight,
  Camera,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  FileSpreadsheet,
  Folder,
  FolderPlus,
  History,
  Images,
  Layers,
  Plus,
  RefreshCw,
  Settings as SettingsIcon,
  Sparkles,
  Tag as TagIcon,
  TriangleAlert,
  Upload,
  UserCheck,
  X
} from 'lucide-react'
import type {
  ClipStatus,
  Facet,
  FilterState,
  Folder as FolderType,
  ImportDirNode,
  SmartFolder,
  Stats,
  Tag
} from '@shared/types'
import { folderName, samePath } from '../lib/format'
import Logo from './Logo'

interface DirRowsProps {
  nodes: ImportDirNode[]
  depth: number
  current: string | null | undefined
  expanded: string[]
  onToggle: (path: string) => void
  onPick: (path: string) => void
}

function DirRows({ nodes, depth, current, expanded, onToggle, onPick }: DirRowsProps) {
  return (
    <>
      {nodes.map((node) => {
        const open = expanded.includes(node.path)
        return (
          <div key={node.path}>
            <div
              className={`side-item ${current === node.path ? 'active' : ''}`}
              style={{ paddingLeft: 8 + depth * 12 }}
              onClick={() => onPick(node.path)}
              title={node.path}
            >
              {node.children.length > 0 ? (
                <button
                  className="shrink-0 text-[var(--faint)] hover:text-[var(--text)]"
                  onClick={(event) => {
                    event.stopPropagation()
                    onToggle(node.path)
                  }}
                >
                  {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
              ) : (
                <span className="w-[12px] shrink-0" />
              )}
              <Folder size={13} />
              <span className="truncate">{node.name}</span>
              <span className="count">{node.total}</span>
            </div>
            {open && node.children.length > 0 && (
              <DirRows
                nodes={node.children}
                depth={depth + 1}
                current={current}
                expanded={expanded}
                onToggle={onToggle}
                onPick={onPick}
              />
            )}
          </div>
        )
      })}
    </>
  )
}

interface SidebarProps {
  library: string
  /** 图库的显示名（可在启动页重命名） */
  libraryName: string
  stats: Stats
  tags: Tag[]
  /** 人像维度：作为统一多级筛选树的父节点，取值挂在它下面 */
  facets: Facet[]
  folders: FolderType[]
  smarts: SmartFolder[]
  dirTree: ImportDirNode[]
  filter: FilterState
  onFilter: (filter: FilterState) => void
  onImportFiles: () => void
  onImportFolder: () => void
  /** 打开人像工作台（独立三栏视图） */
  onPortrait: () => void
  onSync: () => void
  onRescan: () => void
  onDuplicates: () => void
  onSwitch: () => void
  onBackup: () => void
  onRestore: () => void
  onExport: () => void
  onAutoBackup: () => void
  clipStatus: ClipStatus | null
  onIndexClip: () => void
  onAutoTag: () => void
  onRelocate: () => void
  /** 打开选片会话历史 */
  onPickHistory: () => void
  lastRelocateDir: string | null
  onEquipment: () => void
  onSettings: () => void
  onCreateFolder: (name: string) => void
  onDropItems: (ids: number[], target: { folderId?: number; tagId?: number }) => void
  onDeleteFolder: (id: number) => void
  onDeleteTag: (id: number) => void
  /** 调整标签层级：parentId 为 null 时移回顶层 */
  onTagNest: (childId: number, parentId: number | null) => Promise<void>
  onDeleteSmart: (id: number) => void
}

export default function Sidebar({
  library,
  libraryName,
  stats,
  tags,
  facets,
  folders,
  smarts,
  dirTree,
  filter,
  onFilter,
  onImportFiles,
  onImportFolder,
  onPortrait,
  onSync,
  onRescan,
  onDuplicates,
  onSwitch,
  onBackup,
  onRestore,
  onExport,
  onAutoBackup,
  clipStatus,
  onIndexClip,
  onAutoTag,
  onRelocate,
  onPickHistory,
  lastRelocateDir,
  onEquipment,
  onSettings,
  onCreateFolder,
  onDropItems,
  onDeleteFolder,
  onDeleteTag,
  onTagNest,
  onDeleteSmart
}: SidebarProps) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  /** 标签树里被折叠的父标签 */
  const [collapsedTags, setCollapsedTags] = useState<number[]>([])
  /** 人像维度：默认收起，展开后才列出该维度的取值 */
  const [expandedFacets, setExpandedFacets] = useState<string[]>([])
  const [expandedDirs, setExpandedDirs] = useState<string[]>([])
  const [dirsOpen, setDirsOpen] = useState(true)
  /** 三个筛选区各自折叠，避免侧栏被长列表占满 */
  const [openSections, setOpenSections] = useState({ folders: true, tags: true, smarts: true })
  /** 右键菜单：替代原先悬停 × 直接删除 */
  const [menu, setMenu] = useState<{ x: number; y: number; kind: string; onDelete: () => void } | null>(
    null
  )
  const seededDirs = useRef(false)

  const toggleSection = (key: keyof typeof openSections): void =>
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }))

  // 目录树首次加载时展开根节点，之后尊重用户的折叠状态
  useEffect(() => {
    if (seededDirs.current || dirTree.length === 0) return
    seededDirs.current = true
    setExpandedDirs(dirTree.map((node) => node.path))
  }, [dirTree])

  const toggleDir = (path: string): void => {
    setExpandedDirs((prev) =>
      prev.includes(path) ? prev.filter((item) => item !== path) : [...prev, path]
    )
  }

  const isLibraryDrag = (e: ReactDragEvent): boolean =>
    e.dataTransfer.types.includes('application/x-imagenest-items')

  const dragOver = (key: string) => (e: ReactDragEvent) => {
    if (!isLibraryDrag(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    if (dropTarget !== key) setDropTarget(key)
  }

  const dragLeave = (key: string) => () => {
    setDropTarget((current) => (current === key ? null : current))
  }

  const drop = (target: { folderId?: number; tagId?: number }) => (e: ReactDragEvent) => {
    if (!isLibraryDrag(e)) return
    e.preventDefault()
    e.stopPropagation()
    setDropTarget(null)
    try {
      const ids = JSON.parse(e.dataTransfer.getData('application/x-imagenest-items')) as number[]
      if (Array.isArray(ids) && ids.length) onDropItems(ids, target)
    } catch {
      /* 不是库内拖拽就忽略 */
    }
  }

  const tagIds = filter.tagIds ?? []
  const facetPicked = filter.facets ?? {}
  const hasFacetFilter = Object.values(facetPicked).some((list) => list.length > 0)
  const isAll =
    !filter.folderId &&
    tagIds.length === 0 &&
    !hasFacetFilter &&
    !filter.missing &&
    !filter.dir &&
    !filter.errors &&
    !filter.pickAction

  /** 只比较筛选条件本身（忽略排序），用来判断哪个智能文件夹正生效 */
  const filterKey = (value: FilterState | SmartFolder['filter']): string =>
    JSON.stringify({
      query: value.query ?? '',
      folderId: value.folderId ?? null,
      dir: value.dir ?? null,
      tagIds: [...(value.tagIds ?? [])].sort((a, b) => a - b),
      // 维度筛选也纳入比较，否则同一张智能文件夹在不同维度下都会亮
      facets: Object.fromEntries(
        Object.entries(value.facets ?? {})
          .map(([key, list]) => [key, [...list].sort((a, b) => a - b)] as const)
          .sort(([a], [b]) => a.localeCompare(b))
      ),
      orientation: value.orientation ?? null,
      minRating: value.minRating ?? 0,
      flag: value.flag ?? 0,
      pickAction: value.pickAction ?? null,
      pickSessionId: value.pickSessionId ?? null,
      missing: Boolean(value.missing),
      errors: Boolean(value.errors)
    })

  const activeSmartId =
    smarts.find((smart) => filterKey(smart.filter) === filterKey(filter))?.id ?? null

  const commitFolder = (): void => {
    if (name.trim()) onCreateFolder(name.trim())
    setName('')
    setAdding(false)
  }

  const toggleTag = (id: number): void => {
    const next = tagIds.includes(id) ? tagIds.filter((t) => t !== id) : [...tagIds, id]
    onFilter({ ...filter, tagIds: next, folderId: null })
  }

  const unselectTag = (id: number): void => {
    onFilter({ ...filter, tagIds: tagIds.filter((t) => t !== id) })
  }

  /** 选中/取消某个维度的取值；同一维度内多选取 OR，跨维度取 AND */
  const toggleFacetValue = (facetId: string, valueId: number): void => {
    const current = facetPicked[facetId] ?? []
    const next = current.includes(valueId)
      ? current.filter((id) => id !== valueId)
      : [...current, valueId]
    const facets = { ...facetPicked }
    if (next.length > 0) facets[facetId] = next
    else delete facets[facetId]
    onFilter({ ...filter, facets, folderId: null })
  }

  const toggleFacetOpen = (facetId: string): void =>
    setExpandedFacets((prev) =>
      prev.includes(facetId) ? prev.filter((id) => id !== facetId) : [...prev, facetId]
    )

  /**
   * 统一的多级筛选树：维度不是单独开关，而是树上的父节点；
   * 维度取值本身就是标签，所以和普通标签共用同一套展开、选中与嵌套规则。
   */
  const knownTagIds = new Set(tags.map((tag) => tag.id))
  const childrenOf = new Map<number, Tag[]>()
  for (const tag of tags) {
    const parent = tag.parentId != null && knownTagIds.has(tag.parentId) ? tag.parentId : 0
    const list = childrenOf.get(parent) ?? []
    list.push(tag)
    childrenOf.set(parent, list)
  }

  /** 普通标签的子节点；维度取值只挂在所属维度下面，避免重复出现 */
  const subTagsOf = (id: number): Tag[] =>
    (childrenOf.get(id) ?? []).filter((tag) => !tag.facetId)

  const isTagDrag = (event: ReactDragEvent): boolean =>
    event.dataTransfer.types.includes('application/x-imagenest-tag')

  const dragOverTag = (key: string) => (event: ReactDragEvent) => {
    if (!isTagDrag(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (dropTarget !== key) setDropTarget(key)
  }

  /** 把拖起的标签挂到 parentId 下；null 表示移回顶层 */
  const dropTagOn = (parentId: number | null) => (event: ReactDragEvent) => {
    if (!isTagDrag(event)) return
    event.preventDefault()
    event.stopPropagation()
    setDropTarget(null)
    const childId = Number(event.dataTransfer.getData('application/x-imagenest-tag'))
    if (Number.isFinite(childId) && childId && childId !== parentId) {
      void onTagNest(childId, parentId)
    }
  }

  const renderTagTree = (tag: Tag, depth: number): ReactNode => {
    const children = subTagsOf(tag.id)
    const collapsed = collapsedTags.includes(tag.id)
    const active = tagIds.includes(tag.id)
    const key = `tag-${tag.id}`
    return (
      <div key={tag.id}>
        <div
          className={`side-item group ${active ? 'active' : ''} ${
            dropTarget === key ? 'ring-1 ring-[var(--accent)] bg-[var(--panel-3)]' : ''
          }`}
          style={{ paddingLeft: 6 + depth * 12 }}
          onClick={() => toggleTag(tag.id)}
          title={`${tag.name}（右键删除；拖到另一个标签上可归为子级）`}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData('application/x-imagenest-tag', String(tag.id))
            event.dataTransfer.effectAllowed = 'move'
          }}
          onContextMenu={(event) => {
            event.preventDefault()
            setMenu({
              x: event.clientX,
              y: event.clientY,
              kind: '标签',
              onDelete: () => onDeleteTag(tag.id)
            })
          }}
          onDragOver={(event) => {
            if (isTagDrag(event)) dragOverTag(key)(event)
            else dragOver(key)(event)
          }}
          onDragLeave={dragLeave(key)}
          onDrop={(event) => {
            if (isTagDrag(event)) dropTagOn(tag.id)(event)
            else drop({ tagId: tag.id })(event)
          }}
        >
          {children.length > 0 ? (
            <button
              className="w-3 h-3 grid place-items-center text-[var(--faint)] shrink-0"
              onClick={(event) => {
                event.stopPropagation()
                setCollapsedTags((prev) =>
                  prev.includes(tag.id) ? prev.filter((id) => id !== tag.id) : [...prev, tag.id]
                )
              }}
              title={collapsed ? '展开子标签' : '折叠子标签'}
            >
              {collapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
            </button>
          ) : (
            <span className="w-3 shrink-0" />
          )}
          <span className="tag-dot" style={{ background: tag.color }} />
          <span className="truncate">{tag.name}</span>
          <span className={`count ${active ? 'group-hover:hidden' : ''}`}>{tag.count}</span>
          {active && (
            <button
              className="hidden group-hover:block ml-auto text-[var(--faint)] hover:text-[var(--accent-2)]"
              title="取消选中（不删除标签）"
              onClick={(event) => {
                event.stopPropagation()
                unselectTag(tag.id)
              }}
            >
              <X size={12} />
            </button>
          )}
        </div>
        {!collapsed && children.map((child) => renderTagTree(child, depth + 1))}
      </div>
    )
  }

  /** 维度节点：和普通标签在同一棵树上，展开后列出取值，取值下面还能继续挂子标签 */
  const renderFacetNode = (facet: Facet): ReactNode => {
    const picked = facetPicked[facet.id] ?? []
    const open = expandedFacets.includes(facet.id)
    const values = tags.filter((tag) => tag.facetId === facet.id)
    return (
      <div key={facet.id}>
        <div
          className={`side-item ${picked.length > 0 ? 'active' : ''}`}
          style={{ paddingLeft: 6 }}
          onClick={() => toggleFacetOpen(facet.id)}
          title={
            picked.length > 0
              ? `${facet.name}：已选 ${picked.length} 个取值，点一下收起`
              : `${facet.name}：展开后按取值筛选`
          }
        >
          <button
            className="w-3 h-3 grid place-items-center text-[var(--faint)] shrink-0"
            onClick={(event) => {
              event.stopPropagation()
              toggleFacetOpen(facet.id)
            }}
            title={open ? '收起取值' : '展开取值'}
          >
            {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </button>
          <Layers size={12} />
          <span className="truncate">{facet.name}</span>
          <span className={`count ${picked.length > 0 ? 'text-[var(--accent-2)]' : ''}`}>
            {picked.length > 0 ? `${picked.length}/${values.length}` : values.length}
          </span>
        </div>
        {open &&
          values.map((value) => {
            const active = picked.includes(value.id)
            const children = subTagsOf(value.id)
            const collapsed = collapsedTags.includes(value.id)
            return (
              <div key={value.id}>
                <div
                  className={`side-item ${active ? 'active' : ''}`}
                  style={{ paddingLeft: 18 }}
                  onClick={() => toggleFacetValue(facet.id, value.id)}
                  title={`${facet.name}：${value.name}（同一维度多选取并集）`}
                >
                  {children.length > 0 ? (
                    <button
                      className="w-3 h-3 grid place-items-center text-[var(--faint)] shrink-0"
                      onClick={(event) => {
                        event.stopPropagation()
                        setCollapsedTags((prev) =>
                          prev.includes(value.id)
                            ? prev.filter((id) => id !== value.id)
                            : [...prev, value.id]
                        )
                      }}
                      title={collapsed ? '展开子标签' : '折叠子标签'}
                    >
                      {collapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
                    </button>
                  ) : (
                    <span className="w-3 shrink-0" />
                  )}
                  <span className="tag-dot" style={{ background: value.color }} />
                  <span className="truncate">{value.name}</span>
                  <span className="count">{value.count}</span>
                </div>
                {!collapsed && children.map((child) => renderTagTree(child, 2))}
              </div>
            )
          })}
        {open && values.length === 0 && (
          <div className="px-2 py-1 pl-[18px] text-[11px] text-[var(--faint)]">
            还没有取值，可在人像工作台里添加
          </div>
        )}
      </div>
    )
  }

  return (
    <aside
      className="shrink-0 border-r border-[var(--border)] bg-[var(--panel)] flex flex-col min-h-0 overflow-x-hidden"
      style={{ width: 'var(--sidebar-w, 236px)' }}
    >
      <div className="px-4 pt-4 pb-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <div className="w-[26px] h-[26px]">
            <Logo size={26} />
          </div>
          <div className="font-semibold text-[13.5px] tracking-wide">月相</div>
          <button className="btn btn-ghost h-6 px-1.5 ml-auto" title="切换图库" onClick={onSwitch}>
            <ArrowLeftRight size={13} />
          </button>
        </div>
        <div className="mt-1.5 truncate text-[11px] text-[var(--faint)]" title={library}>
          {libraryName}
          {filter.dir && !samePath(filter.dir, library) ? ` › ${folderName(filter.dir)}` : ''}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        <div
          className={`side-item ${isAll ? 'active' : ''}`}
          onClick={() => onFilter({ sort: filter.sort })}
        >
          <Images size={14} />
          全部图片
          <span className="count">{stats.total}</span>
        </div>

        <div
          className="side-item"
          onClick={onPortrait}
          title="按景别、光线、氛围等人像维度筛选与打标"
        >
          <Camera size={14} />
          人像工作台
        </div>

        {stats.clientPicked > 0 && (
          <div
            className={`side-item ${filter.pickAction ? 'active' : ''}`}
            onClick={() =>
              onFilter({ sort: filter.sort, pickAction: filter.pickAction ? undefined : 'any' })
            }
            title="最近一单客户「要的 + 要修的」照片"
          >
            <UserCheck size={14} />
            客户已选
            <span className="count">{stats.clientPicked}</span>
          </div>
        )}

        <div
          className="side-item"
          onClick={onPickHistory}
          title="回看每一单的客户选择，也能重新导入回传结果"
        >
          <History size={14} />
          选片记录
        </div>

        {stats.missing > 0 && (
          <div
            className={`side-item ${filter.missing ? 'active' : ''}`}
            onClick={() => onFilter({ sort: filter.sort, missing: true })}
            title="原文件已经不在记录里的路径了，可以重新定位接回"
          >
            <TriangleAlert size={14} />
            文件丢失
            <span className="count">{stats.missing}</span>
          </div>
        )}

        {stats.errors > 0 && (
          <div
            className={`side-item ${filter.errors ? 'active' : ''}`}
            onClick={() => onFilter({ sort: filter.sort, errors: true })}
            title="损坏或无法识别的文件，修好后重新导入即可"
          >
            <TriangleAlert size={14} />
            导入异常
            <span className="count">{stats.errors}</span>
          </div>
        )}

        <div
          className="section-title mt-3 cursor-pointer select-none hover:text-[var(--muted)]"
          onClick={() => setDirsOpen((open) => !open)}
          title={dirsOpen ? '折叠源目录' : '展开源目录'}
        >
          {dirsOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          <span className="ml-1">源目录</span>
          <span className="ml-auto text-[10px]">{dirTree.length}</span>
        </div>
        {dirsOpen &&
          (dirTree.length === 0 ? (
            <div className="px-2 py-1 text-[11px] text-[var(--faint)]">
              导入文件夹后按原目录归档
            </div>
          ) : (
            <DirRows
              nodes={dirTree}
              depth={0}
              current={filter.dir}
              expanded={expandedDirs}
              onToggle={toggleDir}
              onPick={(path) => onFilter({ sort: filter.sort, dir: path })}
            />
          ))}

        <div
          className="section-title mt-3 cursor-pointer select-none hover:text-[var(--muted)]"
          onClick={() => toggleSection('folders')}
          title={openSections.folders ? '折叠文件夹' : '展开文件夹'}
        >
          {openSections.folders ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          <span className="ml-1">文件夹</span>
          <span className="ml-auto text-[10px]">{folders.length}</span>
          <button
            className="btn btn-ghost h-5 px-1 ml-1"
            onClick={(event) => {
              event.stopPropagation()
              setAdding(true)
            }}
            title="新建文件夹"
          >
            <Plus size={12} />
          </button>
        </div>

        {openSections.folders && adding && (
          <div className="px-1 pb-1">
            <input
              autoFocus
              className="input w-full h-7 text-[12px]"
              placeholder="文件夹名称，回车确认"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitFolder()
                if (e.key === 'Escape') {
                  setName('')
                  setAdding(false)
                }
              }}
              onBlur={commitFolder}
            />
          </div>
        )}

        {openSections.folders &&
          folders.map((folder) => (
            <div
              key={folder.id}
              className={`side-item group ${filter.folderId === folder.id ? 'active' : ''} ${
                dropTarget === `folder-${folder.id}` ? 'ring-1 ring-[var(--accent)] bg-[var(--panel-3)]' : ''
              }`}
              onClick={() => onFilter({ sort: filter.sort, folderId: folder.id })}
              title={`${folder.name}（右键可删除）`}
              onContextMenu={(event) => {
                event.preventDefault()
                setMenu({
                  x: event.clientX,
                  y: event.clientY,
                  kind: '文件夹',
                  onDelete: () => onDeleteFolder(folder.id)
                })
              }}
              onDragOver={dragOver(`folder-${folder.id}`)}
              onDragLeave={dragLeave(`folder-${folder.id}`)}
              onDrop={drop({ folderId: folder.id })}
            >
              <Folder size={14} />
              <span className="truncate">{folder.name}</span>
              <span className={`count ${filter.folderId === folder.id ? 'group-hover:hidden' : ''}`}>
                {folder.count}
              </span>
              {filter.folderId === folder.id && (
                <button
                  className="hidden group-hover:block ml-auto text-[var(--faint)] hover:text-[var(--accent-2)]"
                  title="取消选中（不删除文件夹）"
                  onClick={(event) => {
                    event.stopPropagation()
                    onFilter({ sort: filter.sort })
                  }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ))}

        {openSections.folders && folders.length === 0 && !adding && (
          <div className="px-2 py-1 text-[11px] text-[var(--faint)]">还没有文件夹</div>
        )}

        <div
          className={`section-title mt-3 cursor-pointer select-none hover:text-[var(--muted)] ${
            dropTarget === 'tag-root' ? 'ring-1 ring-[var(--accent)]' : ''
          }`}
          onClick={() => toggleSection('tags')}
          title={
            openSections.tags
              ? '折叠标签；把标签拖到这里可移回顶层'
              : '展开标签；把标签拖到这里可移回顶层'
          }
          onDragOver={dragOverTag('tag-root')}
          onDragLeave={dragLeave('tag-root')}
          onDrop={dropTagOn(null)}
        >
          {openSections.tags ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          <span className="ml-1">标签</span>
          <span className="ml-auto text-[10px]">{facets.length + subTagsOf(0).length}</span>
        </div>

        {/* 同一棵筛选树：普通标签与维度节点混在一起，层级一致、交互一致 */}
        {openSections.tags && subTagsOf(0).map((tag) => renderTagTree(tag, 0))}
        {openSections.tags && facets.map((facet) => renderFacetNode(facet))}
        {openSections.tags && tags.length === 0 && facets.length === 0 && (
          <div className="px-2 py-1 text-[11px] text-[var(--faint)]">在右侧详情里给图片打标签</div>
        )}

        <div
          className="section-title mt-3 cursor-pointer select-none hover:text-[var(--muted)]"
          onClick={() => toggleSection('smarts')}
          title={openSections.smarts ? '折叠智能文件夹' : '展开智能文件夹'}
        >
          {openSections.smarts ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          <span className="ml-1">智能文件夹</span>
          <span className="ml-auto text-[10px]">{smarts.length}</span>
        </div>
        {openSections.smarts &&
          smarts.map((smart) => (
            <div
              key={smart.id}
              className={`side-item group ${activeSmartId === smart.id ? 'active' : ''}`}
              title={`${smart.name}（右键可删除）`}
              onClick={() => onFilter({ ...smart.filter, sort: smart.filter.sort ?? filter.sort })}
              onContextMenu={(event) => {
                event.preventDefault()
                setMenu({
                  x: event.clientX,
                  y: event.clientY,
                  kind: '智能文件夹',
                  onDelete: () => onDeleteSmart(smart.id)
                })
              }}
            >
              <Sparkles size={13} />
              <span className="truncate">{smart.name}</span>
              {activeSmartId === smart.id && (
                <button
                  className="hidden group-hover:block ml-auto text-[var(--faint)] hover:text-[var(--accent-2)]"
                  title="取消选中（不删除智能文件夹）"
                  onClick={(event) => {
                    event.stopPropagation()
                    onFilter({ sort: filter.sort })
                  }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
        {openSections.smarts && smarts.length === 0 && (
          <div className="px-2 py-1 text-[11px] text-[var(--faint)]">筛选后可在顶部保存</div>
        )}
        <div className="section-title mt-3">装备</div>
        <div
          className="side-item"
          onClick={onEquipment}
          title="管理机身、镜头、三脚架等设备，按拍摄场景挑搭配"
        >
          <Camera size={13} />
          设备与搭配
        </div>
        <div className="section-title mt-3">维护</div>
        <div className="side-item" onClick={onBackup} title="把索引数据库打包成 zip">
          <Archive size={13} />
          备份图库
        </div>
        <div className="side-item" onClick={onRestore} title="从 zip 备份恢复到一个新文件夹">
          <RefreshCw size={13} />
          从备份恢复
        </div>
        <div className="side-item" onClick={onAutoBackup} title="设置定时自动备份">
          <Clock size={13} />
          自动备份
        </div>
        <div className="side-item" onClick={onExport} title="导出 CSV 素材清单">
          <FileSpreadsheet size={13} />
          导出素材清单
        </div>
        <div
          className="side-item"
          onClick={onIndexClip}
          title="为图片建立本地语义向量，用于自然语言搜图和找相似"
        >
          <Sparkles size={13} />
          语义索引
          <span className="ml-auto text-[10.5px] text-[var(--faint)] tabular-nums">
            {!clipStatus
              ? ''
              : !clipStatus.modelReady
                ? '未下载模型'
                : clipStatus.running
                  ? '进行中…'
                  : `${clipStatus.indexed}/${clipStatus.total}`}
          </span>
        </div>
        <div className="side-item" onClick={onAutoTag} title="用本地模型把图片自动归到风景、人像等分类标签">
          <TagIcon size={13} />
          自动分类
        </div>
        <div
          className="side-item"
          onClick={onRelocate}
          title={
            lastRelocateDir
              ? `上次定位：${lastRelocateDir}`
              : '文件搬家后，按目录结构和内容接回丢失的图片'
          }
        >
          <TriangleAlert size={13} />
          重新定位
          {lastRelocateDir && (
            <span className="ml-auto max-w-[96px] truncate text-[10.5px] text-[var(--faint)]">
              {folderName(lastRelocateDir)}
            </span>
          )}
        </div>
        <div className="side-item mt-3" onClick={onSettings} title="外观、大模型、语义索引与存储位置">
          <SettingsIcon size={13} />
          设置
        </div>
      </div>

      <div className="p-2 border-t border-[var(--border)] space-y-1">
        <button className="btn btn-primary w-full justify-center" onClick={onImportFiles}>
          <Upload size={14} /> 导入图片
        </button>
        <button
          className="btn w-full justify-center"
          onClick={onSync}
          title="重新扫描源目录：补上新照片、标记已删除、刷新被覆盖修改的照片"
        >
          <RefreshCw size={13} /> 刷新图库
        </button>
        <div className="grid grid-cols-2 gap-1">
          <button className="btn justify-center px-2" onClick={onImportFolder}>
            <FolderPlus size={13} /> 文件夹
          </button>
          <button className="btn justify-center px-2" onClick={onRescan}>
            <RefreshCw size={13} /> 扫描
          </button>
        </div>
        <button className="btn w-full justify-center" onClick={onDuplicates}>
          <Copy size={13} /> 查找重复
        </button>
        <div className="pt-1 text-[10.5px] text-[var(--faint)] flex items-center gap-1.5 px-1">
          <TagIcon size={11} /> {stats.tags} 个标签 · {stats.folders} 个文件夹
        </div>
      </div>

      {/* 右键菜单：删除入口从悬停的 × 挪到这里，× 只负责取消选中 */}
      {menu && (
        <div
          className="fixed inset-0 z-[70]"
          onClick={() => setMenu(null)}
          onContextMenu={(event) => {
            event.preventDefault()
            setMenu(null)
          }}
        >
          <div
            className="absolute min-w-[150px] rounded-lg border border-[var(--border)] bg-[var(--panel)] py-1 shadow-2xl"
            style={{ left: menu.x, top: menu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-3 py-1 text-[10.5px] text-[var(--faint)]">× 只取消选中</div>
            <button
              className="w-full text-left px-3 py-1.5 text-[12px] text-[var(--danger-text)] hover:bg-[var(--panel-2)]"
              onClick={() => {
                const run = menu.onDelete
                setMenu(null)
                run()
              }}
            >
              删除{menu.kind}
            </button>
          </div>
        </div>
      )}
    </aside>
  )
}
