import type { LlmCapabilitySwitch, LlmConfig, LlmProviderId } from '../../shared/llm'
import { LLM_CAPABILITY_DEFAULTS, LLM_CAPABILITY_IDS } from '../../shared/llm'
import { readConfig, updateConfig } from '../settings'
import { DEFAULT_BASE_URL } from './providers'

export const LLM_DEFAULTS: LlmConfig = {
  provider: 'openai-compatible',
  baseUrl: DEFAULT_BASE_URL['openai-compatible'],
  model: '',
  temperature: 0.3,
  maxTokens: 1200,
  timeoutMs: 60_000,
  maxRetries: 2,
  enabled: false,
  capabilities: { ...LLM_CAPABILITY_DEFAULTS }
}

/** 只认明确写下来的 false，缺字段就按默认（开）处理，老配置也能平滑升级 */
function normalizeCapabilities(stored: Partial<Record<string, boolean>> | undefined): LlmCapabilitySwitch {
  const next = { ...LLM_CAPABILITY_DEFAULTS }
  for (const id of LLM_CAPABILITY_IDS) {
    if (stored && stored[id] === false) next[id] = false
  }
  return next
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function normalizeProvider(value: unknown): LlmProviderId {
  return value === 'anthropic' ? 'anthropic' : 'openai-compatible'
}

export function getLlmConfig(): LlmConfig {
  const stored = readConfig().llm ?? {}
  const provider = normalizeProvider(stored.provider)
  return {
    provider,
    baseUrl: (stored.baseUrl ?? LLM_DEFAULTS.baseUrl).trim(),
    model: (stored.model ?? '').trim(),
    temperature: clamp(stored.temperature ?? LLM_DEFAULTS.temperature, 0, 2, LLM_DEFAULTS.temperature),
    maxTokens: Math.round(clamp(stored.maxTokens ?? LLM_DEFAULTS.maxTokens, 16, 32_000, LLM_DEFAULTS.maxTokens)),
    timeoutMs: Math.round(clamp(stored.timeoutMs ?? LLM_DEFAULTS.timeoutMs, 5_000, 300_000, LLM_DEFAULTS.timeoutMs)),
    maxRetries: Math.round(clamp(stored.maxRetries ?? LLM_DEFAULTS.maxRetries, 0, 5, LLM_DEFAULTS.maxRetries)),
    enabled: Boolean(stored.enabled),
    capabilities: normalizeCapabilities(stored.capabilities)
  }
}

export function saveLlmConfig(patch: Partial<LlmConfig>): LlmConfig {
  const current = getLlmConfig()
  const provider = patch.provider ? normalizeProvider(patch.provider) : current.provider
  const next: LlmConfig = {
    provider,
    // 换厂商且地址还是旧默认值时，自动跟到新默认值，省得用户手动改
    baseUrl:
      patch.baseUrl !== undefined
        ? patch.baseUrl.trim()
        : current.baseUrl === DEFAULT_BASE_URL[current.provider]
          ? DEFAULT_BASE_URL[provider]
          : current.baseUrl,
    model: patch.model !== undefined ? patch.model.trim() : current.model,
    temperature: clamp(patch.temperature ?? current.temperature, 0, 2, current.temperature),
    maxTokens: Math.round(clamp(patch.maxTokens ?? current.maxTokens, 16, 32_000, current.maxTokens)),
    timeoutMs: Math.round(clamp(patch.timeoutMs ?? current.timeoutMs, 5_000, 300_000, current.timeoutMs)),
    maxRetries: Math.round(clamp(patch.maxRetries ?? current.maxRetries, 0, 5, current.maxRetries)),
    enabled: patch.enabled !== undefined ? Boolean(patch.enabled) : current.enabled,
    capabilities: mergeCapabilities(current.capabilities, patch.capabilities)
  }
  updateConfig({ llm: next })
  return next
}

/** 局部补丁：只改传进来的能力，其余保持不变 */
function mergeCapabilities(
  current: LlmCapabilitySwitch,
  patch: Partial<Record<string, boolean>> | undefined
): LlmCapabilitySwitch {
  const next = { ...current }
  if (patch) {
    for (const id of LLM_CAPABILITY_IDS) {
      if (patch[id] !== undefined) next[id] = Boolean(patch[id])
    }
  }
  return next
}
