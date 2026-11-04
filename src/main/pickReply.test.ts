import { describe, expect, it } from 'vitest'
import { parsePickReply } from './pickReply'

describe('parsePickReply', () => {
  it('解析标准回传文本', () => {
    const text = [
      '【选片结果】小林 · 老门东街拍',
      '客户：王女士',
      '',
      '要的（3 张）：',
      '001, 012, 015',
      '',
      '要修的（1 张）：',
      '012、044',
      '',
      '不要的：其余',
      '',
      '备注：',
      '015 能不能再亮一点'
    ].join('\n')
    const parsed = parsePickReply(text)
    expect(parsed.keep).toEqual([1, 12, 15])
    expect(parsed.fix).toEqual([12, 44])
    expect(parsed.rejectRest).toBe(true)
    expect(parsed.note).toBe('015 能不能再亮一点')
  })

  it('容忍换行、中文逗号与全角数字', () => {
    const text = '要的（2 张）：\n００３， ００７\n要修的（1 张）：\n7\n不要的：其余'
    const parsed = parsePickReply(text)
    expect(parsed.keep).toEqual([3, 7])
    expect(parsed.fix).toEqual([7])
    expect(parsed.rejectRest).toBe(true)
  })

  it('没有「不要的：其余」时不擅自把所有照片标成不要', () => {
    const parsed = parsePickReply('要的（1 张）：005')
    expect(parsed.keep).toEqual([5])
    expect(parsed.rejectRest).toBe(false)
  })

  it('空文本与（无）都不会解析出编号', () => {
    expect(parsePickReply('').keep).toEqual([])
    expect(parsePickReply('要的（0 张）：（无）\n要修的（0 张）：（无）').keep).toEqual([])
  })

  it('不会把「要修的」误认成「要的」', () => {
    const parsed = parsePickReply('要修的（2 张）：009, 010')
    expect(parsed.keep).toEqual([])
    expect(parsed.fix).toEqual([9, 10])
  })

  it('备注里的数字不会混进选片编号', () => {
    const parsed = parsePickReply('要的（1 张）：001\n备注：\n第 015 张再亮一点')
    expect(parsed.keep).toEqual([1])
    expect(parsed.note).toBe('第 015 张再亮一点')
  })

  it('「不要的」里的编号不能混进「要的」', () => {
    const parsed = parsePickReply('要的（1 张）：001\n不要的（5 张）：002, 003')
    expect(parsed.keep).toEqual([1])
    expect(parsed.rejectRest).toBe(false)
    const onlyReject = parsePickReply('不要的（18 张）：其余')
    expect(onlyReject.keep).toEqual([])
    expect(onlyReject.fix).toEqual([])
  })
})
