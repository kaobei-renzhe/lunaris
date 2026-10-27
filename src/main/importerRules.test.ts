import { describe, expect, it } from 'vitest'
import {
  classifyColor,
  formatExposure,
  isSupportedFile,
  rgbToHex,
  shouldSkipDir
} from './importerRules'

describe('shouldSkipDir', () => {
  it('跳过依赖、版本库、回收站与系统卷目录', () => {
    expect(shouldSkipDir('node_modules')).toBe(true)
    expect(shouldSkipDir('.git')).toBe(true)
    expect(shouldSkipDir('$RECYCLE.BIN')).toBe(true)
    expect(shouldSkipDir('System Volume Information')).toBe(true)
  })

  it('所有点开头的隐藏目录都跳过', () => {
    expect(shouldSkipDir('.cache')).toBe(true)
    expect(shouldSkipDir('.照片')).toBe(true)
  })

  it('普通照片目录照常扫描', () => {
    expect(shouldSkipDir('照片')).toBe(false)
    expect(shouldSkipDir('2024-trip')).toBe(false)
    expect(shouldSkipDir('exports_v2')).toBe(false)
  })
})

describe('isSupportedFile', () => {
  it('常见位图与 RAW 都认', () => {
    expect(isSupportedFile('a.jpg')).toBe(true)
    expect(isSupportedFile('a.png')).toBe(true)
    expect(isSupportedFile('a.webp')).toBe(true)
    expect(isSupportedFile('a.nef')).toBe(true)
    expect(isSupportedFile('a.CR3')).toBe(true)
  })

  it('扩展名大小写不敏感', () => {
    expect(isSupportedFile('IMG_0001.JPEG')).toBe(true)
    expect(isSupportedFile('IMG_0002.NEF')).toBe(true)
  })

  it('非图片文件与没有扩展名的都排除', () => {
    expect(isSupportedFile('notes.txt')).toBe(false)
    expect(isSupportedFile('video.mp4')).toBe(false)
    expect(isSupportedFile('README')).toBe(false)
    expect(isSupportedFile('a.jpg.bak')).toBe(false)
  })
})

describe('rgbToHex', () => {
  it('补齐两位并小写输出', () => {
    expect(rgbToHex(0, 0, 0)).toBe('#000000')
    expect(rgbToHex(255, 255, 255)).toBe('#ffffff')
    expect(rgbToHex(122, 162, 247)).toBe('#7aa2f7')
  })

  it('单数字也补零', () => {
    expect(rgbToHex(1, 2, 3)).toBe('#010203')
  })
})

describe('classifyColor', () => {
  it('先按亮度判黑白，再看饱和度判灰', () => {
    expect(classifyColor(0, 0, 0)).toBe('black')
    expect(classifyColor(10, 10, 20)).toBe('black')
    expect(classifyColor(255, 255, 255)).toBe('white')
    expect(classifyColor(128, 128, 128)).toBe('gray')
  })

  it('按色相分到对应色系', () => {
    expect(classifyColor(255, 0, 0)).toBe('red')
    expect(classifyColor(255, 165, 0)).toBe('orange')
    expect(classifyColor(255, 255, 0)).toBe('yellow')
    expect(classifyColor(0, 255, 0)).toBe('green')
    expect(classifyColor(0, 255, 255)).toBe('cyan')
    expect(classifyColor(0, 0, 255)).toBe('blue')
    expect(classifyColor(128, 0, 255)).toBe('purple')
    expect(classifyColor(255, 105, 180)).toBe('pink')
  })

  it('色相首尾相连：洋红偏红也归到红', () => {
    expect(classifyColor(255, 0, 60)).toBe('red')
  })
})

describe('formatExposure', () => {
  it('缺失或非法值不输出', () => {
    expect(formatExposure(undefined)).toBeUndefined()
    expect(formatExposure(0)).toBeUndefined()
    expect(formatExposure(Number.NaN)).toBeUndefined()
  })

  it('一秒及以上用秒', () => {
    expect(formatExposure(1)).toBe('1s')
    expect(formatExposure(2.5)).toBe('2.5s')
  })

  it('更快的用 1/x 展示', () => {
    expect(formatExposure(0.008)).toBe('1/125s')
    expect(formatExposure(0.004)).toBe('1/250s')
  })
})
