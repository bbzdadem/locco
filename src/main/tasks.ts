import { shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { isEleven, MEDIA_MODELS } from '../shared/models'
import type { GenerateRequest, MediaModel, ModelSpec, Ref, Task } from '../shared/types'
import { db, dirs } from './db'
import { runEleven } from './eleven'
import { current, isMain } from '../shared/inputs'
import { createTask, taskInfo } from './kie'
import { download, kieUrlFor, pathOf } from './media'

let notify = () => {}

const toTask = (r: any): Task => ({
  id: r.id, modelId: r.model_id, variant: r.variant, label: r.label, prompt: r.prompt ?? '', input: JSON.parse(r.input || '{}'),
  state: r.state, files: JSON.parse(r.files || '[]'), meta: JSON.parse(r.meta || 'null') ?? undefined, credits: r.credits ?? undefined, error: r.error ?? undefined,
  starred: !!r.starred, projectId: r.project_id ?? undefined, createdAt: r.created_at, completedAt: r.completed_at ?? undefined,
})
export const listTasks = () => db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all().map(toTask)
export const getTask = (id: string) => {
  const r = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)
  return r ? toTask(r) : undefined
}

export async function generate(req: GenerateRequest): Promise<string[]> {
  const model = MEDIA_MODELS.find((m) => m.id === req.modelId)
  const spec = model?.[req.variant]
  if (!model || !spec) throw new Error('That model is not available.')
  if (isEleven(model.id)) return startEleven(model, spec, req)
  // Build the kie input from the model's own field list. Local files become hosted URLs here.
  const input: Record<string, unknown> = { ...spec.fixed }
  for (const f of spec.fields) {
    // Settings you didn't choose get the same default the prompt bar shows, whoever asked (Create, chat, Read aloud).
    let v = isMain(f) ? req.prompt.trim() : (req.input[f.name] ?? (f.media ? undefined : current(f, undefined)))
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) {
      if (f.required) throw new Error(isMain(f) ? 'Write a prompt first.' : `${model.label} needs ${f.name.replace(/_/g, ' ')}.`)
      continue
    }
    if (f.media) {
      const refs = (Array.isArray(v) ? v : [v]) as Ref[]
      const urls = await Promise.all(refs.slice(0, f.maxItems ?? 1).map(kieUrlFor))
      v = f.type === 'array' ? urls : urls[0]
    } else if (f.type === 'integer' || f.type === 'number') v = Number(v)
    else if (f.type === 'boolean') v = v === true || v === 'true'
    input[f.name] = v
  }
  // Veo 3.1 hides its mode and kie's guess fails on a single image: 1-2 images are the first (and last) frame, 3 are references.
  if (model.id === 'veo-3-1' && Array.isArray(input.image_urls))
    input.generation_type = input.image_urls.length > 2 ? 'REFERENCE_2_VIDEO' : 'FIRST_AND_LAST_FRAMES_2_VIDEO'
  // Tools also take ids that aren't in kie's field list (Suno's task_id), so pass those through.
  if (req.variant === 'tool') for (const [k, v] of Object.entries(req.input)) if (!(k in input) && !spec.fields.some((f) => f.name === k)) input[k] = v
  const count = Math.min(Math.max(Math.round(req.count) || 1, 1), 4)
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    const id = await createTask(spec.slug, input)
    ids.push(id)
    // Saved the moment kie returns the ID: the job is already billed, so it must never be lost.
    db.prepare(
      "INSERT INTO tasks (id, model_id, variant, label, prompt, input, state, files, project_id, created_at) VALUES (?, ?, ?, ?, ?, ?, 'waiting', '[]', ?, ?)",
    ).run(id, model.id, req.variant, model.label, req.prompt, JSON.stringify(req.input), req.projectId ?? null, Date.now())
    notify()
  }
  return ids
}

