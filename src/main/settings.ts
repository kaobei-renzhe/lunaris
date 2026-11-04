import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type {
  AutoTagSettings,
  EmbeddingModelId,
  FinalsDefaults,
  ImportOptions,
  LibraryEntry,
  PickDefaults,
  PickWatermarkStyle,
  ThemeMode,
  XmpSettings
} from '../shared/types'
import { PICK_WATERMARK_DEFAULT, normalizePickWatermark } from '../shared/pick'
import type { LayoutSizes } from '../shared/layout'
import { normalizeLayout } from '../shared/layout'
import type { ThumbQualityPref } from '../shared/thumbs'
import { THUMB_CACHE_LIMIT_DEFAULT, THUMB_QUALITY_DEFAULT, isThumbQualityPref } from '../shared/thumbs'
import type { LlmConfig } from '../shared/llm'
import { DEFAULT_SKIN, isSkinId, type SkinId } from '../shared/skins'

export interface AutoBackupSettings {
  enabled: boolean
  intervalDays: number
  keep: number
  directory: string | null
  lastRunAt: number
}

export interface AppConfig {
  library?: string
  /** 图库路径 → 索引目录（library.db / thumbnails / previews）；没有记录就放在图库目录里 */
  libraryIndex?: Record<string, string>
  /** 多图库清单；老配置没有这个字段，启动时由 library 迁移一次 */
  libraries?: LibraryEntry[]
  autoBackup?: Partial<AutoBackupSettings>
  autoTag?: Partial<AutoTagSettings> & {
    /** 每个模型各自记一份阈值；老配置只有 threshold，按 Chinese-CLIP 处理 */
    thresholds?: Partial<Record<EmbeddingModelId, number>>
  }
  importOptions?: Partial<ImportOptions>
  clipAutoIndex?: boolean
  /** 当前使用的内嵌语义模型；不填按 Chinese-CLIP 处理，老配置零迁移 */
  embeddingModel?: EmbeddingModelId
  skin?: SkinId
  relocate?: { lastDir?: string }
  theme?: ThemeMode
  /** 左栏 / 右栏拖过的宽度 */
  layout?: Partial<LayoutSizes>
  /** 瀑布流缩略图清晰度（auto = 按卡片实际像素自动选档） */
  thumbQuality?: ThumbQualityPref
  /** 高清缩略图缓存上限（MB），0 = 不限 */
  thumbCacheLimitMB?: number
  /** AI 评分的最低星级：0 = 全部；>0 时只评 rating >= N，未标星（0 星）不参与 */
  aiScoreMinRating?: number
  /** AI 处理范围：只处理这些文件夹里的照片；空数组 = 不限 */
  aiFolderIds?: number[]
  llm?: Partial<LlmConfig>
  /** 客户选片：记住上次的输出目录、客户名与水印模板 */
  pick?: {
    lastDir?: string
    lastClient?: string
    watermark?: Partial<PickWatermarkStyle>
  }
  /** 导出成品：记住上次的目录与参数，第二次导出不用重填 */
  finals?: {
    lastDir?: string
    mode?: string
    maxEdge?: number | null
    quality?: number
    naming?: string
    prefix?: string
    watermark?: string
    watermarkStyle?: Partial<PickWatermarkStyle>
  }
  /** XMP 侧车：默认关闭，只写人的判断 */
  xmp?: Partial<XmpSettings>
}

const DEFAULTS: AutoBackupSettings = {
  enabled: false,
  intervalDays: 1,
  keep: 5,
  directory: null,
  lastRunAt: 0
}

const IMPORT_DEFAULTS: ImportOptions = {
  recursive: true,
  skipDuplicates: true
}

function configPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

export function readConfig(): AppConfig {
  try {
    return JSON.parse(readFileSync(configPath(), 'utf8')) as AppConfig
  } catch {
    return {}
  }
}

export function writeConfig(config: AppConfig): void {
  try {
    writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf8')
  } catch {
    /* 配置写入失败不影响主流程 */
  }
}

export function updateConfig(patch: Partial<AppConfig>): AppConfig {
  const next = { ...readConfig(), ...patch }
  writeConfig(next)
  return next
}

/** Windows 路径大小写不敏感，去掉末尾分隔符再小写，作为索引映射的键 */
export function libraryKey(path: string): string {
  return path.replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase()
}

/** 该图库的索引放在哪；没配置过就是图库目录本身 */
export function getIndexDirFor(library: string): string {
  const map = readConfig().libraryIndex ?? {}
  return map[libraryKey(library)] ?? library
}

