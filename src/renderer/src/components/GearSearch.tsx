import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Aperture,
  Boxes,
  Camera,
  Lightbulb,
  Package,
  Plus,
  Search,
  Video,
  X,
  Zap
} from 'lucide-react'
import type { GearCategory, GearItem, GearSpec, GearSuggestion } from '@shared/types'

const CATEGORY_LABEL: Record<GearCategory, string> = {
  body: '机身',
  lens: '镜头',
  tripod: '三脚架',
  flash: '闪光灯',
  light: '补光灯',
  gimbal: '云台',
  other: '其它'
}

const CATEGORY_ICON: Record<GearCategory, typeof Camera> = {
  body: Camera,
  lens: Aperture,
  tripod: Package,
  flash: Zap,
  light: Lightbulb,
  gimbal: Video,
  other: Boxes
}

const CATEGORY_ORDER: GearCategory[] = ['body', 'lens', 'tripod', 'flash', 'light', 'gimbal', 'other']

const SENSOR_LABEL: Record<string, string> = {
  ff: '全画幅',
  apsc: 'APS-C',
  m43: 'M4/3',
  compact: '一英寸'
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '')
}

function summary(spec: GearSpec): string {
  const parts: string[] = []
  if (spec.category === 'body') {
    if (spec.sensor) parts.push(SENSOR_LABEL[spec.sensor] ?? spec.sensor)
    if (spec.megapixels) parts.push(`${spec.megapixels}MP`)
    if (spec.ibis) parts.push('防抖')
    if (spec.burst) parts.push(`${spec.burst} fps`)
  } else if (spec.category === 'lens') {
    if (spec.focalMin) {
      parts.push(
        spec.focalMax && spec.focalMax !== spec.focalMin
          ? `${spec.focalMin}-${spec.focalMax}mm`
          : `${spec.focalMin}mm`
      )
    }
    if (spec.aperture) parts.push(`f/${spec.aperture}`)
    if (spec.macro) parts.push('微距')
    if (spec.stabilized) parts.push('防抖')
  } else if (spec.category === 'tripod' || spec.category === 'gimbal') {
    if (spec.payload) parts.push(`承重 ${spec.payload}kg`)
  } else if (spec.category === 'flash' || spec.category === 'light') {
    if (spec.power) parts.push(`${spec.power}W/GN`)
  }
  if (spec.weight) parts.push(`${spec.weight}g`)
  return parts.join(' · ')
}

interface GearSearchProps {
  mode: 'add' | 'replace'
  current?: GearItem
  suggestions: GearSuggestion[]
  items: GearItem[]
  defaultCategory: GearCategory | 'all'
  onPick: (spec: GearSpec) => void
  onManual: (query: string) => void
  onClose: () => void
}

