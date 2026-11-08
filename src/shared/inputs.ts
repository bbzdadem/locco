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

// The image slots a model offers: reference images for image models, frames for video models.
export const slotsOf = (m: MediaModel) => (m.image ?? m.text)!.fields.filter((f) => f.media && f.accept === 'image')
export const capOf = (f: Field) => (f.type === 'array' ? (f.maxItems ?? 4) : 1)

export function slotLabel(f: Field, kind: MediaKind) {
  if (kind === 'image') return ''
  if (/last|tail|end/i.test(f.name)) return 'End frame'
  if (/first|start/i.test(f.name)) return 'Start frame'
  if (/keyframe/i.test(f.name)) return 'Keyframes'
  if (/reference/i.test(f.name)) return 'References'
  return f.type === 'array' ? 'Frames' : 'Start frame'
}

// Puts images into slots in order, or into one named slot.
export function fill(refs: Refs, slots: Field[], items: Attachment[], only?: string): Refs {
  const next = { ...refs }
  const queue = [...items]
  for (const s of only ? slots.filter((x) => x.name === only) : slots) {
    const cur = (next[s.name] ?? []).filter((a) => !queue.some((q) => q.file === a.file))
    next[s.name] = [...cur, ...queue.splice(0, Math.max(0, capOf(s) - cur.length))]
  }
  return next
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
  return { slots, hasRefs, variant, spec, input, missing }
}

// @ mentions: references are numbered across slots in order (@img1, @img2 …).
export function refList(slots: Field[], refs: Refs) {
  return slots.flatMap((field) => (refs[field.name] ?? []).map((a, pos) => ({ a, field, pos })))
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
