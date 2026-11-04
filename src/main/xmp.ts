import { existsSync, statSync } from 'node:fs'
import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { getDb } from './db'
import { getXmpSettings } from './settings'
import { log } from './logger'
import type {
  XmpCheckResult,
  XmpConflictItem,
  XmpExportResult,
  XmpImportResult,
  XmpProgress
} from '../shared/types'

const DEFAULT_TAG_COLOR = '#7aa2f7'
const FLAG_PICK_LABEL = '青色'
const FLAG_REJECT_LABEL = '红色'

interface XmpItemRow {
  id: number
  path: string
  name: string
  ext: string
  rating: number
  flag: number
  note: string
  reference: number
  is_raw: number
  pair_key: string | null
  pair_cover: number
  trashed: number
  missing: number
  error: string | null
  xmp_mtime: number
}

const ITEM_COLUMNS = `id, path, name, ext, rating, flag, note, reference, is_raw, pair_key,
  pair_cover, trashed, missing, error, xmp_mtime`

export interface XmpData {
  rating: number
  flag: number
  note: string
  reference: boolean
  keywords: string[]
  hierarchical: string[]
}

export interface SidecarData extends XmpData {
  path: string
  mtime: number
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** 只写「人的判断」：星级、旗标、普通标签、facet 层级、短备注、参考片标记 */
export function buildXmp(data: XmpData): string {
  const attrs = [`xmp:Rating="${Math.max(0, Math.min(5, Math.round(data.rating)))}"`]
  if (data.flag > 0) {
    attrs.push(`xmp:Label="${FLAG_PICK_LABEL}"`, 'moonphoto:Flag="pick"')
  } else if (data.flag < 0) {
    attrs.push(`xmp:Label="${FLAG_REJECT_LABEL}"`, 'moonphoto:Flag="reject"')
  }
  if (data.reference) attrs.push('moonphoto:Reference="1"')
  attrs.push('moonphoto:Version="1"')

  const blocks: string[] = []
  if (data.note.trim()) {
    blocks.push(
      `   <dc:description>\n    <rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(
        data.note.trim()
      )}</rdf:li></rdf:Alt>\n   </dc:description>`
    )
  }
  if (data.keywords.length) {
    blocks.push(
      `   <dc:subject>\n    <rdf:Bag>${data.keywords
        .map((tag) => `<rdf:li>${escapeXml(tag)}</rdf:li>`)
        .join('')}</rdf:Bag>\n   </dc:subject>`
    )
  }
  if (data.hierarchical.length) {
    blocks.push(
      `   <lr:hierarchicalSubject>\n    <rdf:Bag>${data.hierarchical
        .map((tag) => `<rdf:li>${escapeXml(tag)}</rdf:li>`)
        .join('')}</rdf:Bag>\n   </lr:hierarchicalSubject>`
    )
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="月相 Lunaris 0.3">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:lr="http://ns.adobe.com/lightroom/1.0/"
    xmlns:moonphoto="https://lunaris.app/ns/1.0/"
    ${attrs.join('\n    ')}>
${blocks.join('\n')}
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
`
}

function basePath(filePath: string): string {
  const ext = extname(filePath)
  return ext ? filePath.slice(0, -ext.length) : filePath
}

/** 统一写小写 .xmp，读取时兼容 Adobe 的大写 .XMP */
function targetSidecar(filePath: string): string {
  return `${basePath(filePath)}.xmp`
}

function findSidecar(filePath: string): string | null {
  const base = basePath(filePath)
  for (const suffix of ['.xmp', '.XMP']) {
    const candidate = `${base}${suffix}`
    if (existsSync(candidate)) return candidate
  }
  return null
}

function itemRow(id: number): XmpItemRow | null {
  const row = getDb()
    .prepare(`SELECT ${ITEM_COLUMNS} FROM items WHERE id = ?`)
    .get(id) as XmpItemRow | undefined
  return row ?? null
}

/**
 * RAW + JPEG 配对的侧车处理：
 * 始终写 RAW 旁边的 .xmp；内容取配对封面（用户实际看到/操作的那张），标签合并两边。
 */
function pairContext(row: XmpItemRow): {
  target: string
  source: XmpItemRow
  ids: number[]
} | null {
  if (!row.pair_key) return null
  const rows = getDb()
    .prepare(`SELECT ${ITEM_COLUMNS} FROM items WHERE pair_key = ? AND trashed = 0`)
    .all(row.pair_key) as XmpItemRow[]
  if (rows.length < 2) return null
  const raw = rows.find((item) => item.is_raw === 1) ?? null
  const cover = rows.find((item) => item.pair_cover === 1) ?? raw ?? row
  return {
    target: targetSidecar(raw?.path ?? row.path),
    source: cover,
    ids: rows.map((item) => item.id)
  }
}

function collectXmpData(row: XmpItemRow, extraIds: number[] = []): XmpData {
  const ids = [...new Set([row.id, ...extraIds])]
  const placeholders = ids.map(() => '?').join(',')
  const tags = getDb()
    .prepare(
      `SELECT t.name, t.facet_id, f.name AS facet_name
       FROM item_tags it
       JOIN tags t ON t.id = it.tag_id
       LEFT JOIN facets f ON f.id = t.facet_id
       WHERE it.item_id IN (${placeholders})`
    )
    .all(...ids) as Array<{ name: string; facet_id: string | null; facet_name: string | null }>

  const keywords = new Set<string>()
  const hierarchical = new Set<string>()
  for (const tag of tags) {
    if (tag.facet_id && tag.facet_name) hierarchical.add(`${tag.facet_name}|${tag.name}`)
    else keywords.add(tag.name)
  }
  return {
    rating: row.rating,
    flag: row.flag,
    note: row.note,
    reference: row.reference === 1,
    keywords: [...keywords],
    hierarchical: [...hierarchical]
  }
}

export async function writeSidecarForItem(
  itemId: number
): Promise<'written' | 'skipped' | 'failed'> {
  const row = itemRow(itemId)
  if (!row || row.trashed || row.missing || row.error) return 'skipped'

  const pair = pairContext(row)
  const source = pair?.source ?? row
  const target = pair?.target ?? targetSidecar(row.path)
  const temp = `${target}.tmp`
  try {
    await writeFile(temp, buildXmp(collectXmpData(source, pair?.ids ?? [])), 'utf8')
    // 先写临时文件再改名，避免断电留下半个 XMP
    await rename(temp, target)
    const mtime = Math.round(statSync(target).mtimeMs)
    const ids = pair?.ids ?? [row.id]
    const update = getDb().prepare('UPDATE items SET xmp_mtime = ? WHERE id = ?')
    for (const id of ids) update.run(mtime, id)
    return 'written'
  } catch (error) {
    try {
      if (existsSync(temp)) await unlink(temp)
    } catch {
      /* 清理失败不影响主流程 */
    }
    void log.warn('xmp', '写入侧车失败', { id: row.id, path: row.path, error: (error as Error).message })
    return 'failed'
  }
}

function extractList(xml: string, tag: string): string[] {
  const block = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(xml)?.[1]
  if (!block) return []
  const out: string[] = []
  for (const match of block.matchAll(/<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/gi)) {
    const value = decodeXml(match[1].replace(/<[^>]+>/g, '')).trim()
    if (value) out.push(value)
  }
  return out
}

function extractText(xml: string, tag: string): string {
  const block = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(xml)?.[1]
  if (!block) return ''
  const li = /<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/i.exec(block)?.[1] ?? block
  return decodeXml(li.replace(/<[^>]+>/g, '')).trim()
}

function attrOrTag(xml: string, name: string): string {
  const attr = new RegExp(`${name}="([^"]*)"`, 'i').exec(xml)?.[1]
  if (attr !== undefined) return decodeXml(attr)
  return extractText(xml, name)
}