/** dir 传 null 表示恢复默认（放回图库目录） */
export function setIndexDirFor(library: string, dir: string | null): void {
  const config = readConfig()
  const map = { ...(config.libraryIndex ?? {}) }
  const key = libraryKey(library)
  const normalized = dir ? dir.replace(/[\\/]+$/, '') : ''
  if (!normalized || libraryKey(normalized) === key) delete map[key]
  else map[key] = normalized
  updateConfig({ libraryIndex: map })
}

export function getAutoBackup(): AutoBackupSettings {
  const stored = readConfig().autoBackup ?? {}
  return { ...DEFAULTS, ...stored }
}

export function saveAutoBackup(patch: Partial<AutoBackupSettings>): AutoBackupSettings {
  const next = { ...getAutoBackup(), ...patch }
  updateConfig({ autoBackup: next })
  return next
}

export function getTheme(): ThemeMode {
  const stored = readConfig().theme
  return stored === 'dark' || stored === 'light' ? stored : 'system'
}

export function saveTheme(mode: ThemeMode): ThemeMode {
  const next: ThemeMode = mode === 'dark' || mode === 'light' ? mode : 'system'
  updateConfig({ theme: next })
  return next
}

export function getImportOptions(): ImportOptions {
  const stored = readConfig().importOptions ?? {}
  return { ...IMPORT_DEFAULTS, ...stored }
}

export function saveImportOptions(patch: Partial<ImportOptions>): ImportOptions {
  const next = { ...getImportOptions(), ...patch }
  updateConfig({ importOptions: next })
  return next
}

/** 闲时自动建立语义索引，默认开启（只在系统空闲时小批量跑） */
export function getClipAutoIndex(): boolean {
  return readConfig().clipAutoIndex !== false
}

export function saveClipAutoIndex(enabled: boolean): boolean {
  const next = Boolean(enabled)
  updateConfig({ clipAutoIndex: next })
  return next
}

export function getEmbeddingModel(): EmbeddingModelId {
  return readConfig().embeddingModel === 'siglip2' ? 'siglip2' : 'chinese-clip'
}

export function saveEmbeddingModel(id: EmbeddingModelId): EmbeddingModelId {
  const next: EmbeddingModelId = id === 'siglip2' ? 'siglip2' : 'chinese-clip'
  updateConfig({ embeddingModel: next })
  return next
}

/** 界面风格（皮肤） */
export function getSkin(): SkinId {
  const stored = readConfig().skin
  return isSkinId(stored) ? stored : DEFAULT_SKIN
}

export function saveSkin(id: SkinId): SkinId {
  const next = isSkinId(id) ? id : DEFAULT_SKIN
  updateConfig({ skin: next })
  return next
}

/** 左栏 / 右栏宽度（记住用户拖过的值，越界会被收回合法范围） */
export function getLayout(): LayoutSizes {
  return normalizeLayout(readConfig().layout)
}

export function saveLayout(patch: Partial<LayoutSizes>): LayoutSizes {
  const next = normalizeLayout({ ...getLayout(), ...patch })
  updateConfig({ layout: next })
  return next
}

/** 瀑布流缩略图清晰度档位 */
export function getThumbQuality(): ThumbQualityPref {
  const stored = readConfig().thumbQuality
  return isThumbQualityPref(stored) ? stored : THUMB_QUALITY_DEFAULT
}

export function saveThumbQuality(pref: ThumbQualityPref): ThumbQualityPref {
  const next = isThumbQualityPref(pref) ? pref : THUMB_QUALITY_DEFAULT
  updateConfig({ thumbQuality: next })
  return next
}

/** 高清缩略图缓存上限（MB），0 = 不限 */
export function getThumbCacheLimitMB(): number {
  const stored = readConfig().thumbCacheLimitMB
  return typeof stored === 'number' && Number.isFinite(stored) && stored >= 0
    ? Math.round(stored)
    : THUMB_CACHE_LIMIT_DEFAULT
}

export function saveThumbCacheLimitMB(mb: number): number {
  const next = Number.isFinite(mb) && mb >= 0 ? Math.round(mb) : THUMB_CACHE_LIMIT_DEFAULT
  updateConfig({ thumbCacheLimitMB: next })
  return next
}

/** AI 批量处理的星级门槛：默认 3 星；0 = 全部照片，1–5 = 只处理该星级及以上 */
export function getAiScoreMinRating(): number {
  const stored = readConfig().aiScoreMinRating
  // 没配过就走保守默认：只处理三星及以上，避免把整库废片都送进模型
  if (typeof stored !== 'number' || !Number.isFinite(stored)) return 3
  const value = Math.round(stored)
  return value >= 1 && value <= 5 ? value : 0
}

