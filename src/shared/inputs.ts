// Turns a model, chosen settings and attached images into the exact kie input.
// Shared by the Create prompt bar and the chat assistant, so both send the same thing.
import type { Attachment, Field, MediaKind, MediaModel, Variant } from './types'

export type Refs = Record<string, Attachment[]>

// The field that holds what you type: `prompt` for most models, `text` for speech.
export const isMain = (f: Field) => f.name === 'prompt' || f.name === 'text'

export const valid = (f: Field, v: unknown) =>
  v === undefined || v === '' || (f.enum && !f.enum.map(String).includes(String(v))) ? undefined : v

// Value a field will be sent with: your choice, else kie's default, else the first option for required fields.
export const current = (f: Field, chosen: unknown) =>
  valid(f, chosen) ?? f.default ?? (f.required ? (f.enum?.[0] ?? (f.type === 'boolean' ? false : undefined)) : undefined)

// The file slots a model offers: reference images for image models; frames, references, a video to copy motion from or
// a voice track for video models.
export const slotsOf = (m: MediaModel) => (m.image ?? m.text)!.fields.filter((f) => f.media)
export const capOf = (f: Field) => (f.type === 'array' ? (f.maxItems ?? 4) : 1)
// What a file is (image, video or audio), from its type, else its name.
export const fileKind = (a: Attachment) =>
  a.mime?.split('/')[0] || (/\.(mp4|mov|webm)$/i.test(a.file) ? 'video' : /\.(mp3|wav|m4a|aac|ogg)$/i.test(a.file) ? 'audio' : 'image')
const takes = (f: Field, a: Attachment) => (f.accept ?? 'image') === fileKind(a)
// Frames (start, end) and references (images, videos or audio of who or what to show, how to move, how to sound) are two
// modes on Seedance 2.x, Wan 3.0 and Gemini Omni Flash: kie turns down a request with both. Keyframes go with frames.
const isFrame = (f: Field) => f.type !== 'array' && /first|start|last|end|tail/i.test(f.name)
const isRefs = (f: Field) => f.type === 'array' && !/keyframe/i.test(f.name) && (f.accept !== 'image' || capOf(f) > 1)

export function slotLabel(f: Field, kind: MediaKind) {
  if (kind === 'image') return ''
  if (/last|tail|end/i.test(f.name)) return 'End frame'
  if (/first|start/i.test(f.name)) return 'Start frame'
  if (/keyframe/i.test(f.name)) return 'Keyframes'
  if (f.label) return f.label
  if (f.accept === 'video') return capOf(f) > 1 ? 'Reference videos' : 'Reference video'
  if (f.accept === 'audio') return f.type === 'array' ? 'Reference audio' : 'Voice track'
  if (/reference/i.test(f.name)) return 'References'
  if (f.type === 'array') return capOf(f) > 3 ? 'References' : 'Frames'
  return 'Start frame'
}

// Puts files into the slots that take them, in order, or into one named slot. Where frames and references can't be
// mixed: one image is the start frame; two or more images, or any video or audio, make it references (frames move
// over), and filling one mode by hand empties the other.
export function fill(refs: Refs, slots: Field[], items: Attachment[], only?: string): Refs {
  const next = { ...refs }
  let queue = [...items]
  let targets = only ? slots.filter((x) => x.name === only) : slots
  const frames = slots.filter(isFrame), refSlots = slots.filter(isRefs)
  if (frames.length && refSlots.length) {
    const inFrames = frames.flatMap((f) => next[f.name] ?? [])
    const inRefs = refSlots.flatMap((f) => next[f.name] ?? [])
    const images = queue.filter((a) => fileKind(a) === 'image').length
    const media = queue.some((a) => fileKind(a) !== 'image')
    const useRefs = only ? refSlots.some((f) => f.name === only) : inRefs.length > 0 || media || inFrames.length + images > 1
    for (const f of useRefs ? frames : refSlots) delete next[f.name]
    if (useRefs) queue = [...inFrames, ...queue]
    targets = targets.filter((f) => !(useRefs ? isFrame(f) : isRefs(f)))
    if (only && !targets.length) targets = useRefs ? refSlots : frames
  }
  for (const s of targets) {
    const cur = (next[s.name] ?? []).filter((a) => !queue.some((q) => q.file === a.file))
    const fits = queue.filter((a) => takes(s, a)).slice(0, Math.max(0, capOf(s) - cur.length))
    queue = queue.filter((a) => !fits.includes(a))
    next[s.name] = [...cur, ...fits]
  }
  return next
}

