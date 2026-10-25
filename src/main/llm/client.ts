import type { LlmConfig } from '../../shared/llm'
import { buildRequest, errorFromStatus, parseReply } from './providers'
import { LlmError, type LlmMessage, type LlmReply } from './types'

export interface ChatOptions {
  json?: boolean
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
}

export interface ChatOutcome {
  reply: LlmReply
  attempts: number
  latencyMs: number
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export interface ClientDeps {
  config: LlmConfig
  key: string
  /** 便于测试注入；生产环境用全局 fetch */
  fetchImpl?: FetchLike
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 统一调用入口：超时、重试、错误归一都在这里，上层能力只关心 messages。
 * 重试策略：仅对网络错误 / 429 / 5xx 生效，指数退避 + 抖动，尊重 Retry-After。
 */
export function createClient({ config, key, fetchImpl = fetch }: ClientDeps) {
  async function chat(messages: LlmMessage[], options: ChatOptions = {}): Promise<ChatOutcome> {
    const startedAt = Date.now()
    const request = buildRequest(config.provider, config, key, messages, options)
    let lastError: unknown = new LlmError('unknown', '调用失败')

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      if (options.signal?.aborted) throw new LlmError('cancelled', '已取消')
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), config.timeoutMs)
      const onAbort = (): void => controller.abort()
      options.signal?.addEventListener('abort', onAbort, { once: true })

      try {
        const response = await fetchImpl(request.url, {
          method: 'POST',
          headers: request.headers,
          body: JSON.stringify(request.body),
          signal: controller.signal
        })

        if (!response.ok) {
          const text = await response.text().catch(() => '')
          const retryAfter = Number(response.headers.get('retry-after'))
          throw errorFromStatus(
            response.status,
            text,
            Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined
          )
        }

        const payload = await response.json().catch(() => {
          throw new LlmError('bad_response', '响应不是合法 JSON')
        })
        return {
          reply: parseReply(config.provider, payload),
          attempts: attempt + 1,
          latencyMs: Date.now() - startedAt
        }
      } catch (error) {
        if (options.signal?.aborted) throw new LlmError('cancelled', '已取消')
        if (error instanceof LlmError) {
          lastError = error
        } else if (controller.signal.aborted) {
          lastError = new LlmError('timeout', `请求超时（${config.timeoutMs}ms）`, { retryable: true })
        } else {
          lastError = new LlmError('network', (error as Error)?.message || '网络错误', { retryable: true })
        }
      } finally {
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', onAbort)
      }

      const retryable = lastError instanceof LlmError && lastError.retryable
      if (!retryable || attempt === config.maxRetries) throw lastError

      const retryAfterMs = lastError instanceof LlmError ? lastError.retryAfterMs : undefined
      const backoff = retryAfterMs ?? Math.min(8000, 600 * 2 ** attempt)
      await sleep(backoff + Math.random() * 200)
    }

    throw lastError
  }

  return { chat }
}

export type LlmClient = ReturnType<typeof createClient>
