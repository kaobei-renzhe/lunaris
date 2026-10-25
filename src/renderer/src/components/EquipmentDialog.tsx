import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Aperture,
  Boxes,
  Camera,
  Copy,
  Lightbulb,
  Package,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Video,
  X,
  Zap
} from 'lucide-react'
import type {
  GearCategory,
  GearItem,
  GearKit,
  GearPlan,
  GearRecommendation,
  GearSpec,
  GearSuggestion,
  GearUsage,
  ScenarioId,
  ScenarioOption
} from '@shared/types'
import GearSearch from './GearSearch'

interface EquipmentDialogProps {
  onClose: () => void
}

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

function emptyForm(category: GearCategory): GearSpec & { id?: string } {
  return { category, brand: '', model: '' }
}

function specSummary(item: GearSpec): string {
  const parts: string[] = []
  if (item.category === 'body') {
    if (item.sensor) parts.push(SENSOR_LABEL[item.sensor] ?? item.sensor)
    if (item.megapixels) parts.push(`${item.megapixels}MP`)
    parts.push(item.ibis ? '机身防抖' : '无防抖')
    if (item.burst) parts.push(`${item.burst} fps`)
    if (item.video4k) parts.push('4K')
  } else if (item.category === 'lens') {
    if (item.focalMin) {
      parts.push(
        item.focalMax && item.focalMax !== item.focalMin
          ? `${item.focalMin}-${item.focalMax}mm`
          : `${item.focalMin}mm`
      )
    }
    if (item.aperture) parts.push(`f/${item.aperture}`)
    if (item.macro) parts.push('微距')
    if (item.stabilized) parts.push('防抖')
  } else if (item.category === 'tripod' || item.category === 'gimbal') {
    if (item.payload) parts.push(`承重 ${item.payload}kg`)
  } else if (item.category === 'flash' || item.category === 'light') {
    if (item.power) parts.push(`${item.power}W/GN`)
  }
  if (item.weight) parts.push(`${item.weight}g`)
  return parts.join(' · ')
}

