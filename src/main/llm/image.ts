import { existsSync } from 'node:fs'
import sharp from 'sharp'
import { getItemFile, previewPathFor } from '../repo'
import { LlmError, type LlmContentPart } from './types'

export interface PreparedImage {
  part: LlmContentPart
  width: number
  height: number
  /** 实际送到模型的像素尺寸，便于提示词里说明 */
  maxEdge: number
}

async function render(file: string, maxEdge: number) {
  const result = await sharp(file, { failOn: 'none' })
    .rotate()
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer({ resolveWithObject: true })
  return { buffer: result.data, width: result.info.width, height: result.info.height }
}

/**
 * 把一张图压到适合视觉模型的大小（默认长边 1024）。
 * RAW / TIFF / HEIF 优先用导入时生成的预览，避免 sharp 解不动原文件。
 */
export async function prepareImage(itemId: number, maxEdge = 1024): Promise<PreparedImage> {
  const file = getItemFile(itemId)
  if (!file || !existsSync(file)) {
    throw new LlmError('bad_request', `图片 ${itemId} 的源文件不可用`)
  }

  let rendered
  try {
    rendered = await render(file, maxEdge)
  } catch {
    const preview = previewPathFor(itemId)
    if (!existsSync(preview)) {
      throw new LlmError('bad_request', `图片 ${itemId} 无法解码，也没有可用预览`)
    }
    rendered = await render(preview, maxEdge)
  }

  return {
    part: { type: 'image', mime: 'image/jpeg', base64: rendered.buffer.toString('base64') },
    width: rendered.width,
    height: rendered.height,
    maxEdge
  }
}
