import { readFile } from 'node:fs/promises'
import sharp from 'sharp'

const SOI = Buffer.from([0xff, 0xd8, 0xff])
const MIN_PREVIEW_BYTES = 16 * 1024

/**
 * 从 SOI 开始按 JPEG 段结构走到 EOI，跳过 EXIF(APP1) 中的缩略图，避免误判结束位置。
 */
function findJpegEnd(buf: Buffer, start: number): number | null {
  let pos = start + 2
  while (pos + 3 < buf.length) {
    if (buf[pos] !== 0xff) {
      pos++
      continue
    }
    const marker = buf[pos + 1]
    if (marker === 0xff) {
      pos++
      continue
    }
    if (marker === 0xd8) {
      pos += 2
      continue
    }
    if (marker === 0xd9) return pos + 2
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2
      continue
    }

    const length = buf.readUInt16BE(pos + 2)
    if (length < 2) return null

    if (marker === 0xda) {
      // 熵编码数据：0xFF00 是填充字节，0xFFD0-D7 是重启标记，其它 0xFFxx 表示下一段开始
      let p = pos + 2 + length
      while (p + 1 < buf.length) {
        if (buf[p] === 0xff) {
          const next = buf[p + 1]
          if (next === 0xd9) return p + 2
          if (next !== 0x00 && !(next >= 0xd0 && next <= 0xd7)) break
        }
        p++
      }
      pos = p
      continue
    }

    pos += 2 + length
  }
  return null
}

/**
 * 扫描 RAW 容器里的 JPEG 预览，按解码后的像素面积挑最大的一张。
 */
export async function extractEmbeddedPreview(filePath: string): Promise<Buffer | null> {
  const buf = await readFile(filePath)
  const candidates: Array<{ start: number; end: number }> = []

  let cursor = 0
  while (candidates.length < 60) {
    const index = buf.indexOf(SOI, cursor)
    if (index < 0) break
    const end = findJpegEnd(buf, index)
    if (end && end - index >= MIN_PREVIEW_BYTES) candidates.push({ start: index, end })
    cursor = index + 3
  }

  if (candidates.length === 0) return null

  // 字节数大的通常就是全尺寸预览，先试大的
  candidates.sort((a, b) => b.end - b.start - (a.end - a.start))
  let best: { buffer: Buffer; area: number } | null = null
  for (const candidate of candidates.slice(0, 8)) {
    const slice = buf.subarray(candidate.start, candidate.end)
    try {
      const meta = await sharp(slice, { failOn: 'none' }).metadata()
      const width = meta.width ?? 0
      const height = meta.height ?? 0
      if (meta.format !== 'jpeg' || width < 640 || height < 480) continue
      const area = width * height
      if (!best || area > best.area) best = { buffer: Buffer.from(slice), area }
      if (area >= 6000 * 4000) break
    } catch {
      // 假阳性，继续试下一张
    }
  }

  return best ? best.buffer : null
}
