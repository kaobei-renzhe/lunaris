import type { PickReplyPreview } from '../shared/types'

/**
 * 客户回传的文本是给人看的，不是 JSON：
 * 中文逗号、换行、多余空格、全角数字都可能出现。这里只认编号，别的全部忽略。
 */
const KEEP_LABEL = /(?<!不)要的\s*[（(]\s*\d+\s*张\s*[）)]\s*[：:]/
const FIX_LABEL = /要修的\s*[（(]\s*\d+\s*张\s*[）)]\s*[：:]/
const SECTION_END =
  /要修的\s*[（(]|不要的\s*(?:[（(]\s*\d+\s*张\s*[）)])?\s*[：:]|备注\s*[：:]|【选片结果】|客户\s*[：:]/

function normalizeDigits(text: string): string {
  return text.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
}

function sectionAfter(text: string, label: RegExp): string {
  const match = label.exec(text)
  if (!match) return ''
  const rest = text.slice(match.index + match[0].length)
  const end = rest.search(SECTION_END)
  return end >= 0 ? rest.slice(0, end) : rest
}

function numbersIn(text: string): number[] {
  const seen = new Set<number>()
  const out: number[] = []
  for (const part of text.split(/[^\d]+/)) {
    if (!part) continue
    const value = Number(part)
    if (!Number.isFinite(value) || value <= 0) continue
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out.sort((a, b) => a - b)
}

function noteFrom(text: string): string {
  const match = /备注\s*[：:]\s*([\s\S]*)$/.exec(text)
  if (!match) return ''
  const value = match[1].trim()
  if (!value || value === '（无）' || value === '(无)') return ''
  return value.slice(0, 1000)
}

/** 只解析「要的 / 要修的 / 不要的：其余 / 备注」，返回编号（seq），不做会话校验 */
export function parsePickReply(text: string): PickReplyPreview {
  const source = normalizeDigits(String(text ?? ''))
  return {
    keep: numbersIn(sectionAfter(source, KEEP_LABEL)),
    fix: numbersIn(sectionAfter(source, FIX_LABEL)),
    unmatched: [],
    rejectRest: /不要的\s*[：:]\s*其余/.test(source),
    note: noteFrom(source),
    total: 0
  }
}
