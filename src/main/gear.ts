import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { getDb } from './db'
import type {
  GearCategory,
  GearItem,
  GearKit,
  GearPlan,
  GearRecommendation,
  GearSpec,
  GearUsage,
  ScenarioId,
  ScenarioOption,
  SensorSize
} from '../shared/types'

const CATEGORY_SET = new Set<GearCategory>(['body', 'lens', 'tripod', 'flash', 'light', 'gimbal', 'other'])

/** 常见设备目录：只是录入时的快捷模板，不代表用户拥有 */
export const GEAR_CATALOG: GearSpec[] = [
  // 机身
  { category: 'body', brand: 'Nikon', model: 'Zf', mount: 'Nikon Z', sensor: 'ff', megapixels: 24.5, ibis: true, burst: 14, video4k: true, weight: 710 },
  { category: 'body', brand: 'Nikon', model: 'Z6III', mount: 'Nikon Z', sensor: 'ff', megapixels: 24.5, ibis: true, burst: 20, video4k: true, weight: 760 },
  { category: 'body', brand: 'Nikon', model: 'Z8', mount: 'Nikon Z', sensor: 'ff', megapixels: 45.7, ibis: true, burst: 20, video4k: true, weight: 910 },
  { category: 'body', brand: 'Nikon', model: 'Z fc', mount: 'Nikon Z', sensor: 'apsc', megapixels: 20.9, ibis: false, burst: 11, video4k: true, weight: 445 },
  { category: 'body', brand: 'Nikon', model: 'Z50II', mount: 'Nikon Z', sensor: 'apsc', megapixels: 20.9, ibis: false, burst: 11, video4k: true, weight: 550 },
  { category: 'body', brand: 'Sony', model: 'A7C II', mount: 'Sony E', sensor: 'ff', megapixels: 33, ibis: true, burst: 10, video4k: true, weight: 514 },
  { category: 'body', brand: 'Canon', model: 'EOS R6 Mark II', mount: 'Canon RF', sensor: 'ff', megapixels: 24.2, ibis: true, burst: 40, video4k: true, weight: 670 },
  { category: 'body', brand: 'Fujifilm', model: 'X-T5', mount: 'Fujifilm X', sensor: 'apsc', megapixels: 40.2, ibis: true, burst: 15, video4k: true, weight: 557 },
  // 镜头
  { category: 'lens', brand: 'Nikon', model: 'NIKKOR Z 24-70mm f/2.8 S', mount: 'Nikon Z', focalMin: 24, focalMax: 70, aperture: 2.8, weight: 805 },
  { category: 'lens', brand: 'Nikon', model: 'NIKKOR Z 24-120mm f/4 S', mount: 'Nikon Z', focalMin: 24, focalMax: 120, aperture: 4, weight: 630 },
  { category: 'lens', brand: 'Nikon', model: 'NIKKOR Z 85mm f/1.8 S', mount: 'Nikon Z', focalMin: 85, focalMax: 85, aperture: 1.8, weight: 470 },
  { category: 'lens', brand: 'Nikon', model: 'NIKKOR Z 50mm f/1.8 S', mount: 'Nikon Z', focalMin: 50, focalMax: 50, aperture: 1.8, weight: 415 },
  { category: 'lens', brand: 'Nikon', model: 'NIKKOR Z 35mm f/1.8 S', mount: 'Nikon Z', focalMin: 35, focalMax: 35, aperture: 1.8, weight: 370 },
  { category: 'lens', brand: 'Nikon', model: 'NIKKOR Z 14-24mm f/2.8 S', mount: 'Nikon Z', focalMin: 14, focalMax: 24, aperture: 2.8, weight: 650 },
  { category: 'lens', brand: 'Nikon', model: 'NIKKOR Z 70-200mm f/2.8 VR S', mount: 'Nikon Z', focalMin: 70, focalMax: 200, aperture: 2.8, stabilized: true, weight: 1360 },
  { category: 'lens', brand: 'Nikon', model: 'NIKKOR Z MC 105mm f/2.8 VR S', mount: 'Nikon Z', focalMin: 105, focalMax: 105, aperture: 2.8, macro: true, stabilized: true, weight: 630 },
  { category: 'lens', brand: 'Nikon', model: 'NIKKOR Z 100-400mm f/4.5-5.6 VR S', mount: 'Nikon Z', focalMin: 100, focalMax: 400, aperture: 4.5, stabilized: true, weight: 1355 },
  { category: 'lens', brand: 'Nikon', model: 'NIKKOR Z 28mm f/2.8 SE', mount: 'Nikon Z', focalMin: 28, focalMax: 28, aperture: 2.8, weight: 160 },
  { category: 'lens', brand: 'Sony', model: 'FE 24-70mm f/2.8 GM II', mount: 'Sony E', focalMin: 24, focalMax: 70, aperture: 2.8, weight: 695 },
  { category: 'lens', brand: 'Sony', model: 'FE 85mm f/1.8', mount: 'Sony E', focalMin: 85, focalMax: 85, aperture: 1.8, weight: 371 },
  { category: 'lens', brand: 'Canon', model: 'RF 24-105mm f/4 L IS', mount: 'Canon RF', focalMin: 24, focalMax: 105, aperture: 4, stabilized: true, weight: 700 },
  { category: 'lens', brand: 'Canon', model: 'RF 85mm f/2 Macro IS', mount: 'Canon RF', focalMin: 85, focalMax: 85, aperture: 2, macro: true, stabilized: true, weight: 500 },
  { category: 'lens', brand: 'Fujifilm', model: 'XF 16-55mm f/2.8 R LM WR', mount: 'Fujifilm X', focalMin: 16, focalMax: 55, aperture: 2.8, weight: 655 },
  { category: 'lens', brand: 'Fujifilm', model: 'XF 56mm f/1.2 R', mount: 'Fujifilm X', focalMin: 56, focalMax: 56, aperture: 1.2, weight: 405 },
  // 支撑与灯光
  { category: 'tripod', brand: 'Gitzo', model: 'GT2545T 旅行者三脚架', payload: 12, weight: 1700 },
  { category: 'tripod', brand: '马小路', model: 'MT-2542 碳纤维三脚架', payload: 10, weight: 1200 },
  { category: 'tripod', brand: 'Manfrotto', model: 'Befree Advanced 三脚架', payload: 5, weight: 1400 },
  { category: 'flash', brand: 'Nikon', model: 'SB-700 闪光灯', power: 28, weight: 420 },
  { category: 'flash', brand: 'Godox', model: 'V1 Pro 圆头闪光灯', power: 76, weight: 580 },
  { category: 'light', brand: 'Godox', model: 'LED P120C 补光灯', power: 30, weight: 460 },
  { category: 'light', brand: 'Godox', model: 'SL60W 常亮补光灯', power: 60, weight: 1500 },
  { category: 'gimbal', brand: 'DJI', model: 'RS 4 稳定器', payload: 3, weight: 890 },
  { category: 'gimbal', brand: 'Zhiyun', model: 'Crane M3 稳定器', payload: 1.2, weight: 600 }
]

