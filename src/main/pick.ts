import { existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import sharp from 'sharp'
import { getDb } from './db'
import { getItemFile, getItemsByIds } from './repo'
import { log } from './logger'
import { parsePickReply } from './pickReply'
import { buildPickHtml, type PickHtmlShot } from './pickHtml'
import { normalizePickWatermark } from '../shared/pick'
import { loadLogo, textWidth, watermarkBlockSvg, type LogoAsset } from './watermark'
import type {
  PickAction,
  PickApplyResult,
  PickExportFailure,
  PickExportInput,
  PickExportProgress,
  PickExportResult,
  PickReplyPreview,
  PickSessionItem,
  PickSessionSummary,
  PickWatermarkStyle
} from '../shared/types'

const MAX_PHOTOS = 999
const JPEG_QUALITY = 72

interface SessionRow {
  id: number
  token: string
  title: string
  client: string
  photo_count: number
  watermark: string
  file_path: string | null
  client_note: string
  reply_count: number
  created_at: number
  sent_at: number | null
  received_at: number | null
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** 8 位短码，避开容易看错的 0/o/1/l，方便主人在文件名和聊天记录里认单 */
export function newPickToken(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  const db = getDb()
  for (let attempt = 0; attempt < 20; attempt++) {
    let token = ''
    for (let i = 0; i < 8; i++) {
      token += alphabet[Math.floor(Math.random() * alphabet.length)]
    }
    const exists = db.prepare('SELECT 1 FROM pick_sessions WHERE token = ?').get(token)
    if (!exists) return token
  }
  return Date.now().toString(36)
}

/**
 * 把原图缩到客户够看的尺寸，并把水印烘进像素。
 * 先解成 raw 再合成一次，避免 resize 后重复解码整张原图。
 */
async function renderForClient(
  file: string,
  maxEdge: number,
  label: string,
  style: PickWatermarkStyle,
  logo: LogoAsset | null
): Promise<{ b64: string; width: number; height: number }> {
  const edge = [800, 1200, 1600].includes(maxEdge) ? maxEdge : 1200
  const { data, info } = await sharp(file, { failOn: 'none' })
    .rotate()
    .resize(edge, edge, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true })

  let fontSize = Math.max(
    10,
    Math.round(Math.min(info.width, info.height) * style.fontScale)
  )
  const maxWidth = Math.round(Math.min(info.width, info.height) * 0.62)
  while (fontSize > 9 && textWidth(label, fontSize) > maxWidth) fontSize--

  // logo 跟着画面宽度走，但至少 40px、最多半屏，避免极端比例下看不见或糊满整张
  const logoWidth = logo
    ? Math.max(40, Math.min(Math.round(info.width * 0.5), Math.round(info.width * style.logoScale)))
    : 0

  const jpeg = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels }
  })
    .composite([
      { input: watermarkBlockSvg(label, fontSize, style, logo, logoWidth), gravity: style.position }
    ])
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer()

  return { b64: jpeg.toString('base64'), width: info.width, height: info.height }
}

function createSession(
  token: string,
  input: PickExportInput,
  label: string,
  shots: Array<PickHtmlShot & { itemId: number }>,
  outPath: string
): number {
  const db = getDb()
  const insertSession = db.prepare(
    `INSERT INTO pick_sessions(token, title, client, photo_count, watermark, file_path, created_at)
     VALUES(?, ?, ?, ?, ?, ?, ?)`
  )
  const insertItem = db.prepare(
    'INSERT INTO pick_items(session_id, seq, item_id, action, note) VALUES(?, ?, ?, NULL, NULL)'
  )
  const tx = db.transaction(() => {
    const info = insertSession.run(
      token,
      input.title.trim() || '未命名选片',
      input.client.trim(),
      shots.length,
      label,
      outPath,
      Date.now()
    )
    const sessionId = Number(info.lastInsertRowid)
    for (const shot of shots) insertItem.run(sessionId, shot.seq, shot.itemId)
    return sessionId
  })
  return tx()
}

function deleteSession(sessionId: number): void {
  const db = getDb()
  db.prepare('DELETE FROM pick_items WHERE session_id = ?').run(sessionId)
  db.prepare('DELETE FROM pick_sessions WHERE id = ?').run(sessionId)
}

