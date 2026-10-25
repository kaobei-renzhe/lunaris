import type { LlmErrorCode, LlmUsage } from '../../shared/llm'

export type LlmRole = 'system' | 'user' | 'assistant'

export type LlmContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mime: string; base64: string }

export interface LlmMessage {
  role: LlmRole
  content: string | LlmContentPart[]
}

export interface LlmReply {
  text: string
  usage?: LlmUsage
  /** 原始响应，排查用；不要写进日志 */
  raw: unknown
}

export interface LlmRequestOptions {
  /** 要求模型输出 JSON；部分厂商用 response_format 实现 */
  json?: boolean
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
  /** 仅用于统计与日志，不影响请求 */
  capabilityId?: string
}

/** 统一的可识别错误：上层按 code 决定是否重试、如何提示 */
export class LlmError extends Error {
  readonly code: LlmErrorCode
  readonly status?: number
  readonly retryable: boolean
  readonly retryAfterMs?: number

  constructor(
    code: LlmErrorCode,
    message: string,
    options: { status?: number; retryable?: boolean; retryAfterMs?: number } = {}
  ) {
    super(message)
    this.name = 'LlmError'
    this.code = code
    this.status = options.status
    this.retryable = options.retryable ?? false
    this.retryAfterMs = options.retryAfterMs
  }
}

export function isLlmError(value: unknown): value is LlmError {
  return value instanceof LlmError
}
