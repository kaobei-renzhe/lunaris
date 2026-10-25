import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { AutoTagSettings, ImportOptions, ThemeMode } from '../shared/types'
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
  autoBackup?: Partial<AutoBackupSettings>
  autoTag?: Partial<AutoTagSettings>
  importOptions?: Partial<ImportOptions>
  clipAutoIndex?: boolean
  skin?: SkinId
  relocate?: { lastDir?: string }
  theme?: ThemeMode
  llm?: Partial<LlmConfig>
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