/** 删除一单选片记录；照片、标签、旗标都不受影响 */
export function deletePickSession(sessionId: number): void {
  if (!getSession(sessionId)) return
  deleteSession(sessionId)
}

/**
 * 导出选片页：读原图 → 缩图 + 水印 → base64 内嵌 → 单个 HTML。
 * 用户取消保存时由调用方返回 null，不走到这里。
 */
export async function exportPickSession(
  input: PickExportInput,
  outPath: string,
  onProgress?: (progress: PickExportProgress) => void
): Promise<PickExportResult> {
  const ids = [...new Set((input.itemIds ?? []).filter((id) => Number.isFinite(id)))]
  if (ids.length === 0) throw new Error('没有选中照片')
  if (ids.length > MAX_PHOTOS) throw new Error(`一次最多导出 ${MAX_PHOTOS} 张`)
  if (!input.title.trim()) throw new Error('请先填写标题')

  const items = getItemsByIds(ids)
  if (items.length !== ids.length) throw new Error('有照片已经不在图库里，请刷新后再试')

  const label =
    input.watermark.trim() || [input.client.trim(), today()].filter(Boolean).join(' · ')
  const style = normalizePickWatermark(input.watermarkStyle)
  const logo = await loadLogo(style.logo)

  const shots: Array<PickHtmlShot & { itemId: number }> = []
  const failed: PickExportFailure[] = []
  let done = 0
  for (const item of items) {
    onProgress?.({ done, total: items.length, current: item.name })
    try {
      const file = getItemFile(item.id)
      if (!file || !existsSync(file)) throw new Error('原文件不在了')
      const rendered = await renderForClient(file, input.maxEdge, label, style, logo)
      shots.push({
        seq: shots.length + 1,
        itemId: item.id,
        width: rendered.width,
        height: rendered.height,
        b64: rendered.b64
      })
    } catch (error) {
      failed.push({ id: item.id, name: item.name, message: (error as Error).message })
      void log.warn('pick', '选片页跳过一张照片', { id: item.id, error: (error as Error).message })
    }
    done++
    onProgress?.({ done, total: items.length, current: item.name })
  }

  if (shots.length === 0) throw new Error('所有照片都没能读取，导出已取消')

  const token = newPickToken()
  const sessionId = createSession(token, input, label, shots, outPath)
  const html = buildPickHtml({
    token,
    title: input.title.trim() || '未命名选片',
    client: input.client.trim(),
    shots
  })

  mkdirSync(dirname(outPath), { recursive: true })
  const temp = `${outPath}.tmp`
  try {
    await writeFile(temp, html, 'utf8')
    await rename(temp, outPath)
  } catch (error) {
    try {
      if (existsSync(temp)) unlinkSync(temp)
    } catch {
      /* 清理失败不影响报错 */
    }
    deleteSession(sessionId)
    throw new Error(`写入选片页失败：${(error as Error).message}`)
  }

  getDb().prepare('UPDATE pick_sessions SET sent_at = ? WHERE id = ?').run(Date.now(), sessionId)

  return {
    sessionId,
    token,
    path: outPath,
    bytes: statSync(outPath).size,
    count: shots.length,
    failed
  }
}

function mapSession(
  row: SessionRow & { keep?: number; fix?: number; reject?: number; pending?: number }
): PickSessionSummary {
  return {
    id: row.id,
    token: row.token,
    title: row.title,
    client: row.client,
    photoCount: row.photo_count,
    watermark: row.watermark,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    receivedAt: row.received_at,
    filePath: row.file_path ?? null,
    clientNote: row.client_note ?? '',
    replyCount: row.reply_count ?? 0,
    keep: row.keep ?? 0,
    fix: row.fix ?? 0,
    reject: row.reject ?? 0,
    pending: row.pending ?? 0
  }
}