export default function GearSearch({
  mode,
  current,
  suggestions,
  items,
  defaultCategory,
  onPick,
  onManual,
  onClose
}: GearSearchProps) {
  const [query, setQuery] = useState(current?.model ?? '')
  const [category, setCategory] = useState<GearCategory | 'all'>(
    mode === 'replace' ? current?.category ?? 'all' : defaultCategory
  )
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const owned = useMemo(() => {
    const set = new Set<string>()
    for (const item of items) {
      if (current && item.id === current.id) continue
      set.add(`${item.category}|${normalize(item.model)}`)
    }
    return set
  }, [items, current])

  const results = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return suggestions
      .filter((spec) => {
        if (category !== 'all' && spec.category !== category) return false
        if (tokens.length === 0) return true
        const hay = `${spec.brand} ${spec.model}`.toLowerCase()
        const flat = normalize(hay)
        return tokens.every((token) => {
          const norm = normalize(token)
          return hay.includes(token) || (norm.length > 0 && flat.includes(norm))
        })
      })
      .slice(0, 60)
  }, [suggestions, query, category])

  const firstAvailable = results.find(
    (spec) => !owned.has(`${spec.category}|${normalize(spec.model)}`)
  )
  const trimmed = query.trim()

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60" onClick={onClose}>
      <div
        className="w-[660px] max-h-[80vh] flex flex-col rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="h-[48px] shrink-0 px-4 flex items-center gap-2 border-b border-[var(--border)]">
          <Search size={15} color="var(--accent-2)" />
          <span className="text-[13.5px] font-medium">
            {mode === 'replace' ? '更换型号' : '添加设备'}
          </span>
          <span className="text-[11px] text-[var(--faint)] ml-1">搜索型号，参数自动带出</span>
          <button className="btn btn-ghost h-7 px-1.5 ml-auto" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="p-3 border-b border-[var(--border)] space-y-2">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)] pointer-events-none"
            />
            <input
              ref={inputRef}
              className="input w-full h-8 pl-8 text-[12.5px]"
              placeholder="输入型号或品牌，比如 Zf、24-70、三脚架…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && firstAvailable) onPick(firstAvailable)
              }}
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button
              className={`h-[24px] px-2 rounded-md border text-[11px] ${
                category === 'all'
                  ? 'border-[var(--accent)] text-[var(--accent-2)] bg-[var(--accent-soft)]'
                  : 'border-[var(--border)] text-[var(--muted)] bg-[var(--panel-2)]'
              }`}
              onClick={() => setCategory('all')}
            >
              全部
            </button>
            {CATEGORY_ORDER.map((entry) => (
              <button
                key={entry}
                className={`h-[24px] px-2 rounded-md border text-[11px] ${
                  category === entry
                    ? 'border-[var(--accent)] text-[var(--accent-2)] bg-[var(--accent-soft)]'
                    : 'border-[var(--border)] text-[var(--muted)] bg-[var(--panel-2)]'
                }`}
                onClick={() => setCategory(entry)}
              >
                {CATEGORY_LABEL[entry]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 min-h-[180px]">
          {results.length === 0 ? (
            <div className="py-10 text-center">
              <div className="text-[12.5px] text-[var(--muted)]">没有匹配的设备</div>
              <div className="text-[11px] text-[var(--faint)] mt-1">
                换个关键词，或用下面的「手动填写」直接建一条
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              {results.map((spec) => {
                const key = `${spec.category}|${normalize(spec.model)}`
                const already = owned.has(key)
                const Icon = CATEGORY_ICON[spec.category]
                return (
                  <button
                    key={`${key}-${spec.brand}`}
                    className="w-full flex items-center gap-3 rounded-lg border border-transparent px-2.5 py-1.5 text-left hover:border-[var(--accent)] hover:bg-[var(--panel-2)] disabled:opacity-45 disabled:hover:border-transparent disabled:hover:bg-transparent"
                    disabled={already}
                    onClick={() => onPick(spec)}
                    title={already ? '已经在装备里了' : '点击添加'}
                  >
                    <Icon size={14} className="shrink-0 text-[var(--accent-2)]" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] text-[var(--text)] truncate">
                        {spec.brand} {spec.model}
                      </div>
                      <div className="text-[10.5px] text-[var(--faint)] truncate">
                        {CATEGORY_LABEL[spec.category]}
                        {summary(spec) ? ` · ${summary(spec)}` : ' · 参数可在手动模式补充'}
                      </div>
                    </div>
                    {spec.count > 0 && (
                      <span className="shrink-0 text-[10px] px-1.5 py-[1px] rounded bg-[var(--panel-3)] text-[var(--muted)] whitespace-nowrap">
                        已有 {spec.count} 张
                      </span>
                    )}
                    {already ? (
                      <span className="shrink-0 text-[10.5px] text-[var(--faint)]">已添加</span>
                    ) : (
                      <Plus size={13} className="shrink-0 text-[var(--faint)]" />
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="shrink-0 px-3 py-2 border-t border-[var(--border)] flex items-center gap-2">
          <span className="text-[10.5px] text-[var(--faint)]">
            {mode === 'replace' ? '选一个型号会覆盖参数，备注保留' : '回车可直接选第一条'}
          </span>
          <button
            className="btn btn-ghost h-6 px-2 text-[11px] ml-auto"
            onClick={() => onManual(trimmed)}
          >
            手动填写{trimmed && mode === 'add' ? `「${trimmed}」` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