interface ScenarioSpec extends ScenarioOption {
  targetFocal: number
  apertureNeed: number
  sensorBonus: Partial<Record<SensorSize, number>>
  wantIbis: boolean
  wantBurst: boolean
  wantVideo: boolean
  wantMacro: boolean
  weightCap?: number
  wantMegapixels: boolean
  needTripod: boolean
  needFlash: boolean
  needLight: boolean
  needGimbal: boolean
  coverage?: [number, number]
  lensTip: string
  optional?: {
    tripod?: boolean
    flash?: boolean
    light?: boolean
    gimbal?: boolean
  }
}

const SCENARIOS: ScenarioSpec[] = [
  {
    id: 'portrait',
    name: '人像',
    hint: '大光圈虚化、肤色与眼神光',
    targetFocal: 85,
    apertureNeed: 2,
    sensorBonus: { ff: 12, apsc: 4 },
    wantIbis: true,
    wantBurst: false,
    wantVideo: false,
    wantMacro: false,
    wantMegapixels: false,
    needTripod: false,
    needFlash: true,
    needLight: false,
    needGimbal: false,
    lensTip: '85mm 左右的大光圈定焦',
    optional: { tripod: true, light: true }
  },
  {
    id: 'landscape',
    name: '风光',
    hint: '广角、高像素、稳定支撑',
    targetFocal: 24,
    apertureNeed: 4,
    sensorBonus: { ff: 14, apsc: 2 },
    wantIbis: false,
    wantBurst: false,
    wantVideo: false,
    wantMacro: false,
    weightCap: 4200,
    wantMegapixels: true,
    needTripod: true,
    needFlash: false,
    needLight: false,
    needGimbal: false,
    coverage: [14, 35],
    lensTip: '14-24mm 或 16-35mm 这一档广角'
  },
  {
    id: 'street',
    name: '人文 / 街拍',
    hint: '轻便、快速、隐蔽',
    targetFocal: 35,
    apertureNeed: 2.8,
    sensorBonus: { ff: 10, apsc: 8 },
    wantIbis: true,
    wantBurst: false,
    wantVideo: false,
    wantMacro: false,
    weightCap: 1300,
    wantMegapixels: false,
    needTripod: false,
    needFlash: false,
    needLight: false,
    needGimbal: false,
    lensTip: '35mm 或 28mm 的轻便定焦',
    optional: { flash: true }
  },
  {
    id: 'event',
    name: '婚礼 / 活动',
    hint: '焦段覆盖广、需要补光',
    targetFocal: 50,
    apertureNeed: 2.8,
    sensorBonus: { ff: 10, apsc: 4 },
    wantIbis: true,
    wantBurst: false,
    wantVideo: false,
    wantMacro: false,
    weightCap: 3000,
    wantMegapixels: false,
    needTripod: false,
    needFlash: true,
    needLight: false,
    needGimbal: false,
    coverage: [24, 105],
    lensTip: '24-70mm 或 24-120mm 这类标准变焦',
    optional: { light: true, tripod: true }
  },
  {
    id: 'astro',
    name: '星空',
    hint: '超广角大光圈 + 三脚架',
    targetFocal: 20,
    apertureNeed: 2.8,
    sensorBonus: { ff: 16, apsc: 2 },
    wantIbis: false,
    wantBurst: false,
    wantVideo: false,
    wantMacro: false,
    wantMegapixels: false,
    needTripod: true,
    needFlash: false,
    needLight: false,
    needGimbal: false,
    coverage: [14, 24],
    lensTip: '14-24mm 或 20mm 这一档超广角',
    optional: { light: true }
  },
  {
    id: 'macro',
    name: '微距',
    hint: '放大倍率、稳定与补光',
    targetFocal: 100,
    apertureNeed: 4,
    sensorBonus: { ff: 8, apsc: 6 },
    wantIbis: true,
    wantBurst: false,
    wantVideo: false,
    wantMacro: true,
    wantMegapixels: false,
    needTripod: true,
    needFlash: false,
    needLight: true,
    needGimbal: false,
    lensTip: '90-105mm 的微距镜头',
    optional: { flash: true }
  },
  {
    id: 'video',
    name: '视频 / Vlog',
    hint: '稳定性、4K、防抖',
    targetFocal: 35,
    apertureNeed: 4,
    sensorBonus: { ff: 8, apsc: 8 },
    wantIbis: true,
    wantBurst: false,
    wantVideo: true,
    wantMacro: false,
    weightCap: 3000,
    wantMegapixels: false,
    needTripod: false,
    needFlash: false,
    needLight: false,
    needGimbal: true,
    coverage: [16, 70],
    lensTip: '16-35mm 或 24-70mm 这类视频常用变焦',
    optional: { light: true, tripod: true }
  },
  {
    id: 'travel',
    name: '旅行',
    hint: '一机一镜、轻便覆盖广',
    targetFocal: 28,
    apertureNeed: 4,
    sensorBonus: { ff: 8, apsc: 10 },
    wantIbis: true,
    wantBurst: false,
    wantVideo: false,
    wantMacro: false,
    weightCap: 1400,
    wantMegapixels: false,
    needTripod: false,
    needFlash: false,
    needLight: false,
    needGimbal: false,
    coverage: [16, 120],
    lensTip: '24-120mm 这类旅行变焦，或 28mm 轻便定焦',
    optional: { tripod: true }
  },
  {
    id: 'product',
    name: '产品 / 静物',
    hint: '细节、布光与稳定',
    targetFocal: 70,
    apertureNeed: 4,
    sensorBonus: { ff: 10, apsc: 4 },
    wantIbis: true,
    wantBurst: false,
    wantVideo: false,
    wantMacro: true,
    wantMegapixels: true,
    needTripod: true,
    needFlash: false,
    needLight: true,
    needGimbal: false,
    lensTip: '微距镜头或 50-105mm 中焦定焦',
    optional: { flash: true }
  },
  {
    id: 'sports',
    name: '运动 / 打鸟',
    hint: '长焦、连拍与追焦',
    targetFocal: 300,
    apertureNeed: 4,
    sensorBonus: { ff: 8, apsc: 12 },
    wantIbis: true,
    wantBurst: true,
    wantVideo: false,
    wantMacro: false,
    weightCap: 5000,
    wantMegapixels: false,
    needTripod: true,
    needFlash: false,
    needLight: false,
    needGimbal: false,
    coverage: [100, 400],
    lensTip: '100-400mm 或 200-600mm 这类长焦'
  },
  {
    id: 'indoor',
    name: '室内闪光',
    hint: '小空间、可控布光',
    targetFocal: 35,
    apertureNeed: 2.8,
    sensorBonus: { ff: 10, apsc: 6 },
    wantIbis: true,
    wantBurst: false,
    wantVideo: false,
    wantMacro: false,
    weightCap: 3000,
    wantMegapixels: false,
    needTripod: false,
    needFlash: true,
    needLight: false,
    needGimbal: false,
    lensTip: '35mm 或 50mm 定焦，室内也能收进环境',
    optional: { light: true, tripod: true }
  },
  {
    id: 'lowlight',
    name: '弱光手持',
    hint: '大光圈 + 防抖，尽量不依赖脚架',
    targetFocal: 35,
    apertureNeed: 1.8,
    sensorBonus: { ff: 14, apsc: 4 },
    wantIbis: true,
    wantBurst: false,
    wantVideo: false,
    wantMacro: false,
    wantMegapixels: false,
    needTripod: false,
    needFlash: false,
    needLight: false,
    needGimbal: false,
    lensTip: '35mm 或 50mm 的 f/1.8 以上定焦',
    optional: { light: true }
  },
  {
    id: 'timelapse',
    name: '延时摄影',
    hint: '固定机位、长时间稳定',
    targetFocal: 24,
    apertureNeed: 4,
    sensorBonus: { ff: 10, apsc: 4 },
    wantIbis: false,
    wantBurst: false,
    wantVideo: false,
    wantMacro: false,
    weightCap: 5000,
    wantMegapixels: true,
    needTripod: true,
    needFlash: false,
    needLight: false,
    needGimbal: false,
    coverage: [16, 35],
    lensTip: '16-35mm 或 24mm 广角，方便固定机位',
    optional: { light: true }
  }
]

