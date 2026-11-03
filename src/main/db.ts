import { dirname, join } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
import Database from 'better-sqlite3'
import { log } from './logger'
import { getIndexDirFor } from './settings'

let db: Database.Database | null = null
let libraryPath = ''
let indexPath = ''

const SCHEMA = /* sql */ `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  ext TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  mtime INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL,
  hash TEXT,
  dominant TEXT,
  color_family TEXT,
  palette TEXT,
  exif TEXT,
  rating INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  url TEXT,
  missing INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_items_added ON items(added_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_hash ON items(hash);
CREATE INDEX IF NOT EXISTS idx_items_family ON items(color_family);
CREATE INDEX IF NOT EXISTS idx_items_rating ON items(rating);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  color TEXT NOT NULL DEFAULT '#7aa2f7',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS item_tags (
  item_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (item_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_item_tags_tag ON item_tags(tag_id);

CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS item_folders (
  item_id INTEGER NOT NULL,
  folder_id INTEGER NOT NULL,
  PRIMARY KEY (item_id, folder_id)
);

CREATE TABLE IF NOT EXISTS smart_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  filter TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT UNIQUE NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
  name, note, url,
  content='items',
  content_rowid='id',
  tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
  INSERT INTO items_fts(rowid, name, note, url)
  VALUES (new.id, new.name, new.note, coalesce(new.url, ''));
END;

CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, name, note, url)
  VALUES ('delete', old.id, old.name, old.note, coalesce(old.url, ''));
END;

CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, name, note, url)
  VALUES ('delete', old.id, old.name, old.note, coalesce(old.url, ''));
  INSERT INTO items_fts(rowid, name, note, url)
  VALUES (new.id, new.name, new.note, coalesce(new.url, ''));
END;

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
`

