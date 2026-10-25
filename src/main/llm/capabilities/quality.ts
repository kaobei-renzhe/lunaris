import type { PhotoQualityResult, PhotoQualityScore } from '../../../shared/llm'
import type { LlmCapability } from '../registry'
import { LlmError } from '../types'
import { extractJson, normalizeScore } from '../util'

const SYSTEM = `你是一位严格的摄影评审。请从四个维度给照片打分（0-100 的整数）：
- composition 构图：主体位置、画面平衡、留白与引导线
- exposure 曝光：高光与暗部细节、整体明暗是否得当
- color 色彩：白平衡、色调统一性、饱和度是否自然
- sharpness 清晰度：对焦准确性、运动模糊、噪点控制
同时给 overall 总分（不要简单平均，要体现"这张照片能不能用"）与一句 40 字以内的评语。
只输出 JSON，不要任何解释，格式：
{"composition":0,"exposure":0,"color":0,"sharpness":0,"overall":0,"comment":""}`

export const qualityCapability: LlmCapability<{ itemIds: number[] }, PhotoQualityResult> = {
  id: 'photo.quality',
  title: '照片质量评分',
  description: '对构图、曝光、色彩、清晰度打分，并给出可用性总分与评语',
  maxItems: 12,
  async run(ctx, input) {
    const ids = [...new Set((input.itemIds ?? []).filter((id) => Number.isInteger(id)))]
    if (ids.length === 0) throw new LlmError('bad_request', '没有选择要评分的照片')
    if (ids.length > 12) throw new LlmError('bad_request', '一次最多评 12 张，避免单次成本过高')

    const results: PhotoQualityScore[] = []
    const failed: Array<{ itemId: number; message: string }> = []

    for (const itemId of ids) {
      try {
        const image = await ctx.image(itemId)
        const text = await ctx.chat(
          [
            { role: 'system', content: SYSTEM },
            {
              role: 'user',
              content: [
                { type: 'text', text: `照片编号 ${itemId}，请按要求评分。` },
                image
              ]
            }
          ],
          { json: true, maxTokens: 400, temperature: 0.2 }
        )
        const parsed = extractJson<Record<string, unknown>>(text)
        results.push({
          itemId,
          composition: normalizeScore(parsed.composition),
          exposure: normalizeScore(parsed.exposure),
          color: normalizeScore(parsed.color),
          sharpness: normalizeScore(parsed.sharpness),
          overall: normalizeScore(parsed.overall),
          comment: String(parsed.comment ?? '').slice(0, 200)
        })
      } catch (error) {
        failed.push({ itemId, message: (error as Error).message })
      }
    }

    return { results, failed }
  }
}
