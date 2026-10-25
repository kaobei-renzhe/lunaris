import type { LlmCallSummary } from '../../shared/llm'
import { log } from '../logger'

const MAX_KEEP = 50
const calls: LlmCallSummary[] = []

/** 记录一次模型调用：只落模型/耗时/重试次数等元信息，绝不记录密钥与图片内容 */
export function recordCall(summary: LlmCallSummary): void {
  calls.push(summary)
  if (calls.length > MAX_KEEP) calls.shift()

  if (summary.ok) {
    void log.info('llm', '调用完成', {
      capability: summary.capabilityId,
      attempts: summary.attempts,
      latencyMs: summary.latencyMs,
      totalTokens: summary.usage?.totalTokens
    })
  } else {
    void log.warn('llm', '调用失败', {
      capability: summary.capabilityId,
      attempts: summary.attempts,
      latencyMs: summary.latencyMs,
      code: summary.errorCode
    })
  }
}

export function lastCall(): LlmCallSummary | null {
  return calls.length ? calls[calls.length - 1] : null
}

/** 最近的调用（新的在前），给设置页做"最近调用"展示 */
export function recentCalls(limit = 10): LlmCallSummary[] {
  return calls.slice(-limit).reverse()
}
