import type { LlmErrorCode } from '@shared/llm'

/** 错误码 → 用户能看懂的下一步（不给技术黑话） */
const HINTS: Partial<Record<LlmErrorCode, string>> = {
  not_configured: '还没启用大模型或没填 API Key，去「设置 → 大模型」配一下',
  auth: 'API Key 无效或没有权限，去设置里换一把',
  rate_limit: '服务商限流了，等一会儿再试',
  timeout: '这次等太久了，可以调大超时或换个小一点的模型',
  network: '网络不通，检查代理或接口地址',
  bad_request: '请求被服务商拒绝了，可能是这个模型不支持看图',
  bad_response: '模型返回的内容格式不对，再试一次通常就好',
  cancelled: '这次调用被取消了'
}

export function llmHint(code: LlmErrorCode, message: string): string {
  return HINTS[code] ?? message
}
