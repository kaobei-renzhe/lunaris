import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PICK_WATERMARK_DEFAULT } from '../shared/pick'

vi.mock('electron', () => ({ app: { getPath: () => process.cwd() } }))
vi.mock('./logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const { exportFinalsTo } = await import('./finals')

const sources = (file: string) => [{ id: 1, name: 'A.jpg', path: file, file }]
const baseInput = {
  itemIds: [1],
  mode: 'jpeg' as const,
  maxEdge: null,
  quality: 90,
  naming: 'original' as const,
  prefix: '',
  watermark: '',
  watermarkStyle: PICK_WATERMARK_DEFAULT
}

let root = ''
let source = ''

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'lunaris-finals-'))
  source = join(root, 'A.jpg')
  // 1200×800 的纯色图，够检查缩放和水印
  await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#4a6fa5' } })
    .jpeg({ quality: 92 })
    .toFile(source)
})

describe('exportFinalsTo', () => {
  it('按长边缩放，前缀序号命名', async () => {
    const dir = join(root, 'out')
    const result = await exportFinalsTo(
      { ...baseInput, maxEdge: 640, naming: 'prefix', prefix: '小林' },
      dir,
      sources(source)
    )

    expect(result.count).toBe(1)
    expect(result.failed).toHaveLength(0)
    expect(readdirSync(dir)).toEqual(['小林-001.jpg'])

    const meta = await sharp(join(dir, '小林-001.jpg')).metadata()
    expect(meta.width).toBe(640)
    expect(meta.height).toBe(427)
  })

  it('不缩放时保持原尺寸', async () => {
    const dir = join(root, 'out')
    await exportFinalsTo({ ...baseInput, maxEdge: null }, dir, sources(source))
    const meta = await sharp(join(dir, 'A.jpg')).metadata()
    expect(meta.width).toBe(1200)
    expect(meta.height).toBe(800)
  })

  it('同名文件不覆盖，自动加序号', async () => {
    const dir = join(root, 'out')
    const first = await exportFinalsTo(baseInput, dir, sources(source))
    const second = await exportFinalsTo(baseInput, dir, sources(source))

    expect(first.renamed).toBe(0)
    expect(second.renamed).toBe(1)
    expect(readdirSync(dir).sort()).toEqual(['A-2.jpg', 'A.jpg'])
  })

  it('原件复制逐字节一致，保留原扩展名', async () => {
    const dir = join(root, 'out')
    const result = await exportFinalsTo({ ...baseInput, mode: 'copy' }, dir, sources(source))
    expect(result.count).toBe(1)
    expect(readFileSync(join(dir, 'A.jpg')).equals(readFileSync(source))).toBe(true)
  })

  it('水印会改像素但不改尺寸', async () => {
    const plain = join(root, 'plain')
    const stamped = join(root, 'stamped')
    await exportFinalsTo(baseInput, plain, sources(source))
    await exportFinalsTo(
      { ...baseInput, watermark: '银月影像' },
      stamped,
      sources(source)
    )

    const a = readFileSync(join(plain, 'A.jpg'))
    const b = readFileSync(join(stamped, 'A.jpg'))
    expect(a.equals(b)).toBe(false)
    const meta = await sharp(b).metadata()
    expect(meta.width).toBe(1200)
    expect(meta.height).toBe(800)
  })

  it('某张读不出来只记失败，其余照常导出', async () => {
    const dir = join(root, 'out')
    const result = await exportFinalsTo(
      baseInput,
      dir,
      [
        { id: 1, name: 'A.jpg', path: source, file: source },
        { id: 2, name: 'B.jpg', path: join(root, 'missing.jpg'), file: join(root, 'missing.jpg') }
      ]
    )
    expect(result.count).toBe(1)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0].name).toBe('B.jpg')
    expect(existsSync(join(dir, 'A.jpg'))).toBe(true)
  })

  it('全部失败时抛错，不留下空目录结果', async () => {
    await expect(
      exportFinalsTo(baseInput, join(root, 'out'), [
        { id: 9, name: 'X.jpg', path: join(root, 'none.jpg'), file: join(root, 'none.jpg') }
      ])
    ).rejects.toThrow('所有照片都没能导出')
  })
})
