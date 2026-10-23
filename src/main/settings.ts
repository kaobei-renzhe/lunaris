import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { AutoTagSettings, ThemeMode } from '../shared/types'

export interface AutoBackupSettings {
  enabled: boolean
  intervalDays: number
  keep: number
  directory: string | null
  lastRunAt: number
}

export interface AppConfig {
  library?: string
  autoBackup?: Partial<AutoBackupSettings>
  autoTag?: Partial<AutoTagSettings>
  relocate?: { lastDir?: string }
  theme?: ThemeMode
}

const DEFAULTS: AutoBackupSettings = {
  enabled: false,
  intervalDays: 1,
  keep: 5,
  directory: null,
  lastRunAt: 0
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
