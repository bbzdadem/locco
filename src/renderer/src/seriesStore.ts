// Shared state for Series and Characters: one copy of every series and character, written only from here,
// plus the helpers that make images, voices and videos. Runs keep going while you look at other screens.
import { buildInput, fill, slotsOf } from '../../shared/inputs'
import { clipFor as clipLength } from '../../shared/timing'
import { ELEVEN_VOICES, MEDIA_MODELS } from '../../shared/models'
import type { Attachment, Character, MediaModel, Scene, Series, Task } from '../../shared/types'
import { elapsed } from './Create'
import { api } from './lib'

export type Run = { step: string; error?: string; note?: string; stop?: boolean }
let series: Series[] = []
let characters: Character[] = []
let runs: Record<string, Run> = {}
const subs = new Set<() => void>()
let snap = { series, characters, runs }
const changed = () => ((snap = { series, characters, runs }), subs.forEach((f) => f()))
export const subscribe = (f: () => void) => (subs.add(f), () => void subs.delete(f))
export const getSnapshot = () => snap
export const loadAll = async () => {
  ;[series, characters] = await Promise.all([api.series(), api.characters()])
  changed()
}

export const getSeries = (id: string) => series.find((s) => s.id === id)!
export async function updateSeries(id: string, fn: (s: Series) => void) {
  const next = structuredClone(getSeries(id))
  fn(next)
  series = series.map((s) => (s.id === id ? next : s))
  changed()
  await api.saveSeries(next)
}
export const getChar = (id: string) => characters.find((c) => c.id === id)
export async function saveChar(c: Character) {
  characters = characters.some((x) => x.id === c.id) ? characters.map((x) => (x.id === c.id ? c : x)) : [c, ...characters]
  changed()
  await api.saveCharacter(c)
}
export const updateChar = (id: string, fn: (c: Character) => void) => {
  const next = structuredClone(getChar(id)!)
  fn(next)
  return saveChar(next)
}
export async function removeChar(id: string) {
  characters = characters.filter((c) => c.id !== id)
  changed()
  await api.deleteCharacter(id)
}
export const runOf = (key: string) => runs[key]
export function setRun(key: string, r?: Run) {
  runs = { ...runs }
  if (r) runs[key] = r
  else delete runs[key]
  changed()
}

// --- Models ---

export const IMAGE_MODELS = ['gpt-image-2', 'nano-banana-pro', 'nano-banana-2', 'seedream-4-5', 'wan-2-7-image']
export const VIDEO_MODELS = ['kling-3', 'seedance-2-fast', 'grok-imagine']
export const model = (id: string) => MEDIA_MODELS.find((m) => m.id === id)!
const spec = (m: MediaModel) => (m.image ?? m.text)!
const has = (m: MediaModel, name: string) => [m.text, m.image].some((s) => s?.fields.some((f) => f.name === name))
const enumOf = (m: MediaModel, name: string) => spec(m).fields.find((f) => f.name === name)?.enum ?? []
// The video lengths a model can make, shortest first.
export const lengths = (m: MediaModel) => enumOf(m, 'duration').map(Number).filter((n) => n > 0).sort((a, b) => a - b)
// Shortest clip that covers the scene (the cut trims it to the exact length, or holds the last frame if even the longest is short).
export const clipFor = (m: MediaModel, seconds: number) => clipLength(lengths(m), seconds)
// Videos are silent unless the series turns video sound on: the voices come from the script.
export function videoValues(m: MediaModel, seconds: number, sound: boolean) {
  const v: Record<string, unknown> = { aspect_ratio: '9:16', duration: String(clipFor(m, seconds)), resolution: enumOf(m, 'resolution')[0] }
  if (has(m, 'sound')) v.sound = sound
  if (has(m, 'generate_audio')) v.generate_audio = sound
  if (has(m, 'mode') && m.id.startsWith('kling')) v.mode = 'std'
  return v
}
export const img = (file: string): Attachment => ({ kind: 'media', file, name: file, mime: 'image/png' })

// --- Tasks ---

export type Tasks = Record<string, Task>
export const stateOf = (t: Tasks, id?: string) =>
  !id ? 'none' : !t[id] ? 'busy' : t[id].state === 'success' ? 'done' : t[id].state === 'fail' ? 'fail' : 'busy'
export const fileOf = (t: Tasks, id?: string) => (id && t[id]?.state === 'success' ? t[id].files[0] : undefined)
export const needs = (t: Tasks, id?: string) => ['none', 'fail'].includes(stateOf(t, id))
export const allTasks = async () => Object.fromEntries((await api.tasks()).map((t) => [t.id, t])) as Tasks

export async function makeOne(modelId: string, values: Record<string, unknown>, files: Attachment[], prompt: string, count = 1) {
  const m = model(modelId)
  const slots = slotsOf(m)
  const { variant, input } = buildInput(m, values, slots.length ? fill({}, slots, files) : {})
  return api.generate({ modelId, variant, prompt, input, count })
}

