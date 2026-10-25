import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import { LlmError } from './types'

/**
 * 密钥管理：只以系统加密（Windows DPAPI / macOS Keychain）形式落盘。
 * 若当前系统拿不到加密能力，宁可不保存，也不写明文。
 * 用 async 版本 API：Electron 45 起同步版本已标记废弃。
 */
function keyFile(): string {
  return join(app.getPath('userData'), 'llm-key.bin')
}

export async function encryptionAvailable(): Promise<boolean> {
  try {
    return await safeStorage.isAsyncEncryptionAvailable()
  } catch {
    return false
  }
}

export async function saveKey(key: string): Promise<void> {
  const trimmed = key.trim()
  if (!trimmed) throw new LlmError('not_configured', 'API Key 不能为空')
  if (!(await encryptionAvailable())) {
    throw new LlmError('not_configured', '系统加密不可用，已拒绝保存明文密钥')
  }
  const encrypted = await safeStorage.encryptStringAsync(trimmed)
  writeFileSync(keyFile(), encrypted)
}

export async function readKey(): Promise<string | null> {
  const file = keyFile()
  if (!existsSync(file)) return null
  try {
    const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(readFileSync(file))
    // 系统密钥轮换后建议重新加密，顺手更新，避免下次又走一遍
    if (shouldReEncrypt) {
      try {
        writeFileSync(file, await safeStorage.encryptStringAsync(result))
      } catch {
        /* 重新加密失败不影响本次读取 */
      }
    }
    return result
  } catch {
    // 换了机器/系统账户后旧密文解不开，按"没有密钥"处理
    return null
  }
}

export function clearKey(): void {
  try {
    rmSync(keyFile(), { force: true })
  } catch {
    /* 删不掉也不影响：读不到就当作没密钥 */
  }
}

/** 给界面看的掩码，只暴露头尾，便于确认"存的是哪把钥匙" */
export async function keyHint(): Promise<string | null> {
  const key = await readKey()
  if (!key) return null
  if (key.length <= 8) return '••••'
  return `${key.slice(0, 3)}…${key.slice(-4)}`
}
