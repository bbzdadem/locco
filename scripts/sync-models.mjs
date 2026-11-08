// Pulls each model's OpenAPI spec from docs.kie.ai and writes src/shared/media-models.json.
// Add a model: add a line to MODELS, run `npm run sync-models`. The Create prompt bar is built from these fields.
//   hide:     fields to leave out of the UI (kie's default applies)
//   fixed:    values always sent and never shown
//   override: replaces parts of a field, e.g. a short duration list instead of a free number
//   slug:     kie model name, when the docs only give it in an example
//   hidden:   used by the app itself (dictation), kept out of the gallery
//   price:    regex for this model's rows in kie's price list; the app narrows them by your settings
//             (models in src/shared/prices.ts use exact hand-checked prices instead)
import { parse } from 'yaml'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const HIDE = ['nsfw_checker', 'watermark', 'enable_fallback', 'enable_translation', 'return_last_frame', 'web_search', 'prompt_extend']
const secs = (...s) => ({ enum: s.map(String), default: String(s[0]) })

const MODELS = [
  { id: 'nano-banana-pro', kind: 'image', label: 'Nano Banana Pro', text: 'google/pro-image-to-image' },
  { id: 'nano-banana-2', kind: 'image', label: 'Nano Banana 2', text: 'google/nanobanana2' },
  { id: 'gpt-image-2', kind: 'image', label: 'GPT Image 2', text: 'gpt/gpt-image-2-text-to-image', image: 'gpt/gpt-image-2-image-to-image' },
  { id: 'seedream-5-pro', kind: 'image', label: 'Seedream 5 Pro', text: 'seedream/5-pro-text-to-image', image: 'seedream/5-pro-image-to-image' },
  { id: 'flux-2-pro', kind: 'image', label: 'Flux-2 Pro', text: 'flux2/pro-text-to-image', image: 'flux2/pro-image-to-image' },
  { id: 'ideogram-v3', kind: 'image', label: 'Ideogram V3', text: 'ideogram/v3-text-to-image' },
  { id: 'nano-banana', kind: 'image', label: 'Nano Banana', text: 'google/nano-banana', image: 'google/nano-banana-edit', price: '^google nano banana(,| edit)' },
  { id: 'nano-banana-2-1', kind: 'image', label: 'Nano Banana 2.1', text: 'google/nanobanana-2-1', price: '^nano-banana-2-1,' },
  { id: 'nano-banana-2-lite', kind: 'image', label: 'Nano Banana 2 Lite', text: 'google/nano-banana-2-lite', price: '^nano-banana-2-lite,' },
  { id: 'imagen-4', kind: 'image', label: 'Imagen 4', text: 'google/imagen4', price: '^google imagen4, text-to-image, default' },
  { id: 'imagen-4-fast', kind: 'image', label: 'Imagen 4 Fast', text: 'google/imagen4-fast', price: '^google imagen4, text-to-image, fast' },
  { id: 'imagen-4-ultra', kind: 'image', label: 'Imagen 4 Ultra', text: 'google/imagen4-ultra', price: '^google imagen4, text-to-image, ultra' },
  { id: 'seedream-5-flash', kind: 'image', label: 'Seedream 5 Flash', text: 'seedream/5-flash-text-to-image', image: 'seedream/5-flash-image-to-image', price: '^seedream 5 flash, (text|image) to image' },
  { id: 'seedream-5-lite', kind: 'image', label: 'Seedream 5 Lite', text: 'seedream/5-lite-text-to-image', price: '^seedream 5\\.0 lite,' },
  { id: 'seedream-4-5', kind: 'image', label: 'Seedream 4.5', text: 'seedream/4-5-text-to-image', image: 'seedream/4-5-edit', price: '^seedream 4\\.5,' },
  { id: 'flux-2-flex', kind: 'image', label: 'Flux-2 Flex', text: 'flux2/flex-text-to-image', image: 'flux2/flex-image-to-image', price: 'flux 2 flex,' },
  { id: 'flux-3-klein', kind: 'image', label: 'FLUX 3 Klein', text: 'flux3/klein-text-to-image', image: 'flux3/klein-edit-image', price: 'flux 3 klein,' },
  ...['flare', 'sunburst'].map((v) => ({
    id: `gpt-image-2-6-${v}`, kind: 'image', label: `GPT Image 2.6 ${v[0].toUpperCase()}${v.slice(1)}`,
    text: `gpt/gpt-image-2-6-${v}-text-to-image`, image: `gpt/gpt-image-2-6-${v}-image-to-image`,
    // GIF and mask-editing options stay out of the prompt bar; still images (PNG/JPEG/WebP/SVG) only.
    hide: ['frame_count', 'frame_duration_ms', 'size', 'mask_url', 'markup', 'moderation', 'output_compression'],
    override: { output_format: { enum: ['png', 'jpeg', 'webp', 'svg'] } },
  })),
  { id: 'gpt-image-2-6-economy', kind: 'image', label: 'GPT Image 2.6 Economy', text: 'gpt/gpt-image-2-6-economy-text-to-image', image: 'gpt/gpt-image-2-6-economy-image-to-image', price: '^gpt-image-2-6-economy,',
    hide: ['frame_count', 'frame_duration_ms'], override: { output_format: { enum: ['png'] } } },
  { id: 'gpt-image-1-5', kind: 'image', label: 'GPT Image 1.5', text: 'gpt-image/1-5-text-to-image', image: 'gpt-image/1-5-image-to-image', price: '^gpt image 1\\.5,' },
  { id: 'qwen-3', kind: 'image', label: 'Qwen Image 3', text: 'qwen3/text-to-image', image: 'qwen3/image-to-image', price: '^qwen image 3\\.0, output' },
  { id: 'qwen-3-pro', kind: 'image', label: 'Qwen Image 3 Pro', text: 'qwen3-pro/text-to-image', image: 'qwen3-pro/image-to-image', price: '^qwen image 3\\.0 pro, output' },
  { id: 'wan-2-7-image', kind: 'image', label: 'Wan 2.7 Image', text: 'wan/2-7-image', fixed: { n: 1 }, price: '^wan 2\\.7 image$' },
  { id: 'wan-2-7-image-pro', kind: 'image', label: 'Wan 2.7 Image Pro', text: 'wan/2-7-image-pro', fixed: { n: 1 }, price: '^wan 2\\.7 image pro' },
  { id: 'grok-imagine-image', kind: 'image', label: 'Grok Imagine Image', text: 'grok-imagine-image-2-0/text-to-image', image: 'grok-imagine-image-2-0/image-to-image', price: '^grok-imagine-image-2-0, (text to image|image edit)' },
  { id: 'z-image', kind: 'image', label: 'Z-Image', text: 'z-image/z-image', price: '^qwen z-image,' },
  { id: 'ideogram-character', kind: 'image', label: 'Ideogram Character', image: 'ideogram/character', price: '^ideogram character,' },
  { id: 'upscale', kind: 'image', label: 'Topaz Upscale', tool: 'topaz/image-upscale' },
  { id: 'remove-bg', kind: 'image', label: 'Remove Background', tool: 'recraft/remove-background' },

  { id: 'kling-3', kind: 'video', label: 'Kling 3.0', text: 'kling/kling-3-0', // image_urls: first frame, then optional last frame
    fixed: { multi_shots: false }, hide: ['multi_prompt', 'kling_elements'],
    override: { duration: secs(5, 10, 15), mode: { default: 'std' }, sound: { default: false }, aspect_ratio: { default: '16:9' }, image_urls: { maxItems: 2 } } },
  { id: 'kling-4-keyframes', kind: 'video', label: 'Kling 4.0 Keyframes', text: 'kling/v4-keyframe-to-video', override: { duration: secs(5, 10) } },
  { id: 'veo-3-1', kind: 'video', label: 'Veo 3.1', text: 'https://docs.kie.ai/veo3-api/generate-veo-3-video.md',
    hide: ['generation_type'], override: { model: { label: 'Tier' }, image_urls: { maxItems: 3 } } },
  { id: 'seedance-2', kind: 'video', label: 'Seedance 2.0', text: 'bytedance/seedance-2', override: { duration: secs(5, 10, 15) } },
  { id: 'hailuo-2-3-pro', kind: 'video', label: 'Hailuo 2.3 Pro', image: 'hailuo/2-3-image-to-video-pro' },
  { id: 'wan-2-7', kind: 'video', label: 'Wan 2.7', text: 'wan/2-7-text-to-video', image: 'wan/2-7-image-to-video', override: { duration: secs(5, 10, 15) } },
  { id: 'grok-imagine', kind: 'video', label: 'Grok Imagine', text: 'grok-imagine/text-to-video', image: 'grok-imagine/image-to-video',
    hide: ['task_id', 'index'], override: { duration: secs(6, 10, 15) } },
  { id: 'kling-2-6', kind: 'video', label: 'Kling 2.6', text: 'kling/text-to-video', image: 'kling/image-to-video', price: '^kling 2\\.6,' },
  { id: 'kling-2-5-turbo', kind: 'video', label: 'Kling 2.5 Turbo Pro', text: 'kling/v25-turbo-text-to-video-pro', image: 'kling/v25-turbo-image-to-video-pro', price: '^kling 2\\.5 turbo,' },
  { id: 'kling-3-turbo', kind: 'video', label: 'Kling 3.0 Turbo', text: 'kling/v3-turbo-text-to-video', image: 'kling/v3-turbo-image-to-video', price: '^kling 3\\.0 turbo,' },
  { id: 'kling-3-omni', kind: 'video', label: 'Kling 3.0 Omni', text: 'kling/v3-omni-text-to-video', hide: ['customize_multi_shots', 'prefer_multi_shots'], price: '^kling 3\\.0 omni, text' },
  { id: 'kling-4-reference', kind: 'video', label: 'Kling 4.0 Reference', text: 'kling/v4-reference-to-video', price: '^kling 4\\.0, reference' },
  { id: 'kling-4-flash-keyframes', kind: 'video', label: 'Kling 4.0 Flash Keyframes', text: 'kling/v4-flash-keyframe-to-video', price: '^kling 4\\.0 flash, keyframe' },
  { id: 'kling-4-flash-reference', kind: 'video', label: 'Kling 4.0 Flash Reference', text: 'kling/v4-flash-reference-to-video', price: '^kling 4\\.0 flash, reference' },
  { id: 'seedance-2-fast', kind: 'video', label: 'Seedance 2.0 Fast', text: 'bytedance/seedance-2-fast', price: '^bytedance/seedance-2 fast,' },
  { id: 'seedance-2-mini', kind: 'video', label: 'Seedance 2.0 Mini', text: 'bytedance/seedance-2-mini', price: '^bytedance/seedance-2-mini,' },
  { id: 'seedance-2-5', kind: 'video', label: 'Seedance 2.5', text: 'bytedance/seedance-2-5', price: '^bytedance/seedance-2-5,' },
  { id: 'seedance-1-pro', kind: 'video', label: 'Seedance 1 Pro', text: 'bytedance/v1-pro-text-to-video', image: 'bytedance/v1-pro-image-to-video', price: '^bytedance/seedance-v1-pro,' },
  { id: 'seedance-1-lite', kind: 'video', label: 'Seedance 1 Lite', text: 'bytedance/v1-lite-text-to-video', image: 'bytedance/v1-lite-image-to-video', price: '^bytedance/seedance-v1-lite,' },
  { id: 'hailuo-2-3', kind: 'video', label: 'Hailuo 2.3 Standard', image: 'hailuo/2-3-image-to-video-standard', price: '^hailuo 2\\.3, image-to-video, standard' },
  { id: 'hailuo-02-pro', kind: 'video', label: 'Hailuo 02 Pro', text: 'hailuo/02-text-to-video-pro', image: 'hailuo/02-image-to-video-pro', price: '^hailuo 02,.*pro-' },
  { id: 'wan-2-6', kind: 'video', label: 'Wan 2.6', text: 'wan/2-6-text-to-video', image: 'wan/2-6-image-to-video', price: '^wan 2\\.6,' },
  { id: 'wan-2-6-flash', kind: 'video', label: 'Wan 2.6 Flash', image: 'wan/2-6-flash-image-to-video', price: '^wan 2\\.6 flash, image' },
  { id: 'wan-3', kind: 'video', label: 'Wan 3.0', text: 'wan/3-0-video', hide: ['reference_file_urls', 'reference_link_urls'], price: '^wan 3\\.0 video,' },
  { id: 'wan-3-prime', kind: 'video', label: 'Wan 3.0 Prime', text: 'wan/3-0-video-prime', hide: ['reference_file_urls', 'reference_link_urls'], price: '^wan3\\.0 video prime' },
  { id: 'pixverse-6', kind: 'video', label: 'PixVerse V6', text: 'pixverse/text-to-video', image: 'pixverse/image-to-video',
    hide: ['template_id', 'generate_multi_clip_switch'], override: { generate_audio_switch: { label: 'Sound' } }, price: '^pixverse-v6, text' },
  { id: 'pixverse-6-max', kind: 'video', label: 'PixVerse V6 Max', text: 'pixverse/v6-max-text-to-video', image: 'pixverse/v6-max-image-to-video',
    override: { generate_audio_switch: { label: 'Sound' } }, price: '^pixverse-v6-max,' },
  { id: 'pixverse-transition', kind: 'video', label: 'PixVerse Transition', image: 'pixverse/transition', override: { generate_audio_switch: { label: 'Sound' } }, price: '^pixverse-v6, transition' },
  { id: 'minimax-h3', kind: 'video', label: 'MiniMax H3', text: 'minimax-h3/text-to-video', image: 'minimax-h3/image-to-video', price: '^minimax h3, (text|image) to video' },
  { id: 'happyhorse-1-1', kind: 'video', label: 'HappyHorse 1.1', text: 'happyhorse-1-1/text-to-video', image: 'happyhorse-1-1/image-to-video', price: '^happyhorse-1\\.1, (text|image)' },
  { id: 'happyhorse-1-1-reference', kind: 'video', label: 'HappyHorse 1.1 Reference', image: 'happyhorse-1-1/reference-to-video', price: '^happyhorse-1\\.1, reference' },
  { id: 'gemini-omni-video', kind: 'video', label: 'Gemini Omni Video', text: 'gemini-omni-video', price: '^gemini-omni-video,' },
  { id: 'gemini-omni-flash', kind: 'video', label: 'Gemini Omni Flash 1.1', text: 'google/gemini-omni-flash-1-1', price: '^google/gemini-omni-flash-1-1,' },
  { id: 'vidu-q4', kind: 'video', label: 'Vidu Q4', image: 'vidu-q4/image-to-video', price: '^vidu q4, image' },
  { id: 'vidu-q4-reference', kind: 'video', label: 'Vidu Q4 Reference', image: 'vidu-q4/reference-to-video', price: '^vidu q4, reference' },
  { id: 'grok-imagine-1-5', kind: 'video', label: 'Grok Imagine 1.5 Preview', image: 'grok-imagine/1-5-preview', price: '^grok-imagine-video-1-5-preview' },
  { id: 'video-upscale', kind: 'video', label: 'Topaz Video Upscale', tool: 'topaz/video-upscale' },

  { id: 'suno', kind: 'audio', label: 'Suno V6', text: 'https://docs.kie.ai/suno-api/generate-music.md', slug: 'ai-music-api/generate',
    hide: ['persona_id', 'persona_model', 'style_weight', 'weirdness_constraint', 'audio_weight', 'variety', 'lyrics', 'image_urls',
      'audio_urls', 'video_urls', 'duration', 'negative_tags'],
    override: { model: { enum: ['V6', 'V6_MINI', 'V6_WILD'], default: 'V6', label: 'Version' }, custom_mode: { label: 'Custom lyrics', default: false },
      instrumental: { default: false }, vocal_gender: { label: 'Vocals', enumLabels: { m: 'Male', f: 'Female' } } } },
  ...['turbo-2-5', 'multilingual-v2'].map((v) => ({
    id: `tts-${v.split('-')[0]}`, kind: 'audio', label: v === 'turbo-2-5' ? 'ElevenLabs Turbo 2.5' : 'ElevenLabs Multilingual v2',
    text: `elevenlabs/text-to-speech-${v}`,
    hide: ['stability', 'similarity_boost', 'style', 'speed', 'timestamps', 'previous_text', 'next_text', 'language_code'],
    override: { voice: { default: '1SM7GgM6IMuvQlz2BwM3', label: 'Voice' } },
  })),
  { id: 'suno-extend', kind: 'audio', label: 'Suno Extend', tool: 'https://docs.kie.ai/suno-api/extend-music.md', slug: 'ai-music-api/extend',
    override: { model: { enum: ['V6', 'V6_MINI', 'V6_WILD'], default: 'V6' } } },
  { id: 'suno-stems', kind: 'audio', label: 'Suno Split Vocals', tool: 'https://docs.kie.ai/suno-api/separate-vocals.md', slug: 'ai-music-api/separate-vocals' },
  { id: 'transcribe', kind: 'audio', label: 'Transcribe', tool: 'nvidia/nemotron-3-5-transcribe', hidden: true },
]