const MONTHS: Record<SensorSize, string> = {
  ff: '全画幅',
  apsc: 'APS-C',
  m43: 'M4/3',
  compact: '一英寸'
}

function storePath(): string {
  return join(app.getPath('userData'), 'gear.json')
}

interface GearStore {
  items: GearItem[]
  kits: GearKit[]
}

let storeCache: GearStore | null = null

function loadStore(): GearStore {
  if (storeCache) return storeCache
  try {
    if (!existsSync(storePath())) {
      storeCache = { items: [], kits: [] }
      return storeCache
    }
    const parsed = JSON.parse(readFileSync(storePath(), 'utf8')) as Partial<GearStore>
    const items = Array.isArray(parsed.items)
      ? parsed.items.filter((item) => item && CATEGORY_SET.has(item.category) && typeof item.id === 'string')
      : []
    const kits = Array.isArray(parsed.kits)
      ? parsed.kits.filter(
          (kit) =>
            kit &&
            typeof kit.id === 'string' &&
            typeof kit.name === 'string' &&
            Array.isArray(kit.accessoryIds)
        )
      : []
    storeCache = { items, kits }
    return storeCache
  } catch {
    storeCache = { items: [], kits: [] }
    return storeCache
  }
}

function persistStore(next: GearStore): void {
  storeCache = next
  try {
    writeFileSync(storePath(), JSON.stringify(next, null, 2), 'utf8')
  } catch {
    /* 写入失败不阻塞界面，内存里仍然可用 */
  }
}

