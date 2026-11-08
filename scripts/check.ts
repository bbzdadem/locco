// npm run check: every model builds a request and gets a price, and @ mentions turn into what each model understands.
import assert from 'node:assert/strict'
import { buildInput, fill, resolveMentions, slotsOf } from '../src/shared/inputs'
import { generators, isEleven, MEDIA_MODELS } from '../src/shared/models'
import { estimate, priceLabel } from '../src/shared/prices'
import { clipFor, timing } from '../src/shared/timing'
import type { Attachment, MediaKind } from '../src/shared/types'

const img = (file: string): Attachment => ({ kind: 'uploads', file, name: file, mime: 'image/png' })
const model = (id: string) => MEDIA_MODELS.find((m) => m.id === id)!
const credits = (id: string, input: Record<string, unknown>) => estimate(id, input)!

let unpriced = 0
for (const kind of ['image', 'video', 'audio'] as MediaKind[]) {
  for (const m of generators(kind)) {
    const plain = buildInput(m, {}, {})
    const framed = slotsOf(m).length ? buildInput(m, {}, fill({}, slotsOf(m), [img('a.png'), img('b.png')])) : null
    const price = (input: Record<string, unknown>) => priceLabel(estimate(m.id, input, 100)) || 'no price'
    if (!estimate(m.id, plain.input, 100) && !isEleven(m.id)) unpriced++
    console.log(
      `${kind.padEnd(5)} ${m.label.padEnd(28)} ${m.text ? price(plain.input).padEnd(34) : 'needs an image'.padEnd(34)}` +
        (framed ? ` with images: ${price(framed.input)}${framed.missing ? ' (missing a slot)' : ''}` : ''),
    )
  }
}

// Prices narrowed from kie's list by the chosen settings.
assert.equal(credits('kling-2-6', { duration: '5', sound: false }).hi, 63)
assert.equal(credits('kling-2-6', { duration: '10', sound: true }).hi, 252)
assert.equal(credits('kling-3-turbo', { duration: '10', resolution: '1080p' }).hi, 252)
assert.equal(credits('seedance-1-lite', { duration: '5', resolution: '480p' }).hi, 10)
assert.equal(credits('imagen-4-fast', {}).hi, 4)
assert.equal(credits('flux-3-klein', { resolution: '2K' }).hi, 2.5)
assert.equal(credits('gpt-image-1-5', { quality: 'high' }).hi, 22)
// Hand-checked prices still win.
assert.equal(credits('nano-banana-pro', { resolution: '4K' }).hi, 24)

// One request makes one result: models that default to several (Wan 2.7 Image makes 4, all billed) are pinned to 1.
for (const m of MEDIA_MODELS) for (const sp of [m.text, m.image]) {
  if (!sp) continue
  const count = sp.fields.find((f) => /^(n|num_images|number_of_images|num_outputs)$/.test(f.name))
  assert.ok(!count || count.default === undefined || Number(count.default) === 1, `${m.id} would make ${count?.default} results per request`)
  assert.ok(!count || count.default !== undefined || sp.fixed?.[count.name] !== undefined || /default: ?1\b/.test(count.description), `${m.id}: ${count?.name} has no default; pin it in fixed`)
}

// Series: a scene runs as long as its dialogue (plus short pauses), and the clip asked for is the shortest that covers it.
assert.deepEqual(timing({ lines: [] }), { voices: [], seconds: 3 })
const two = timing({ lines: [{ speaker: 'A', text: '', seconds: 2 }, { speaker: 'B', text: '', seconds: 1.5 }] })
assert.deepEqual(two.voices.map((v) => +v.toFixed(2)), [0.3, 2.65])
assert.equal(+two.seconds.toFixed(2), 4.8)
assert.equal(clipFor([5, 10, 15], 4.8), 5)
assert.equal(clipFor([6, 10, 15], 11), 15)
assert.equal(clipFor([5, 10], 20), 10)

// @ mentions
const a = img('a.png'), b = img('b.png')
assert.equal(resolveMentions('from @img1 to @img2', model('kling-4-keyframes'), { first_frame_url: [a], last_frame_url: [b] }), 'from @first_frame to @last_frame')
assert.equal(resolveMentions('@img2 wears @img1', model('kling-4-reference'), { image_urls: [a, b] }), '@image_2 wears @image_1')
assert.equal(resolveMentions('put @img2 on @img1', model('nano-banana-pro'), { image_input: [a, b] }), 'put image 2 on image 1')
assert.equal(resolveMentions('fade @img1 into @img2', model('wan-2-7'), { first_frame_url: [a], last_frame_url: [b] }), 'fade the start frame into the end frame')
assert.equal(resolveMentions('@img9 stays', model('nano-banana-pro'), { image_input: [a] }), '@img9 stays')

console.log(`\nAll checks passed. ${generators('image').length + generators('video').length + generators('audio').length} models, ${unpriced} without a price.`)
