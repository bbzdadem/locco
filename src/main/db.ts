import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { UsageRow } from '../shared/types'

// Everything locco keeps lives in ~/Library/Application Support/locco: locco.db, media/ (results), uploads/ (your attachments).
export const dirs = { root: '', media: '', uploads: '' }
export let db: DatabaseSync

export function openDb(root: string) {
  Object.assign(dirs, { root, media: join(root, 'media'), uploads: join(root, 'uploads') })
  mkdirSync(dirs.media, { recursive: true })
  mkdirSync(dirs.uploads, { recursive: true })
  db = new DatabaseSync(join(root, 'locco.db'))
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT);
    CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, title TEXT, model TEXT, updated_at INTEGER);
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, chat_id TEXT REFERENCES chats(id) ON DELETE CASCADE, role TEXT, text TEXT, thinking TEXT,
      attachments TEXT, model TEXT, credits REAL, error TEXT, created_at INTEGER);
    CREATE INDEX IF NOT EXISTS messages_chat ON messages(chat_id, created_at);
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, model_id TEXT, variant TEXT, label TEXT, prompt TEXT, input TEXT, state TEXT, files TEXT,
      credits REAL, error TEXT, created_at INTEGER, completed_at INTEGER);
    CREATE TABLE IF NOT EXISTS uploads (file TEXT PRIMARY KEY, url TEXT, uploaded_at INTEGER);
    CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT, instructions TEXT, files TEXT, created_at INTEGER);
    CREATE TABLE IF NOT EXISTS spend (at INTEGER, model TEXT, credits REAL);
    CREATE TABLE IF NOT EXISTS series (id TEXT PRIMARY KEY, data TEXT, updated_at INTEGER);
    CREATE TABLE IF NOT EXISTS characters (id TEXT PRIMARY KEY, data TEXT, updated_at INTEGER);
    CREATE TABLE IF NOT EXISTS edits (id TEXT PRIMARY KEY, data TEXT, updated_at INTEGER);
  `)
  // Columns added after the first release.
  const addColumn = (table: string, col: string, type: string) => {
    const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)
    if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`)
  }
  addColumn('messages', 'calls', 'TEXT')
  addColumn('messages', 'agent', 'TEXT')
  addColumn('tasks', 'meta', 'TEXT')
  addColumn('tasks', 'starred', 'INTEGER')
  addColumn('tasks', 'project_id', 'TEXT')
  addColumn('chats', 'pinned', 'INTEGER')
  addColumn('chats', 'project_id', 'TEXT')
  addColumn('chats', 'summary', 'TEXT')
  addColumn('chats', 'summary_upto', 'INTEGER')
  addColumn('series', 'deleted_at', 'INTEGER')
}

export const getSetting = (k: string) => (db.prepare('SELECT v FROM settings WHERE k = ?').get(k) as { v: string } | undefined)?.v
export const setSetting = (k: string, v: string) => db.prepare('INSERT OR REPLACE INTO settings (k, v) VALUES (?, ?)').run(k, v)

// Credits used outside chat replies and generations (prompt improvements, chat summaries).
export const spend = (model: string, credits: number) => credits > 0 && db.prepare('INSERT INTO spend VALUES (?, ?, ?)').run(Date.now(), model, credits)

export function usage(days = 30): UsageRow[] {
  const since = Date.now() - days * 86_400_000
  const day = (col: string) => `date(${col} / 1000, 'unixepoch', 'localtime')`
  return db.prepare(`
    SELECT ${day('created_at')} AS day, 'chat' AS source, model, SUM(credits) AS credits FROM messages WHERE credits > 0 AND created_at >= ? GROUP BY 1, 3
    UNION ALL SELECT ${day('created_at')}, 'media', label, SUM(credits) FROM tasks WHERE credits > 0 AND created_at >= ? GROUP BY 1, 3
    UNION ALL SELECT ${day('at')}, 'extra', model, SUM(credits) FROM spend WHERE at >= ? GROUP BY 1, 3`).all(since, since, since) as UsageRow[]
}