async function fetchSpec(path) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(path.startsWith('http') ? path : `https://docs.kie.ai/market/${path}.md`)
    const yaml = res.ok && (await res.text()).match(/```yaml\n([\s\S]*?)\n```/)?.[1]
    if (yaml) return yaml
    if (attempt === 3) throw new Error(`${path}: no OpenAPI block (HTTP ${res.status})`)
    await new Promise((r) => setTimeout(r, 2000 * attempt)) // the docs site sometimes serves its HTML shell instead
  }
}

// A free-number duration ("3s - 15s", "from 1 to 15") becomes a few chips, so it can sit in the prompt bar.
function durationChips(p, desc) {
  const r = desc.match(/(\d+)\s*s?\s*(?:–|-|to|,)\s*(\d+)\s*s?/)
  const lo = p.minimum ?? (r ? Number(r[1]) : undefined)
  const hi = p.maximum ?? (r ? Number(r[2]) : undefined)
  if (lo === undefined || hi === undefined || hi <= lo) return {}
  let opts = [5, 10, 15, 20, 30].filter((s) => s >= lo && s <= hi)
  if (!opts.length) opts = [lo, hi]
  const def = opts.includes(Number(p.default)) ? Number(p.default) : opts[0]
  return { enum: opts.map(String), default: String(def) }
}