/** 读取同名 .xmp / .XMP；标准字段按 Adobe 的 RDF 结构解析，私有字段单独读 */
export async function readSidecar(filePath: string): Promise<SidecarData | null> {
  const sidecar = findSidecar(filePath)
  if (!sidecar) return null
  try {
    const xml = await readFile(sidecar, 'utf8')
    const rating = Number(attrOrTag(xml, 'xmp:Rating') || 0)
    const label = attrOrTag(xml, 'xmp:Label')
    const flagMatch = /moonphoto:Flag="(pick|reject)"/.exec(xml)
    const refMatch = /moonphoto:Reference="(1|true|True)"/.exec(xml)
    let flag = flagMatch?.[1] === 'pick' ? 1 : flagMatch?.[1] === 'reject' ? -1 : 0
    if (!flag && label) {
      if (label.includes('红') || /red/i.test(label)) flag = -1
      else if (label.includes('青') || label.includes('绿') || /cyan|green/i.test(label)) flag = 1
    }

    const keywords = extractList(xml, 'dc:subject')
    const hierarchical = extractList(xml, 'lr:hierarchicalSubject')
    return {
      path: sidecar,
      mtime: Math.round(statSync(sidecar).mtimeMs),
      rating: Number.isFinite(rating) ? Math.max(0, Math.min(5, Math.round(rating))) : 0,
      flag,
      note: extractText(xml, 'dc:description'),
      reference: Boolean(refMatch),
      keywords: [...new Set(keywords.map((item) => item.trim()).filter(Boolean))],
      hierarchical: [...new Set(hierarchical.map((item) => item.trim()).filter(Boolean))]
    }
  } catch (error) {
    void log.warn('xmp', '读取侧车失败', { path: sidecar, error: (error as Error).message })
    return null
  }
}

