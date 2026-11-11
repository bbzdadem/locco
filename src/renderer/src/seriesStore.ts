// Shared state for Series and Characters: one copy of every series and character, written only from here,
// plus the helpers that make images, voices and videos. Runs keep going while you look at other screens.
import { buildInput, fill, slotsOf } from '../../shared/inputs'
import { clipFor as shortestClip, timing as sceneTiming } from '../../shared/timing'
import { ELEVEN_VOICES, MEDIA_MODELS } from '../../shared/models'
import type { Attachment, Character, Edit, Episode, MediaModel, RenderRequest, Scene, Series, Task } from '../../shared/types'
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
// Models that animate a drawn frame: each takes it as the first frame, makes vertical clips, and has a clip length that
// fits short shots. Reference-only and text-only models are left out (they can't start from the scene's image).
export const VIDEO_MODELS = [
  'kling-3', 'kling-2-6', 'kling-4-flash-keyframes', 'seedance-2-5', 'seedance-2', 'seedance-2-fast', 'seedance-2-mini',
  'wan-3', 'minimax-h3', 'hailuo-2-3', 'grok-imagine',
]
export const model = (id: string) => MEDIA_MODELS.find((m) => m.id === id)!
const spec = (m: MediaModel) => (m.image ?? m.text)!
const has = (m: MediaModel, name: string) => [m.text, m.image].some((s) => s?.fields.some((f) => f.name === name))
const enumOf = (m: MediaModel, name: string) => spec(m).fields.find((f) => f.name === name)?.enum ?? []
// The video lengths a model can make, shortest first.
export const lengths = (m: MediaModel) => enumOf(m, 'duration').map(Number).filter((n) => n > 0).sort((a, b) => a - b)
// Shortest clip that covers the scene (the cut trims it to the exact length, or holds the last frame if even the longest is short).
export const clipFor = (m: MediaModel, seconds: number) => shortestClip(lengths(m), seconds)
// Videos are silent unless the series turns video sound on: the voices come from the script.
export function videoValues(m: MediaModel, seconds: number, sound: boolean) {
  const v: Record<string, unknown> = { aspect_ratio: '9:16', duration: String(clipFor(m, seconds)), resolution: enumOf(m, 'resolution')[0] }
  if (has(m, 'sound')) v.sound = sound
  if (has(m, 'generate_audio')) v.generate_audio = sound
  if (has(m, 'audio')) v.audio = sound
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
// Lip sync: the shot's lines spoken by someone on screen (not the narrator), and the synced clip while it still matches
// the shot's video and voices (animating again or re-recording a line falls back to the plain clip).
export const speaking = (sc: Scene) => sc.lines.map((l, li) => ({ l, li })).filter(({ l }) => l.voiceTask && sc.cast.some((n) => n.trim().toLowerCase() === l.speaker.trim().toLowerCase()))
export const syncKeyOf = (sc: Scene) => [sc.videoTask, ...sc.lines.map((l) => l.voiceTask ?? '')].join('|')
export const syncState = (t: Tasks, sc: Scene) => (sc.syncTask && sc.syncKey === syncKeyOf(sc) ? stateOf(t, sc.syncTask) : 'none')
export const synced = (t: Tasks, sc: Scene) => (syncState(t, sc) === 'done' ? fileOf(t, sc.syncTask) : undefined)
export const clipOf = (t: Tasks, sc: Scene) => synced(t, sc) ?? fileOf(t, sc.videoTask)
export const allTasks = async () => Object.fromEntries((await api.tasks()).map((t) => [t.id, t])) as Tasks

export async function makeOne(modelId: string, values: Record<string, unknown>, files: Attachment[], prompt: string, count = 1) {
  const m = model(modelId)
  const slots = slotsOf(m)
  const { variant, input } = buildInput(m, values, slots.length ? fill({}, slots, files) : {})
  return api.generate({ modelId, variant, prompt, input, count })
}

// Starts one job per item, saves the ids and waits for all of them, showing how long kie is taking.
// A job kie times out on, or turns away as busy (unbilled), is started once more; any other failure stops the run with kie's reason.
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
    const again = mine.flatMap((t, i) => (t?.state === 'fail' && /time ?out|timed out|busy|try again/i.test(t.error ?? '') && !retried.has(i) ? [i] : []))
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

// Whether a name appears in a scene's text, with or without @ (a longer word containing it doesn't count).
const named = (n: string, text: string) =>
  !!n && new RegExp(`(^|[^\\p{L}\\p{N}])@?${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u').test(text)
// Who is in a scene: the writer's pick, anyone speaking, and anyone named in the scene text (with or without @).
// A name and its short form: "Jeny - gift giver" is also "Jeny".
const aliases = (c: Character) => [...new Set([c.name, c.name.split(/\s+[-–—(,]/)[0]].map((n) => n.trim().toLowerCase()).filter(Boolean))]
export const castOf = (s: Series, cast: Character[], scene: Scene) => {
  const names = new Set([...scene.cast, ...scene.lines.map((l) => l.speaker)].map((n) => n.trim().toLowerCase()))
  const text = `${scene.action} ${scene.place}`.toLowerCase()
  return cast.filter((c) => s.cast.includes(c.id) && aliases(c).some((a) => names.has(a) || named(a, text)))
}
// The series' places and things that a scene names (in its place, action or camera).
export const elementsOf = (s: Series, all: Character[], scene: Scene) => {
  const text = `${scene.place} ${scene.action} ${scene.camera}`.toLowerCase()
  return all.filter((e) => (s.elements ?? []).includes(e.id) && named(e.name.trim().toLowerCase(), text))
}
// A character's references: the reference sheet (if made) and the chosen portrait.
export const refsOf = (t: Tasks, c: Character) => [fileOf(t, c.sheetTask), fileOf(t, c.portraitTask)].filter((f): f is string => !!f)
const isProduct = (c: Character) => c.category === 'product'
// Every photo of a character or element, the main one first.
export const photosOf = (c: Character) => [c.photo, ...(c.photos ?? [])].filter((p): p is Attachment => !!p)
// The images sent for one character or element: its references, and a product's own photos (the truth for its label and shape).
// ponytail: a shot gets only the first 2 photos, so a busy shot stays within Nano Banana Pro's 8 images; the image and angles carry the rest.
export const refImages = (t: Tasks, c: Character): Attachment[] => [...refsOf(t, c).map(img), ...(isProduct(c) ? photosOf(c).slice(0, 2) : [])]
// Ready to be drawn: a portrait is picked, or (a product) there is a photo of it.
export const ready = (t: Tasks, c: Character) => !!fileOf(t, c.portraitTask) || (isProduct(c) && !!c.photo)

export const portraitPrompt = (c: Character, style = '') =>
  isProduct(c)
    ? `Product photo of exactly ${photosOf(c).length > 1 ? 'the product in the reference photos (the same product from different sides)' : c.photo ? 'the product in the reference photo' : 'this product'} (${c.name}): ${c.look}. Same shape, proportions, colours, materials, logo and label text, letter for letter. The whole product centred on a plain light grey background, soft even light, no added text, no props, no hands.`
    : c.kind === 'element'
    ? c.category === 'place'
      ? `Reference image of the place ${c.name}: ${c.look}. ${style} Wide establishing view, vertical 9:16, no people, no text.`
      : `Reference image of ${c.name}: ${c.look}. ${style} Shown whole and centred on a plain light grey background, even studio light, no text.`
    :
  `Character portrait for a short film: ${c.name}, ${c.look}. ${style} Head and shoulders, facing the camera, neutral expression, plain light grey background, sharp focus, no text.`
export const sheetPrompt = (c: Character) =>
  isProduct(c)
    ? `Product reference sheet of exactly this product (${c.name}): front, back, side and three-quarter views and a close-up of the label, side by side on a plain light grey background. The same shape, proportions, colours, materials, logo and label text in every view, letter for letter.${photosOf(c).length ? ' The other images are photos of the real product: take every side you can see in them from the photos, not from imagination.' : ''} No added text, no hands.`
    : c.kind === 'element'
    ? c.category === 'place'
      ? `Three views of exactly this place (${c.name}) side by side: wide establishing, medium, close detail. Same layout, materials, colours and light as the reference image. No people, no text.`
      : `Reference sheet of exactly this ${c.category === 'creature' ? 'creature' : 'object'} (${c.name}): front, side, back and three-quarter views side by side on a plain light grey background. Same shape, materials and colours as the reference image. No text.`
    :
  `Character reference sheet of exactly this person (${c.name}): the same face, hair, skin and clothes as the reference image. Four views side by side on a plain light grey background: front, three-quarter, side profile, full body standing. Even studio light, no text, no labels.`
// The images sent with a scene: each character's references, then the series' style images.
export const sceneRefs = (s: Series, people: Character[], t: Tasks) => [...people.flatMap((c) => refImages(t, c)), ...(s.styleRefs ?? []).slice(0, 3)]
// people here can include elements: characters first, then places and things (each with its own references).

// Joins prompt pieces as sentences: empty parts dropped, exactly one full stop after each.
const sentences = (...parts: (string | false | undefined)[]) =>
  parts.map((p) => (p || '').trim().replace(/[.\s]+$/, '')).filter(Boolean).map((p) => `${p}.`).join(' ')

// The first beat of a plan ("0-1 s the ring flashes; 1-3 s ..."): what the opening frame shows.
const firstBeat = (beats = '') => beats.split(/;|\n/)[0]?.replace(/^\s*\d+(\.\d+)?\s*[–-]\s*\d+(\.\d+)?\s*s\s*[:,]?\s*/i, '').trim()

// The opening still of a shot: look, place, light and atmosphere, the first moment of the action, framing and
// performance. (Camera moves and later beats are for the video.)
export function scenePrompt(s: Series, scene: Scene, people: Character[], t: Tasks) {
  let n = 0
  const label = (c: Character) => {
    const k = refImages(t, c).length
    const from = n + 1
    n += k
    return `${c.name} = image${k > 1 ? `s ${from}–${n}` : ` ${n}`}`
  }
  // Numbered in the order sceneRefs sends them; something with no image yet has nothing to point at.
  const shown = people.filter((c) => refImages(t, c).length)
  const labels = new Map(shown.map((c) => [c.id, label(c)]))
  const of = (keep: (c: Character) => boolean) => shown.filter(keep).map((c) => labels.get(c.id)).join('; ')
  const refs = of((c) => !c.kind)
  const things = of((c) => !!c.kind && !isProduct(c))
  const products = of(isProduct)
  const ad = s.kind === 'ad'
  const styles = (s.styleRefs ?? []).slice(0, 3).length
  const p = scene.plan
  const said = scene.lines.map((l) => `${l.speaker} is speaking`).join(', ')
  return sentences(
    s.style,
    scene.place,
    p?.environment,
    scene.action,
    p?.beats && `Opening moment: ${firstBeat(p.beats)}`,
    p ? p.shot && `Framing: ${p.shot}` : scene.camera && `Camera: ${scene.camera}`,
    p?.performance,
    said,
    ad ? 'A vertical 9:16 frame from real phone footage for TikTok: natural, unpolished, a real place, no text, no captions, no subtitles'
      : 'A vertical 9:16 still from a short film, cinematic, no text, no captions, no subtitles',
    refs && `Keep each character exactly as in their reference images (${refs}): same face, hair and clothes`,
    things && `Keep each place and thing exactly as in its reference images (${things}): same shape, materials and colours`,
    products && `The product must match its reference images exactly (${products}): same shape, proportions, colours, logo and label text letter for letter, at a believable real-world size; hands hold it naturally without covering the label`,
    styles > 1 && `Images ${n + 1}–${n + styles} are style references: match their art style, rendering, palette and lighting, not their content`,
    styles === 1 && `Image ${n + 1} is a style reference: match its art style, rendering, palette and lighting, not its content`,
  )
}
export const editPrompt = (change: string) =>
  `Edit the first image: ${change}. Keep everything else the same: characters, faces, clothes, framing, light and style. Vertical 9:16, no text.`
// The video of a shot, starting from its still: what happens over time, the camera move, performance and the living
// environment (rain, haze, light changes). Kept under 1800 characters for the video models' prompt limits.
export function motionPrompt(s: Series, scene: Scene) {
  const p = scene.plan
  const talking = scene.lines.length ? `${[...new Set(scene.lines.map((l) => l.speaker))].join(' and ')} talking, natural mouth movement` : ''
  return sentences(
    scene.action,
    p?.beats && `Over the shot: ${p.beats}`,
    p ? p.move && `Camera: ${p.move}` : scene.camera && `Camera: ${scene.camera}`,
    p?.performance,
    p?.environment && `Environment in motion: ${p.environment}`,
    talking,
    s.style,
    s.kind === 'ad' && 'Real handheld phone footage. The product keeps its exact shape, colours and label throughout; hands move simply and naturally',
    'No text, no subtitles, no captions',
  ).slice(0, 1800)
}

export { timing } from '../../shared/timing'

// The edit an episode starts with (the same as the plain cut): every scene once, as long as its dialogue,
// holding the last frame when the clip is shorter than that.
export async function defaultEdit(s: Series, ep: Episode, t: Tasks): Promise<Edit> {
  const clips = await Promise.all(ep.scenes.map(async (sc) => {
    const file = clipOf(t, sc)
    const tm = sceneTiming(sc)
    const out = Math.min((file && (await api.mediaSeconds(file))) || tm.seconds, tm.seconds)
    return {
      id: crypto.randomUUID(), sceneId: sc.id, in: 0, out: +out.toFixed(2), speed: 1, pan: 0, zoom: 1,
      hold: +Math.max(0, tm.seconds - out).toFixed(2), sound: !!s.videoSound && !synced(t, sc), // a synced clip's own sound is the voices again
      voices: sc.lines.flatMap((l, i) => (fileOf(t, l.voiceTask) ? [{ line: i, at: +tm.voices[i].toFixed(2) }] : [])), // only lines that have audio
    }
  }))
  return { clips, music: ep.music !== false, volume: 0.16 }
}

// An edit with its files filled in, ready for ffmpeg. Clips whose scene or video is gone are left out.
export function toRender(ep: Episode, edit: Edit, t: Tasks, name: string, preview = false): RenderRequest {
  const clips = edit.clips.flatMap((c) => {
    const sc = ep.scenes.find((x) => x.id === c.sceneId)
    const video = sc && clipOf(t, sc)
    if (!sc || !video) return []
    const { id: _id, sceneId: _scene, voices, ...rest } = c
    return [{ ...rest, video, voices: voices.flatMap((v) => (fileOf(t, sc.lines[v.line]?.voiceTask) ? [{ file: fileOf(t, sc.lines[v.line].voiceTask)!, at: v.at }] : [])) }]
  })
  const music = edit.music ? fileOf(t, ep.musicTask) : undefined
  return { name, clips, preview, ...(music && { music: { file: music, volume: edit.volume } }) }
}
export const voiceFor = (cast: Character[], speaker: string) => {
  const v = cast.find((c) => c.name.trim().toLowerCase() === speaker.trim().toLowerCase())?.voice
  return ELEVEN_VOICES.some((x) => x.id === v) ? v : undefined // an old kie voice id falls back to the default voice
}
export const voiceName = (id?: string) => ELEVEN_VOICES.find((v) => v.id === id)?.name.split(' - ')[0]

// Looks to start a series from. Picking one sets the series' "look"; style images can go on top.
export const STYLE_PRESETS: { id: string; name: string; text: string }[] = [
  { id: 'cinematic', name: 'Cinematic', text: 'Photoreal cinematic film still: natural light, shallow depth of field, 35mm lens, subtle film grain.' },
  { id: '3d', name: '3D animated', text: 'Polished 3D animated feature look: soft global illumination, rounded appealing characters, rich colour, gentle subsurface skin.' },
  { id: 'anime', name: 'Anime', text: 'Hand-drawn anime look: clean line art, cel shading, painted backgrounds, expressive eyes, vivid sky gradients.' },
  { id: 'watercolour', name: 'Watercolour storybook', text: 'Soft watercolour storybook illustration: paper texture, gentle pastel palette, hand-painted edges, cosy light.' },
  { id: 'clay', name: 'Claymation', text: 'Stop-motion clay animation: sculpted plasticine characters with fingerprints in the clay, miniature handmade sets, warm practical light.' },
  { id: 'comic', name: 'Comic book', text: 'Bold comic-book art: thick ink outlines, halftone shading, flat saturated colours, dramatic angles.' },
  { id: 'noir', name: 'Film noir', text: 'Black-and-white film noir: hard shadows, venetian-blind light, high contrast, smoky atmosphere.' },
  { id: 'retro', name: 'Retro 80s', text: '1980s VHS look: neon colours, soft bloom, light scanlines, synthwave palette, slight tape wobble.' },
  { id: 'documentary', name: 'Documentary', text: 'Handheld documentary realism: available light, natural colours, slight grain, candid framing.' },
  { id: 'papercut', name: 'Paper cut-out', text: 'Layered paper cut-out animation: textured craft paper, soft drop shadows, diorama depth, handmade feel.' },
  { id: 'oil', name: 'Oil painting', text: 'Rich oil painting: visible brush strokes, warm chiaroscuro light, classical composition.' },
  { id: 'pixel', name: 'Pixel art', text: 'Detailed 16-bit pixel art: limited palette, crisp pixels, game-like staging.' },
]