export default function EquipmentDialog({ onClose }: EquipmentDialogProps) {
  const [tab, setTab] = useState<'gear' | 'plan'>('gear')
  const [items, setItems] = useState<GearItem[]>([])
  const [suggestions, setSuggestions] = useState<GearSuggestion[]>([])
  const [scenarios, setScenarios] = useState<ScenarioOption[]>([])
  const [filter, setFilter] = useState<'all' | GearCategory>('all')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<(GearSpec & { id?: string }) | null>(null)
  const [picker, setPicker] = useState<{ mode: 'add' | 'replace'; item?: GearItem } | null>(null)
  const [scenario, setScenario] = useState<ScenarioId>('portrait')
  const [recommendation, setRecommendation] = useState<GearRecommendation | null>(null)
  const [usage, setUsage] = useState<GearUsage | null>(null)
  const [kits, setKits] = useState<GearKit[]>([])
  const [savingKitFor, setSavingKitFor] = useState<string | null>(null)
  const [kitName, setKitName] = useState('')
  const [copied, setCopied] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(async () => {
    const [list, nextUsage, nextKits] = await Promise.all([
      window.api.listGear(),
      window.api.gearUsage(),
      window.api.listKits()
    ])
    setItems(list)
    setUsage(nextUsage)
    setKits(nextKits)
    return list
  }, [])

  const runRecommend = useCallback(async (id: ScenarioId) => {
    try {
      setRecommendation(await window.api.recommendGear(id))
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  useEffect(() => {
    void Promise.all([
      window.api.listGear(),
      window.api.gearSuggestions(),
      window.api.gearScenarios(),
      window.api.gearUsage(),
      window.api.listKits()
    ])
      .then(([list, suggestionList, scenarioList, usageInfo, kitList]) => {
        setItems(list)
        setSuggestions(suggestionList)
        setScenarios(scenarioList)
        setUsage(usageInfo)
        setKits(kitList)
      })
      .catch((err) => setError((err as Error).message))
  }, [])

  useEffect(() => {
    if (tab === 'plan') void runRecommend(scenario)
  }, [tab, scenario, runRecommend])

  const applyPick = async (spec: GearSpec): Promise<void> => {
    setError('')
    try {
      if (picker?.mode === 'replace' && picker.item) {
        // 换型号只覆盖参数，备注这类个人信息保留
        await window.api.saveGear({ ...spec, id: picker.item.id, note: picker.item.note })
      } else {
        await window.api.saveGear(spec)
      }
      setPicker(null)
      await refresh()
      if (tab === 'plan') await runRecommend(scenario)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const openManual = (query: string): void => {
    const base =
      picker?.mode === 'replace' && picker.item
        ? { ...picker.item }
        : emptyForm(filter === 'all' ? 'body' : filter)
    if (query) base.model = query
    setPicker(null)
    setEditing(base)
  }

  const remove = async (item: GearItem): Promise<void> => {
    const ok = await window.api.confirm('删除这件设备？', `${item.brand} ${item.model}`)
    if (!ok) return
    await window.api.deleteGear(item.id)
    await refresh()
    if (tab === 'plan') await runRecommend(scenario)
  }

  const save = async (): Promise<void> => {
    if (!editing) return
    if (!editing.model.trim()) {
      setError('请填写设备型号')
      return
    }
    setSaving(true)
    setError('')
    try {
      await window.api.saveGear(editing)
      await refresh()
      setEditing(null)
      if (tab === 'plan') await runRecommend(scenario)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const keyword = search.trim().toLowerCase()
  const matched = keyword
    ? items.filter((item) => `${item.brand} ${item.model}`.toLowerCase().includes(keyword))
    : items
  const visibleItems = filter === 'all' ? matched : matched.filter((item) => item.category === filter)
  const currentScenario = scenarios.find((item) => item.id === scenario)

  const scenarioName = (id: ScenarioId): string =>
    scenarios.find((item) => item.id === id)?.name ?? '拍摄'

  const planKey = (plan: GearPlan): string =>
    `${plan.scenario}-${plan.body?.id ?? ''}-${plan.lens?.id ?? ''}`

  const planText = (plan: GearPlan): string => {
    const lines = [`${scenarioName(plan.scenario)}方案 · 月巢`]
    if (plan.body) lines.push(`机身：${plan.body.brand} ${plan.body.model}`.trim())
    if (plan.lens) lines.push(`镜头：${plan.lens.brand} ${plan.lens.model}`.trim())
    for (const item of plan.accessories) {
      lines.push(`${CATEGORY_LABEL[item.category]}：${item.brand} ${item.model}`.trim())
    }
    for (const item of plan.extras) {
      lines.push(`可选 ${CATEGORY_LABEL[item.category]}：${item.brand} ${item.model}`.trim())
    }
    const weight =
      ((plan.body?.weight ?? 0) +
        (plan.lens?.weight ?? 0) +
        plan.accessories.reduce((sum, item) => sum + (item.weight ?? 0), 0)) /
      1000
    if (weight > 0) lines.push(`总重：约 ${weight.toFixed(1)} kg`)
    return lines.join('\n')
  }

  const copyText = async (key: string, text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(''), 1600)
    } catch {
      setError('复制失败，请手动选择文本')
    }
  }

  const savePlanAsKit = async (plan: GearPlan): Promise<void> => {
    const name = kitName.trim() || `${scenarioName(plan.scenario)}方案`
    try {
      await window.api.saveKit({
        name,
        scenario: plan.scenario,
        bodyId: plan.body?.id,
        lensId: plan.lens?.id,
        accessoryIds: plan.accessories.map((item) => item.id)
      })
      setSavingKitFor(null)
      setKitName('')
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const kitText = (kit: GearKit): string => {
    const lines = [kit.name, `${scenarioName(kit.scenario)}方案 · 月巢`]
    const body = items.find((item) => item.id === kit.bodyId)
    const lens = items.find((item) => item.id === kit.lensId)
    if (body) lines.push(`机身：${body.brand} ${body.model}`.trim())
    if (lens) lines.push(`镜头：${lens.brand} ${lens.model}`.trim())
    for (const id of kit.accessoryIds) {
      const item = items.find((entry) => entry.id === id)
      if (item) lines.push(`${CATEGORY_LABEL[item.category]}：${item.brand} ${item.model}`.trim())
    }
    return lines.join('\n')
  }

  const removeKit = async (kit: GearKit): Promise<void> => {
    const ok = await window.api.confirm('删除这套方案？', kit.name)
    if (!ok) return
    await window.api.deleteKit(kit.id)
    await refresh()
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60" onClick={onClose}>
      <div
        className="w-[900px] max-h-[88vh] flex flex-col rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-[52px] shrink-0 px-4 flex items-center gap-3 border-b border-[var(--border)]">
          <Sparkles size={16} color="var(--accent-2)" />
          <span className="text-[14px] font-medium">装备与搭配</span>
          <div className="ml-4 flex items-center rounded-lg border border-[var(--border)] overflow-hidden">
            <button
              className={`h-7 px-3 text-[11.5px] ${
                tab === 'gear' ? 'bg-[var(--accent-soft)] text-[var(--accent-2)]' : 'text-[var(--muted)]'
              }`}
              onClick={() => setTab('gear')}
            >
              我的装备
            </button>
            <button
              className={`h-7 px-3 text-[11.5px] ${
                tab === 'plan' ? 'bg-[var(--accent-soft)] text-[var(--accent-2)]' : 'text-[var(--muted)]'
              }`}
              onClick={() => setTab('plan')}
            >
              场景搭配
            </button>
          </div>
          <button className="btn btn-ghost h-7 px-1.5 ml-auto" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="mb-3 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-soft)] px-2.5 py-2 text-[11.5px] text-[var(--danger-text)]">
              {error}
            </div>
          )}

          {tab === 'gear' &&
            (editing ? (
              <GearForm
                form={editing}
                saving={saving}
                onChange={setEditing}
                onCancel={() => setEditing(null)}
                onSave={() => void save()}
              />
            ) : (
              <>
                {usage && usage.total > 0 && (
                  <div className="mb-2 text-[11px] text-[var(--faint)]">
                    已匹配 {usage.matched} / {usage.total} 张带 EXIF 的照片
                    {usage.matched < usage.total ? '（其余没对上的会显示为未匹配）' : ''}
                  </div>
                )}

                <div className="flex items-center gap-2 mb-2">
                  <div className="relative flex-1 max-w-[320px]">
                    <Search
                      size={13}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)] pointer-events-none"
                    />
                    <input
                      className="input w-full h-7 pl-8 text-[12px]"
                      placeholder="搜索我的设备…"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </div>
                  <button
                    className="btn btn-primary h-7 px-3 text-[11.5px]"
                    onClick={() => setPicker({ mode: 'add' })}
                  >
                    <Plus size={12} /> 搜索添加
                  </button>
                  <button
                    className="btn btn-ghost h-7 px-2 text-[11.5px]"
                    onClick={() => openManual('')}
                    title="型号不在目录里时，手动录入参数"
                  >
                    手动录入
                  </button>
                </div>

                <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                  <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
                    全部 {items.length}
                  </FilterChip>
                  {CATEGORY_ORDER.map((category) => {
                    const count = items.filter((item) => item.category === category).length
                    return (
                      <FilterChip
                        key={category}
                        active={filter === category}
                        onClick={() => setFilter(category)}
                      >
                        {CATEGORY_LABEL[category]} {count}
                      </FilterChip>
                    )
                  })}
                </div>

                {visibleItems.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[var(--border)] py-10 text-center">
                    <div className="text-[12.5px] text-[var(--muted)]">
                      {keyword ? '没有匹配的设备' : '还没有这类设备'}
                    </div>
                    <button
                      className="btn mt-3 h-7 px-3 text-[11.5px]"
                      onClick={() => setPicker({ mode: 'add' })}
                    >
                      搜索型号添加
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {visibleItems.map((item) => {
                      const Icon = CATEGORY_ICON[item.category]
                      return (
                        <div
                          key={item.id}
                          className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2"
                        >
                          <Icon size={15} color="var(--accent-2)" />
                          <div className="min-w-0">
                            <div className="text-[12.5px] text-[var(--text)] truncate">
                              {item.brand} {item.model}
                            </div>
                            <div className="text-[10.5px] text-[var(--faint)] truncate">
                              {CATEGORY_LABEL[item.category]} · {specSummary(item) || '未填写参数'}
                            </div>
                          </div>
                          <div className="ml-auto flex items-center gap-1">
                            {usage && (usage.byGear[item.id] ?? 0) > 0 && (
                              <span className="text-[10px] px-1.5 py-[1px] rounded bg-[var(--success-soft)] text-[var(--success)] whitespace-nowrap">
                                已拍 {usage.byGear[item.id]} 张
                              </span>
                            )}
                            <button
                              className="btn btn-ghost h-6 px-1.5"
                              title="更换型号（搜索）"
                              onClick={() => setPicker({ mode: 'replace', item })}
                            >
                              <Pencil size={12} />
                            </button>
                            <button
                              className="btn btn-ghost btn-danger h-6 px-1.5"
                              title="删除"
                              onClick={() => void remove(item)}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            ))}

          {tab === 'plan' && (
            <>
              <div className="flex flex-wrap gap-1.5 mb-1">
                {scenarios.map((item) => (
                  <FilterChip
                    key={item.id}
                    active={scenario === item.id}
                    onClick={() => setScenario(item.id)}
                  >
                    {item.name}
                  </FilterChip>
                ))}
              </div>
              {currentScenario && (
                <div className="text-[11px] text-[var(--faint)] mb-3">{currentScenario.hint}</div>
              )}

              {kits.length > 0 && (
                <div className="mb-3">
                  <div className="text-[11px] text-[var(--faint)] mb-1.5">我的方案</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {kits.map((kit) => {
                      const body = items.find((item) => item.id === kit.bodyId)
                      const lens = items.find((item) => item.id === kit.lensId)
                      const copyKey = `kit-${kit.id}`
                      return (
                        <div
                          key={kit.id}
                          className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2.5 py-2"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-[11.5px] text-[var(--text)] truncate">{kit.name}</span>
                            <button
                              className="btn btn-ghost h-5 px-1 ml-auto"
                              title="复制清单"
                              onClick={() => void copyText(copyKey, kitText(kit))}
                            >
                              <Copy size={11} />
                            </button>
                            <button
                              className="btn btn-ghost btn-danger h-5 px-1"
                              title="删除方案"
                              onClick={() => void removeKit(kit)}
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                          <div className="text-[10.5px] text-[var(--faint)] truncate">
                            {scenarioName(kit.scenario)} · {body?.model ?? '无机身'} +{' '}
                            {lens?.model ?? '无镜头'}
                            {kit.accessoryIds.length > 0 ? ` + ${kit.accessoryIds.length} 件配件` : ''}
                          </div>
                          {copied === copyKey && (
                            <div className="text-[10px] text-[var(--success)]">已复制到剪贴板</div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {recommendation && recommendation.plans.length === 0 && (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-4 py-8 text-center">
                  <div className="text-[12.5px] text-[var(--muted)]">还缺少基础设备</div>
                  <div className="mt-2 space-y-1">
                    {recommendation.missing.map((text) => (
                      <div key={text} className="text-[11.5px] text-[var(--warn)]">
                        ＋ {text}
                      </div>
                    ))}
                  </div>
                  <button
                    className="btn btn-primary mt-4 h-7 px-3 text-[11.5px]"
                    onClick={() => setTab('gear')}
                  >
                    去添加设备
                  </button>
                </div>
              )}

              {recommendation && recommendation.plans.length > 0 && (
                <div className="space-y-2.5">
                  {recommendation.plans.map((plan, index) => {
                    const key = planKey(plan)
                    const copyKey = `plan-${key}`
                    const weight =
                      ((plan.body?.weight ?? 0) +
                        (plan.lens?.weight ?? 0) +
                        plan.accessories.reduce((sum, item) => sum + (item.weight ?? 0), 0)) /
                      1000
                    return (
                      <div
                        key={key}
                        className={`rounded-xl border px-3 py-2.5 ${
                          index === 0
                            ? 'border-[var(--accent-border)] bg-[var(--accent-soft)]'
                            : 'border-[var(--border)] bg-[var(--panel-2)]'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <span
                            className={`text-[10.5px] px-1.5 py-[1px] rounded ${
                              index === 0
                                ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                                : 'bg-[var(--panel-3)] text-[var(--muted)]'
                            }`}
                          >
                            {index === 0 ? '首选' : '备选'}
                          </span>
                          <span className="text-[12.5px] text-[var(--text)]">
                            {plan.body?.brand} {plan.body?.model}
                          </span>
                          <span className="ml-auto text-[10.5px] text-[var(--faint)]">
                            匹配度 {plan.score}
                          </span>
                        </div>

                        <div className="space-y-1">
                          <PlanLine
                            label="镜头"
                            value={plan.lens ? `${plan.lens.brand} ${plan.lens.model}` : '无可用镜头'}
                          />
                          {plan.accessories.map((item) => (
                            <PlanLine
                              key={item.id}
                              label={CATEGORY_LABEL[item.category]}
                              value={`${item.brand} ${item.model}`}
                              tag="必带"
                            />
                          ))}
                          {plan.extras.map((item) => (
                            <PlanLine
                              key={item.id}
                              label={CATEGORY_LABEL[item.category]}
                              value={`${item.brand} ${item.model}`}
                              tag="可选"
                            />
                          ))}
                          {weight > 0 && (
                            <PlanLine label="重量" value={`约 ${weight.toFixed(1)} kg`} />
                          )}
                        </div>

                        {plan.reasons.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                            {plan.reasons.slice(0, 6).map((reason) => (
                              <span key={reason} className="text-[10.5px] text-[var(--success)]">
                                ✓ {reason}
                              </span>
                            ))}
                          </div>
                        )}
                        {plan.warnings.map((warning) => (
                          <div key={warning} className="mt-1 text-[10.5px] text-[var(--warn)]">
                            ! {warning}
                          </div>
                        ))}
                        {plan.missing.map((text) => (
                          <div key={text} className="mt-1 text-[10.5px] text-[var(--accent-2)]">
                            ＋ {text}
                          </div>
                        ))}

                        <div className="mt-2 flex items-center gap-2">
                          <button
                            className="btn btn-ghost h-6 px-2 text-[11px]"
                            onClick={() => void copyText(copyKey, planText(plan))}
                          >
                            <Copy size={11} /> {copied === copyKey ? '已复制' : '复制清单'}
                          </button>
                          {savingKitFor === key ? (
                            <div className="flex items-center gap-1">
                              <input
                                autoFocus
                                className="input h-6 w-[150px] text-[11px]"
                                placeholder="方案名称"
                                value={kitName}
                                onChange={(e) => setKitName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') void savePlanAsKit(plan)
                                  if (e.key === 'Escape') {
                                    setSavingKitFor(null)
                                    setKitName('')
                                  }
                                }}
                              />
                              <button
                                className="btn h-6 px-2 text-[11px]"
                                onClick={() => void savePlanAsKit(plan)}
                              >
                                保存
                              </button>
                              <button
                                className="btn btn-ghost h-6 px-1.5"
                                onClick={() => {
                                  setSavingKitFor(null)
                                  setKitName('')
                                }}
                              >
                                <X size={11} />
                              </button>
                            </div>
                          ) : (
                            <button
                              className="btn btn-ghost h-6 px-2 text-[11px]"
                              onClick={() => {
                                setSavingKitFor(key)
                                setKitName(`${scenarioName(plan.scenario)}方案`)
                              }}
                            >
                              <Plus size={11} /> 存为方案
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {picker && (
          <GearSearch
            mode={picker.mode}
            current={picker.item}
            suggestions={suggestions}
            items={items}
            defaultCategory={picker.item?.category ?? (filter === 'all' ? 'all' : filter)}
            onPick={(spec) => void applyPick(spec)}
            onManual={openManual}
            onClose={() => setPicker(null)}
          />
        )}
      </div>
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      className={`h-[26px] px-2 rounded-md border text-[11.5px] transition-colors ${
        active
          ? 'border-[var(--accent)] text-[var(--accent-2)] bg-[var(--accent-soft)]'
          : 'border-[var(--border)] text-[var(--muted)] bg-[var(--panel-2)]'
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function PlanLine({ label, value, tag }: { label: string; value: string; tag?: string }) {
  return (
    <div className="flex items-start gap-2 text-[11.5px] leading-5">
      <span className="w-[42px] shrink-0 text-[var(--faint)]">{label}</span>
      <span className="text-[var(--text)] break-all">{value}</span>
      {tag && (
        <span className="ml-auto shrink-0 text-[10px] text-[var(--faint)]">{tag}</span>
      )}
    </div>
  )
}

function GearForm({
  form,
  saving,
  onChange,
  onCancel,
  onSave
}: {
  form: GearSpec & { id?: string }
  saving: boolean
  onChange: (next: GearSpec & { id?: string }) => void
  onCancel: () => void
  onSave: () => void
}) {
  const patch = (next: Partial<GearSpec>): void => onChange({ ...form, ...next })
  const numberValue = (value?: number): string => (value === undefined ? '' : String(value))
  const parseNumber = (value: string): number | undefined => {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-3">
      <div className="text-[12px] text-[var(--text)] mb-2.5">
        {form.id ? '编辑设备' : '添加设备'}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <div className="text-[10.5px] text-[var(--faint)] mb-1">分类</div>
          <select
            className="input h-7 w-full text-[12px]"
            value={form.category}
            onChange={(e) => patch({ category: e.target.value as GearCategory })}
          >
            {CATEGORY_ORDER.map((category) => (
              <option key={category} value={category}>
                {CATEGORY_LABEL[category]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <div className="text-[10.5px] text-[var(--faint)] mb-1">品牌</div>
          <input
            className="input h-7 w-full text-[12px]"
            value={form.brand}
            onChange={(e) => patch({ brand: e.target.value })}
            placeholder="Nikon"
          />
        </label>
        <label className="block col-span-2">
          <div className="text-[10.5px] text-[var(--faint)] mb-1">型号</div>
          <input
            className="input h-7 w-full text-[12px]"
            value={form.model}
            onChange={(e) => patch({ model: e.target.value })}
            placeholder="NIKKOR Z 85mm f/1.8 S"
          />
        </label>

        {form.category === 'body' && (
          <>
            <label className="block">
              <div className="text-[10.5px] text-[var(--faint)] mb-1">卡口</div>
              <input
                className="input h-7 w-full text-[12px]"
                value={form.mount ?? ''}
                onChange={(e) => patch({ mount: e.target.value })}
                placeholder="Nikon Z"
              />
            </label>
            <label className="block">
              <div className="text-[10.5px] text-[var(--faint)] mb-1">画幅</div>
              <select
                className="input h-7 w-full text-[12px]"
                value={form.sensor ?? 'ff'}
                onChange={(e) => patch({ sensor: e.target.value as GearSpec['sensor'] })}
              >
                <option value="ff">全画幅</option>
                <option value="apsc">APS-C</option>
                <option value="m43">M4/3</option>
                <option value="compact">一英寸</option>
              </select>
            </label>
            <NumberInput label="像素（MP）" value={numberValue(form.megapixels)} onChange={(v) => patch({ megapixels: parseNumber(v) })} />
            <NumberInput label="连拍（张/秒）" value={numberValue(form.burst)} onChange={(v) => patch({ burst: parseNumber(v) })} />
            <NumberInput label="重量（g）" value={numberValue(form.weight)} onChange={(v) => patch({ weight: parseNumber(v) })} />
            <div className="flex items-end gap-3 pb-1">
              <Check label="机身防抖" checked={Boolean(form.ibis)} onChange={(v) => patch({ ibis: v })} />
              <Check label="支持 4K" checked={Boolean(form.video4k)} onChange={(v) => patch({ video4k: v })} />
            </div>
          </>
        )}

        {form.category === 'lens' && (
          <>
            <label className="block">
              <div className="text-[10.5px] text-[var(--faint)] mb-1">卡口</div>
              <input
                className="input h-7 w-full text-[12px]"
                value={form.mount ?? ''}
                onChange={(e) => patch({ mount: e.target.value })}
                placeholder="Nikon Z"
              />
            </label>
            <NumberInput label="最大光圈" value={numberValue(form.aperture)} onChange={(v) => patch({ aperture: parseNumber(v) })} placeholder="1.8" />
            <NumberInput label="最短焦距" value={numberValue(form.focalMin)} onChange={(v) => patch({ focalMin: parseNumber(v) })} placeholder="85" />
            <NumberInput label="最长焦距" value={numberValue(form.focalMax)} onChange={(v) => patch({ focalMax: parseNumber(v) })} placeholder="85" />
            <NumberInput label="重量（g）" value={numberValue(form.weight)} onChange={(v) => patch({ weight: parseNumber(v) })} />
            <div className="flex items-end gap-3 pb-1">
              <Check label="微距" checked={Boolean(form.macro)} onChange={(v) => patch({ macro: v })} />
              <Check label="镜头防抖" checked={Boolean(form.stabilized)} onChange={(v) => patch({ stabilized: v })} />
            </div>
          </>
        )}

        {(form.category === 'tripod' || form.category === 'gimbal') && (
          <>
            <NumberInput label="承重（kg）" value={numberValue(form.payload)} onChange={(v) => patch({ payload: parseNumber(v) })} />
            <NumberInput label="自重（g）" value={numberValue(form.weight)} onChange={(v) => patch({ weight: parseNumber(v) })} />
          </>
        )}

        {(form.category === 'flash' || form.category === 'light') && (
          <>
            <NumberInput label="功率 / GN" value={numberValue(form.power)} onChange={(v) => patch({ power: parseNumber(v) })} />
            <NumberInput label="重量（g）" value={numberValue(form.weight)} onChange={(v) => patch({ weight: parseNumber(v) })} />
          </>
        )}

        <label className="block col-span-2">
          <div className="text-[10.5px] text-[var(--faint)] mb-1">备注</div>
          <input
            className="input h-7 w-full text-[12px]"
            value={form.note ?? ''}
            onChange={(e) => patch({ note: e.target.value })}
            placeholder="选填，比如购买时间、成色"
          />
        </label>
      </div>

      <div className="flex justify-end gap-2 mt-3">
        <button className="btn h-7 px-3 text-[11.5px]" onClick={onCancel}>
          取消
        </button>
        <button className="btn btn-primary h-7 px-4 text-[11.5px]" disabled={saving} onClick={onSave}>
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  )
}

function NumberInput({
  label,
  value,
  onChange,
  placeholder
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <label className="block">
      <div className="text-[10.5px] text-[var(--faint)] mb-1">{label}</div>
      <input
        className="input h-7 w-full text-[12px]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode="decimal"
      />
    </label>
  )
}

function Check({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-[11.5px] text-[var(--muted)] cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-[var(--accent)]"
      />
      {label}
    </label>
  )
}