function load(): GearItem[] {
  return loadStore().items
}

function persist(items: GearItem[]): void {
  persistStore({ ...loadStore(), items })
}

function clean(input: GearSpec): GearSpec {
  const number = (value?: number): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
  return {
    category: input.category,
    brand: (input.brand ?? '').trim(),
    model: (input.model ?? '').trim(),
    note: (input.note ?? '').trim() || undefined,
    mount: (input.mount ?? '').trim() || undefined,
    sensor: input.sensor,
    megapixels: number(input.megapixels),
    ibis: Boolean(input.ibis),
    burst: number(input.burst),
    video4k: Boolean(input.video4k),
    weight: number(input.weight),
    focalMin: number(input.focalMin),
    focalMax: number(input.focalMax),
    aperture: number(input.aperture),
    macro: Boolean(input.macro),
    stabilized: Boolean(input.stabilized),
    payload: number(input.payload),
    power: number(input.power)
  }
}

export function listGear(): GearItem[] {
  return [...load()].sort((a, b) => a.createdAt - b.createdAt)
}

export function saveGear(input: GearSpec & { id?: string }): GearItem {
  if (!CATEGORY_SET.has(input.category)) throw new Error('设备分类不正确')
  const spec = clean(input)
  if (!spec.model) throw new Error('请填写设备型号')
  const items = [...load()]
  if (input.id) {
    const index = items.findIndex((item) => item.id === input.id)
    if (index < 0) throw new Error('设备不存在')
    items[index] = { ...items[index], ...spec }
    persist(items)
    return items[index]
  }
  const item: GearItem = { ...spec, id: randomUUID(), createdAt: Date.now() }
  items.push(item)
  persist(items)
  return item
}