// ElevenLabs answers with the audio directly: the job is saved as waiting (in locco's queue), marked generating when it's
// sent, then finished when the reply arrives. Jobs still unfinished when locco quits are sent again at the next launch.
function elevenInput(model: MediaModel, spec: ModelSpec, raw: Record<string, unknown>) {
  const input: Record<string, unknown> = {}
  for (const f of spec.fields) {
    if (isMain(f)) continue
    const v = raw[f.name] ?? (f.media ? undefined : current(f, undefined))
    if (v === undefined || v === '') {
      if (f.required) throw new Error(f.name === 'voice' ? 'Pick a voice. Add your ElevenLabs key in Settings to load your voices.' : `${model.label} needs ${f.name}.`)
      continue
    }
    input[f.name] = v
  }
  return input
}
function runElevenTask(id: string, modelId: string, prompt: string, input: Record<string, unknown>) {
  void runEleven(modelId, prompt, input, () => (db.prepare("UPDATE tasks SET state = 'generating' WHERE id = ?").run(id), notify()))
    .then(async ({ bytes, ext }) => {
      await writeFile(join(dirs.media, id + ext), bytes)
      db.prepare("UPDATE tasks SET state = 'success', files = ?, completed_at = ? WHERE id = ?").run(JSON.stringify([id + ext]), Date.now(), id)
    })
    .catch((e) => db.prepare("UPDATE tasks SET state = 'fail', error = ?, completed_at = ? WHERE id = ?").run((e as Error).message, Date.now(), id))
    .finally(() => notify())
}
function startEleven(model: MediaModel, spec: ModelSpec, req: GenerateRequest) {
  const main = spec.fields.find(isMain)
  if (main?.required && !req.prompt.trim()) throw new Error(main.name === 'text' ? 'Type what the voice should say.' : 'Write a prompt first.')
  const input = elevenInput(model, spec, req.input)
  const ids: string[] = []
  for (let i = 0; i < Math.min(Math.max(Math.round(req.count) || 1, 1), 4); i++) {
    const id = `el-${randomUUID()}`
    ids.push(id)
    db.prepare(
      "INSERT INTO tasks (id, model_id, variant, label, prompt, input, state, files, project_id, created_at) VALUES (?, ?, ?, ?, ?, ?, 'waiting', '[]', ?, ?)",
    ).run(id, model.id, req.variant, model.label, req.prompt, JSON.stringify(req.input), req.projectId ?? null, Date.now())
    runElevenTask(id, model.id, req.prompt.trim(), input)
  }
  notify()
  return ids
}

// Your own footage for a shot (the supplier's clip, or one you filmed): kept as a finished job, so a shot uses it exactly
// like a clip it generated.
export async function addFootage(name: string, bytes: Uint8Array) {
  const id = `footage-${randomUUID()}`
  const file = id + (extname(name).toLowerCase() || '.mp4')
  await writeFile(join(dirs.media, file), bytes)
  db.prepare("INSERT INTO tasks (id, model_id, variant, label, prompt, input, state, files, created_at, completed_at) VALUES (?, 'footage', 'image', 'Your footage', ?, '{}', 'success', ?, ?, ?)")
    .run(id, name, JSON.stringify([file]), Date.now(), Date.now())
  notify()
  return id
}

export const starTask = (id: string, on: boolean) => (db.prepare('UPDATE tasks SET starred = ? WHERE id = ?').run(on ? 1 : 0, id), notify())

export async function removeTask(id: string) {
  const row = db.prepare('SELECT files FROM tasks WHERE id = ?').get(id) as { files: string } | undefined
  for (const file of JSON.parse(row?.files || '[]')) await shell.trashItem(pathOf({ kind: 'media', file })).catch(() => {})
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
  notify()
}

