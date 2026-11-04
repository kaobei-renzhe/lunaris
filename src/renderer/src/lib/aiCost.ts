/**
 * 批量 AI 的 token 粗估。
 * 图片统一压到长边 1024 再送模型（见主进程 llm/image.ts），各家视觉模型按这个尺寸
 * 大约 0.8k–1.4k 输入 token/张，这里取中间值兜底；估算只用来决定要不要警示，
 * 不作为账单依据。
 */
const IMAGE_TOKENS = 1200
const PROMPT_TOKENS = 200
/** 一次超过这个量就算「大量」：大约 1.5 万 token，够一次评 9 张或筛 12 张 */
export const HEAVY_TOKEN_THRESHOLD = 15000

export type BatchKind = 'quality' | 'smartFilter'

/** 智能筛选每批最多带几张图（与主进程 capabilities/smartFilter.ts 保持一致） */
const FILTER_BATCH = 6
/** 评分的输出预算（与 quality.ts 的 maxTokens 一致） */
const QUALITY_OUTPUT = 400
/** 智能筛选的输出预算（与 smartFilter.ts 的 maxTokens 一致） */
const FILTER_OUTPUT = 600

export interface BatchCost {
  tokens: number
  /** 超过阈值，调用前应该明确警示 */
  heavy: boolean
}

export function estimateBatchTokens(kind: BatchKind, images: number): BatchCost {
  if (!(images > 0)) return { tokens: 0, heavy: false }
  const requests = kind === 'quality' ? images : Math.ceil(images / FILTER_BATCH)
  const output = kind === 'quality' ? QUALITY_OUTPUT * images : FILTER_OUTPUT * requests
  const tokens = images * IMAGE_TOKENS + output + PROMPT_TOKENS * requests
  return { tokens, heavy: tokens >= HEAVY_TOKEN_THRESHOLD }
}

/** 给用户看的量级，不假装精确 */
export function formatTokens(tokens: number): string {
  if (tokens >= 10000) return `约 ${(tokens / 10000).toFixed(1)} 万 token`
  return `约 ${Math.max(100, Math.round(tokens / 100) * 100)} token`
}