export function deleteGear(id: string): void {
  const store = loadStore()
  persistStore({
    items: store.items.filter((item) => item.id !== id),
    kits: store.kits.map((kit) => ({
      ...kit,
      bodyId: kit.bodyId === id ? null : kit.bodyId,
      lensId: kit.lensId === id ? null : kit.lensId,
      accessoryIds: kit.accessoryIds.filter((accessoryId) => accessoryId !== id)
    }))
  })
}

export function listKits(): GearKit[] {
  return [...loadStore().kits].sort((a, b) => b.createdAt - a.createdAt)
}

export function saveKit(input: {
  name: string
  scenario: ScenarioId
  bodyId?: string
  lensId?: string
  accessoryIds?: string[]
}): GearKit {
  const name = input.name.trim()
  if (!name) throw new Error('给这套方案起个名字')
  const kit: GearKit = {
    id: randomUUID(),
    name,
    scenario: input.scenario,
    bodyId: input.bodyId ?? null,
    lensId: input.lensId ?? null,
    accessoryIds: Array.from(new Set(input.accessoryIds ?? [])),
    createdAt: Date.now()
  }
  const store = loadStore()
  persistStore({ ...store, kits: [kit, ...store.kits].slice(0, 20) })
  return kit
}

export function deleteKit(id: string): void {
  const store = loadStore()
  persistStore({ ...store, kits: store.kits.filter((kit) => kit.id !== id) })
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '')
}

