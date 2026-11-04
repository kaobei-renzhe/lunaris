import { existsSync, mkdirSync } from 'node:fs'
import { copyFile, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import sharp from 'sharp'
import { getItemFile, getItemsByIds } from './repo'
import { log } from './logger'
import { loadLogo, textWidth, watermarkBlockSvg, type LogoAsset } from './watermark'
import type {
  FinalsExportFailure,
  FinalsExportInput,
  FinalsExportProgress,
  FinalsExportResult,
  PickWatermarkStyle
} from '../shared/types'

const MAX_ITEMS = 2000

/** 一张待导出的照片：原文件用于复制，file 是可解码的那份（RAW 取导入时抽出的预览） */
export interface FinalsSource {
  id: number
  name: string
  path: string
  file: string | null
}

/** Windows 文件名禁用字符 + 结尾的点/空格，清掉免得写不进去 */
function safeBase(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
  return cleaned || 'photo'
}

/** 同名文件不覆盖，直接加序号 */
function uniquePath(dir: string, base: string, ext: string): { path: string; renamed: boolean } {
  let candidate = join(dir, `${base}${ext}`)
  let n = 2
  while (existsSync(candidate)) {
    candidate = join(dir, `${base}-${n}${ext}`)
    n += 1
  }
  return { path: candidate, renamed: n > 2 }
}

async function renderJpeg(
  file: string,
  maxEdge: number | null,
  quality: number,
  label: string,
  style: PickWatermarkStyle,
  logo: LogoAsset | null
): Promise<Buffer> {
  let pipeline = sharp(file, { failOn: 'none' })
    .rotate()
    .flatten({ background: '#ffffff' })
    .toColourspace('srgb')
  if (maxEdge) {
    pipeline = pipeline.resize(maxEdge, maxEdge, { fit: 'inside', withoutEnlargement: true })
  }
  // 先解成 raw 再合成一次：水印尺寸要按缩放后的实际像素算
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true })
  let output = sharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels }
  })
  if (label) {
    let fontSize = Math.max(10, Math.round(Math.min(info.width, info.height) * style.fontScale))
    const maxWidth = Math.round(Math.min(info.width, info.height) * 0.62)
    while (fontSize > 9 && textWidth(label, fontSize) > maxWidth) fontSize -= 1
    const logoWidth = logo
      ? Math.max(40, Math.min(Math.round(info.width * 0.5), Math.round(info.width * style.logoScale)))
      : 0
    output = output.composite([
      {
        input: watermarkBlockSvg(label, fontSize, style, logo, logoWidth),
        gravity: style.position
      }
    ])
  }
  return output.jpeg({ quality }).toBuffer()
}

/**
 * 真正干活的版本：不碰数据库，传入照片清单即可，方便单独测。
 * 同一目录里重名不覆盖，自动加序号。
 */
export async function exportFinalsTo(
  input: FinalsExportInput,
  dir: string,
  sources: FinalsSource[],
  onProgress?: (progress: FinalsExportProgress) => void
): Promise<FinalsExportResult> {
  const mode = input.mode === 'copy' ? 'copy' : 'jpeg'
  mkdirSync(dir, { recursive: true })

  const label = mode === 'jpeg' ? String(input.watermark ?? '').trim() : ''
  const style = input.watermarkStyle
  const logo = label ? await loadLogo(style.logo) : null
  const quality = Math.min(95, Math.max(60, Math.round(Number(input.quality) || 90)))
  const maxEdge =
    mode === 'jpeg' && Number.isFinite(Number(input.maxEdge)) ? Number(input.maxEdge) : null
  const prefix = safeBase(String(input.prefix ?? '').trim() || 'export')

  const failed: FinalsExportFailure[] = []
  let count = 0
  let bytes = 0
  let renamed = 0
  let done = 0

  for (const [position, source] of sources.entries()) {
    onProgress?.({ done, total: sources.length, current: source.name })
    try {
      const file = mode === 'copy' ? source.path : source.file
      if (!file || !existsSync(file)) throw new Error('原文件不在了')

      const base =
        input.naming === 'prefix'
          ? `${prefix}-${String(position + 1).padStart(3, '0')}`
          : safeBase(basename(source.name, extname(source.name)))
      const ext = mode === 'copy' ? extname(file) : '.jpg'
      const target = uniquePath(dir, base, ext)

      if (mode === 'copy') {
        await copyFile(file, target.path)
      } else {
        const buffer = await renderJpeg(file, maxEdge, quality, label, style, logo)
        await writeFile(target.path, buffer)
      }

      bytes += (await stat(target.path)).size
      count += 1
      if (target.renamed) renamed += 1
    } catch (error) {
      failed.push({ id: source.id, name: source.name, message: (error as Error).message })
      void log.warn('finals', '导出跳过一张', { id: source.id, error: (error as Error).message })
    }
    done += 1
    onProgress?.({ done, total: sources.length, current: source.name })
  }

  if (count === 0) throw new Error('所有照片都没能导出')
  return { dir, count, bytes, renamed, failed }
}

/** 导出成品：从图库取照片清单，再交给 exportFinalsTo */
export async function exportFinals(
  input: FinalsExportInput,
  dir: string,
  onProgress?: (progress: FinalsExportProgress) => void
): Promise<FinalsExportResult> {
  const ids = [...new Set((input.itemIds ?? []).filter((id) => Number.isFinite(id)))]
  if (ids.length === 0) throw new Error('没有选中照片')
  if (ids.length > MAX_ITEMS) throw new Error(`一次最多导出 ${MAX_ITEMS} 张`)

  const items = getItemsByIds(ids)
  if (items.length !== ids.length) throw new Error('有照片已经不在图库里，请刷新后再试')

  return exportFinalsTo(
    input,
    dir,
    items.map((item) => ({
      id: item.id,
      name: item.name,
      path: item.path,
      file: getItemFile(item.id)
    })),
    onProgress
  )
}