function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  definition: string
): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`)
  }
}

function migrate(db: Database.Database): void {
  ensureColumn(db, 'items', 'trashed', 'trashed INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'sources', 'recursive', 'recursive INTEGER NOT NULL DEFAULT 1')
  ensureColumn(db, 'items', 'flag', 'flag INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'items', 'is_raw', 'is_raw INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'items', 'pair_key', 'pair_key TEXT')
  ensureColumn(db, 'items', 'pair_cover', 'pair_cover INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'items', 'burst_key', 'burst_key TEXT')
  ensureColumn(db, 'items', 'burst_cover', 'burst_cover INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'items', 'stack_id', 'stack_id INTEGER')
  ensureColumn(db, 'items', 'stack_cover', 'stack_cover INTEGER NOT NULL DEFAULT 0')
  // 源文件所在目录（用于按原文件夹结构展示）与导入失败原因
  ensureColumn(db, 'items', 'dir', 'dir TEXT')
  ensureColumn(db, 'items', 'error', 'error TEXT')
  // 文件本身的修改时间（mtime 列存的是拍摄时间），用于「刷新图库」识别被覆盖修改的照片
  ensureColumn(db, 'items', 'file_mtime', 'file_mtime INTEGER NOT NULL DEFAULT 0')
  // 人像维度的标签归属；NULL 表示普通标签，老数据零迁移
  ensureColumn(db, 'tags', 'facet_id', 'facet_id TEXT')

  db.exec(`
    CREATE TABLE IF NOT EXISTS stacks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS embeddings (
      item_id INTEGER PRIMARY KEY,
      model TEXT NOT NULL,
      dim INTEGER NOT NULL,
      vec BLOB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auto_tags (
      item_id INTEGER PRIMARY KEY,
      category TEXT NOT NULL,
      score REAL NOT NULL,
      model TEXT NOT NULL
    );
    -- 大模型评分结果：与 items 分表，避免每次加能力都 ALTER 主表
    CREATE TABLE IF NOT EXISTS quality_scores (
      item_id INTEGER PRIMARY KEY,
      composition INTEGER NOT NULL DEFAULT 0,
      exposure INTEGER NOT NULL DEFAULT 0,
      color INTEGER NOT NULL DEFAULT 0,
      sharpness INTEGER NOT NULL DEFAULT 0,
      overall INTEGER NOT NULL DEFAULT 0,
      comment TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_quality_overall ON quality_scores(overall DESC);
    CREATE INDEX IF NOT EXISTS idx_items_flag ON items(flag);
    CREATE INDEX IF NOT EXISTS idx_items_pair ON items(pair_key);
    CREATE INDEX IF NOT EXISTS idx_items_burst ON items(burst_key);
    CREATE INDEX IF NOT EXISTS idx_items_stack ON items(stack_id);
    CREATE INDEX IF NOT EXISTS idx_items_dir ON items(dir);
    CREATE INDEX IF NOT EXISTS idx_items_size ON items(size);

    -- 人像工作台的维度定义：加维度不用改代码
    CREATE TABLE IF NOT EXISTS facets (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      multi       INTEGER NOT NULL DEFAULT 1,
      auto_source TEXT,
      sort        INTEGER NOT NULL DEFAULT 0,
      builtin     INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_tags_facet ON tags(facet_id);
  `)

  seedFacets(db)
  backfillDirs(db)
}

/** 内置维度与取值：只在 facets 表为空时种一次，之后用户改名/删维度都不会被覆盖 */
const FACET_SEEDS: Array<{
  id: string
  name: string
  multi: boolean
  autoSource: string | null
  values: string[]
}> = [
  { id: 'shot_size', name: '景别', multi: false, autoSource: 'local', values: ['特写', '近景', '中景', '全景', '远景', '环境人像'] },
  { id: 'angle', name: '视角', multi: false, autoSource: 'local', values: ['平视', '俯拍', '仰拍', '过肩', '侧脸'] },
  { id: 'light', name: '光线', multi: true, autoSource: 'clip', values: ['顺光', '侧光', '侧逆光', '逆光', '窗口光', '硬光', '柔光'] },
  { id: 'weather', name: '天气', multi: false, autoSource: 'clip', values: ['晴', '多云', '阴', '雨', '雪', '雾'] },
  { id: 'scene', name: '场景', multi: true, autoSource: 'clip', values: ['影棚', '居家', '街头', '自然', '海边', '建筑', '咖啡馆', '废墟'] },
  { id: 'tone', name: '色调', multi: true, autoSource: 'local', values: ['冷调', '暖调', '中性', '高调', '低调', '黑白', '胶片'] },
  { id: 'mood', name: '氛围', multi: true, autoSource: 'clip', values: ['温柔', '冷峻', '复古', '清新', '忧郁', '张力', '慵懒'] },
  { id: 'emotion', name: '情绪', multi: true, autoSource: 'llm', values: ['笑', '沉思', '疏离', '俏皮', '严肃', '紧张', '害羞'] },
  { id: 'time_of_day', name: '时段', multi: false, autoSource: 'local', values: ['清晨', '上午', '正午', '傍晚', '蓝调', '夜'] }
]

const FACET_COLORS = ['#7aa2f7', '#a78bfa', '#f2c94c', '#e86a92', '#6fcf97', '#56ccf2', '#bb86fc', '#f2994a']

function seedFacets(db: Database.Database): void {
  const existing = db.prepare('SELECT COUNT(*) AS c FROM facets').get() as { c: number }
  if (existing.c > 0) return
  const insertFacet = db.prepare(
    'INSERT INTO facets(id, name, multi, auto_source, sort, builtin) VALUES(?, ?, ?, ?, ?, 1)'
  )
  const insertTag = db.prepare(
    'INSERT OR IGNORE INTO tags(name, color, created_at) VALUES(?, ?, ?)'
  )
  const attachTag = db.prepare('UPDATE tags SET facet_id = ? WHERE name = ? AND facet_id IS NULL')
  const tx = db.transaction(() => {
    FACET_SEEDS.forEach((facet, index) => {
      insertFacet.run(facet.id, facet.name, facet.multi ? 1 : 0, facet.autoSource, index)
      facet.values.forEach((value, i) => {
        insertTag.run(value, FACET_COLORS[i % FACET_COLORS.length], Date.now())
        attachTag.run(facet.id, value)
      })
    })
  })
  tx()
}

/**
 * 老图库没有 dir 列，打开时补一次就够了。
 * 目录树依赖它，缺了会全部落到「其他位置」。
 */
function backfillDirs(db: Database.Database): void {
  const done = db.prepare("SELECT value FROM meta WHERE key = 'dir-backfill-v1'").get() as
    | { value: string }
    | undefined
  if (done) return

  const rows = db.prepare('SELECT id, path FROM items WHERE dir IS NULL').all() as Array<{
    id: number
    path: string
  }>
  const update = db.prepare('UPDATE items SET dir = ? WHERE id = ?')
  const tx = db.transaction(() => {
    for (const row of rows) update.run(dirname(row.path), row.id)
    db.prepare(
      "INSERT INTO meta(key, value) VALUES('dir-backfill-v1', '1') ON CONFLICT(key) DO UPDATE SET value = '1'"
    ).run()
  })
  tx()
}

/**
 * 索引目录（library.db / thumbnails / previews）可以和图库分开存放。
 * 映射的索引目录丢了（被删/被移走）时回退到图库目录；但映射本身保留，
 * 这样用户把那个目录放回来（例如换回来一块移动硬盘）就能继续用，不必重新设置。
 */
export function resolveIndexDir(library: string): string {
  const mapped = getIndexDirFor(library)
  if (libraryKeyOf(mapped) === libraryKeyOf(library)) return library
  if (existsSync(join(mapped, 'library.db'))) return mapped
  void log.warn('db', '索引目录里找不到 library.db，临时回退到图库目录', { library, mapped })
  return library
}

function libraryKeyOf(path: string): string {
  return path.replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase()
}

export function openLibrary(dir: string): void {
  if (db) closeLibrary()
  const indexDir = resolveIndexDir(dir)
  mkdirSync(join(indexDir, 'thumbnails'), { recursive: true })
  const file = join(indexDir, 'library.db')
  for (let attempt = 0; ; attempt++) {
    let step = 'open'
    try {
      db = new Database(file)
      step = 'schema'
      db.exec(SCHEMA)
      step = 'migrate'
      migrate(db)
      // 上次异常退出可能留下较大的 WAL，打开时顺手收干净
      checkpoint()
      break
    } catch (error) {
      try {
        db?.close()
      } catch {
        /* 打不开的连接本身可能就是坏的，关不掉无所谓 */
      }
      db = null
      // 进程刚被强杀、或文件正被杀毒软件扫描时，库文件会短暂不可用，稍等再试一次
      if (attempt === 0) {
        void log.warn('db', '打开图库失败，稍后重试', {
          dir,
          indexDir,
          step,
          error: (error as Error).message
        })
        sleepSync(400)
        continue
      }
      // 打不开或迁移失败都要留痕，否则用户只看到"图库加载失败"
      void log.error('db', '打开图库失败', { dir, indexDir, step, error: (error as Error).message })
      throw error
    }
  }
  libraryPath = dir
  indexPath = indexDir
}

/** 主进程里同步等一小会儿（启动/开库阶段可以接受） */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** 把 WAL 合并回主库并截断，避免 WAL 无界增长；关库与退出前都会调用 */
export function checkpoint(): void {
  try {
    db?.pragma('wal_checkpoint(TRUNCATE)')
  } catch (error) {
    void log.warn('db', 'WAL checkpoint 失败', { error: (error as Error).message })
  }
}

export function closeLibrary(): void {
  try {
    if (db) {
      checkpoint()
      db.close()
    }
  } catch (error) {
    void log.warn('db', '关闭图库时出错', { error: (error as Error).message })
  }
  db = null
  libraryPath = ''
  indexPath = ''
}

export function getDb(): Database.Database {
  if (!db) throw new Error('还没有打开图库')
  return db
}

export function getLibraryPath(): string {
  return libraryPath
}

/** 索引当前所在目录；没打开图库时返回空串 */
export function getIndexPath(): string {
  return indexPath
}

export function getMeta(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row ? row.value : null
}

export function setMeta(key: string, value: string): void {
  getDb()
    .prepare('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value)
}
