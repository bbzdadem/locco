// Credits per result, copied from kie's public price list (kie.ai/pricing, served by
// POST https://api.kie.ai/client/v1/model-pricing/page). Checked 8 Nov 2026. kie sells 1 credit for about $0.005.
// These are estimates shown before you generate; each finished result shows what kie actually charged.
// `by` names the setting(s) that change the price; several settings are joined with "|" in the keys.
// `perSecond` prices are multiplied by the `duration` setting; `perKChars` prices by the length of the text (speech).
import { MEDIA_MODELS } from './models'

export const USD_PER_CREDIT = 0.005

type Price = { by?: string | string[]; credits: number | Record<string, number>; perSecond?: boolean; perKChars?: boolean; strict?: boolean }

export const PRICES: Record<string, Price> = {
  // Images, per image
  'nano-banana-pro': { by: 'resolution', credits: { '1K': 18, '2K': 18, '4K': 24 } },
  'nano-banana-2': { by: 'resolution', credits: { '1K': 8, '2K': 12, '4K': 18 } },
  'gpt-image-2': { by: 'resolution', credits: { '1K': 6, '2K': 10, '4K': 16 } },
  'seedream-5-pro': { by: 'quality', credits: { basic: 7, high: 14 } },
  'flux-2-pro': { by: 'resolution', credits: { '1K': 5, '2K': 7 } },
  'ideogram-v3': { by: 'rendering_speed', credits: { TURBO: 3.5, BALANCED: 7, QUALITY: 10 } },
  upscale: { credits: { '2K output': 10, '4K output': 20 } },
  'remove-bg': { credits: 1 },
  // kie prices GPT Image 2.6 Flare/Sunburst by tokens; these are what a run actually cost (8 Nov 2026).
  // `strict`: settings not measured yet show no price rather than a guess.
  'gpt-image-2-6-flare': { by: ['quality', 'resolution'], strict: true, credits: { 'medium|1K': 7.95 } },
  'gpt-image-2-6-sunburst': { by: ['quality', 'resolution'], strict: true, credits: { 'medium|1K': 7.95 } },

  // Video. std = 720p, pro = 1080p for Kling 3.0.
  'kling-3': { by: ['mode', 'sound'], perSecond: true,
    credits: { 'std|false': 15.1, 'std|true': 22.7, 'pro|false': 20.2, 'pro|true': 30.2, '4K|false': 75.5, '4K|true': 75.5 } },
  'kling-4-keyframes': { by: 'resolution', perSecond: true, credits: { '720p': 28.5, '1080p': 42.5 } },
  'veo-3-1': { by: ['model', 'resolution'],
    credits: { 'veo3_fast|720p': 60, 'veo3_fast|1080p': 65, 'veo3_fast|4k': 180, 'veo3_lite|720p': 30, 'veo3_lite|1080p': 35,
      'veo3_lite|4k': 150, 'veo3|720p': 250, 'veo3|1080p': 255, 'veo3|4k': 370 } },
  'seedance-2': { by: 'resolution', perSecond: true, credits: { '480p': 19, '720p': 41, '1080p': 102, '4k': 208 } },
  'hailuo-2-3-pro': { by: ['duration', 'resolution'], credits: { '6|768P': 45, '10|768P': 90, '6|1080P': 80 } },
  'wan-2-7': { by: 'resolution', perSecond: true, credits: { '720p': 16, '1080p': 24 } },
  'grok-imagine': { by: 'resolution', perSecond: true, credits: { '480p': 2.4, '720p': 4.5, '1080p': 8 } },
  'video-upscale': { by: 'upscale_factor', perSecond: true, credits: { '1': 8, '2': 8, '4': 14 } },

  // Audio. One Suno request makes 2 tracks.
  suno: { credits: 12 },
  'suno-extend': { credits: 12 },
  'suno-stems': { credits: 10 },
  'tts-turbo': { perKChars: true, credits: 6 },
  'tts-multilingual': { perKChars: true, credits: 12 },
}

// Credits for one result as [low, high]; a range when a price-driving setting isn't chosen yet.
// `perSecond` is true when the price depends on a duration that isn't known (shown as "/s").
export function estimate(modelId: string, input: Record<string, unknown>, chars = 0): { lo: number; hi: number; perSecond: boolean } | null {
  const p = PRICES[modelId]
  if (!p) return fromPriceList(modelId, input)
  const table = typeof p.credits === 'number' ? { '': p.credits } : p.credits
  const key = p.by === undefined ? undefined : [p.by].flat().map((k) => String(input[k])).join('|')
  if (p.strict && (key === undefined || !(key in table))) return null
  const options = key !== undefined && key in table ? [table[key]] : Object.values(table)
  const seconds = p.perSecond ? Number(input.duration) || 0 : 1
  const n = p.perKChars ? Math.max(chars, 1) / 1000 : seconds || 1
  return { lo: Math.min(...options) * n, hi: Math.max(...options) * n, perSecond: !!p.perSecond && !seconds }
}

const money = (credits: number) => {
  const usd = credits * USD_PER_CREDIT
  return '$' + usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: usd < 0.1 ? 3 : 2 })
}

export function priceLabel(e: ReturnType<typeof estimate>, count = 1) {
  if (!e) return ''
  const [lo, hi] = [e.lo * count, e.hi * count]
  const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 })
  const unit = (hi === 1 ? 'credit' : 'credits') + (e.perSecond ? '/s' : '')
  const usd = lo === hi ? money(lo) : `${money(lo)}–${money(hi).slice(1)}`
  return `≈ ${usd}${e.perSecond ? '/s' : ''} · ${lo === hi ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`} ${unit}`
}

// Models without a hand-checked entry: start from all of the model's rows in kie's price list (stored by
// scripts/sync-models.mjs) and keep only rows that match your settings. Anything that can't be narrowed shows as a range.
function fromPriceList(modelId: string, input: Record<string, unknown>) {
  let rows = (MEDIA_MODELS.find((m) => m.id === modelId)?.prices ?? []).filter((r) => r.u !== 'other')
  if (!rows.length) return null
  const narrow = (keep: (d: string) => boolean) => {
    const left = rows.filter((r) => keep(r.d))
    if (left.length) rows = left
  }
  const isRef = (v: unknown) => !!v && typeof v === 'object' && 'file' in v
  const withImages = Object.values(input).some((v) => (Array.isArray(v) ? v.some(isRef) : isRef(v)))
  narrow((d) => (withImages ? /image[- ]?to|edit|reference|keyframe|transition/.test(d) : /text[- ]?to/.test(d)))
  narrow((d) => !/video-to-video|video to video|video-?edit|with video/.test(d)) // locco never sends video inputs
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === 'boolean' && /audio|sound/.test(k)) narrow((d) => (v ? /with (native )?audio/ : /(without|no) (native )?audio/).test(d))
    if (typeof v !== 'string' && typeof v !== 'number') continue
    const tok = String(v).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (!tok) continue
    const re = k === 'duration' ? new RegExp(`(^|[^0-9.])${tok}(\\.0)?\\s?s\\b`) : new RegExp(`(^|[^a-z0-9])${tok}([^a-z0-9]|$)`)
    narrow((d) => re.test(d))
  }
  const seconds = Number(input.duration) || 0
  const costs = rows.map((r) => r.c * (r.u === 'second' ? seconds || 1 : 1))
  return { lo: Math.min(...costs), hi: Math.max(...costs), perSecond: rows.some((r) => r.u === 'second') && !seconds }
}