export function listPickSessions(): PickSessionSummary[] {
  const rows = getDb()
    .prepare(
      `SELECT s.*,
              coalesce(SUM(pi.action = 'keep'), 0) AS keep,
              coalesce(SUM(pi.action = 'fix'), 0) AS fix,
              coalesce(SUM(pi.action = 'reject'), 0) AS reject,
              coalesce(SUM(pi.action IS NULL), 0) AS pending
       FROM pick_sessions s
       LEFT JOIN pick_items pi ON pi.session_id = s.id
       GROUP BY s.id
       ORDER BY s.created_at DESC, s.id DESC`
    )
    .all() as Array<SessionRow & { keep: number; fix: number; reject: number; pending: number }>
  return rows.map(mapSession)
}

export function listPickSessionItems(sessionId: number): PickSessionItem[] {
  const rows = getDb()
    .prepare(
      `SELECT pi.seq, pi.item_id, coalesce(i.name, '已移除的照片') AS name, pi.action
       FROM pick_items pi
       LEFT JOIN items i ON i.id = pi.item_id
       WHERE pi.session_id = ?
       ORDER BY pi.seq`
    )
    .all(sessionId) as Array<{
    seq: number
    item_id: number
    name: string
    action: PickAction | null
  }>
  return rows.map((row) => ({
    seq: row.seq,
    itemId: row.item_id,
    name: row.name,
    action: row.action
  }))
}

function getSession(sessionId: number): SessionRow | null {
  const row = getDb().prepare('SELECT * FROM pick_sessions WHERE id = ?').get(sessionId) as
    | SessionRow
    | undefined
  return row ?? null
}

function sessionSeqs(sessionId: number): Set<number> {
  const rows = getDb()
    .prepare('SELECT seq FROM pick_items WHERE session_id = ?')
    .all(sessionId) as Array<{ seq: number }>
  return new Set(rows.map((row) => row.seq))
}

export function previewPickReply(sessionId: number, text: string): PickReplyPreview {
  const session = getSession(sessionId)
  if (!session) throw new Error('选片会话不存在')
  const parsed = parsePickReply(text)
  const valid = sessionSeqs(sessionId)
  const unmatched = [...new Set([...parsed.keep, ...parsed.fix])].filter((seq) => !valid.has(seq))
  return { ...parsed, unmatched, total: session.photo_count }
}

/** 落库：客户再次回传时会整体覆盖上一次结果，未提到的编号回到「待定」 */
export function applyPickReply(sessionId: number, preview: PickReplyPreview): PickApplyResult {
  const session = getSession(sessionId)
  if (!session) throw new Error('选片会话不存在')
  const valid = sessionSeqs(sessionId)
  const fix = [...new Set(preview.fix ?? [])].filter((seq) => valid.has(seq))
  const fixSet = new Set(fix)
  // 同一张既写了要又写了要修时，按要修处理（客户想要修过的版本）
  const keep = [...new Set(preview.keep ?? [])].filter((seq) => valid.has(seq) && !fixSet.has(seq))
  const unmatched = [...new Set([...(preview.keep ?? []), ...(preview.fix ?? [])])].filter(
    (seq) => !valid.has(seq)
  )

  const db = getDb()
  const setAction = db.prepare('UPDATE pick_items SET action = ? WHERE session_id = ? AND seq = ?')
  const note = String(preview.note ?? '').trim().slice(0, 1000)
  const tx = db.transaction(() => {
    db.prepare('UPDATE pick_items SET action = NULL WHERE session_id = ?').run(sessionId)
    for (const seq of keep) setAction.run('keep', sessionId, seq)
    for (const seq of fix) setAction.run('fix', sessionId, seq)
    if (preview.rejectRest) {
      db.prepare("UPDATE pick_items SET action = 'reject' WHERE session_id = ? AND action IS NULL").run(
        sessionId
      )
    }
    db.prepare(
      `UPDATE pick_sessions
       SET received_at = ?, client_note = ?, reply_count = reply_count + 1
       WHERE id = ?`
    ).run(Date.now(), note, sessionId)
  })
  tx()

  const saved = getSession(sessionId)
  return {
    keep: keep.length,
    fix: fix.length,
    reject: preview.rejectRest ? Math.max(0, session.photo_count - keep.length - fix.length) : 0,
    unmatched,
    note,
    replyCount: saved?.reply_count ?? 1
  }
}