/** EXIF 里的器材名和用户填写的品牌型号做模糊匹配 */
function matchesGear(text: string, gear: GearItem): boolean {
  const haystack = normalizeText(text)
  const model = normalizeText(gear.model)
  const brand = normalizeText(gear.brand)
  if (!haystack || !model) return false
  // 型号够长时只看型号（NIKKOR / EOS R6 Mark II 这类）
  if (model.length >= 5) return haystack.includes(model)
  // 短型号（Zf / Z8 / X-T5）要求品牌也对上，避免误判
  return (!brand || haystack.includes(brand)) && haystack.includes(model)
}

export function gearUsage(): GearUsage {
  const items = loadStore().items
  const bodies = items.filter((item) => item.category === 'body')
  const lenses = items.filter((item) => item.category === 'lens')
  const byGear: Record<string, number> = {}
  let total = 0
  let matched = 0

  let rows: Array<{ exif: string }> = []
  try {
    rows = getDb()
      .prepare('SELECT exif FROM items WHERE trashed = 0 AND missing = 0 AND exif IS NOT NULL')
      .all() as Array<{ exif: string }>
  } catch {
    return { total: 0, matched: 0, byGear }
  }

  for (const row of rows) {
    let exif: { camera?: string; lens?: string } | null = null
    try {
      exif = JSON.parse(row.exif) as { camera?: string; lens?: string }
    } catch {
      continue
    }
    const camera = exif?.camera ?? ''
    const lens = exif?.lens ?? ''
    if (!camera && !lens) continue
    total++
    let hit = false
    for (const body of bodies) {
      if (matchesGear(camera, body)) {
        byGear[body.id] = (byGear[body.id] ?? 0) + 1
        hit = true
      }
    }
    for (const item of lenses) {
      if (matchesGear(lens, item)) {
        byGear[item.id] = (byGear[item.id] ?? 0) + 1
        hit = true
      }
    }
    if (hit) matched++
  }

  return { total, matched, byGear }
}

export function gearCatalog(): GearSpec[] {
  return GEAR_CATALOG
}

export function gearScenarios(): ScenarioOption[] {
  return SCENARIOS.map(({ id, name, hint }) => ({ id, name, hint }))
}

function lensRange(lens: GearItem): [number, number] {
  const min = lens.focalMin ?? lens.focalMax ?? 0
  const max = lens.focalMax ?? lens.focalMin ?? 0
  return [Math.min(min, max), Math.max(min, max)]
}

function scoreBody(body: GearItem, spec: ScenarioSpec): { score: number; reasons: string[] } {
  let score = 40
  const reasons: string[] = []
  const sensor = body.sensor ?? 'ff'
  score += spec.sensorBonus[sensor] ?? 0
  if (body.sensor) reasons.push(MONTHS[sensor])
  if (spec.wantIbis && body.ibis) {
    score += 10
    reasons.push('机身防抖')
  }
  if (spec.wantBurst && (body.burst ?? 0) >= 10) {
    score += 12
    reasons.push(`${body.burst} 张/秒连拍`)
  }
  if (spec.wantVideo && body.video4k) {
    score += 12
    reasons.push('4K 视频')
  }
  if (spec.wantMegapixels && (body.megapixels ?? 0) >= 40) {
    score += 8
    reasons.push(`${body.megapixels}MP 高像素`)
  }
  if (spec.weightCap && body.weight) {
    if (body.weight > spec.weightCap) score -= 18
    else score += 5
  }
  return { score, reasons }
}

