// Timeline math for the editor, shared by the screen and the checks.
import type { EditProject, Item, Key, KeyProp, Keys, Transition, Word } from './types'

export const MAIN = 'main'
// The saved project's shape: bump it, and add a step to upgrade(), whenever that changes.
export const EDIT_VERSION = 2
export const FRAME_RATES = [24, 25, 30, 60]
// A time on the project's frame grid.
export const toFrame = (t: number, fps: number) => Math.round(t * fps) / fps

// How long an item runs on the timeline.
export function itemLength(it: Item) {
  if (it.media === 'video') return Math.max(0.1, (it.out - it.in) / (it.speed || 1) + (it.hold ?? 0))
  if (it.media === 'audio') return Math.max(0.1, (it.out - it.in) / (it.speed || 1))
  return Math.max(0.1, it.duration)
}
// How long each transition lasts unless set.
export const TRANSITION_SECONDS: Record<Transition['type'], number> = { fade: 0.5, black: 0.2, flash: 0.2, zoom: 0.3 }
// How much a clip overlaps the one before it: a crossfade's length, at most half of either clip.
export const overlap = (before: Item | undefined, it: Item) =>
  before && it.transition?.type === 'fade' ? Math.min(it.transition.seconds, itemLength(before) / 2, itemLength(it) / 2) : 0
// The main track plays its clips in order, back to back (a crossfade overlaps the two); their start times follow from
// that. What's linked to a clip moves by as much as the clip did.
export function layout(p: EditProject): EditProject {
  let t = 0
  let before: Item | undefined
  const moved = new Map<string, number>()
  const items = p.items.map((it) => {
    if (it.track !== MAIN) return it
    const start = +Math.max(0, t - overlap(before, it)).toFixed(3)
    t = start + itemLength(it)
    before = it
    if (start !== it.start) moved.set(it.id, start - it.start)
    return { ...it, start }
  })
  const follow = (it: Item) => (it.track !== MAIN && it.link && moved.has(it.link) ? { ...it, start: +(it.start + moved.get(it.link)!).toFixed(3) } : it)
  return { ...p, items: moved.size ? items.map(follow) : items }
}
export const mainItems = (p: EditProject) => p.items.filter((it) => it.track === MAIN)
export const duration = (p: EditProject) => Math.max(0, ...p.items.map((it) => it.start + itemLength(it)))
// The video's length is the video track's: audio or text running past its end is cut off, as in any editor.
export const videoEnd = (p: EditProject) => Math.max(0, ...p.items.filter((it) => it.track === MAIN).map((it) => it.start + itemLength(it)))
export const itemAt = (p: EditProject, track: string, t: number) => p.items.find((it) => it.track === track && t >= it.start && t < it.start + itemLength(it))

// A word-by-word caption's words on either side of `local` seconds into it (the second half's from its own start).
function splitWords(words: Word[], local: number): [Word[], Word[]] {
  return [words.filter((w) => w.start < local).map((w) => ({ ...w, end: Math.min(w.end, local) })),
    words.filter((w) => w.start >= local).map((w) => ({ ...w, start: +(w.start - local).toFixed(3), end: +(w.end - local).toFixed(3) }))]
}
const withWords = (words: Word[] | undefined) => (words?.length ? { words, text: words.map((w) => w.text).join(' ') } : {})
// The word lit `local` seconds into a word-by-word caption: the last one to have started.
export const litWord = (words: Word[], local: number) => Math.max(0, words.findLastIndex((w) => w.start <= local + 1e-6))

