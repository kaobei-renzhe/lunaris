import { describe, expect, it } from 'vitest'
import {
  formatBytes,
  formatDate,
  formatRelative,
  folderName,
  samePath,
  scoreColor,
  thumbUrl
} from './format'

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

describe('samePath', () => {
  it('忽略大小写、斜杠方向和末尾分隔符', () => {
    expect(samePath('E:\\Photos\\Shoot\\', 'e:/photos/shoot')).toBe(true)
    expect(samePath('E:\\Photos\\A', 'E:\\Photos\\B')).toBe(false)
  })
})

describe('formatRelative', () => {
  it('未打开与刚刚', () => {
    expect(formatRelative(0)).toBe('从未打开')
    expect(formatRelative(Date.now() - 10_000)).toBe('刚刚')
  })

  it('按分钟/小时/天展示', () => {
    expect(formatRelative(Date.now() - 5 * 60_000)).toBe('5 分钟前')
    expect(formatRelative(Date.now() - 3 * 3600_000)).toBe('3 小时前')
    expect(formatRelative(Date.now() - 4 * 86400_000)).toBe('4 天前')
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