async function spec(path, m) {
  const yaml = await fetchSpec(path)
  const [endpoint, ops] = Object.entries(parse(yaml).paths)[0]
  if (endpoint !== '/api/v1/jobs/createTask') throw new Error(`${path}: custom endpoint ${endpoint}, needs an adapter`)
  const content = ops.post.requestBody.content['application/json']
  const body = content.schema.properties
  const input = body.input ?? {}
  const props = input.properties ?? {}
  const order = [...new Set([...(input['x-apidog-orders'] ?? []), ...Object.keys(props)])].filter((n) => props[n])
  const fields = []
  for (const name of order) {
    if (HIDE.includes(name) || m.hide?.includes(name) || name in (m.fixed ?? {})) continue
    const p = props[name]
    const desc = String(p.description ?? '')
    const required = (input.required ?? []).includes(name) || /^\s*required\b/i.test(desc)
    const media = p.format === 'uri' || p.items?.format === 'uri' || (/url|image/i.test(name) && /url|upload/i.test(desc)) || /image_urls?$/i.test(name)
    const accept = !media ? undefined : /video|clip/i.test(name) ? 'video' : /audio/i.test(name) ? 'audio' : 'image'
    if (media && accept !== 'image' && !required) continue // only image slots in the prompt bar for now
    if (!media && (p.type === 'object' || (p.type === 'array' && p.items?.type === 'object'))) continue
    fields.push({
      name,
      type: p.type,
      ...(p.enum && { enum: p.enum }),
      // Opaque ids (ElevenLabs voices) get the names the docs list next to them: "EkK5… - James - Husky…".
      ...(p.enum?.some((v) => desc.includes(`${v} - `)) && {
        enumLabels: Object.fromEntries(p.enum.map((v) => [v, desc.match(new RegExp(`${v} - (.+?)(?: - |\\n|$)`))?.[1]?.trim() ?? v])),
      }),
      ...(p.default !== undefined && { default: p.default }),
      ...(media && { media: true, accept }),
      ...(p.maxItems && { maxItems: p.maxItems }),
      ...(p.minimum !== undefined && { min: p.minimum }),
      ...(p.maximum !== undefined && { max: p.maximum }),
      ...(required && { required: true }),
      description: desc.split('\n')[0].slice(0, 160),
      ...(name === 'duration' && !p.enum && durationChips(p, desc)),
      ...m.override?.[name],
    })
  }
  // Tags the model understands in its prompt, e.g. Kling 4.0's `@first_frame` or `@image_1` (used for @ mentions).
  const mainDesc = String((props.prompt ?? props.text)?.description ?? '')
  const tags = [...new Set([...mainDesc.matchAll(/`@([a-z][a-z_]*?\d*)`/g)].map((x) => x[1]))]
  const slug = body.model?.enum?.[0] ?? body.model?.default ?? m.slug ?? content.example?.model
  if (!slug) throw new Error(`${path}: no model name; add slug to its MODELS line`)
  return { path, slug, deprecated: !!ops.post.deprecated, fields, ...(m.fixed && { fixed: m.fixed }), ...(tags.length && { tags }) }
}

