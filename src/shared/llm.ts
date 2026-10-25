/** 大模型接入的共享类型：主进程与渲染层共用，渲染层不接触密钥与原始请求 */

export type LlmProviderId = 'openai-compatible' | 'anthropic'

export interface LlmConfig {
  provider: LlmProviderId
  /** 接口根地址，不含具体路径；openai 兼容默认 https://api.openai.com/v1 */
  baseUrl: string
  model: string
  temperature: number
  maxTokens: number
  /** 单次请求超时（毫秒） */
  timeoutMs: number
  /** 失败后的最大重试次数（不含首次） */
  maxRetries: number
  /** 总开关：关掉后所有能力调用直接返回未启用 */
  enabled: boolean
  /** 每个能力自己的开关；关掉后对应入口消失，直接调用会被拒绝 */
  capabilities: LlmCapabilitySwitch
}

export interface LlmUsage {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

export type LlmErrorCode =
  | 'not_configured'
  | 'auth'
  | 'rate_limit'
  | 'timeout'
  | 'network'
  | 'bad_request'
  | 'bad_response'
  | 'cancelled'
  | 'unknown'

export interface LlmCallSummary {
  at: number
  capabilityId: string
  ok: boolean
  attempts: number
  latencyMs: number
  errorCode?: LlmErrorCode
  usage?: LlmUsage
}

export interface LlmCapabilityInfo {
  id: LlmCapabilityId
  title: string
  description: string
  maxItems?: number
  /** 该能力是否被用户开启（总开关之外的第二层） */
  enabled: boolean
}

export interface LlmStatus {
  config: LlmConfig
  hasKey: boolean
  /** 形如 sk-…abcd，仅用于确认"存的是哪把钥匙" */
  keyHint: string | null
  /** os = 系统加密可用；unavailable = 无法安全保存，需先解决 */
  encryption: 'os' | 'unavailable'
  lastCall: LlmCallSummary | null
  recent: LlmCallSummary[]
  capabilities: LlmCapabilityInfo[]
}

export interface LlmTestResult {
  ok: boolean
  message: string
  latencyMs: number
  model?: string
}

/**
 * 能力调用结果信封。
 * 走 IPC 时抛出的 Error 只保留 message、会丢掉 code，所以错误码必须放进返回值里。
 */
export type LlmRunOutcome<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; code: LlmErrorCode; message: string }

export const LLM_CAPABILITY_IDS = ['photo.quality', 'photo.advice', 'photo.smartFilter'] as const
export type LlmCapabilityId = (typeof LLM_CAPABILITY_IDS)[number]
/** 每个能力独立开关：关掉后入口消失，直接调用也会被拒绝 */
export type LlmCapabilitySwitch = Record<LlmCapabilityId, boolean>

export const LLM_CAPABILITY_DEFAULTS: LlmCapabilitySwitch = {
  'photo.quality': true,
  'photo.advice': true,
  'photo.smartFilter': true
}

/** 照片质量评分：构图/曝光/色彩/清晰度 + 总分，0-100 */
export interface PhotoQualityScore {
  itemId: number
  composition: number
  exposure: number
  color: number
  sharpness: number
  overall: number
  comment: string
}

export interface PhotoQualityResult {
  results: PhotoQualityScore[]
  failed: Array<{ itemId: number; message: string }>
}

/** 评分接口的返回值：在能力结果上补一个"实际落库条数" */
export interface PhotoQualitySaved extends PhotoQualityResult {
  persisted: number
}

/** 后期建议：方向、参数、风格参考 */
export interface PhotoAdviceParameter {
  name: string
  value: string
  why: string
}

export interface PhotoAdvice {
  itemId: number
  summary: string
  directions: string[]
  parameters: PhotoAdviceParameter[]
  styleRefs: string[]
}

/** 智能筛选：按自然语言规则挑图 */
export interface SmartFilterResult {
  matchedIds: number[]
  reasons: Array<{ itemId: number; reason: string }>
  evaluated: number
  /** 某一批识别失败时的说明；不影响其它批次的结果 */
  errors?: string[]
}
