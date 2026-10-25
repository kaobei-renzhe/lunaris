import { LlmError } from './types'

/**
 * 从模型回复里抠出 JSON：
 * 兼容 ```json 代码块、前后夹带解释、以及数组/对象两种根节点。
 */
export function extractJson<T>(text: string): T {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = (fenced?.[1] ?? trimmed).trim()

  const objectStart = body.indexOf('{')
  const arrayStart = body.indexOf('[')
  const starts = [objectStart, arrayStart].filter((index) => index >= 0)
  if (starts.length === 0) {
    throw new LlmError('bad_response', '模型没有返回 JSON')
  }
  const start = Math.min(...starts)
  const open = body[start]
  const close = open === '{' ? '}' : ']'

  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < body.length; index++) {
    const char = body[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === open) depth++
    else if (char === close) {
      depth--
      if (depth === 0) {
        const snippet = body.slice(start, index + 1)
        try {
          return JSON.parse(snippet) as T
        } catch (error) {
          throw new LlmError('bad_response', `JSON 解析失败：${(error as Error).message}`)
        }
      }
    }
  }

  throw new LlmError('bad_response', '模型返回的 JSON 不完整')
}

/** 把 0-100 的评分收紧到合法区间，模型偶尔会给 1-10 或 120 */
export function normalizeScore(value: unknown, fallback = 60): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  const scaled = numeric > 0 && numeric <= 10 ? numeric * 10 : numeric
  return Math.max(0, Math.min(100, Math.round(scaled)))
}
