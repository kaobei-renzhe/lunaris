import type { SmartFilterResult } from '../../../shared/llm'
import type { LlmCapability } from '../registry'
import { LlmError } from '../types'
import { extractJson } from '../util'

const BATCH = 6
const LABELS = ['A', 'B', 'C', 'D', 'E', 'F']

const SYSTEM = `你是摄影选片助手。用户会给出一条筛选规则和若干张照片，请逐张判断是否符合规则。
规则可能是题材（"有人的街拍"）、画质（"主体清晰、没有明显手抖"）、风格（"低饱和、冷色调"）或内容（"画面里有海"）。
判断要保守：不确定时判为不符合。
只输出 JSON，不要解释，格式：
{"matched":["A","C"],"reasons":{"A":"一句话理由","C":"一句话理由"}}`

export const smartFilterCapability: LlmCapability<
  { rule: string; itemIds: number[] },
  SmartFilterResult
> = {
  id: 'photo.smartFilter',
  title: '智能筛选',
  description: '按自然语言规则批量挑图，返回命中的图片与逐张理由',
  maxItems: 30,
  async run(ctx, input) {
    const rule = String(input?.rule ?? '').trim()
    if (!rule) throw new LlmError('bad_request', '请先写下筛选规则')
    const ids = [...new Set((input.itemIds ?? []).filter((id) => Number.isInteger(id)))]
    if (ids.length === 0) throw new LlmError('bad_request', '没有可筛选的照片')
    if (ids.length > 30) throw new LlmError('bad_request', '一次最多筛 30 张，避免单次成本过高')

    const matchedIds: number[] = []
    const reasons: Array<{ itemId: number; reason: string }> = []
    const errors: string[] = []

    for (let offset = 0; offset < ids.length; offset += BATCH) {
      const chunk = ids.slice(offset, offset + BATCH)
      const mapping = chunk.map((id, index) => `${LABELS[index]}=图片编号${id}`).join('，')
      try {
        const images = await Promise.all(chunk.map((id) => ctx.image(id)))
        const content = [
          {
            type: 'text' as const,
            text: `筛选规则：${rule}\n编号对应关系：${mapping}\n请判断这些照片是否满足规则。`
          },
          ...images
        ]
        const text = await ctx.chat(
          [
            { role: 'system', content: SYSTEM },
            { role: 'user', content }
          ],
          { json: true, maxTokens: 600, temperature: 0.2 }
        )
        const parsed = extractJson<Record<string, unknown>>(text)
        const labels = Array.isArray(parsed.matched) ? parsed.matched.map((entry) => String(entry)) : []
        const reasonMap = (parsed.reasons ?? {}) as Record<string, unknown>

        labels.forEach((label) => {
          const index = LABELS.indexOf(label.toUpperCase())
          const itemId = index >= 0 ? chunk[index] : undefined
          if (!itemId || matchedIds.includes(itemId)) return
          matchedIds.push(itemId)
          const reason = reasonMap[label.toUpperCase()] ?? reasonMap[label]
          if (reason) reasons.push({ itemId, reason: String(reason).slice(0, 160) })
        })
      } catch (error) {
        errors.push(`第 ${Math.floor(offset / BATCH) + 1} 批失败：${(error as Error).message}`)
      }
    }

    return {
      matchedIds,
      reasons,
      evaluated: ids.length,
      ...(errors.length ? { errors } : {})
    }
  }
}
