import type { LlmConfig, LlmStatus, LlmTestResult, PhotoQualityResult, PhotoQualitySaved } from '../../shared/llm'
import { createClient } from './client'
import { getLlmConfig, saveLlmConfig } from './config'
import { clearKey, encryptionAvailable, keyHint, readKey, saveKey } from './keyring'
import { lastCall, recentCalls, recordCall } from './metrics'
import { getCapability, listCapabilities, registerCapability, type CapabilityContext } from './registry'
import { prepareImage } from './image'
import { saveQualityScores } from '../repo'
import { LlmError, isLlmError, type LlmMessage } from './types'
import { qualityCapability } from './capabilities/quality'
import { adviceCapability } from './capabilities/advice'
import { smartFilterCapability } from './capabilities/smartFilter'

// 能力在这里登记一次；新增能力只需实现接口 + 加一行
registerCapability(qualityCapability)
registerCapability(adviceCapability)
registerCapability(smartFilterCapability)

async function readyState(capabilityId?: string): Promise<{ config: LlmConfig; key: string }> {
  const config = getLlmConfig()
  if (!config.enabled) throw new LlmError('not_configured', '大模型功能未启用，请先在设置里打开')
  if (capabilityId && config.capabilities[capabilityId as keyof typeof config.capabilities] === false) {
    const title = getCapability(capabilityId)?.title ?? capabilityId
    throw new LlmError('not_configured', `「${title}」已在设置里关闭`)
  }
  if (!config.model.trim()) throw new LlmError('not_configured', '还没有填写模型名称')
  const key = await readKey()
  if (!key) throw new LlmError('not_configured', '还没有保存 API Key')
  return { config, key }
}

function toLlmError(error: unknown): LlmError {
  if (isLlmError(error)) return error
  return new LlmError('unknown', (error as Error)?.message || '未知错误')
}

export async function getStatus(): Promise<LlmStatus> {
  const config = getLlmConfig()
  const key = await readKey()
  return {
    config,
    hasKey: Boolean(key),
    keyHint: await keyHint(),
    encryption: (await encryptionAvailable()) ? 'os' : 'unavailable',
    lastCall: lastCall(),
    recent: recentCalls(8),
    capabilities: listCapabilities().map((capability) => ({
      ...capability,
      enabled: config.capabilities[capability.id] !== false
    }))
  }
}

export async function updateConfig(patch: Partial<LlmConfig>): Promise<LlmStatus> {
  saveLlmConfig(patch)
  return getStatus()
}

export async function saveApiKey(key: string): Promise<LlmStatus> {
  await saveKey(key)
  return getStatus()
}

export async function removeApiKey(): Promise<LlmStatus> {
  clearKey()
  return getStatus()
}

/** 设置页的"测试连接"：发一条极短请求，只判断链路是否通 */
export async function testConnection(): Promise<LlmTestResult> {
  const startedAt = Date.now()
  try {
    const { config, key } = await readyState()
    const client = createClient({ config, key })
    const outcome = await client.chat([{ role: 'user', content: '请只回复 ok' }], {
      maxTokens: 8,
      temperature: 0
    })
    recordCall({
      at: Date.now(),
      capabilityId: 'llm.test',
      ok: true,
      attempts: outcome.attempts,
      latencyMs: outcome.latencyMs,
      usage: outcome.reply.usage
    })
    return {
      ok: true,
      message: `连接成功：${outcome.reply.text.trim().slice(0, 40) || '已返回内容'}`,
      latencyMs: Date.now() - startedAt,
      model: config.model
    }
  } catch (error) {
    const normalized = toLlmError(error)
    recordCall({
      at: Date.now(),
      capabilityId: 'llm.test',
      ok: false,
      attempts: 1,
      latencyMs: Date.now() - startedAt,
      errorCode: normalized.code
    })
    return { ok: false, message: normalized.message, latencyMs: Date.now() - startedAt }
  }
}

/**
 * 评分并落库：能力返回的成功结果写进 quality_scores，失败的图保持原样。
 * 同步在渲染层刷新后，卡片与详情面板就能直接读到分数。
 */
export async function scorePhotos(itemIds: number[]): Promise<PhotoQualitySaved> {
  const result = (await runCapability('photo.quality', { itemIds })) as PhotoQualityResult
  const persisted = saveQualityScores(result.results, getLlmConfig().model)
  return { ...result, persisted }
}

/**
 * 执行一个能力：统一做配置校验、图片准备、调用统计与错误归一。
 * 能力实现只拿到 chat / image 两个原语，不接触密钥与 HTTP。
 */
export async function runCapability(capabilityId: string, input: unknown): Promise<unknown> {
  const capability = getCapability(capabilityId)
  if (!capability) throw new LlmError('bad_request', `未知能力：${capabilityId}`)

  const { config, key } = await readyState(capability.id)
  const client = createClient({ config, key })
  const startedAt = Date.now()
  let attempts = 0

  const context: CapabilityContext = {
    chat: async (messages, options) => {
      const outcome = await client.chat(messages as LlmMessage[], options)
      attempts += outcome.attempts
      recordCall({
        at: Date.now(),
        capabilityId,
        ok: true,
        attempts: outcome.attempts,
        latencyMs: outcome.latencyMs,
        usage: outcome.reply.usage
      })
      return outcome.reply.text
    },
    image: async (itemId) => (await prepareImage(itemId)).part
  }

  try {
    return await capability.run(context as never, input as never)
  } catch (error) {
    const normalized = toLlmError(error)
    recordCall({
      at: Date.now(),
      capabilityId,
      ok: false,
      attempts: Math.max(1, attempts),
      latencyMs: Date.now() - startedAt,
      errorCode: normalized.code
    })
    throw normalized
  }
}