// Settings kie turns down together, changed to the nearest that works, with a note saying what changed.
function adjust(id: string, input: Record<string, unknown>) {
  const notes: string[] = []
  const n = (k: string) => (Array.isArray(input[k]) ? (input[k] as unknown[]).length : input[k] ? 1 : 0)
  const set = (k: string, v: unknown, why: string) => input[k] !== v && ((input[k] = v), notes.push(why))
  if (id === 'veo-3-1' && n('image_urls') > 2) set('duration', '8', 'Veo makes 8 s videos from 3 references.')
  if (id.startsWith('hailuo') && input.resolution === '1080P' && String(input.duration) === '10') set('resolution', '768P', 'Hailuo makes 10 s videos only at 768P.')
  if (id === 'grok-imagine' && n('image_urls')) {
    if (n('image_urls') > 1 && input.resolution === '1080p') set('resolution', '720p', 'Grok makes 1080p from one image only, so this is 720p.')
    if (input.mode === 'spicy') set('mode', 'normal', 'Spicy works only without images, so this is normal.')
  }
  if (id === 'seedance-2-5' && input.draft === true) set('resolution', '480p', 'Drafts are 480p.')
  if (id === 'gemini-omni-flash' && n('last_frame_url') && Number(input.duration) > 10) set('duration', 10, 'With an end frame, Gemini makes up to 10 s.')
  return notes
}

export function buildInput(model: MediaModel, values: Record<string, unknown>, refs: Refs) {
  const slots = slotsOf(model)
  const hasRefs = slots.some((f) => refs[f.name]?.length)
  const variant: Variant = model.image && (hasRefs || !model.text) ? 'image' : 'text'
  const spec = model[variant]!
  const input: Record<string, unknown> = {}
  for (const f of spec.fields) {
    if (isMain(f)) continue
    if (f.media) {
      if (refs[f.name]?.length) input[f.name] = refs[f.name].slice(0, capOf(f))
      continue
    }
    // Send what the chip shows, so what you see is what kie makes (and bills).
    const val = current(f, values[f.name])
    if (val !== undefined) input[f.name] = val
  }
  const missing = spec.fields.find((f) => f.required && f.media && !refs[f.name]?.length)
  const notes = adjust(model.id, input)
  return { slots, hasRefs, variant, spec, input, missing, notes }
}

// @ mentions: references are numbered across slots in order (@img1, @img2 …).
export function refList(slots: Field[], refs: Refs) {
  return slots.filter((f) => f.accept === 'image').flatMap((field) => (refs[field.name] ?? []).map((a, pos) => ({ a, field, pos })))
}

// Turns @img1 … into what the model understands: its own tags where its docs define them
// (Kling 4.0: @first_frame, @keyframe_1, @last_frame, @image_1), otherwise plain words ("image 2", "the end frame").
export function resolveMentions(prompt: string, model: MediaModel, refs: Refs) {
  const slots = slotsOf(model)
  const tags = (model.image ?? model.text)!.tags ?? []
  const list = refList(slots, refs)
  return prompt.replace(/@img(\d+)\b/gi, (whole, n) => {
    const r = list[Number(n) - 1]
    if (!r) return whole
    const name = r.field.name
    if (tags.includes('first_frame') && /first/.test(name)) return '@first_frame'
    if (tags.includes('last_frame') && /last/.test(name)) return '@last_frame'
    if (tags.some((t) => t.startsWith('keyframe')) && /keyframe/.test(name)) return `@keyframe_${r.pos + 1}`
    if (tags.some((t) => t.startsWith('image_'))) return `@image_${r.pos + 1}`
    if (tags.some((t) => /^image\d/.test(t))) return `@image${r.pos + 1}`
    const label = slotLabel(r.field, model.kind)
    if (label === 'Start frame' || label === 'End frame') return `the ${label.toLowerCase()}`
    return `image ${Number(n)}`
  })
}
