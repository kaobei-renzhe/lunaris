import { readFileSync } from 'node:fs'

interface TokenizerJson {
  model: {
    vocab: Record<string, number>
    merges: Array<[string, string]>
    unk_token?: string
  }
}

const EOS_ID = 1
const UNK_TOKEN = '<unk>'
const PAIR_SEP = '\u0001'

function byteToken(byte: number): string {
  return `<0x${byte.toString(16).toUpperCase().padStart(2, '0')}>`
}

/**
 * SigLIP 2 用的是 Gemma 的 BPE 词表（256k）：
 * 空格先换成 ▁，再按 merges 优先级做 BPE；词表外的字符回退成 <0xXX> 字节 token。
 * 只实现编码所需的部分，解码用不到。
 */
export class SiglipTokenizer {
  private readonly vocab: Map<string, number>
  private readonly merges: Map<string, number>
  private readonly unkId: number
  private readonly byteTokens: string[]

  constructor(tokenizerPath: string) {
    const json = JSON.parse(readFileSync(tokenizerPath, 'utf8')) as TokenizerJson
    this.vocab = new Map(Object.entries(json.model.vocab))
    this.merges = new Map()
    json.model.merges.forEach((pair, index) => {
      this.merges.set(`${pair[0]}${PAIR_SEP}${pair[1]}`, index)
    })
    this.unkId = this.vocab.get(json.model.unk_token ?? UNK_TOKEN) ?? 3
    this.byteTokens = Array.from({ length: 256 }, (_, byte) => {
      const token = byteToken(byte)
      return this.vocab.has(token) ? token : UNK_TOKEN
    })
  }

  /** 返回实际长度的 id / mask（不含 padding），由调用方决定是否补齐 */
  encode(text: string, maxLength = 64): { ids: BigInt64Array; mask: BigInt64Array } {
    const normalized = text.toLowerCase().replace(/ /g, '▁')
    const symbols: string[] = []
    for (const char of normalized) {
      if (this.vocab.has(char)) {
        symbols.push(char)
        continue
      }
      // 词表外字符按 UTF-8 字节回退，保证中文/emoji 都有 id
      for (const byte of Buffer.from(char, 'utf8')) symbols.push(this.byteTokens[byte])
    }

    const merged = this.merge(symbols)
    const ids: number[] = []
    for (const symbol of merged) {
      ids.push(this.vocab.get(symbol) ?? this.unkId)
      if (ids.length >= maxLength - 1) break
    }
    ids.push(EOS_ID)

    return {
      ids: BigInt64Array.from(ids.map((id) => BigInt(id))),
      mask: BigInt64Array.from(ids.map(() => 1n))
    }
  }

  /** 标准 BPE：每轮合并优先级最高的一对相邻符号，直到没有可合并的 */
  private merge(symbols: string[]): string[] {
    let current = symbols
    while (current.length > 1) {
      let bestRank = Number.POSITIVE_INFINITY
      let bestIndex = -1
      for (let i = 0; i < current.length - 1; i++) {
        const rank = this.merges.get(`${current[i]}${PAIR_SEP}${current[i + 1]}`)
        if (rank !== undefined && rank < bestRank) {
          bestRank = rank
          bestIndex = i
        }
      }
      if (bestIndex < 0) break

      const left = current[bestIndex]
      const right = current[bestIndex + 1]
      const next: string[] = []
      for (let i = 0; i < current.length; i++) {
        if (i < current.length - 1 && current[i] === left && current[i + 1] === right) {
          next.push(left + right)
          i++
        } else {
          next.push(current[i])
        }
      }
      if (next.length === current.length) break
      current = next
    }
    return current
  }
}
