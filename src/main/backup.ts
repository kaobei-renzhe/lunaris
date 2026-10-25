import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, sep } from 'node:path'
import { getDb, getIndexPath, getLibraryPath } from './db'
import { exportRows, stats } from './repo'
import { ZipWriter, listZipEntries, readZipEntry } from './zip'

function walkFiles(dir: string, onFile: (fullPath: string) => void): void {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walkFiles(full, onFile)
    else onFile(full)
  }
}

export async function createBackup(
  targetZip: string,
  includeCache: boolean
): Promise<{ path: string; size: number }> {
  const library = getLibraryPath()
  // 索引可能被搬到图库目录之外，临时快照要跟着索引目录走
  const indexDir = getIndexPath() || library
  const tempDb = join(indexDir, 'backup-temp.db')

  // 用 SQLite 自己的备份接口拿一致性快照，避免 WAL 里还有没落盘的数据
  await getDb().backup(tempDb)
  try {
    const writer = new ZipWriter(targetZip)
    writer.addFile('library.db', readFileSync(tempDb), true)
    writer.addFile(
      'meta.json',
      Buffer.from(
        JSON.stringify(
          {
            app: 'image-nest',
            format: 1,
            createdAt: new Date().toISOString(),
            library: basename(library),
            stats: stats(),
            includeCache
          },
          null,
          2
        ),
        'utf8'
      ),
      true
    )

    if (includeCache) {
      for (const folder of ['thumbnails', 'previews']) {
        walkFiles(join(indexDir, folder), (full) => {
          const name = relative(indexDir, full).split(sep).join('/')
          writer.addFile(name, readFileSync(full), true)
        })
      }
    }

    writer.finish()
    return { path: targetZip, size: statSync(targetZip).size }
  } finally {
    try {
      rmSync(tempDb, { force: true })
    } catch {
      /* 临时文件删不掉不影响备份结果 */
    }
  }
}

export function restoreBackup(zipPath: string, targetDir: string): { files: number } {
  const entries = listZipEntries(zipPath)
  const hasDb = entries.some((entry) => entry.name === 'library.db')
  if (!hasDb) throw new Error('备份包里没有 library.db，可能不是月巢的备份')

  let files = 0
  for (const entry of entries) {
    if (entry.name === 'library.db') {
      mkdirSync(targetDir, { recursive: true })
      writeFileSync(join(targetDir, 'library.db'), readZipEntry(zipPath, entry))
      files++
      continue
    }
    if (!entry.name.startsWith('thumbnails/') && !entry.name.startsWith('previews/')) continue

    const parts = entry.name.split('/').filter((part) => part && part !== '..' && part !== '.')
    if (parts.length < 2) continue
    const output = join(targetDir, ...parts)
    mkdirSync(dirname(output), { recursive: true })
    writeFileSync(output, readZipEntry(zipPath, entry))
    files++
  }
  return { files }
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function formatTime(ms: number): string {
  if (!ms) return ''
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`
}

function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value)
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function buildCsv(): { content: string; count: number } {
  const rows = exportRows()
  const header = [
    '文件名',
    '路径',
    '格式',
    '大小(字节)',
    '宽',
    '高',
    '拍摄时间',
    '评分',
    '旗标',
    '标签',
    '文件夹',
    '备注',
    '机身',
    '镜头',
    'ISO',
    '光圈',
    '快门',
    '焦段',
    '来源链接',
    '配对文件数',
    '连拍张数',
    '堆叠张数',
    '状态'
  ]

  const lines = [header.join(',')]
  for (const row of rows) {
    lines.push(
      [
        csvCell(row.name),
        csvCell(row.path),
        csvCell(row.ext.replace('.', '').toUpperCase()),
        csvCell(row.size),
        csvCell(row.width),
        csvCell(row.height),
        csvCell(formatTime(row.takenAt)),
        csvCell(row.rating),
        csvCell(row.flag > 0 ? '留用' : row.flag < 0 ? '淘汰' : ''),
        csvCell(row.tags.join(' / ')),
        csvCell(row.folders.join(' / ')),
        csvCell(row.note),
        csvCell(row.exif?.camera),
        csvCell(row.exif?.lens),
        csvCell(row.exif?.iso),
        csvCell(row.exif?.aperture),
        csvCell(row.exif?.shutter),
        csvCell(row.exif?.focal),
        csvCell(row.url),
        csvCell(row.pairCount),
        csvCell(row.burstCount),
        csvCell(row.stackCount),
        csvCell(row.missing ? '文件丢失' : '正常')
      ].join(',')
    )
  }

  // BOM 让 Excel 正确识别 UTF-8 中文
  return { content: `\uFEFF${lines.join('\r\n')}`, count: rows.length }
}
