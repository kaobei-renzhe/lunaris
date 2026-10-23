import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import Database from 'better-sqlite3'

let db: Database.Database | null = null
let libraryPath = ''

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
    CREATE INDEX IF NOT EXISTS idx_items_flag ON items(flag);
    CREATE INDEX IF NOT EXISTS idx_items_pair ON items(pair_key);
    CREATE INDEX IF NOT EXISTS idx_items_burst ON items(burst_key);
    CREATE INDEX IF NOT EXISTS idx_items_stack ON items(stack_id);
  `)
}

export function openLibrary(dir: string): void {
  if (db) {
    db.close()
    db = null
  }
  mkdirSync(join(dir, 'thumbnails'), { recursive: true })
  db = new Database(join(dir, 'library.db'))
  db.exec(SCHEMA)
  migrate(db)
  libraryPath = dir
}

export function closeLibrary(): void {
  db?.close()
  db = null
  libraryPath = ''
}

export function getDb(): Database.Database {
  if (!db) throw new Error('还没有打开图库')
  return db
}

export function getLibraryPath(): string {
  return libraryPath
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
