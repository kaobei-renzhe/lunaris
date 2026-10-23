import { useState } from 'react'
import type { DragEvent as ReactDragEvent } from 'react'
import {
  Archive,
  ArrowLeftRight,
  Camera,
  Clock,
  Copy,
  FileSpreadsheet,
  Folder,
  FolderPlus,
  Images,
  Plus,
  RefreshCw,
  Settings as SettingsIcon,
  Sparkles,
  Tag as TagIcon,
  TriangleAlert,
  Upload,
  X
} from 'lucide-react'
import type {
  ClipStatus,
  FilterState,
  Folder as FolderType,
  SmartFolder,
  Stats,
  Tag
} from '@shared/types'
import { folderName } from '../lib/format'
import Logo from './Logo'

interface SidebarProps {
  library: string
  stats: Stats
  tags: Tag[]
  folders: FolderType[]
  smarts: SmartFolder[]
  filter: FilterState
  onFilter: (filter: FilterState) => void
  onImportFiles: () => void
  onImportFolder: () => void
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
  lastRelocateDir: string | null
  onEquipment: () => void
  onSettings: () => void
  onCreateFolder: (name: string) => void
  onDropItems: (ids: number[], target: { folderId?: number; tagId?: number }) => void
  onDeleteFolder: (id: number) => void
  onDeleteTag: (id: number) => void
  onDeleteSmart: (id: number) => void
}

export default function Sidebar({
  library,
  stats,
  tags,
  folders,
  smarts,
  filter,
  onFilter,
  onImportFiles,
  onImportFolder,
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
  lastRelocateDir,
  onEquipment,
  onSettings,
  onCreateFolder,
  onDropItems,
  onDeleteFolder,
  onDeleteTag,
  onDeleteSmart
}: SidebarProps) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [dropTarget, setDropTarget] = useState<string | null>(null)

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
  const isAll = !filter.folderId && tagIds.length === 0 && !filter.missing

  const commitFolder = (): void => {
    if (name.trim()) onCreateFolder(name.trim())
    setName('')
    setAdding(false)
  }

  const toggleTag = (id: number): void => {
    const next = tagIds.includes(id) ? tagIds.filter((t) => t !== id) : [...tagIds, id]
    onFilter({ ...filter, tagIds: next, folderId: null })
  }

  return (
    <aside className="w-[236px] shrink-0 border-r border-[var(--border)] bg-[var(--panel)] flex flex-col min-h-0">
      <div className="px-4 pt-4 pb-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <div className="w-[26px] h-[26px]">
            <Logo size={26} />
          </div>
          <div className="font-semibold text-[13.5px] tracking-wide">月巢</div>
          <button className="btn btn-ghost h-6 px-1.5 ml-auto" title="切换图库" onClick={onSwitch}>
            <ArrowLeftRight size={13} />
          </button>
        </div>
        <div className="mt-1.5 text-[11px] text-[var(--faint)] truncate" title={library}>
          {folderName(library)}
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

        <div className="section-title mt-3">
          文件夹
          <button
            className="btn btn-ghost h-5 px-1 ml-auto"
            onClick={() => setAdding(true)}
            title="新建文件夹"
          >
            <Plus size={12} />
          </button>
        </div>

        {adding && (
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

        {folders.map((folder) => (
          <div
            key={folder.id}
            className={`side-item group ${filter.folderId === folder.id ? 'active' : ''} ${
              dropTarget === `folder-${folder.id}` ? 'ring-1 ring-[var(--accent)] bg-[var(--panel-3)]' : ''
            }`}
            onClick={() => onFilter({ sort: filter.sort, folderId: folder.id })}
            onDragOver={dragOver(`folder-${folder.id}`)}
            onDragLeave={dragLeave(`folder-${folder.id}`)}
            onDrop={drop({ folderId: folder.id })}
          >
            <Folder size={14} />
            <span className="truncate">{folder.name}</span>
            <span className="count group-hover:hidden">{folder.count}</span>
            <button
              className="hidden group-hover:block ml-auto text-[var(--faint)] hover:text-[var(--danger)]"
              onClick={(e) => {
                e.stopPropagation()
                onDeleteFolder(folder.id)
              }}
            >
              <X size={12} />
            </button>
          </div>
        ))}

        {folders.length === 0 && !adding && (
          <div className="px-2 py-1 text-[11px] text-[var(--faint)]">还没有文件夹</div>
        )}

        <div className="section-title mt-3">
          标签
          <span className="ml-auto text-[10px]">{tags.length}</span>
        </div>
        {tags.map((tag) => (
          <div
            key={tag.id}
            className={`side-item group ${tagIds.includes(tag.id) ? 'active' : ''} ${
              dropTarget === `tag-${tag.id}` ? 'ring-1 ring-[var(--accent)] bg-[var(--panel-3)]' : ''
            }`}
            onClick={() => toggleTag(tag.id)}
            onDragOver={dragOver(`tag-${tag.id}`)}
            onDragLeave={dragLeave(`tag-${tag.id}`)}
            onDrop={drop({ tagId: tag.id })}
          >
            <span className="tag-dot" style={{ background: tag.color }} />
            <span className="truncate">{tag.name}</span>
            <span className="count group-hover:hidden">{tag.count}</span>
            <button
              className="hidden group-hover:block ml-auto text-[var(--faint)] hover:text-[var(--danger)]"
              onClick={(e) => {
                e.stopPropagation()
                onDeleteTag(tag.id)
              }}
            >
              <X size={12} />
            </button>
          </div>
        ))}
        {tags.length === 0 && (
          <div className="px-2 py-1 text-[11px] text-[var(--faint)]">在右侧详情里给图片打标签</div>
        )}

        <div className="section-title mt-3">智能文件夹</div>
        {smarts.map((smart) => (
          <div
            key={smart.id}
            className="side-item group"
            onClick={() => onFilter({ ...smart.filter, sort: smart.filter.sort ?? filter.sort })}
          >
            <Sparkles size={13} />
            <span className="truncate">{smart.name}</span>
            <button
              className="hidden group-hover:block ml-auto text-[var(--faint)] hover:text-[var(--danger)]"
              onClick={(e) => {
                e.stopPropagation()
                onDeleteSmart(smart.id)
              }}
            >
              <X size={12} />
            </button>
          </div>
        ))}
        {smarts.length === 0 && (
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
        <div className="section-title mt-3">设置</div>
        <div className="side-item" onClick={onSettings} title="外观与偏好设置">
          <SettingsIcon size={13} />
          偏好设置
        </div>
      </div>

      <div className="p-2 border-t border-[var(--border)] space-y-1">
        <button className="btn btn-primary w-full justify-center" onClick={onImportFiles}>
          <Upload size={14} /> 导入图片
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
    </aside>
  )
}
