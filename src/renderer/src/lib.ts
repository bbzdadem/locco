import type { Api } from '../../preload'
import type { Attachment, Ref } from '../../shared/types'

declare global {
  interface Window { locco: Api }
}
export const api = window.locco

// Electron prefixes errors from the main process; people only need the message.
export const errMsg = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
export const mediaUrl = (ref: Ref) => `locco://${ref.kind}/${encodeURIComponent(ref.file)}`
export const ACCEPT_CHAT = 'image/png,image/jpeg,image/webp,image/gif,application/pdf'
export const ACCEPT_IMAGES = 'image/png,image/jpeg,image/webp'

export async function toAttachments(files: FileList | File[], accept: string): Promise<Attachment[]> {
  const ok = [...files].filter((f) => accept.split(',').includes(f.type))
  return Promise.all(ok.map(async (f) => api.saveFile(f.name || 'pasted.png', f.type, new Uint8Array(await f.arrayBuffer()))))
}

export function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}
export function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {}
}

export const fmtCredits = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })
export const pretty = (name: string) => name.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
