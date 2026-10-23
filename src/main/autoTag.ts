import { getDb } from './db'
import { readConfig, updateConfig } from './settings'
import { createTag } from './repo'
import { MODEL_TAG, dot, embedText, resolveModelDir } from './clip/embedder'
import { beginTagging, endTagging, isIndexing } from './taskLock'
import type {
  AutoTagCategory,
  AutoTagProgress,
  AutoTagResult,
  AutoTagSettings,
  AutoTagStatus
} from '../shared/types'

interface CategorySpec extends AutoTagCategory {
  prompts: string[]
}

/** 零样本类目表：prompt 越贴近真实拍摄内容，分类越准 */
export const AUTO_TAG_CATEGORIES: CategorySpec[] = [
  {
    name: '风景',
    color: '#6fcf97',
    prompts: ['一张自然风景照片', '广阔的山川湖泊', '日落时分的海边']
  },
  {
    name: '城市建筑',
    color: '#7aa2f7',
    prompts: ['城市里的高楼大厦', '街道和现代建筑', '一座城市的建筑群']
  },
  {
    name: '人像',
    color: '#e8b45a',
    prompts: ['一张人物肖像照片', '一个人的半身照', '人物的脸部和表情']
  },
  {
    name: '动物',
    color: '#f2994a',
    prompts: ['一只动物的照片', '猫狗等宠物的照片', '野生动物的照片']
  },
  {
    name: '食物',
    color: '#eb5757',
    prompts: ['一份美味的食物', '餐桌上的菜肴', '甜点和饮料']
  },
  {
    name: '静物',
    color: '#bb86fc',
    prompts: ['桌子上的静物', '产品特写照片', '摆放整齐的物品']
  },
  {
    name: '街拍',
    color: '#56ccf2',
    prompts: ['街头行走的人们', '城市街拍照片', '马路上的路人']
  },
  {
    name: '夜景',
    color: '#5c7cfa',
    prompts: ['夜晚的城市灯光', '夜空和月亮', '夜晚的街道']
  },
  {
    name: '花草',
    color: '#27ae60',
    prompts: ['盛开的花朵', '绿色的树叶和植物', '花园里的花草']
  },
  {
    name: '交通工具',
    color: '#9aa7b8',
    prompts: ['马路上行驶的汽车', '火车飞机或轮船', '一辆自行车的照片']
  },
  {
    name: '室内',
    color: '#d4a373',
    prompts: ['房间的室内照片', '家具和家居环境', '室内的空间']
  },
  {
    name: '截图文档',
    color: '#a0aec0',
    prompts: ['电脑屏幕截图', '文档或网页界面', '包含大量文字的图片']
  },
  {
    name: '艺术绘画',
    color: '#e07a5f',
    prompts: ['一幅绘画作品', '插画或艺术创作', '雕塑等艺术品']
  },
  {
    name: '运动',
    color: '#4ecdc4',
    prompts: ['正在进行体育运动', '跑步或球类比赛', '户外的运动场景']
  }
]

const DEFAULT_THRESHOLD = 0.2
const MIN_THRESHOLD = 0.15
const MAX_THRESHOLD = 0.35

let running = false

export function listAutoTagCategories(): AutoTagCategory[] {
  return AUTO_TAG_CATEGORIES.map(({ name, color }) => ({ name, color }))
}

function clampThreshold(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_THRESHOLD
  return Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, Number(value.toFixed(2))))
}

export function getAutoTagSettings(): AutoTagSettings {
  const stored = readConfig().autoTag ?? {}
  const all = AUTO_TAG_CATEGORIES.map((category) => category.name)
  const picked = Array.isArray(stored.categories)
    ? stored.categories.filter((name) => all.includes(name))
    : []
  return {
    threshold: typeof stored.threshold === 'number' ? clampThreshold(stored.threshold) : DEFAULT_THRESHOLD,
    categories: picked.length > 0 ? picked : all
  }
}

export function saveAutoTagSettings(patch: Partial<AutoTagSettings>): AutoTagSettings {
  const current = getAutoTagSettings()
  const all = AUTO_TAG_CATEGORIES.map((category) => category.name)
  const categories = (patch.categories ?? current.categories).filter((name) => all.includes(name))
  if (categories.length === 0) throw new Error('至少要保留一个类目')
  const next: AutoTagSettings = {
    threshold: clampThreshold(patch.threshold ?? current.threshold),
    categories
  }
  updateConfig({ autoTag: next })
  return next
}

export function autoTagStatus(): AutoTagStatus {
  const db = getDb()
  const tagged = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM auto_tags a
         JOIN items i ON i.id = a.item_id
         WHERE i.trashed = 0 AND i.missing = 0`
      )
      .get() as { c: number }
  ).c
  const indexed = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM embeddings e
         JOIN items i ON i.id = e.item_id
         WHERE e.model = ? AND i.trashed = 0 AND i.missing = 0`
      )
      .get(MODEL_TAG) as { c: number }
  ).c
  const total = (
    db.prepare('SELECT COUNT(*) AS c FROM items WHERE trashed = 0 AND missing = 0').get() as {
      c: number
    }
  ).c
  return { tagged, indexed, total }
}

function normalize(vector: Float32Array): Float32Array {
  let length = 0
  for (let i = 0; i < vector.length; i++) length += vector[i] * vector[i]
  length = Math.sqrt(length) || 1
  const out = new Float32Array(vector.length)
  for (let i = 0; i < vector.length; i++) out[i] = vector[i] / length
  return out
}