// Cuts an item in two at timeline time t. Returns null when t is too close to either end.
export function splitAt(it: Item, t: number, newId: string): [Item, Item] | null {
  const local = t - it.start
  if (local <= 0.05 || local >= itemLength(it) - 0.05) return null
  const [ka, kb] = it.keys ? splitKeys(it.keys, local) : []
  const keyed = (keys: Keys | undefined) => (keys ? { keys } : {})
  if (it.media === 'video') {
    const playable = (it.out - it.in) / it.speed
    // Held at the end: the second part is all held frame.
    if (local >= playable) {
      const last = it.reverse ? it.in : it.out
      return [{ ...it, hold: +(local - playable).toFixed(3), ...keyed(ka) }, { ...it, id: newId, start: t, in: last, out: last, hold: +((it.hold ?? 0) - (local - playable)).toFixed(3), transition: undefined, ...keyed(kb) }]
    }
    // A reversed clip plays from out down to in, so its first part is the end of the source.
    const cut = +(it.reverse ? it.out - local * it.speed : it.in + local * it.speed).toFixed(3)
    const [first, second] = it.reverse ? [{ in: cut }, { out: cut }] : [{ out: cut }, { in: cut }]
    return [{ ...it, ...first, hold: 0, fadeOut: 0, ...keyed(ka) }, { ...it, id: newId, start: t, ...second, fadeIn: 0, transition: undefined, ...keyed(kb) }]
  }
  if (it.media === 'audio') {
    const cut = +(it.in + local * (it.speed || 1)).toFixed(3)
    return [{ ...it, out: cut, fadeOut: 0, ...keyed(ka) }, { ...it, id: newId, start: t, in: cut, fadeIn: 0, ...keyed(kb) }]
  }
  const rest = +(it.duration - local).toFixed(3)
  if (it.media === 'image') return [{ ...it, duration: +local.toFixed(3), ...keyed(ka) }, { ...it, id: newId, start: t, duration: rest, transition: undefined, ...keyed(kb) }]
  const [a, b] = it.words ? splitWords(it.words, local) : []
  return [{ ...it, duration: +local.toFixed(3), ...withWords(a), ...keyed(ka) }, { ...it, id: newId, start: t, duration: rest, ...withWords(b), ...keyed(kb) }]
}

// Cuts a video-track clip at t: what's linked to it and starts after t follows the second part, and linked sound or text
// running across t is cut too. Returns false when t is too close to either end of the clip.
export function splitClip(p: EditProject, id: string, t: number, newId: () => string): boolean {
  const clip = p.items.find((it) => it.id === id)
  const parts = clip && splitAt(clip, t, newId())
  if (!clip || !parts) return false
  p.items.splice(p.items.indexOf(clip), 1, ...parts)
  if (clip.track !== MAIN) return true
  for (const it of p.items.filter((x) => x.link === id)) {
    const cut = splitAt(it, t, newId())
    if (cut) p.items.splice(p.items.indexOf(it), 1, cut[0], { ...cut[1], link: parts[1].id })
    else if (it.start >= t - 0.05) it.link = parts[1].id
  }
  return true
}

// Deletes items. Only the chosen items go: a deleted video-track clip closes its gap, and what was linked to it (its
// extracted sound, its texts) is unlinked and kept. Other tracks slide up with the gap, never cut or deleted: what started
// inside it now starts where the gap was.
export function removeItems(p: EditProject, ids: string[]) {
  const clips = new Set(p.items.filter((it) => ids.includes(it.id) && it.track === MAIN).map((it) => it.id))
  const gaps = p.items.filter((it) => clips.has(it.id)).map((it) => [it.start, it.start + itemLength(it)]).sort((a, b) => b[0] - a[0])
  p.items = p.items.filter((it) => !ids.includes(it.id))
  for (const it of p.items) if (it.link && clips.has(it.link)) delete it.link
  for (const [a, b] of gaps) {
    for (const it of p.items) {
      if (it.track === MAIN || it.link) continue
      it.start = +(it.start < a ? it.start : it.start < b ? a : it.start - (b - a)).toFixed(3)
    }
  }
}

