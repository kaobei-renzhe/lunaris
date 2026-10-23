import { existsSync, readFileSync } from 'node:fs'

const CLS = 101
const SEP = 102
const UNK = 100
const PAD = 0
const MAX_CHARS_PER_WORD = 100

function isWhitespace(ch: string): boolean {
  return /\s/.test(ch)
}

function isControl(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0
  return code === 0 || code === 0xfffd || code < 32 || (code >= 127 && code <= 159)
}

function isPunctuation(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0
  if (
    (code >= 33 && code <= 47) ||
    (code >= 58 && code <= 64) ||
    (code >= 91 && code <= 96) ||
    (code >= 123 && code <= 126)
  ) {
    return true
  }
  return /\p{P}/u.test(ch)
}

function isChineseChar(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x20000 && code <= 0x2a6df) ||
    (code >= 0x2a700 && code <= 0x2b73f) ||
    (code >= 0x2b740 && code <= 0x2b81f) ||
    (code >= 0x2b820 && code <= 0x2ceaf) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0x2f800 && code <= 0x2fa1f)
  )
}

/**
 * BERT WordPiece 分词，和 Chinese-CLIP 官方 tokenizer 对齐：
 * 中文按字切、英文按子词切、大小写归一。
 */
export class BertTokenizer {
  private readonly vocab: Map<string, number>

  constructor(vocabPath: string) {
    const map = new Map<string, number>()
    readFileSync(vocabPath, 'utf8')
      .split(/\r?\n/)
      .forEach((token, index) => {
        if (token) map.set(token, index)
      })
    this.vocab = map
  }

  private basicTokenize(text: string): string[] {
    let spaced = ''
    for (const ch of text) {
      if (isControl(ch)) continue
      if (isWhitespace(ch)) {
        spaced += ' '
      } else if (isChineseChar(ch) || isPunctuation(ch)) {
        spaced += ` ${ch} `
      } else {
        spaced += ch
      }
    }
    return spaced
      .split(/\s+/)
      .filter(Boolean)
      .map((token) =>
        token
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
      )
  }

  private wordpiece(token: string): string[] | null {
    const pieces: string[] = []
    let start = 0
    while (start < token.length) {
      let end = token.length
      let match: string | null = null
      while (start < end) {
        const candidate = (start > 0 ? '##' : '') + token.slice(start, end)
        if (this.vocab.has(candidate)) {
          match = candidate
          break
        }
        end--
      }
      if (!match) return null
      pieces.push(match)
      start = end
    }
    return pieces
  }

  encode(text: string, maxLength = 52): { ids: BigInt64Array; mask: BigInt64Array } {
    const pieces: string[] = []
    for (const token of this.basicTokenize(text)) {
      const sub = token.length > MAX_CHARS_PER_WORD ? null : this.wordpiece(token)
      if (sub) pieces.push(...sub)
      else pieces.push('[UNK]')
    }

    const ids: number[] = [CLS]
    for (const piece of pieces.slice(0, maxLength - 2)) {
      ids.push(this.vocab.get(piece) ?? UNK)
    }
    ids.push(SEP)

    const mask = new Array<number>(ids.length).fill(1)
    while (ids.length < maxLength) {
      ids.push(PAD)
      mask.push(0)
    }

    return {
      ids: BigInt64Array.from(ids.map((id) => BigInt(id))),
      mask: BigInt64Array.from(mask.map((value) => BigInt(value)))
    }
  }
}

export function tokenizerFileExists(path: string): boolean {
  return existsSync(path)
}