// kie's public price list (the table behind kie.ai/pricing), fetched once per sync.
async function priceRows() {
  const rows = []
  for (let page = 1; page < 20; page++) {
    const res = await fetch('https://api.kie.ai/client/v1/model-pricing/page', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageNum: page, pageSize: 100, modelDescription: '', interfaceType: '' }),
    })
    const data = (await res.json()).data
    rows.push(...data.records)
    if (page >= data.pages) return rows
  }
  return rows
}
const unitOf = (u) => (/second/.test(u) ? 'second' : /token|megapixel|minute|character/.test(u) ? 'other' : 'item')
let prices = []
try {
  prices = await priceRows()
} catch (e) {
  console.warn(`! Price list unavailable (${e.message}); new models keep their last prices.`)
}

const file = new URL('../src/shared/media-models.json', import.meta.url)
const previous = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []
const out = []
for (const m of MODELS) {
  const entry = { id: m.id, kind: m.kind, label: m.label, ...(m.hidden && { hidden: true }) }
  try {
    for (const k of ['text', 'image', 'tool']) if (m[k]) entry[k] = await spec(m[k], m)
  } catch (e) {
    const old = previous.find((p) => p.id === m.id)
    if (!old) throw e
    console.warn(`! ${m.label}: ${e.message}. Kept the last synced spec.`)
    out.push(old)
    continue
  }
  if (m.price) {
    const re = new RegExp(m.price, 'i')
    const rows = prices.filter((r) => re.test(r.modelDescription.trim()))
      .map((r) => ({ d: r.modelDescription.toLowerCase(), c: Number(r.creditPrice), u: unitOf(r.creditUnit) }))
    entry.prices = rows.length ? rows : previous.find((p) => p.id === m.id)?.prices ?? []
    if (!entry.prices.length) console.warn(`! ${m.label}: no price rows match ${m.price}`)
  }
  if ([entry.text, entry.image, entry.tool].some((v) => v?.deprecated)) console.warn(`! ${m.label} is marked deprecated in the docs`)
  out.push(entry)
  console.log(`✓ ${m.label}`)
}
writeFileSync(file, JSON.stringify(out, null, 2) + '\n')
