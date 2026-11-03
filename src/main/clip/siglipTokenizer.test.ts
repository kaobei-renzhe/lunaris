import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { SiglipTokenizer } from './siglipTokenizer'

const dir = mkdtempSync(join(tmpdir(), 'siglip-tokenizer-'))
const path = join(dir, 'tokenizer.json')

writeFileSync(
  path,
  JSON.stringify({
    model: {
      vocab: {
        '<pad>': 0,
        '<eos>': 1,
        '<bos>': 2,
        '<unk>': 3,
        '▁': 4,
        a: 5,
        b: 6,
        '▁a': 7,
        ab: 8,
        '▁ab': 9,
        '<0xE4>': 10,
        '<0xBD>': 11,
        '<0xA0>': 12
      },
      merges: [
        ['▁', 'a'],
        ['a', 'b'],
        ['▁a', 'b']
      ],
      unk_token: '<unk>'
    }
  })
)

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('SiglipTokenizer', () => {
  const tokenizer = new SiglipTokenizer(path)

  it('lowercases, replaces spaces with ▁ and applies BPE merges', () => {
    expect([...tokenizer.encode('AB').ids]).toEqual([8n, 1n])
    expect([...tokenizer.encode(' a').ids]).toEqual([7n, 1n])
    expect([...tokenizer.encode(' a b').ids]).toEqual([7n, 4n, 6n, 1n])
  })

  it('falls back to byte tokens for characters outside the vocab', () => {
    expect([...tokenizer.encode('你').ids]).toEqual([10n, 11n, 12n, 1n])
  })

  it('keeps the EOS at the end when truncating', () => {
    const { ids } = tokenizer.encode('abab', 3)
    expect(ids.length).toBe(3)
    expect(ids[ids.length - 1]).toBe(1n)
  })
})
