import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { Attachment, Ref } from '../shared/types'
import { db, dirs } from './db'
import { upload } from './kie'

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.aac': 'audio/aac', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.webm': 'audio/webm',
}
export const mimeOf = (file: string) => MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'
const extOf = (mime: string | null) => Object.entries(MIME).find(([, m]) => m === mime?.split(';')[0])?.[0] ?? ''

export const pathOf = (ref: Ref) => {
  if (ref.kind !== 'media' && ref.kind !== 'uploads') throw new Error('Not a locco file.')
  return join(dirs[ref.kind], basename(ref.file))
}

// Attachments are stored by content hash, so the same file dropped twice is kept once.
export async function saveUpload(name: string, mime: string, bytes: Uint8Array): Promise<Attachment> {
  const file = createHash('sha256').update(bytes).digest('hex').slice(0, 32) + (extname(name).toLowerCase() || extOf(mime))
  const path = join(dirs.uploads, file)
  if (!existsSync(path)) await writeFile(path, bytes)
  return { kind: 'uploads', file, name, mime }
}

// kie needs a hosted URL for reference images. Uploads expire after 24 h, so a cached URL is reused for 20 h.
export async function kieUrlFor(ref: Ref): Promise<string> {
  const id = `${ref.kind}/${ref.file}`
  const row = db.prepare('SELECT url, uploaded_at FROM uploads WHERE file = ?').get(id) as { url: string; uploaded_at: number } | undefined
  if (row && Date.now() - row.uploaded_at < 20 * 3600_000) return row.url
  const url = await upload(await readFile(pathOf(ref)), ref.file, mimeOf(ref.file))
  db.prepare('INSERT OR REPLACE INTO uploads (file, url, uploaded_at) VALUES (?, ?, ?)').run(id, url, Date.now())
  return url
}

export async function download(url: string, base: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)
  const file = base + (extname(new URL(url).pathname).toLowerCase() || extOf(res.headers.get('content-type')) || '.png')
  await writeFile(join(dirs.media, file), Buffer.from(await res.arrayBuffer()))
  return file
}