// Starts one job per item, saves the ids and waits for all of them, showing how long kie is taking.
// A job kie times out on is started once more; any other failure stops the run with kie's reason.
export async function makeAll<T>(key: string, label: string, what: string, items: T[], make: (it: T) => Promise<string>, save: (pairs: [T, string][]) => Promise<void>) {
  if (!items.length) return
  const ids = await Promise.all(items.map(make))
  await save(items.map((it, i) => [it, ids[i]]))
  const retried = new Set<number>()
  const started = Date.now()
  for (;;) {
    if (runs[key]?.stop) throw new Error('Stopped. Press the button again to carry on where it left off.')
    const all = await api.tasks()
    const mine = ids.map((id) => all.find((t) => t.id === id))
    const again = mine.flatMap((t, i) => (t?.state === 'fail' && /time ?out|timed out/i.test(t.error ?? '') && !retried.has(i) ? [i] : []))
    if (again.length) {
      for (const i of again) (retried.add(i), (ids[i] = await make(items[i])))
      await save(again.map((i) => [items[i], ids[i]]))
      continue
    }
    if (mine.every((t) => t && (t.state === 'success' || t.state === 'fail'))) {
      const failed = mine.filter((t) => t!.state === 'fail')
      if (failed.length) throw new Error(`${failed.length} ${what} failed: ${failed[0]!.error}. Press the button again to retry them.`)
      return
    }
    const waited = Date.now() - started
    setRun(key, { step: `${label} ${elapsed(waited)}${waited > 120_000 ? ' · kie is slow right now' : ''}` })
    await new Promise((r) => setTimeout(r, 2500))
  }
}
// Runs one step of an episode, showing progress and keeping any error on screen.
export async function step(key: string, label: string, work: () => Promise<void | string>) {
  setRun(key, { step: label })
  try {
    const note = await work()
    setRun(key, note ? { step: '', note } : undefined)
  } catch (e) {
    setRun(key, { step: '', error: String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
  }
}

// --- Characters in scenes ---

export const castOf = (s: Series, cast: Character[], scene: Scene) => {
  const names = new Set([...scene.cast, ...scene.lines.map((l) => l.speaker)].map((n) => n.trim().toLowerCase()))
  return cast.filter((c) => s.cast.includes(c.id) && names.has(c.name.trim().toLowerCase()))
}
// A character's references: the reference sheet (if made) and the chosen portrait.
export const refsOf = (t: Tasks, c: Character) => [fileOf(t, c.sheetTask), fileOf(t, c.portraitTask)].filter((f): f is string => !!f)
export const ready = (t: Tasks, c: Character) => !!fileOf(t, c.portraitTask)

export const portraitPrompt = (c: Character, style = '') =>
  `Character portrait for a short film: ${c.name}, ${c.look}. ${style} Head and shoulders, facing the camera, neutral expression, plain light grey background, sharp focus, no text.`
export const sheetPrompt = (c: Character) =>
  `Character reference sheet of exactly this person (${c.name}): the same face, hair, skin and clothes as the reference image. Four views side by side on a plain light grey background: front, three-quarter, side profile, full body standing. Even studio light, no text, no labels.`
export function scenePrompt(s: Series, scene: Scene, people: Character[], t: Tasks) {
  let n = 0
  const refs = people.map((c) => `${c.name} = image${refsOf(t, c).length > 1 ? `s ${++n} and ${++n}` : ` ${++n}`}`).join('; ')
  const said = scene.lines.map((l) => `${l.speaker} is speaking`).join(', ')
  return [
    `${s.style}`,
    `${scene.place}. ${scene.action}. Camera: ${scene.camera}.${said ? ` ${said}.` : ''}`,
    'A vertical 9:16 still from a short film, cinematic, no text, no captions, no subtitles.',
    refs && `Keep each character exactly as in their reference images (${refs}): same face, hair and clothes.`,
  ].filter(Boolean).join(' ')
}
export const editPrompt = (change: string) =>
  `Edit the first image: ${change}. Keep everything else the same: characters, faces, clothes, framing, light and style. Vertical 9:16, no text.`
export const motionPrompt = (s: Series, scene: Scene) =>
  `${scene.action}. Camera: ${scene.camera}.${scene.lines.length ? ` ${[...new Set(scene.lines.map((l) => l.speaker))].join(' and ')} talking, natural mouth movement.` : ''} ${s.style} No text, no subtitles.`

export { timing } from '../../shared/timing'
export const voiceFor = (cast: Character[], speaker: string) => {
  const v = cast.find((c) => c.name.trim().toLowerCase() === speaker.trim().toLowerCase())?.voice
  return ELEVEN_VOICES.some((x) => x.id === v) ? v : undefined // an old kie voice id falls back to the default voice
}
export const voiceName = (id?: string) => ELEVEN_VOICES.find((v) => v.id === id)?.name.split(' - ')[0]
