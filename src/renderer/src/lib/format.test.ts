import { describe, expect, it } from 'vitest'
import { formatBytes, formatDate, folderName, scoreColor, thumbUrl } from './format'

describe('formatBytes', () => {
  it('0 与字节级不带小数', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('进位后保留一位小数', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1024 * 1024 * 1.5)).toBe('1.5 MB')
  })

  it('超过 100 时不带小数', () => {
    expect(formatBytes(1024 * 120)).toBe('120 KB')
  })
})

describe('thumbUrl', () => {
  it('默认中档，显式档位写进查询参数', () => {
    expect(thumbUrl(12)).toBe('thumb://item/12?q=mid')
    expect(thumbUrl(12, 'mid')).toBe('thumb://item/12?q=mid')
    expect(thumbUrl(12, 'low')).toBe('thumb://item/12?q=low')
    expect(thumbUrl(12, 'high')).toBe('thumb://item/12?q=high')
  })
})

describe('folderName', () => {
  it('取最后一段，兼容反斜杠与结尾斜杠', () => {
    expect(folderName('E:\\照片\\2024\\a.jpg')).toBe('a.jpg')
    expect(folderName('E:/photos/')).toBe('photos')
    expect(folderName('E:\\照片')).toBe('照片')
  })
})

describe('scoreColor', () => {
  it('80 以上绿、60 以上黄、其余红', () => {
    expect(scoreColor(80)).toBe('var(--success)')
    expect(scoreColor(79)).toBe('var(--warn)')
    expect(scoreColor(60)).toBe('var(--warn)')
    expect(scoreColor(59)).toBe('var(--danger-text)')
  })
})

describe('formatDate', () => {
  it('空值与非法值显示占位符', () => {
    expect(formatDate(0)).toBe('—')
    expect(formatDate(Number.NaN)).toBe('—')
  })

  it('按本地时间格式化成分钟', () => {
    const stamp = new Date(2024, 0, 2, 3, 4).getTime()
    expect(formatDate(stamp)).toBe('2024-01-02 03:04')
  })
})