// Checks unfinished jobs every 4 s and saves results to disk. Runs from launch, so jobs survive a restart.
let sweeping = false
const failingSince = new Map<string, number>() // job id → when its checks started failing
async function sweep() {
  if (sweeping) return
  sweeping = true
  let changed = false
  try {
    // ElevenLabs jobs finish on their own (see startEleven); only kie jobs are polled.
    const pending = db.prepare("SELECT id, state, created_at FROM tasks WHERE state NOT IN ('success', 'fail') AND id NOT LIKE 'el-%'").all() as any[]
    for (const t of pending) {
      try {
        const info = await taskInfo(t.id)
        failingSince.delete(t.id)
        if (info.state === 'success') {
          const result = JSON.parse(info.resultJson || '{}')
          const files: string[] = []
          const meta: NonNullable<Task['meta']> = {}
          if (Array.isArray(result.data)) {
            // Suno: tracks with their own ids (needed to extend or split them) and cover art.
            meta.tracks = []
            for (const [i, tr] of result.data.entries()) {
              const file = await download(tr.audio_url, `${t.id}-${i}`)
              const cover = tr.image_url ? await download(tr.image_url, `${t.id}-${i}-cover`).catch(() => undefined) : undefined
              files.push(file)
              meta.tracks.push({ file, id: tr.id, title: tr.title, cover })
            }
          } else {
            // Veo at 1080p/4K puts its video under data.result_urls instead of resultUrls.
            const urls: string[] = result.resultUrls ?? result.data?.result_urls ?? result.data?.resultUrls ?? []
            for (const [i, url] of urls.entries()) files.push(await download(url, `${t.id}-${i}`))
          }
          if (result.resultObject?.text) meta.text = result.resultObject.text
          db.prepare("UPDATE tasks SET state = 'success', files = ?, meta = ?, credits = ?, completed_at = ? WHERE id = ?").run(
            JSON.stringify(files), JSON.stringify(meta), info.creditsConsumed ?? null, Date.now(), t.id)
        } else if (info.state === 'fail') {
          db.prepare("UPDATE tasks SET state = 'fail', error = ?, credits = ?, completed_at = ? WHERE id = ?").run(
            info.failMsg || `Generation failed (code ${info.failCode ?? '?'})`, info.creditsConsumed ?? 0, Date.now(), t.id)
        } else if (info.state !== t.state) {
          db.prepare('UPDATE tasks SET state = ? WHERE id = ?').run(info.state, t.id)
        } else continue
        changed = true
      } catch (e) {
        // Network blips (waking from sleep, say) retry on the next sweep. A job whose checks keep failing for 2 hours is given up.
        const since = failingSince.get(t.id) ?? Date.now()
        failingSince.set(t.id, since)
        if (Date.now() - since > 2 * 3600_000) {
          failingSince.delete(t.id)
          db.prepare("UPDATE tasks SET state = 'fail', error = ? WHERE id = ?").run(`Gave up: ${(e as Error).message}`, t.id)
          changed = true
        }
      }
    }
  } finally {
    sweeping = false
  }
  if (changed) notify()
}

// Dictation: transcribe a recording and wait for the text (usually 2–5 s).
export async function transcribe(recording: Ref): Promise<string> {
  const [id] = await generate({ modelId: 'transcribe', variant: 'tool', prompt: '', input: { audio_url: recording }, count: 1 })
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 1500))
    const info = await taskInfo(id)
    if (info.state === 'success') return String(JSON.parse(info.resultJson || '{}').resultObject?.text ?? '').trim()
    if (info.state === 'fail') throw new Error(info.failMsg || 'Transcription failed.')
  }
  throw new Error('Transcription took too long.')
}

export function startPoller(onChange: () => void) {
  notify = onChange
  // ElevenLabs jobs still queued when locco quit are sent now. One already sent may have been billed, so it isn't sent twice.
  db.prepare("UPDATE tasks SET state = 'fail', error = ? WHERE id LIKE 'el-%' AND state = 'generating'")
    .run('Stopped when locco quit while ElevenLabs was making it. Not sent again, so you aren\'t charged twice: try again if it isn\'t in your ElevenLabs history.')
  const unfinished = db.prepare("SELECT id, model_id, variant, prompt, input FROM tasks WHERE id LIKE 'el-%' AND state NOT IN ('success', 'fail') ORDER BY created_at").all() as any[]
  for (const r of unfinished) {
    try {
      const model = MEDIA_MODELS.find((m) => m.id === r.model_id)!
      const input = elevenInput(model, model[r.variant as 'text']!, JSON.parse(r.input || '{}'))
      db.prepare("UPDATE tasks SET state = 'waiting' WHERE id = ?").run(r.id)
      runElevenTask(r.id, model.id, String(r.prompt ?? '').trim(), input)
    } catch (e) {
      db.prepare("UPDATE tasks SET state = 'fail', error = ? WHERE id = ?").run(`Stopped when locco quit: ${(e as Error).message}`, r.id)
    }
  }
  setInterval(sweep, 4000)
  void sweep()
}