function ensureTag(name: string, cache: Map<string, number>): number {
  const cached = cache.get(name)
  if (cached !== undefined) return cached
  const spec = AUTO_TAG_CATEGORIES.find((category) => category.name === name)
  const tag = createTag(name, spec?.color ?? '#7aa2f7')
  cache.set(name, tag.id)
  return tag.id
}

function pruneEmptyTags(): void {
  const db = getDb()
  const names = AUTO_TAG_CATEGORIES.map((category) => category.name)
  const statement = db.prepare(
    `DELETE FROM tags WHERE name = ?
       AND NOT EXISTS (SELECT 1 FROM item_tags WHERE tag_id = tags.id)`
  )
  for (const name of names) statement.run(name)
}

function syncTags(assignments: Map<number, { category: string; score: number }>): void {
  const db = getDb()
  const previous = db.prepare('SELECT item_id, category FROM auto_tags').all() as Array<{
    item_id: number
    category: string
  }>
  const tagCache = new Map<string, number>()
  const removeLink = db.prepare('DELETE FROM item_tags WHERE item_id = ? AND tag_id = ?')
  const addLink = db.prepare('INSERT OR IGNORE INTO item_tags(item_id, tag_id) VALUES(?, ?)')
  const upsert = db.prepare(
    `INSERT INTO auto_tags(item_id, category, score, model) VALUES(?, ?, ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET
       category = excluded.category, score = excluded.score, model = excluded.model`
  )
  const dropRow = db.prepare('DELETE FROM auto_tags WHERE item_id = ?')

  const tx = db.transaction(() => {
    for (const row of previous) {
      const next = assignments.get(row.item_id)
      // 旧分类被改写或撤销时，先摘掉旧标签
      if (!next || next.category !== row.category) {
        const spec = AUTO_TAG_CATEGORIES.find((category) => category.name === row.category)
        if (spec) {
          const existing = db.prepare('SELECT id FROM tags WHERE name = ?').get(row.category) as
            | { id: number }
            | undefined
          if (existing) removeLink.run(row.item_id, existing.id)
        }
      }
      if (!next) dropRow.run(row.item_id)
    }

    for (const [itemId, entry] of assignments) {
      addLink.run(itemId, ensureTag(entry.category, tagCache))
      upsert.run(itemId, entry.category, entry.score, MODEL_TAG)
    }
    pruneEmptyTags()
  })
  tx()
}

export async function runAutoTag(
  onProgress: (progress: AutoTagProgress) => void
): Promise<AutoTagResult> {
  if (running) throw new Error('自动分类正在执行')
  if (isIndexing()) throw new Error('正在建立语义索引，等它跑完再分类')
  if (!resolveModelDir()) throw new Error('语义模型还没下载，先在上面下载模型')

  const status = autoTagStatus()
  if (status.indexed === 0) throw new Error('还没有语义索引，先点「语义索引」建好再分类')

  const settings = getAutoTagSettings()
  const active = AUTO_TAG_CATEGORIES.filter((category) => settings.categories.includes(category.name))
  const db = getDb()

  running = true
  beginTagging()
  try {
    // 1. 把每个类目的多条提示词合成一个类向量
    const vectors = new Map<string, Float32Array>()
    const promptTotal = active.reduce((sum, category) => sum + category.prompts.length, 0)
    let prepared = 0
    for (const category of active) {
      const sum = new Float32Array(512)
      for (const prompt of category.prompts) {
        const vector = await embedText(prompt)
        for (let i = 0; i < sum.length; i++) sum[i] += vector[i] ?? 0
        prepared++
        onProgress({ phase: 'prepare', done: prepared, total: promptTotal, current: category.name })
      }
      vectors.set(category.name, normalize(sum))
    }

    // 2. 逐张比对已存好的图片向量
    const rows = db
      .prepare(
        `SELECT e.item_id, e.vec FROM embeddings e
         JOIN items i ON i.id = e.item_id
         WHERE e.model = ? AND i.trashed = 0 AND i.missing = 0`
      )
      .all(MODEL_TAG) as Array<{ item_id: number; vec: Buffer }>

    const assignments = new Map<number, { category: string; score: number }>()
    const counts: Record<string, number> = {}
    let done = 0
    for (const row of rows) {
      const vector = new Float32Array(row.vec.byteLength / 4)
      Buffer.from(vector.buffer).set(row.vec)
      let bestName = ''
      let bestScore = -1
      for (const [name, categoryVector] of vectors) {
        const score = dot(vector, categoryVector)
        if (score > bestScore) {
          bestScore = score
          bestName = name
        }
      }
      if (bestName && bestScore >= settings.threshold) {
        assignments.set(row.item_id, { category: bestName, score: bestScore })
        counts[bestName] = (counts[bestName] ?? 0) + 1
      }
      done++
      if (done % 20 === 0 || done === rows.length) {
        onProgress({ phase: 'scan', done, total: rows.length, current: '' })
      }
    }

    // 3. 同步成普通标签（自动打的标签也能直接筛选）
    syncTags(assignments)

    return { total: rows.length, assigned: assignments.size, counts }
  } finally {
    running = false
    endTagging()
  }
}

export function clearAutoTags(): { removed: number } {
  const db = getDb()
  const rows = db.prepare('SELECT item_id, category FROM auto_tags').all() as Array<{
    item_id: number
    category: string
  }>
  const removeLink = db.prepare(
    'DELETE FROM item_tags WHERE item_id = ? AND tag_id = (SELECT id FROM tags WHERE name = ?)'
  )
  const tx = db.transaction(() => {
    for (const row of rows) removeLink.run(row.item_id, row.category)
    db.prepare('DELETE FROM auto_tags').run()
    pruneEmptyTags()
  })
  tx()
  return { removed: rows.length }
}