function scoreLens(
  lens: GearItem,
  body: GearItem,
  spec: ScenarioSpec
): { score: number; reasons: string[]; warnings: string[] } {
  let score = 40
  const reasons: string[] = []
  const warnings: string[] = []
  const [min, max] = lensRange(lens)

  if (spec.targetFocal >= min && spec.targetFocal <= max) {
    score += 25
    reasons.push(`${spec.targetFocal}mm 在焦段内`)
  } else {
    const gap = spec.targetFocal < min ? min - spec.targetFocal : spec.targetFocal - max
    score += Math.max(0, 18 - gap / 3)
  }

  if (lens.aperture) {
    if (lens.aperture <= 2) {
      score += 18
      reasons.push(`f/${lens.aperture} 大光圈`)
    } else if (lens.aperture <= 2.8) {
      score += 12
      reasons.push(`f/${lens.aperture} 光圈`)
    } else if (lens.aperture <= spec.apertureNeed) {
      score += 6
    } else {
      score -= 6
      warnings.push(`f/${lens.aperture} 光圈偏小，弱光下要留意快门`)
    }
  }

  if (spec.wantMacro) {
    if (lens.macro) {
      score += 26
      reasons.push('微距能力')
    } else {
      score -= 12
      warnings.push('这支镜头不是微距镜头，放大倍率有限')
    }
  }

  if (!body.ibis && lens.stabilized) {
    score += 8
    reasons.push('镜头防抖')
  }
  if (!body.ibis && !lens.stabilized && spec.wantIbis) {
    warnings.push('机身和镜头都没有防抖，注意安全快门')
  }

  if (spec.coverage) {
    if (min <= spec.coverage[0] && max >= spec.coverage[1]) {
      score += 8
      reasons.push('覆盖常用焦段')
    }
  }

  if (spec.weightCap) {
    const total = (body.weight ?? 0) + (lens.weight ?? 0)
    if (total > spec.weightCap) score -= 14
  }

  return { score, reasons, warnings }
}

function pickAccessory(
  items: GearItem[],
  category: GearCategory,
  neededPayload?: number
): GearItem | null {
  const list = items.filter((item) => item.category === category)
  if (list.length === 0) return null
  if (neededPayload) {
    const enough = list
      .filter((item) => (item.payload ?? 0) >= neededPayload)
      .sort((a, b) => (a.weight ?? 0) - (b.weight ?? 0))
    if (enough.length > 0) return enough[0]
    return [...list].sort((a, b) => (b.payload ?? 0) - (a.payload ?? 0))[0]
  }
  return [...list].sort((a, b) => (b.power ?? 0) - (a.power ?? 0))[0]
}