function attachTag(itemId: number, name: string, facetId: string | null): void {
  const db = getDb()
  const clean = name.trim()
  if (!clean) return
  let row = db.prepare('SELECT id, facet_id FROM tags WHERE name = ?').get(clean) as
    | { id: number; facet_id: string | null }
    | undefined
  if (!row) {
    const info = db
      .prepare('INSERT INTO tags(name, color, created_at) VALUES(?, ?, ?)')
      .run(clean, DEFAULT_TAG_COLOR, Date.now())
    row = { id: Number(info.lastInsertRowid), facet_id: null }
  }
  if (facetId && !row.facet_id) {
    db.prepare('UPDATE tags SET facet_id = ? WHERE id = ?').run(facetId, row.id)
  }
  db.prepare('INSERT OR IGNORE INTO item_tags(item_id, tag_id) VALUES(?, ?)').run(itemId, row.id)
}

/**
 * 把侧车里的判断写回库。overwrite=true 用于外部修改导入：
 * 星级/旗标/备注整体覆盖，标签只增不减（避免误删主人自己后来打的标签）。
 */
export function applySidecarToItem(
  itemId: number,
  data: SidecarData,
  overwrite: boolean
): void {
  const db = getDb()
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE items
       SET rating = ?, flag = ?, note = ?, reference = ?, xmp_mtime = ?
       WHERE id = ?`
    ).run(
      data.rating,
      data.flag,
      overwrite ? data.note : data.note || (itemRow(itemId)?.note ?? ''),
      data.reference ? 1 : 0,
      data.mtime,
      itemId
    )
    for (const keyword of data.keywords) attachTag(itemId, keyword, null)
    for (const path of data.hierarchical) {
      const parts = path.split('|').map((part) => part.trim()).filter(Boolean)
      if (parts.length >= 2) {
        const facetName = parts[0]
        const value = parts[parts.length - 1]
        const facet = db.prepare('SELECT id FROM facets WHERE name = ?').get(facetName) as
          | { id: string }
          | undefined
        if (facet) attachTag(itemId, value, facet.id)
        else attachTag(itemId, path, null)
      } else if (parts.length === 1) {
        attachTag(itemId, parts[0], null)
      }
    }
  })
  tx()
}

/** 导入新照片时读侧车；只在开关打开时调用 */
export async function importSidecarForItem(itemId: number, filePath: string): Promise<boolean> {
  const data = await readSidecar(filePath)
  if (!data) return false
  applySidecarToItem(itemId, data, false)
  return true
}

const pending = new Set<number>()
let timer: NodeJS.Timeout | null = null
let flushing = false

async function flushQueue(): Promise<void> {
  if (flushing) return
  flushing = true
  try {
    while (pending.size) {
      const ids = [...pending]
      pending.clear()
      for (const id of ids) await writeSidecarForItem(id)
    }
  } finally {
    flushing = false
    if (pending.size && !timer) timer = setTimeout(() => void flushQueue(), 2000)
  }
}

/** 单张/批量改动后防抖 2 秒合并写，避免拖滑块写 100 次 */
export function scheduleXmpWrite(itemIds: number[]): void {
  if (!getXmpSettings().enabled) return
  for (const id of itemIds) if (Number.isFinite(id) && id > 0) pending.add(id)
  if (!pending.size) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void flushQueue()
  }, 2000)
}

/** 删除标签前调用：把用到这个标签的照片排进写队列 */
export function scheduleXmpForTag(tagId: number): void {
  const ids = (
    getDb().prepare('SELECT item_id FROM item_tags WHERE tag_id = ?').all(tagId) as Array<{
      item_id: number
    }>
  ).map((row) => row.item_id)
  scheduleXmpWrite(ids)
}

/** 维度改名/删除前调用：把该维度下所有取值关联的照片排进写队列 */
export function scheduleXmpForFacet(facetId: string): void {
  const ids = (
    getDb()
      .prepare(
        `SELECT DISTINCT it.item_id
         FROM item_tags it JOIN tags t ON t.id = it.tag_id
         WHERE t.facet_id = ?`
      )
      .all(facetId) as Array<{ item_id: number }>
  ).map((row) => row.item_id)
  scheduleXmpWrite(ids)
}

/** 手动全量写，用于迁移或备份到别的软件 */
export async function exportAllXmp(
  onProgress?: (progress: XmpProgress) => void
): Promise<XmpExportResult> {
  const rows = getDb()
    .prepare(
      `SELECT id, name FROM items
       WHERE trashed = 0 AND missing = 0 AND error IS NULL
         AND (pair_key IS NULL OR pair_cover = 1)
       ORDER BY id`
    )
    .all() as Array<{ id: number; name: string }>
  let written = 0
  let skipped = 0
  let failed = 0
  let done = 0
  for (const row of rows) {
    if (done % 10 === 0) {
      onProgress?.({ phase: 'write', done, total: rows.length, current: row.name })
    }
    const result = await writeSidecarForItem(row.id)
    if (result === 'written') written++
    else if (result === 'skipped') skipped++
    else failed++
    done++
  }
  onProgress?.({ phase: 'write', done, total: rows.length, current: '' })
  return { written, skipped, failed }
}

/** 对比侧车当前 mtime 与上次记录，找出外部软件改过的照片 */
export async function checkXmpConflicts(
  onProgress?: (progress: XmpProgress) => void
): Promise<XmpCheckResult> {
  const settings = getXmpSettings()
  if (settings.ignoreExternal) return { scanned: 0, conflicts: [], ignored: true }

  const rows = getDb()
    .prepare(
      `SELECT id, path, name, xmp_mtime FROM items
       WHERE xmp_mtime > 0 AND trashed = 0 AND missing = 0 AND error IS NULL
       ORDER BY id`
    )
    .all() as Array<{ id: number; path: string; name: string; xmp_mtime: number }>

  const conflicts: XmpConflictItem[] = []
  let done = 0
  for (const row of rows) {
    const sidecar = findSidecar(row.path)
    if (sidecar) {
      try {
        const mtime = Math.round(statSync(sidecar).mtimeMs)
        if (Math.abs(mtime - row.xmp_mtime) > 1) {
          conflicts.push({ itemId: row.id, name: row.name, sidecar, mtime })
        }
      } catch {
        /* 文件刚被删/改，跳过 */
      }
    }
    done++
    if (done % 200 === 0) {
      onProgress?.({ phase: 'scan', done, total: rows.length, current: row.name })
    }
  }
  onProgress?.({ phase: 'scan', done, total: rows.length, current: '' })
  return { scanned: rows.length, conflicts, ignored: false }
}

export async function importXmpConflicts(itemIds: number[]): Promise<XmpImportResult> {
  let imported = 0
  let failed = 0
  for (const id of itemIds) {
    const row = itemRow(id)
    if (!row) {
      failed++
      continue
    }
    try {
      const data = await readSidecar(row.path)
      if (!data) {
        failed++
        continue
      }
      applySidecarToItem(row.id, data, true)
      imported++
    } catch (error) {
      failed++
      void log.warn('xmp', '导入外部修改失败', { id, error: (error as Error).message })
    }
  }
  return { imported, failed }
}
