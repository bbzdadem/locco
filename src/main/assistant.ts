// The chat assistant's one tool: make an image or a video with any model in the Create studio.
import { randomUUID } from 'node:crypto'
import { buildInput, current, fill, slotLabel, slotsOf } from '../shared/inputs'
import { generators, MEDIA_MODELS } from '../shared/models'
import { estimate, priceLabel } from '../shared/prices'
import type { Attachment, MediaKind, MediaModel, ToolCall } from '../shared/types'

export const TOOL = 'generate_media'
const DEFAULT: Record<MediaKind, string> = { image: 'nano-banana-pro', video: 'kling-3', audio: 'suno' }
const all = () => [...generators('image'), ...generators('video'), ...generators('audio')]

const parameters = () => ({
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['image', 'video', 'audio'], description: 'What to make. audio = music (suno) or speech (tts-*).' },
    model: { type: 'string', enum: all().map((m) => m.id), description: 'Model id from the catalog in the system prompt. Must match exactly.' },
    prompt: { type: 'string', description: 'A detailed prompt: subject, setting, light, style; for video also motion and camera; for music the song idea (or the lyrics with custom_mode); for speech the exact words to say.' },
    settings: { type: 'object', description: 'Optional settings from the catalog, e.g. {"aspect_ratio": "16:9", "duration": "5"}.' },
    images: {
      type: 'array',
      items: { type: 'string' },
      description: 'Optional ids of images from this chat (shown as "id: ..."), in order. For video the first is the start frame.',
    },
  },
  required: ['kind', 'prompt'],
})
const description =
  'Create an image, a video, music or speech. Images start right away; video and audio wait for the user to press Run. ' +
  'The result appears in the chat and in the Create gallery.'
export const claudeTool = () => ({ name: TOOL, description, input_schema: parameters() })
export const openaiTool = () => ({ type: 'function', function: { name: TOOL, description, parameters: parameters() } })
export const responsesTool = () => ({ type: 'function', name: TOOL, description, parameters: parameters() })

export function systemAddon() {
  const lines = all().map((m) => {
    const spec = (m.text ?? m.image)!
    const settings = spec.fields
      .filter((f) => !f.media && f.name !== 'prompt' && (f.enum || f.type === 'boolean'))
      .map((f) => `${f.name}=${f.enum ? f.enum.join('|') : 'true|false'}${current(f, undefined) !== undefined ? ` (default ${current(f, undefined)})` : ''}`)
    const slots = slotsOf(m)
    const images = !slots.length ? 'no images' : m.text ? `takes images: ${slots.map((f) => slotLabel(f, m.kind) || 'references').join(', ')}` : 'needs a start frame'
    const defaults = buildInput(m, {}, {}).input
    const voices = spec.fields.find((f) => f.enumLabels)?.enumLabels
    const named = voices ? ` Voices: ${Object.entries(voices).slice(0, 12).map(([id, n]) => `${n}=${id}`).join(', ')}.` : ''
    return `- ${m.id} (${m.kind}, ${m.label}; ${images}; ${priceLabel(estimate(m.id, defaults, 1000))}): ${settings.filter((s) => !s.startsWith('voice=')).join('; ')}${named}`
  })
  return [
    'You can make images, videos, music and speech with the generate_media tool. Use it whenever the user asks for a picture, photo, illustration, logo, edit, animation, video, song, jingle, soundtrack or voice-over.',
    'Pick the model that fits: nano-banana-pro for general images and edits, gpt-image-2 or ideogram-v3 for text in images, kling-3 or veo-3-1 for video, grok-imagine for cheap quick video tests, suno for songs and music, tts-turbo for a voice reading text.',
    'To edit, combine or animate an image, pass its id in `images`. Results you made earlier are listed in the chat with their ids.',
    'After calling the tool, say in one short sentence what you started. Do not claim it is finished: the user sees it appear.',
    'Catalog (settings use these exact values):',
    ...lines,
  ].join('\n')
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const snake = (k: string) => k.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()

// Models sometimes invent ids or setting names. Match what we can and say what was changed.
function pickModel(args: any, notes: string[]): MediaModel {
  const kind: MediaKind = args.kind === 'video' ? 'video' : 'image'
  const wanted = String(args.model ?? '')
  const exact = all().find((m) => m.id === wanted)
  if (exact) return exact
  const fuzzy = wanted && all().find((m) => norm(m.id).includes(norm(wanted)) || norm(wanted).includes(norm(m.id)) || norm(m.label) === norm(wanted))
  if (fuzzy) return fuzzy
  const fallback = MEDIA_MODELS.find((m) => m.id === DEFAULT[kind])!
  if (wanted) notes.push(`Used ${fallback.label} (asked for "${wanted}").`)
  return fallback
}

export function planCall(args: any, files: Attachment[]): ToolCall {
  const notes: string[] = []
  const model = pickModel(args, notes)
  const values: Record<string, unknown> = {}
  for (const [rawKey, rawVal] of Object.entries(args.settings ?? {})) {
    const key = snake(rawKey)
    const f = [model.text, model.image].flatMap((s) => s?.fields ?? []).find((x) => x.name === key && !x.media)
    if (!f) continue
    let val: unknown = rawVal
    if (f.name === 'duration') val = String(rawVal).replace(/\s*s(ec(ond)?s?)?$/i, '')
    if (f.enum) {
      const byName = Object.entries(f.enumLabels ?? {}).find(([, n]) => n.toLowerCase() === String(val).toLowerCase())?.[0]
      const match = f.enum.find((o) => String(o).toLowerCase() === String(byName ?? val).toLowerCase())
      if (match === undefined) {
        notes.push(`${key} "${rawVal}" isn't available, used ${current(f, undefined) ?? 'the default'}.`)
        continue
      }
      val = String(match)
    }
    values[key] = val
  }
  const wanted: string[] = Array.isArray(args.images) ? args.images.map(String) : []
  const images = wanted.flatMap((w) => {
    const hit = files.find((a) => a.file === w) ?? files.find((a) => a.name.toLowerCase() === w.toLowerCase())
    if (!hit) notes.push(`Couldn't find image "${w}".`)
    return hit ? [hit] : []
  })
  const { variant, input, missing } = buildInput(model, values, fill({}, slotsOf(model), images))
  if (images.length && !slotsOf(model).length) notes.push(`${model.label} doesn't take images, so they were left out.`)
  return {
    id: randomUUID(),
    modelId: model.id,
    label: model.label,
    kind: model.kind,
    variant,
    prompt: String(args.prompt ?? '').trim(),
    input,
    cost: priceLabel(estimate(model.id, input, String(args.prompt ?? '').length)),
    // Images start right away; video and audio wait for Run.
    status: missing ? 'error' : model.kind === 'image' ? 'started' : 'pending',
    ...(missing && { error: `${model.label} needs ${slotLabel(missing, model.kind).toLowerCase() || 'an image'}. Attach one and ask again.` }),
    ...(notes.length && { notes }),
  }
}
