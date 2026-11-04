import type { SocraticInput, SocraticReply, SocraticTurn } from '../../../shared/types'
import type { LlmCapability } from '../registry'
import { LlmError } from '../types'
import { extractJson } from '../util'

const MAX_PROBES = 2

const SYSTEM = `你是带学生读片的摄影老师。学生会圈出画面的一块区域并向你提问。

铁律（按重要性排序）：
1. 先让学生自己观察，别一上来就给答案。第一次回应必须是一个能引导他看的问题。
2. 最多反问两轮。已经反问过两轮就必须给出明确解释，不许再问。
3. 学生说「直接告诉我」时，立刻解释，不要反问。
4. 所有解释都要指向画面里可观察的证据：边缘软硬、色温冷暖、明暗比例、视线方向、
   景深虚实、高光落点。禁止「构图很好」「氛围很棒」这类没有信息的空话。
5. 拿不准就直说不确定，不要编造光源、参数、器材或拍摄手法。
6. 一次只说一件事，别一次抛出三个问题。
7. 中文回答，控制在 120 字以内。

输出 JSON，不要任何多余内容：
{"stage":"probe","text":"这一轮的问题或解释"}
stage 取 probe 表示这轮是反问，explain 表示这轮给出了答案。`

function describeRegion(region: SocraticInput['region']): string {
  if (!region) return '整张画面（没有具体圈选）'
  const cx = region.x + region.w / 2
  const cy = region.y + region.h / 2
  const horizontal = cx < 0.34 ? '左侧' : cx > 0.66 ? '右侧' : '中间'
  const vertical = cy < 0.34 ? '上方' : cy > 0.66 ? '下方' : '中部'
  const size = region.w * region.h > 0.18 ? '较大一块' : region.w * region.h > 0.06 ? '一块' : '较小一块'
  return `${vertical}${horizontal}的${size}，左上角在 (${region.x.toFixed(2)}, ${region.y.toFixed(2)})，宽高 ${region.w.toFixed(2)}×${region.h.toFixed(2)}（归一化坐标）`
}

function formatHistory(history: SocraticTurn[]): string {
  if (!history.length) return '（这是第一轮对话）'
  return history
    .map((turn) => `${turn.role === 'me' ? '学生' : '你'}：${turn.text}`)
    .join('\n')
}

export const socraticCapability: LlmCapability<SocraticInput, SocraticReply> = {
  id: 'photo.socratic',
  title: '读片对话',
  description: '对着照片提问，AI 先反问引导，最多两轮再讲解',
  maxItems: 1,
  async run(ctx, input) {
    const itemId = Number(input?.itemId)
    if (!Number.isInteger(itemId)) throw new LlmError('bad_request', '缺少有效的图片编号')
    const question = String(input?.question ?? '').trim()
    if (!question) throw new LlmError('bad_request', '问题不能为空')

    const history = Array.isArray(input.history) ? input.history.slice(-8) : []
    const aiTurns = history.filter((turn) => turn.role === 'ai').length
    const mustExplain = Boolean(input.skipSocratic) || aiTurns >= MAX_PROBES
    const mode = input.mode === 'review' ? 'review' : 'study'

    const modeHint =
      mode === 'study'
        ? '这是「研读」：这张片子是别人的作品，学生想学他为什么这么拍。'
        : '这是「复盘」：这张片子是学生自己拍的，他想弄清当时的问题出在哪。'

    const context = [
      modeHint,
      `学生圈的位置：${describeRegion(input.region)}`,
      `已反问次数：${aiTurns} / ${MAX_PROBES}${mustExplain ? '（本轮必须给出解释，不许再反问）' : '（本轮可以反问）'}`,
      '',
      '之前的对话：',
      formatHistory(history),
      '',
      `学生本轮说：${question}`
    ].join('\n')

    const image = await ctx.image(itemId)
    const text = await ctx.chat(
      [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: [{ type: 'text', text: context }, image] }
      ],
      { json: true, maxTokens: 400, temperature: mustExplain ? 0.35 : 0.65 }
    )

    let stage: SocraticReply['stage'] = mustExplain ? 'explain' : 'probe'
    let reply = ''
    try {
      const parsed = extractJson<Record<string, unknown>>(text)
      reply = String(parsed.text ?? '').trim()
      const rawStage = String(parsed.stage ?? '')
      if (rawStage === 'explain' || rawStage === 'probe') stage = rawStage
    } catch {
      // 模型没按 JSON 回时，把原文当答案用，但要尊重轮次上限
      reply = text.trim()
    }
    if (!reply) throw new LlmError('bad_response', '模型没有给出有效回复')
    // 已经到轮次上限，模型还想反问就直接扳回解释态，保证不会无限反问
    if (mustExplain) stage = 'explain'

    return { text: reply.slice(0, 600), stage }
  }
}