export function recommendGear(scenario: ScenarioId): GearRecommendation {
  const spec = SCENARIOS.find((item) => item.id === scenario)
  if (!spec) throw new Error('未知的拍摄场景')

  const items = load()
  const bodies = items.filter((item) => item.category === 'body')
  const lenses = items.filter((item) => item.category === 'lens')
  const globalMissing: string[] = []
  if (bodies.length === 0) globalMissing.push('先在「我的装备」里添加一台机身')
  if (lenses.length === 0) globalMissing.push('再添加至少一支镜头')
  if (bodies.length === 0 || lenses.length === 0) {
    return { scenario, plans: [], missing: globalMissing }
  }

  const plans: GearPlan[] = []
  for (const body of bodies.slice(0, 8)) {
    const compatible = body.mount
      ? lenses.filter((lens) => (lens.mount ?? '').toLowerCase() === body.mount?.toLowerCase())
      : lenses
    if (compatible.length === 0) {
      plans.push({
        scenario,
        body,
        lens: null,
        accessories: [],
        extras: [],
        score: 0,
        reasons: [],
        warnings: [`没有 ${body.mount ?? '该卡口'} 的镜头`],
        missing: [`补一支 ${spec.lensTip}`]
      })
      continue
    }
    let added = false
    for (const lens of compatible.slice(0, 8)) {
      const [lensMin, lensMax] = lensRange(lens)
      // 完全够不到场景目标焦段的镜头不进候选，避免出现“风光配 85mm”这种奇怪搭配
      const gap =
        spec.targetFocal < lensMin
          ? lensMin - spec.targetFocal
          : spec.targetFocal > lensMax
            ? spec.targetFocal - lensMax
            : 0
      if (gap > 45) continue

      const bodyScore = scoreBody(body, spec)
      const lensScore = scoreLens(lens, body, spec)
      const reasons = [...bodyScore.reasons, ...lensScore.reasons]
      const warnings = [...lensScore.warnings]
      const missing: string[] = []
      const accessories: GearItem[] = []
      const totalWeight = (body.weight ?? 0) + (lens.weight ?? 0)

      if (spec.needTripod) {
        const needed = Math.max(2, Math.round((totalWeight + 600) / 1000))
        const tripod = pickAccessory(items, 'tripod', needed)
        if (tripod) {
          accessories.push(tripod)
          if ((tripod.payload ?? 0) < needed) {
            warnings.push(`三脚架承重不足，建议 ≥ ${needed}kg`)
          } else {
            reasons.push('三脚架保证稳定')
          }
        } else {
          missing.push(`补一个承重 ≥ ${needed}kg 的三脚架`)
        }
      }
      if (spec.needFlash) {
        const flash = pickAccessory(items, 'flash')
        if (flash) {
          accessories.push(flash)
          reasons.push('闪光灯补光')
        } else {
          missing.push('补一支闪光灯')
        }
      }
      if (spec.needLight) {
        const light = pickAccessory(items, 'light')
        if (light) {
          accessories.push(light)
          reasons.push('常亮补光灯')
        } else {
          missing.push('补一支补光灯')
        }
      }
      if (spec.needGimbal) {
        const needed = Math.max(1, Math.round(((body.weight ?? 0) + (lens.weight ?? 0)) / 1000))
        const gimbal = pickAccessory(items, 'gimbal', needed)
        if (gimbal) {
          accessories.push(gimbal)
          if ((gimbal.payload ?? 0) < needed) {
            warnings.push(`稳定器承重不足，建议 ≥ ${needed}kg`)
          } else {
            reasons.push('稳定器保证运镜')
          }
        } else {
          missing.push(`补一个承重 ≥ ${needed}kg 的稳定器`)
        }
      }
      if (spec.weightCap && totalWeight > spec.weightCap) {
        warnings.push(`整套约 ${(totalWeight / 1000).toFixed(1)}kg，超过轻装上限`)
      }

      // 可选配件：有就列出来，不强制、也不计入缺失提示
      const extras: GearItem[] = []
      const optional = spec.optional ?? {}
      const pickExtra = (category: GearCategory): void => {
        const item = pickAccessory(items, category)
        if (!item) return
        if (accessories.some((accessory) => accessory.id === item.id)) return
        if (extras.some((extra) => extra.id === item.id)) return
        extras.push(item)
      }
      if (optional.tripod) pickExtra('tripod')
      if (optional.flash) pickExtra('flash')
      if (optional.light) pickExtra('light')
      if (optional.gimbal) pickExtra('gimbal')

      plans.push({
        scenario,
        body,
        lens,
        accessories,
        extras,
        score: Math.round(bodyScore.score + lensScore.score),
        reasons: Array.from(new Set(reasons)),
        warnings: Array.from(new Set(warnings)),
        missing
      })
      added = true
    }

    if (!added) {
      plans.push({
        scenario,
        body,
        lens: null,
        accessories: [],
        extras: [],
        score: 0,
        reasons: [],
        warnings: ['现有镜头都够不到这个场景的焦段'],
        missing: [`补一支 ${spec.lensTip}`]
      })
    }
  }

  plans.sort((a, b) => b.score - a.score)
  const seen = new Set<string>()
  const top: GearPlan[] = []
  for (const plan of plans) {
    const key = `${plan.body?.id ?? ''}-${plan.lens?.id ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    top.push(plan)
    if (top.length >= 3) break
  }
  return { scenario, plans: top, missing: globalMissing }
}