// Brings a saved project up to the current shape. Before versions (0): no frame rate (they were made at 30), a clip's
// trim and speed could be missing, and a word-by-word caption was one item per word (hl was its lit word, each holding the
// whole line); those become one caption with its words.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function upgrade(saved: any): EditProject {
  const p = { ...saved, items: [...(saved.items ?? [])] }
  if (!p.version) {
    p.fps ??= 30
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out: any[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let group: any[] = []
    const flush = () => {
      if (!group.length) return
      const [first] = group
      const said = String(first.text ?? '').split(/\s+/)
      const words = group.map((g, i) => ({ text: said[i] ?? '', start: +(g.start - first.start).toFixed(3), end: +(g.start + (g.duration ?? 0.3) - first.start).toFixed(3) }))
      const { hl: _, ...rest } = first
      out.push({ ...rest, duration: words.at(-1)!.end, words })
      group = []
    }
    for (const raw of p.items) {
      const it = { ...raw }
      if (it.media === 'video') Object.assign(it, { in: it.in ?? 0, out: it.out ?? it.source ?? 0, speed: it.speed ?? 1 })
      if (it.media === 'audio') Object.assign(it, { in: it.in ?? 0, out: it.out ?? it.source ?? 0 })
      if (!it.media) it.text ??= ''
      if ((!it.media || it.media === 'image') && it.duration === undefined) it.duration = 3
      const last = group.at(-1)
      if (it.hl !== undefined && it.hl > 0 && last && last.track === it.track && last.text === it.text && last.hl === it.hl - 1) group.push(it)
      else {
        flush()
        if (it.hl === 0) group.push(it)
        else out.push((({ hl: _, ...x }) => x)(it))
      }
    }
    flush()
    p.items = out
  }
  // 1 → 2: a transition was just its kind (now its kind and length), an export just its file name.
  if ((p.version ?? 0) < 2) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    p.items = p.items.map((it: any) => (typeof it.transition === 'string' ? { ...it, transition: { type: it.transition, seconds: TRANSITION_SECONDS[it.transition as Transition['type']] ?? 0.2 } } : it))
    p.exports = (p.exports ?? []).map((e: unknown) => (typeof e === 'string' ? { file: e, at: p.createdAt ?? 0 } : e))
  }
  p.version = EDIT_VERSION
  return p as EditProject
}

// ffmpeg's atempo takes 0.5 to 100; slower speeds chain it (0.25× = 0.5 × 0.5).
export function atempo(speed: number) {
  const steps: number[] = []
  for (let s = speed; ; s /= 0.5) if (s >= 0.5) { steps.push(+s.toFixed(4)); break } else steps.push(0.5)
  return steps.map((s) => `atempo=${s}`).join(',')
}

// Pulls a time onto the nearest edge (clip starts and ends, the playhead) within `within` seconds.
export function snap(t: number, edges: number[], within: number) {
  let best = t
  let gap = within
  for (const e of edges) if (Math.abs(e - t) < gap) (gap = Math.abs(e - t)), (best = e)
  return best
}

export const SIZE: Record<EditProject['aspect'], [number, number]> = { '9:16': [720, 1280], '4:5': [720, 900], '1:1': [720, 720], '16:9': [1280, 720] }
// The export's size: 1080p unless the project asks for 720p or 4K (2160p).
export function sizeOf(aspect: EditProject['aspect'], resolution?: EditProject['resolution']): [number, number] {
  const [w, h] = SIZE[aspect]
  const k = resolution === '720p' ? 1 : resolution === '2160p' ? 3 : 1.5
  return [w * k, h * k]
}

// Movement and transitions, shared by the preview and the export so they match. A moving clip is shown 12% larger and
// moves inside that margin over the clip; a zoom transition starts 25% closer and settles over 0.3 s; a dip through
// black or white lasts 0.2 s on each side of the cut.
export const MOVE = 0.12
export const ZOOM_IN = { scale: 0.25, seconds: 0.3 }
export const DIP = 0.2
// Music (an item called Music, or on a track called Music) is lowered under speech unless you turn that off.
export const isMusic = (p: EditProject, it: Item) => /music/i.test(`${it.label} ${p.tracks.find((t) => t.id === it.track)?.name ?? ''}`)
export const ducks = (p: EditProject, it: Item) => it.media === 'audio' && (it.duck ?? isMusic(p, it))
// Whether a track's sound is heard: when any track is soloed only those are, otherwise every track not muted.
export function audible(p: EditProject, track: string) {
  const tr = p.tracks.find((t) => t.id === track)
  return p.tracks.some((t) => t.solo) ? !!tr?.solo : !tr?.muted
}
// A track's own volume, which every sound on it is scaled by.
export const trackVolume = (p: EditProject, track: string) => p.tracks.find((t) => t.id === track)?.volume ?? 1
// When someone speaks: the spans of every voice and sound that isn't itself lowered, merged, on the timeline.
export function speechSpans(p: EditProject): [number, number][] {
  const spans = p.items.filter((it) => it.media === 'audio' && it.ref && audible(p, it.track) && !ducks(p, it)).map((it) => [it.start, it.start + itemLength(it)] as [number, number]).sort((a, b) => a[0] - b[0])
  const out: [number, number][] = []
  for (const s of spans) out.length && s[0] <= out.at(-1)![1] + 0.3 ? (out.at(-1)![1] = Math.max(out.at(-1)![1], s[1])) : out.push([...s])
  return out
}
// How loud lowered music is at time t: down to `level` (30% unless set) while someone speaks, easing over 0.25 s either
// side.
export const DUCK = { level: 0.3, ramp: 0.25 }
export function duckGain(spans: [number, number][], t: number, level = DUCK.level) {
  let g = 0
  for (const [a, b] of spans) g = Math.max(g, Math.min(1, Math.max(0, (t - a + DUCK.ramp) / DUCK.ramp), Math.max(0, (b + DUCK.ramp - t) / DUCK.ramp)))
  return 1 - (1 - level) * g
}

