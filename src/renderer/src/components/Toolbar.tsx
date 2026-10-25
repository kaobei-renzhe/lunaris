import { useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Folder as FolderIcon,
  FolderPlus,
  Layers,
  Save,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  X
} from 'lucide-react'
import type { ClipStatus, FilterState, Folder } from '@shared/types'
import { COLOR_OPTIONS } from '../lib/format'

interface ToolbarProps {
  filter: FilterState
  onFilter: (filter: FilterState) => void
  total: number
  loading: boolean
  selectedIds: number[]
  folders: Folder[]
  thumbSize: number
  onThumbSize: (size: number) => void
  onRateSelected: (rating: number) => void
  onFlagSelected: (flag: number) => void
  onStackSelected: () => void
  onScoreSelected: () => void
  aiScoring: boolean
  /** AI 智能筛选用到的自然语言规则（仅用于显示 chip） */
  aiRule: string | null
  onOpenSmartFilter: () => void
  onClearAi: () => void
  /** 大模型总开关是否就绪；没就绪时相册里不出现任何 AI 入口 */
  aiReady: boolean
  /** 能力级开关：只有总开关就绪且该能力开启时才渲染入口 */
  canScore: boolean
  canSmartFilter: boolean
  semanticMode: boolean
  clipStatus: ClipStatus | null
  onToggleSemantic: () => void
  onAddToFolder: (folderId: number) => void
  onDeleteSelected: () => void
  onClearSelection: () => void
  onSaveSmart: (name: string) => void
}