export function saveAiScoreMinRating(value: number): number {
  const rounded = Number.isFinite(value) ? Math.round(value) : 0
  const next = rounded >= 1 && rounded <= 5 ? rounded : 0
  updateConfig({ aiScoreMinRating: next })
  return next
}

/** AI 处理的文件夹范围：空数组表示不限；只存文件夹 id，失效 id 由读取方按当前图库清掉 */
export function getAiFolderIds(): number[] {
  const stored = readConfig().aiFolderIds
  if (!Array.isArray(stored)) return []
  return [...new Set(stored.filter((id) => Number.isInteger(id) && id > 0))]
}

export function saveAiFolderIds(ids: number[]): number[] {
  const next = [...new Set((Array.isArray(ids) ? ids : []).filter((id) => Number.isInteger(id) && id > 0))]
  updateConfig({ aiFolderIds: next })
  return next
}

/** 客户选片：上次的输出目录 + 客户名 + 水印模板，下次导出直接沿用 */
export function getPickDefaults(): PickDefaults {
  const stored = readConfig().pick ?? {}
  return {
    lastDir: typeof stored.lastDir === 'string' && stored.lastDir ? stored.lastDir : null,
    lastClient: typeof stored.lastClient === 'string' ? stored.lastClient : '',
    watermarkStyle: normalizePickWatermark(stored.watermark ?? PICK_WATERMARK_DEFAULT)
  }
}

export function savePickDefaults(patch: Partial<PickDefaults>): PickDefaults {
  const current = getPickDefaults()
  const next: PickDefaults = {
    ...current,
    ...patch,
    watermarkStyle: normalizePickWatermark(patch.watermarkStyle ?? current.watermarkStyle)
  }
  updateConfig({
    pick: {
      lastDir: next.lastDir ?? undefined,
      lastClient: next.lastClient,
      watermark: next.watermarkStyle
    }
  })
  return next
}

/** 长边只接受 256–8192 的整数，其余当「不缩放」 */
function normalizeMaxEdge(value: unknown): number | null {
  const n = Math.round(Number(value))
  return Number.isFinite(n) && n >= 256 && n <= 8192 ? n : null
}

export function getFinalsDefaults(): FinalsDefaults {
  const stored = readConfig().finals ?? {}
  const quality = Number(stored.quality)
  return {
    lastDir: typeof stored.lastDir === 'string' && stored.lastDir ? stored.lastDir : null,
    mode: stored.mode === 'copy' ? 'copy' : 'jpeg',
    maxEdge:
      stored.maxEdge === null || stored.maxEdge === undefined ? null : normalizeMaxEdge(stored.maxEdge),
    quality: Number.isFinite(quality) ? Math.min(95, Math.max(60, Math.round(quality))) : 90,
    naming: stored.naming === 'prefix' ? 'prefix' : 'original',
    prefix: typeof stored.prefix === 'string' ? stored.prefix : '',
    watermark: typeof stored.watermark === 'string' ? stored.watermark : '',
    watermarkStyle: normalizePickWatermark(stored.watermarkStyle ?? PICK_WATERMARK_DEFAULT)
  }
}

export function saveFinalsDefaults(patch: Partial<FinalsDefaults>): FinalsDefaults {
  const current = getFinalsDefaults()
  const next: FinalsDefaults = {
    ...current,
    ...patch,
    watermarkStyle: normalizePickWatermark(patch.watermarkStyle ?? current.watermarkStyle)
  }
  updateConfig({
    finals: {
      lastDir: next.lastDir ?? undefined,
      mode: next.mode,
      maxEdge: next.maxEdge,
      quality: next.quality,
      naming: next.naming,
      prefix: next.prefix,
      watermark: next.watermark,
      watermarkStyle: next.watermarkStyle
    }
  })
  return next
}

/** XMP 侧车：默认关闭，避免在用户没同意的情况下往照片目录写文件 */
export function getXmpSettings(): XmpSettings {
  const stored = readConfig().xmp ?? {}
  return {
    enabled: stored.enabled === true,
    ignoreExternal: stored.ignoreExternal === true
  }
}

export function saveXmpSettings(patch: Partial<XmpSettings>): XmpSettings {
  const next = { ...getXmpSettings(), ...patch }
  const settings: XmpSettings = {
    enabled: next.enabled === true,
    ignoreExternal: next.ignoreExternal === true
  }
  updateConfig({ xmp: settings })
  return settings
}
