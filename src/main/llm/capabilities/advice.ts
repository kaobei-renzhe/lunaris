import type { PhotoAdvice, PhotoAdviceParameter } from '../../../shared/llm'
import type { LlmCapability } from '../registry'
import { LlmError } from '../types'
import { extractJson } from '../util'

const SYSTEM = `你是资深商业摄影师与后期师。针对用户给的一张照片，给出可直接执行的后期建议：
- summary：一句话说明这张图最大的提升空间
- directions：2-4 条修图方向（例如"压高光保留天空层次""局部提亮主体"）
- parameters：3-6 条参数调整，name 用通用后期术语（曝光/对比度/高光/阴影/色温/鲜艳度/清晰度/降噪 等），value 给出建议幅度（例如"+0.3EV""-15"），why 说明理由
- styleRefs：2-3 个可参考的风格或摄影师/画册方向（不点名在世摄影师的具体作品）
只输出 JSON，不要任何解释，格式：
{"summary":"","directions":[""],"parameters":[{"name":"","value":"","why":""}],"styleRefs":[""]}`

export const adviceCapability: LlmCapability<{ itemId: number }, PhotoAdvice> = {
  id: 'photo.advice',
  title: '后期优化建议',
  description: '针对单张照片输出修图方向、参数调整建议与风格参考',
  maxItems: 1,
  async run(ctx, input) {
    const itemId = Number(input?.itemId)
    if (!Number.isInteger(itemId)) throw new LlmError('bad_request', '缺少有效的图片编号')

    const image = await ctx.image(itemId)
    const text = await ctx.chat(
      [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: [{ type: 'text', text: `请为照片 ${itemId} 给出后期建议。` }, image]
        }
      ],
      { json: true, maxTokens: 800, temperature: 0.4 }
    )

    // 模型偶尔会把数组写成字符串，这里统一兜一层
    const parsed = extractJson<Record<string, unknown>>(text)
    const directions = Array.isArray(parsed.directions)
      ? parsed.directions.map((entry) => String(entry)).filter(Boolean).slice(0, 4)
      : []
    const parameters: PhotoAdviceParameter[] = Array.isArray(parsed.parameters)
      ? parsed.parameters
          .slice(0, 6)
          .map((entry) => {
            const item = entry as Record<string, unknown>
            return {
              name: String(item.name ?? '').slice(0, 24),
              value: String(item.value ?? '').slice(0, 24),
              why: String(item.why ?? '').slice(0, 120)
            }
          })
          .filter((item) => item.name)
      : []
    const styleRefs = Array.isArray(parsed.styleRefs)
      ? parsed.styleRefs.map((entry) => String(entry)).filter(Boolean).slice(0, 3)
      : []

    return {
      itemId,
      summary: String(parsed.summary ?? '').slice(0, 200),
      directions,
      parameters,
      styleRefs
    }
  }
}
