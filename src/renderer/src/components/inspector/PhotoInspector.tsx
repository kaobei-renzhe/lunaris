import { useEffect, useMemo, useState } from 'react'
import { BookOpen, Gauge, Info, Tags } from 'lucide-react'
import type { Item } from '@shared/types'
import InfoTab, { type InfoTabProps } from './InfoTab'
import FacetTab, { type FacetTabProps } from './FacetTab'
import PerfTab, { type PerfTabProps } from './PerfTab'
import StudyTab, { type StudyTabProps } from './StudyTab'

export type InspectorTab = 'info' | 'facet' | 'perf' | 'study'
export type InspectorHost = 'library' | 'portrait' | 'lightbox'

const DEFAULT_BY_HOST: Record<InspectorHost, InspectorTab> = {
  library: 'info',
  portrait: 'facet',
  lightbox: 'study'
}

const TABS: Array<{ id: InspectorTab; label: string; Icon: typeof Info }> = [
  { id: 'info', label: '信息', Icon: Info },
  { id: 'facet', label: '分类', Icon: Tags },
  { id: 'perf', label: '表现', Icon: Gauge },
  { id: 'study', label: '研读', Icon: BookOpen }
]

function isTab(value: string | null): value is InspectorTab {
  return value === 'info' || value === 'facet' || value === 'perf' || value === 'study'
}

/** 外部要求切 Tab：token 变化才生效，避免每次渲染都抢用户的点击 */
export interface InspectorTabRequest {
  tab: InspectorTab
  token: number
}

interface PhotoInspectorProps {
  item: Item
  host: InspectorHost
  /** 不传就用 host 的默认值；有记忆时优先用记忆 */
  defaultTab?: InspectorTab
  compact?: boolean
  showPreview?: boolean
  /** 灯箱用：按 N 打开档案、点圈选框时直接落到指定 Tab */
  tabRequest?: InspectorTabRequest
  /** 把当前 Tab 报给外面，灯箱据此决定 F 键能不能用 */
  onTabChange?: (tab: InspectorTab) => void
  /** 控制 Tab 显隐；没数据源的 Tab 默认不出现 */
  available?: Partial<Record<InspectorTab, boolean>>
  info?: Omit<InfoTabProps, 'item' | 'compact' | 'showPreview'>
  perf?: Omit<PerfTabProps, 'item'>
  facet?: Omit<FacetTabProps, 'item' | 'compact'>
  study?: Omit<StudyTabProps, 'item' | 'compact'>
}

export default function PhotoInspector({
  item,
  host,
  defaultTab,
  compact,
  showPreview = true,
  tabRequest,
  onTabChange,
  available,
  info,
  perf,
  facet,
  study
}: PhotoInspectorProps) {
  const storageKey = `lunaris:inspector:tab:${host}`
  const [tab, setTab] = useState<InspectorTab>(() => {
    try {
      const stored = localStorage.getItem(storageKey)
      if (isTab(stored)) return stored
    } catch {
      /* localStorage 不可用时退回默认 */
    }
    return defaultTab ?? DEFAULT_BY_HOST[host]
  })

  const visibleTabs = useMemo(() => {
    const enabled: Record<InspectorTab, boolean> = {
      info: Boolean(info),
      facet: true,
      perf: Boolean(perf),
      study: true
    }
    return TABS.filter((entry) => available?.[entry.id] ?? enabled[entry.id])
  }, [available, info, perf])

  useEffect(() => {
    if (!visibleTabs.some((entry) => entry.id === tab)) {
      setTab(visibleTabs[0]?.id ?? 'info')
    }
  }, [tab, visibleTabs])

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, tab)
    } catch {
      /* 记不住就记不住，不影响使用 */
    }
  }, [storageKey, tab])

  // 外部点名要某个 Tab（N 键、点圈选框），按 token 生效一次
  useEffect(() => {
    if (tabRequest) setTab(tabRequest.tab)
  }, [tabRequest])

  useEffect(() => {
    onTabChange?.(tab)
  }, [tab, onTabChange])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className={`flex shrink-0 items-center gap-0.5 border-b border-[var(--border)] ${
          compact ? 'px-1.5' : 'px-2'
        }`}
      >
        {visibleTabs.map(({ id, label, Icon }) => {
          const active = id === tab
          return (
            <button
              key={id}
              className={`flex h-8 items-center gap-1 rounded-t-md border-b-2 px-2 text-[11.5px] transition-colors ${
                active
                  ? 'border-[var(--accent)] text-[var(--text)]'
                  : 'border-transparent text-[var(--faint)] hover:text-[var(--text)]'
              }`}
              onClick={() => setTab(id)}
              title={label}
            >
              <Icon size={12} />
              {label}
            </button>
          )
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'info' && info && (
          <InfoTab
            item={item}
            compact={compact}
            showPreview={showPreview}
            {...info}
            onOpenStudy={
              visibleTabs.some((entry) => entry.id === 'study')
                ? () => setTab('study')
                : undefined
            }
          />
        )}
        {tab === 'facet' && <FacetTab item={item} compact={compact} {...facet} />}
        {tab === 'perf' && perf && <PerfTab item={item} {...perf} />}
        {tab === 'study' && <StudyTab item={item} compact={compact} {...study} />}
      </div>
    </div>
  )
}