// Keyframes. A setting's value `local` seconds into its item: straight lines between keys, held before the first and
// after the last; without keys, the item's own setting.
export function valueAt(keys: Key[] | undefined, local: number, fallback: number) {
  if (!keys?.length) return fallback
  const i = keys.findIndex((k) => k.t > local)
  if (i === 0) return keys[0].v
  if (i < 0) return keys.at(-1)!.v
  const [a, b] = [keys[i - 1], keys[i]]
  return a.v + ((b.v - a.v) * (local - a.t)) / (b.t - a.t)
}
// Within half a frame (at 30 fps) counts as the same moment.
const SAME = 1 / 60
export const keyAt = (keys: Key[] | undefined, local: number) => keys?.find((k) => Math.abs(k.t - local) < SAME)
// Sets a setting at `local`: on its key there (added if there's none) when it has keys, otherwise the setting itself.
export function setKeyed(it: Item, prop: KeyProp, local: number, v: number, plain: (v: number) => void) {
  const keys = it.keys?.[prop]
  if (!keys?.length) return plain(v)
  const t = +local.toFixed(3)
  it.keys = { ...it.keys, [prop]: [...keys.filter((k) => Math.abs(k.t - t) >= SAME), { t, v }].sort((a, b) => a.t - b.t) }
}
// Adds or removes the key at `local`, the first one keeping the value the setting has there.
export function toggleKey(it: Item, prop: KeyProp, local: number, now: number) {
  const keys = it.keys?.[prop] ?? []
  const t = +local.toFixed(3)
  const next = keyAt(keys, t) ? keys.filter((k) => Math.abs(k.t - t) >= SAME) : [...keys, { t, v: now }].sort((a, b) => a.t - b.t)
  const rest = { ...it.keys }
  delete rest[prop]
  it.keys = next.length ? { ...rest, [prop]: next } : rest
  if (!Object.keys(it.keys).length) delete it.keys
}
// Keys on either side of `local` seconds into an item, each side keeping the value at the cut (the second half's from its
// own start).
function splitKeys(keys: Keys, local: number): [Keys, Keys] {
  const a: Keys = {}
  const b: Keys = {}
  for (const [prop, ks] of Object.entries(keys) as [KeyProp, Key[]][]) {
    const at = { t: +local.toFixed(3), v: valueAt(ks, local, 0) }
    a[prop] = [...ks.filter((k) => k.t < local), at]
    b[prop] = [{ t: 0, v: at.v }, ...ks.filter((k) => k.t > local).map((k) => ({ t: +(k.t - local).toFixed(3), v: k.v }))]
  }
  return [a, b]
}

// How a moving clip looks at progress f (0 to 1 through the clip): its zoom and its horizontal place (0 left, 1 right).
export function motionAt(motion: Item['motion'], f: number) {
  const p = Math.min(1, Math.max(0, f))
  const zoom = motion === 'push-in' ? 1 + MOVE * p : motion === 'pull-out' ? 1 + MOVE * (1 - p) : motion ? 1 + MOVE : 1
  const x = motion === 'pan-left' ? 1 - p : motion === 'pan-right' ? p : 0.5
  return { zoom, x }
}
