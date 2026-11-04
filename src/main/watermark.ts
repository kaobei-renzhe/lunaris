import { existsSync } from 'node:fs'
import sharp from 'sharp'
import type { PickWatermarkStyle } from '../shared/types'

/** 解析好的 logo：PNG + 尺寸，循环里直接复用，不重复读盘 */
export interface LogoAsset {
  dataUri: string
  width: number
  height: number
}

/** 估算文字宽度：中文按一个字宽，西文按 0.55 字宽，够用来排版 */
export function textWidth(text: string, fontSize: number): number {
  let units = 0
  for (const ch of text) units += ch.charCodeAt(0) > 0x2e80 ? 1 : 0.55
  return Math.ceil(units * fontSize)
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export async function loadLogo(path: string | null): Promise<LogoAsset | null> {
  if (!path) return null
  if (!existsSync(path)) throw new Error('logo 文件不在了，请重新选择')
  try {
    const buffer = await sharp(path, { failOn: 'none' })
      .resize({ width: 600, withoutEnlargement: true })
      .ensureAlpha()
      .png()
      .toBuffer()
    const meta = await sharp(buffer).metadata()
    if (!meta.width || !meta.height) throw new Error('读不出 logo 尺寸')
    return {
      dataUri: `data:image/png;base64,${buffer.toString('base64')}`,
      width: meta.width,
      height: meta.height
    }
  } catch (error) {
    throw new Error(`logo 读取失败：${(error as Error).message}`)
  }
}

/**
 * 水印块：logo（可选）在上、文字在下，整体作为一个透明 SVG 合成，
 * 这样位置、透明度、间距只需要在一个地方算。
 */
export function watermarkBlockSvg(
  label: string,
  fontSize: number,
  style: PickWatermarkStyle,
  logo: LogoAsset | null,
  logoWidth: number
): Buffer {
  const pad = Math.round(fontSize * 0.7)
  const textWidthValue = textWidth(label, fontSize)
  const textHeight = Math.ceil(fontSize * 1.9)
  const logoHeight = logo ? Math.max(1, Math.round((logoWidth * logo.height) / logo.width)) : 0
  const gap = logo ? Math.round(fontSize * 0.55) : 0
  const contentWidth = Math.max(textWidthValue, logo ? logoWidth : 0)
  const width = contentWidth + pad * 2
  const height = (logo ? logoHeight + gap : 0) + textHeight + pad * 2
  const textY = pad + (logo ? logoHeight + gap : 0) + Math.round(fontSize * 1.25)
  const strokeWidth = Math.max(1, fontSize * 0.045)
  const parts: string[] = []
  if (logo) {
    parts.push(
      `<image x="${(width - logoWidth) / 2}" y="${pad}" width="${logoWidth}" height="${logoHeight}"
        opacity="${style.opacity}" preserveAspectRatio="xMidYMid meet"
        href="${logo.dataUri}" />`
    )
  }
  parts.push(
    `<text x="${width / 2}" y="${textY}" text-anchor="middle"
      font-family="Microsoft YaHei, PingFang SC, Noto Sans CJK SC, sans-serif"
      font-size="${fontSize}" fill="rgba(255,255,255,${style.opacity})"
      stroke="rgba(0,0,0,${style.opacity * 0.55})" stroke-width="${strokeWidth}"
      paint-order="stroke">${escapeXml(label)}</text>`
  )
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`
  )
}