export default function Toolbar({
  filter,
  onFilter,
  total,
  loading,
  selectedIds,
  folders,
  thumbSize,
  onThumbSize,
  onRateSelected,
  onFlagSelected,
  onStackSelected,
  onScoreSelected,
  aiScoring,
  aiRule,
  onOpenSmartFilter,
  onClearAi,
  aiReady,
  canScore,
  canSmartFilter,
  semanticMode,
  clipStatus,
  onToggleSemantic,
  onAddToFolder,
  onDeleteSelected,
  onClearSelection,
  onSaveSmart
}: ToolbarProps) {
  const [saving, setSaving] = useState(false)
  const [smartName, setSmartName] = useState('')
  /** 第二排筛选条件可以折叠，给图库让出高度 */
  const [filtersOpen, setFiltersOpen] = useState(true)

  const patch = (next: Partial<FilterState>): void => onFilter({ ...filter, ...next })
  const hasFilter =
    Boolean(filter.query) ||
    Boolean(filter.folderId) ||
    Boolean(filter.dir) ||
    Boolean(filter.errors) ||
    (filter.tagIds?.length ?? 0) > 0 ||
    Boolean(filter.colorFamily) ||
    Boolean(filter.orientation) ||
    Boolean(filter.flag) ||
    Boolean(filter.missing) ||
    (filter.minRating ?? 0) > 0 ||
    (filter.minAiScore ?? 0) > 0 ||
    Boolean(filter.unscored) ||
    (filter.onlyIds?.length ?? 0) > 0

  /** 折叠后用它提示还有几个条件在生效 */
  const activeCount = [
    filter.query,
    filter.folderId,
    filter.dir,
    filter.errors,
    filter.colorFamily,
    filter.orientation,
    filter.flag,
    filter.expandBursts,
    filter.missing,
    (filter.minRating ?? 0) > 0,
    (filter.minAiScore ?? 0) > 0,
    filter.unscored,
    (filter.onlyIds?.length ?? 0) > 0,
    (filter.tagIds?.length ?? 0) > 0
  ].filter(Boolean).length

  const commitSmart = (): void => {
    if (smartName.trim()) onSaveSmart(smartName.trim())
    setSmartName('')
    setSaving(false)
  }

  const pending = clipStatus ? Math.max(0, clipStatus.total - clipStatus.indexed) : 0

  return (
    <div className="shrink-0 border-b border-[var(--border)] bg-[var(--panel)] px-3 py-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-[420px]">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)] pointer-events-none"
          />
          <input
            className="input w-full pl-8"
            placeholder={
              semanticMode ? '描述画面，比如「海边的日落」…' : '搜索文件名、标签、备注…'
            }
            value={filter.query ?? ''}
            onChange={(e) => patch({ query: e.target.value })}
          />
        </div>

        <button
          className={`btn h-8 px-2.5 shrink-0 ${
            semanticMode ? 'border-[var(--accent)] text-[var(--accent-2)] bg-[var(--accent-soft)]' : ''
          }`}
          onClick={onToggleSemantic}
          title={
            semanticMode
              ? '正在用画面语义搜索，点此切回普通搜索'
              : '用自然语言描述画面来找图（本地模型，不上传）'
          }
        >
          <Sparkles size={13} /> 语义
          {semanticMode && clipStatus && pending > 0 && (
            <span className="ml-1 text-[10.5px] text-[var(--faint)] tabular-nums">
              {clipStatus.indexed}/{clipStatus.total}
            </span>
          )}
        </button>

        <button
          className={`btn h-8 px-2.5 shrink-0 ${
            !filtersOpen && activeCount > 0 ? 'border-[var(--accent-border)] text-[var(--accent-2)]' : ''
          }`}
          onClick={() => setFiltersOpen((open) => !open)}
          title={filtersOpen ? '折叠筛选条件' : '展开筛选条件'}
        >
          <SlidersHorizontal size={13} /> 筛选
          {activeCount > 0 && (
            <span className="ml-0.5 text-[10.5px] text-[var(--faint)] tabular-nums">{activeCount}</span>
          )}
          {filtersOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>

        <select
          className="input"
          value={filter.sort ?? 'added'}
          onChange={(e) => patch({ sort: e.target.value as FilterState['sort'] })}
        >
          <option value="added">最新导入</option>
          <option value="mtime">拍摄时间</option>
          <option value="name">名称</option>
          <option value="rating">评分</option>
          <option value="size">文件大小</option>
          {aiReady && canScore && <option value="ai">AI 评分</option>}
        </select>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11.5px] text-[var(--muted)] tabular-nums">
            {loading ? '加载中…' : `${total} 张`}
          </span>
          <div className="flex items-center gap-2 pl-2 border-l border-[var(--border)]">
            <span className="text-[11px] text-[var(--faint)]">缩略图</span>
            <input
              type="range"
              min={150}
              max={340}
              step={10}
              value={thumbSize}
              onChange={(e) => onThumbSize(Number(e.target.value))}
              className="w-[86px] accent-[var(--accent)]"
            />
          </div>
        </div>
      </div>

      <div className={`flex items-center gap-2 mt-2 flex-wrap ${filtersOpen ? '' : 'hidden'}`}>
        <select
          className="input h-7 text-[12px]"
          value={filter.minRating ?? 0}
          onChange={(e) => patch({ minRating: Number(e.target.value) })}
        >
          <option value={0}>全部评分</option>
          <option value={1}>1 星以上</option>
          <option value={2}>2 星以上</option>
          <option value={3}>3 星以上</option>
          <option value={4}>4 星以上</option>
          <option value={5}>5 星</option>
        </select>

        {aiReady && canScore && (
          <select
            className="input h-7 text-[12px]"
            value={filter.unscored ? 'unscored' : String(filter.minAiScore ?? 0)}
            onChange={(e) => {
              const value = e.target.value
              if (value === 'unscored') patch({ unscored: true, minAiScore: 0 })
              else patch({ unscored: false, minAiScore: Number(value) })
            }}
            title="按大模型质量评分筛选"
          >
            <option value="0">全部 AI 评分</option>
            <option value="60">AI ≥ 60</option>
            <option value="70">AI ≥ 70</option>
            <option value="80">AI ≥ 80</option>
            <option value="90">AI ≥ 90</option>
            <option value="unscored">未评分</option>
          </select>
        )}

        <select
          className="input h-7 text-[12px]"
          value={filter.orientation ?? ''}
          onChange={(e) => patch({ orientation: (e.target.value || null) as FilterState['orientation'] })}
        >
          <option value="">全部构图</option>
          <option value="landscape">横向</option>
          <option value="portrait">纵向</option>
          <option value="square">方形</option>
        </select>

        <select
          className="input h-7 text-[12px]"
          value={filter.flag ?? 0}
          onChange={(e) => patch({ flag: Number(e.target.value) })}
        >
          <option value={0}>全部旗标</option>
          <option value={1}>✓ 留用</option>
          <option value={-1}>✕ 淘汰</option>
        </select>

        {aiReady && canSmartFilter && (
          <button
            className={`btn h-7 px-2 text-[11.5px] ${
              aiRule ? 'border-[var(--accent)] text-[var(--accent-2)]' : ''
            }`}
            onClick={onOpenSmartFilter}
            title="用一句话描述要挑哪些图，让大模型帮你筛（会消耗 token）"
          >
            <Sparkles size={12} /> AI 筛选
          </button>
        )}

        <button
          className={`btn h-7 px-2 text-[11.5px] ${
            filter.expandBursts ? 'border-[var(--accent)] text-[var(--accent-2)]' : ''
          }`}
          onClick={() => patch({ expandBursts: !filter.expandBursts })}
          title="把连拍组拆开显示"
        >
          {filter.expandBursts ? '收起连拍' : '展开连拍'}
        </button>

        <div className="flex items-center gap-1.5 pl-1">
          {COLOR_OPTIONS.map((c) => {
            const active = filter.colorFamily === c.value
            return (
              <button
                key={c.value}
                title={c.label}
                onClick={() => patch({ colorFamily: active ? null : c.value })}
                className="w-[16px] h-[16px] rounded-full transition-transform hover:scale-110"
                style={{
                  background: c.hex,
                  boxShadow: active
                    ? '0 0 0 2px var(--panel), 0 0 0 3.5px var(--accent)'
                    : '0 0 0 1px rgba(255,255,255,0.14)'
                }}
              />
            )
          })}
        </div>

        {filter.dir && (
          <button
            className="btn h-7 px-2 text-[11.5px] max-w-[260px]"
            onClick={() => patch({ dir: null })}
            title={filter.dir}
          >
            <FolderIcon size={12} />
            <span className="truncate">{filter.dir.split(/[\\/]/).filter(Boolean).pop()}</span>
            <X size={11} />
          </button>
        )}

        {aiRule && (
          <button
            className="btn h-7 px-2 text-[11.5px] max-w-[260px] border-[var(--accent-border)] text-[var(--accent-2)]"
            onClick={onClearAi}
            title={`AI 筛选：${aiRule}（点击取消）`}
          >
            <Sparkles size={11} />
            <span className="truncate">{aiRule}</span>
            <X size={11} />
          </button>
        )}

        {filter.errors && (
          <button
            className="btn h-7 px-2 text-[11.5px] border-[var(--danger-border)] text-[var(--danger-text)]"
            onClick={() => patch({ errors: false })}
          >
            导入异常
            <X size={11} />
          </button>
        )}

        {hasFilter && (
          <button
            className="btn btn-ghost h-7 px-2 text-[11.5px]"
            onClick={() => {
              onClearAi()
              onFilter({
                sort: filter.sort,
                query: '',
                folderId: null,
                dir: null,
                tagIds: [],
                colorFamily: null,
                orientation: null,
                minRating: 0,
                minAiScore: 0,
                unscored: false,
                onlyIds: [],
                flag: 0,
                missing: false,
                errors: false
              })
            }}
          >
            <X size={12} /> 清除筛选
          </button>
        )}

        <div className="ml-auto flex items-center gap-1">
          {saving ? (
            <>
              <input
                autoFocus
                className="input h-7 w-[150px] text-[12px]"
                placeholder="智能文件夹名称"
                value={smartName}
                onChange={(e) => setSmartName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitSmart()
                  if (e.key === 'Escape') {
                    setSmartName('')
                    setSaving(false)
                  }
                }}
              />
              <button className="btn h-7 px-2 text-[11.5px]" onClick={commitSmart}>
                保存
              </button>
            </>
          ) : (
            <button
              className="btn btn-ghost h-7 px-2 text-[11.5px]"
              disabled={!hasFilter}
              onClick={() => setSaving(true)}
              title="把当前筛选条件保存成智能文件夹"
            >
              <Save size={12} /> 保存筛选
            </button>
          )}
        </div>
      </div>

      {selectedIds.length > 0 && (
        <div className="flex items-center gap-2 mt-2 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-soft)] px-2.5 py-1.5">
          <span className="text-[12px] text-[var(--accent-text)]">已选 {selectedIds.length} 张</span>
          <div className="flex items-center gap-0.5 pl-2 border-l border-[var(--accent-border)]">
            <Star size={12} className="text-[var(--muted)]" />
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                className="w-[16px] text-[12px] text-[var(--muted)] hover:text-amber-300"
                onClick={() => onRateSelected(n)}
              >
                {n}
              </button>
            ))}
          </div>
          {folders.length > 0 && (
            <div className="flex items-center gap-1 pl-2 border-l border-[var(--accent-border)]">
              <FolderPlus size={12} className="text-[var(--muted)]" />
              <select
                className="input h-6 text-[11px] bg-transparent border-0"
                value=""
                onChange={(e) => {
                  if (e.target.value) onAddToFolder(Number(e.target.value))
                }}
              >
                <option value="">加入文件夹</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex items-center gap-1 pl-2 border-l border-[var(--accent-border)]">
            <button
              className="w-[20px] text-[12px] text-[var(--success)] hover:text-[var(--text)]"
              title="标为留用"
              onClick={() => onFlagSelected(1)}
            >
              ✓
            </button>
            <button
              className="w-[20px] text-[12px] text-[var(--danger-text)] hover:text-[var(--text)]"
              title="标为淘汰"
              onClick={() => onFlagSelected(-1)}
            >
              ✕
            </button>
            <button
              className="w-[20px] text-[12px] text-[var(--muted)] hover:text-white"
              title="清除旗标"
              onClick={() => onFlagSelected(0)}
            >
              –
            </button>
          </div>
          <div className="ml-auto flex items-center gap-1">
            {aiReady && canScore && (
              <button
                className="btn btn-ghost h-6 px-2 text-[11.5px]"
                disabled={aiScoring}
                onClick={onScoreSelected}
                title="用大模型给选中的图评分（一次最多 12 张），结果会存进图库，每次都会消耗 token"
              >
                <Sparkles size={12} /> {aiScoring ? '评分中…' : 'AI 评分'}
              </button>
            )}
            {selectedIds.length >= 2 && (
              <button
                className="btn btn-ghost h-6 px-2 text-[11.5px]"
                onClick={onStackSelected}
                title="把选中的图片堆成一组"
              >
                <Layers size={12} /> 堆叠
              </button>
            )}
            <button className="btn btn-ghost btn-danger h-6 px-2 text-[11.5px]" onClick={onDeleteSelected}>
              <Trash2 size={12} /> 移除
            </button>
          </div>
          <button className="btn btn-ghost h-6 px-1.5" onClick={onClearSelection} title="取消选择">
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  )
}
