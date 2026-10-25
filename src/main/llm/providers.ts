import type { LlmProviderId } from '../../shared/llm'
import { LlmError, type LlmContentPart, type LlmMessage, type LlmReply } from './types'

export const DEFAULT_BASE_URL: Record<LlmProviderId, string> = {
  'openai-compatible': 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1'
}

export const PROVIDER_LABEL: Record<LlmProviderId, string> = {
  'openai-compatible': 'OpenAI 兼容（DeepSeek / Kimi / 通义 / 智谱 / Ollama 等）',
  anthropic: 'Anthropic（Claude）'
}

export interface ProviderRequest {
  url: string
  headers: Record<string, string>
  body: unknown
}

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  // 允许用户直接填完整端点，避免重复拼接
  if (base.endsWith(path)) return base
  return `${base}${path}`
}

function toOpenAiContent(content: string | LlmContentPart[]): unknown {
  if (typeof content === 'string') return content
  return content.map((part) =>
    part.type === 'text'
      ? { type: 'text', text: part.text }
      : { type: 'image_url', image_url: { url: `data:${part.mime};base64,${part.base64}` } }
  )
}

function toAnthropicContent(content: string | LlmContentPart[]): unknown {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return content.map((part) =>
    part.type === 'text'
      ? { type: 'text', text: part.text }
      : { type: 'image', source: { type: 'base64', media_type: part.mime, data: part.base64 } }
  )
}

export function buildRequest(
  provider: LlmProviderId,
  config: { baseUrl: string; model: string; temperature: number; maxTokens: number },
  key: string,
  messages: LlmMessage[],
  options: { json?: boolean; maxTokens?: number; temperature?: number }
): ProviderRequest {
  if (provider === 'anthropic') {
    const system = messages
      .filter((message) => message.role === 'system')
      .map((message) => (typeof message.content === 'string' ? message.content : ''))
      .filter(Boolean)
      .join('\n\n')
    const dialogue = messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({ role: message.role, content: toAnthropicContent(message.content) }))

    return {
      url: joinUrl(config.baseUrl || DEFAULT_BASE_URL.anthropic, '/messages'),
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: {
        model: config.model,
        max_tokens: options.maxTokens ?? config.maxTokens,
        temperature: options.temperature ?? config.temperature,
        ...(system ? { system } : {}),
        messages: dialogue
      }
    }
  }

  return {
    url: joinUrl(config.baseUrl || DEFAULT_BASE_URL['openai-compatible'], '/chat/completions'),
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`
    },
    body: {
      model: config.model,
      messages: messages.map((message) => ({
        role: message.role,
        content: toOpenAiContent(message.content)
      })),
      temperature: options.temperature ?? config.temperature,
      max_tokens: options.maxTokens ?? config.maxTokens,
      // 只有要求 JSON 时才声明，避免部分厂商不认这个字段
      ...(options.json ? { response_format: { type: 'json_object' } } : {})
    }
  }
}

export function parseReply(provider: LlmProviderId, payload: unknown): LlmReply {
  const data = payload as Record<string, unknown> | null

  if (provider === 'anthropic') {
    const content = (data?.content as Array<Record<string, unknown>> | undefined) ?? []
    const text = content
      .filter((part) => part.type === 'text')
      .map((part) => String(part.text ?? ''))
      .join('')
    const usage = data?.usage as { input_tokens?: number; output_tokens?: number } | undefined
    return {
      text,
      usage: usage
        ? {
            promptTokens: usage.input_tokens,
            completionTokens: usage.output_tokens,
            totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)
          }
        : undefined,
      raw: payload
    }
  }

  const choices = (data?.choices as Array<Record<string, unknown>> | undefined) ?? []
  const message = choices[0]?.message as { content?: unknown } | undefined
  const text = typeof message?.content === 'string' ? message.content : ''
  const usage = data?.usage as
    | { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    | undefined
  return {
    text,
    usage: usage
      ? {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens
        }
      : undefined,
    raw: payload
  }
}

/** 把 HTTP 状态映射成可判定的错误码，供重试策略使用 */
export function errorFromStatus(status: number, bodyText: string, retryAfterMs?: number): LlmError {
  const detail = bodyText.slice(0, 300)
  if (status === 401 || status === 403) {
    return new LlmError('auth', `鉴权失败（${status}）：请检查 API Key 与权限`, { status })
  }
  if (status === 429) {
    return new LlmError('rate_limit', '触发限流（429），已按退避重试', {
      status,
      retryable: true,
      retryAfterMs
    })
  }
  if (status >= 500) {
    return new LlmError('network', `服务端错误（${status}）`, { status, retryable: true, retryAfterMs })
  }
  if (status === 400 || status === 404 || status === 422) {
    return new LlmError('bad_request', `请求被拒绝（${status}）：${detail}`, { status })
  }
  return new LlmError('unknown', `请求失败（${status}）：${detail}`, { status })
}
