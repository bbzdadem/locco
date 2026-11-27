// npm run check: every model builds a request and gets a price, and @ mentions turn into what each model understands.
import assert from 'node:assert/strict'
import { buildInput, fill, resolveMentions, slotLabel, slotsOf, type Refs } from '../src/shared/inputs'
import { generators, isEleven, MEDIA_MODELS } from '../src/shared/models'
import { estimate, priceLabel } from '../src/shared/prices'
import { clipFor, clipLength, split, starts, timing } from '../src/shared/timing'
import { atempo, audible, duration, EDIT_VERSION, keyAt, overlap, setKeyed, sizeOf, toggleKey, valueAt, itemLength, layout, litWord, MAIN, removeItems, snap, splitAt, splitClip, toFrame, upgrade } from '../src/shared/timeline'
import type { Attachment, Item, MediaKind } from '../src/shared/types'

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
assert.equal(credits('minimax-h3-reference', { duration: '5', resolution: '768P' }).hi, 40)
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

// Editor: clip length counts trim, speed and held frames; splitting moves later voices to the second part.
const clip = { id: 'a', sceneId: 's', in: 1, out: 7, speed: 1.25, pan: 0, zoom: 1, hold: 0.5, sound: false, voices: [{ line: 0, at: 0.3 }, { line: 1, at: 3 }] }
assert.equal(clipLength(clip), 5.3)
assert.deepEqual(starts([clip, { ...clip, speed: 1, hold: 0 }]), { at: [0, 5.3], total: 11.3 })
const parts = split(clip, 4, 'b')!
assert.deepEqual([parts[0].out, parts[0].hold, parts[0].voices.length], [4, 0, 1])
assert.deepEqual([parts[1].in, parts[1].hold, parts[1].voices], [4, 0.5, [{ line: 1, at: 0.6 }]])
assert.equal(split(clip, 1.05, 'c'), null)

// Video editor: lengths, back-to-back main track, splitting (inside the clip and inside a held frame), snapping.
const vid = { id: 'v', track: MAIN, start: 0, label: '', media: 'video' as const, in: 1, out: 5, speed: 2, hold: 1 }
assert.equal(itemLength(vid), 3)
const proj = layout({ id: 'p', title: '', aspect: '9:16', imports: [], exports: [], createdAt: 0, tracks: [],
  items: [vid, { id: 'i', track: MAIN, start: 99, label: '', media: 'image', duration: 2 }, { id: 'a', track: 'a1', start: 7, label: '', media: 'audio', in: 0, out: 1 }] })
assert.deepEqual(proj.items.map((it) => it.start), [0, 3, 7])
assert.equal(duration(proj), 8)
const [p1, p2] = splitAt(vid, 1, 'w')!
assert.deepEqual([p1.out, p2.in, p2.start, itemLength(p1) + itemLength(p2)], [3, 3, 1, 3])
const [h1, h2] = splitAt(vid, 2.5, 'h')!
assert.deepEqual([h1.hold, h2.in, h2.hold, itemLength(h2)], [0.5, 5, 0.5, 0.5])
assert.equal(splitAt(vid, 0.02, 'x'), null)
assert.equal(snap(4.93, [0, 5, 9], 0.2), 5)
assert.equal(snap(4.5, [0, 5, 9], 0.2), 4.5)

// Deleting the 2-5 s clip closes its gap: other tracks keep everything, uncut; what started inside moves to 2, later items move up.
const cut = layout({ id: 'c', title: '', aspect: '9:16', imports: [], exports: [], createdAt: 0, tracks: [], items: [
  { id: 'm1', track: MAIN, start: 0, label: '', media: 'image', duration: 2 }, { id: 'm2', track: MAIN, start: 0, label: '', media: 'image', duration: 3 },
  { id: 'm3', track: MAIN, start: 0, label: '', media: 'image', duration: 4 },
  { id: 'in', track: 't', start: 2.5, label: '', text: 'x', duration: 1 }, { id: 'across', track: 't', start: 1, label: '', text: 'x', duration: 6 },
  { id: 'head', track: 'a', start: 4, label: '', media: 'audio', in: 0, out: 3 }, { id: 'after', track: 'a', start: 6, label: '', media: 'audio', in: 0, out: 1 },
  { id: 'music', track: 'a', start: 0, label: '', media: 'audio', in: 0, out: 9 }] })
removeItems(cut, ['m2'])
const by = (id: string) => cut.items.find((it) => it.id === id)
assert.deepEqual([by('in')!.start, by('in')!.duration], [2, 1])
assert.deepEqual([by('across')!.start, by('across')!.duration], [1, 6])
assert.deepEqual([by('head')!.start, by('head')!.in, itemLength(by('head')!)], [2, 0, 3])
assert.equal(by('after')!.start, 3)
assert.deepEqual([by('music')!.start, itemLength(by('music')!)], [0, 9])
assert.equal(layout(cut).items.filter((it) => it.track === MAIN).map((it) => it.start).join(), '0,2')
// Links: what's linked to a clip moves when it moves and is cut with it; deleting the clip unlinks and keeps it.
const vref = { kind: 'media' as const, file: 'x.mp4' }
const clipA = { id: 'A', track: MAIN, start: 0, label: 'A', media: 'video' as const, ref: vref, in: 0, out: 2, speed: 1 }
const clipB = { id: 'B', track: MAIN, start: 2, label: 'B', media: 'video' as const, ref: vref, in: 0, out: 3, speed: 1 }
const line = { id: 'v', track: 'au', start: 2.5, label: 'v', media: 'audio' as const, ref: vref, in: 0, out: 2, link: 'B' }
const free = { id: 'f', track: 'au2', start: 2.5, label: 'f', media: 'audio' as const, ref: vref, in: 0, out: 1 }
const linked = layout({ id: 'l', version: 1, fps: 30, title: '', aspect: '9:16', imports: [], exports: [], createdAt: 0, tracks: [], items: [clipA, clipB, line, free] })
// B moved first: its voice comes along (still 0.5 s into B), the unlinked sound stays.
const swapped = layout({ ...linked, items: [linked.items[1], linked.items[0], ...linked.items.slice(2)] })
assert.deepEqual(swapped.items.map((it) => it.start), [0, 3, 0.5, 2.5])
// Cutting B at 3.5 cuts its voice there too; the second half of the voice follows the second half of B.
const cutB = structuredClone(linked)
let n = 0
assert.ok(splitClip(cutB, 'B', 3.5, () => `n${n++}`))
assert.deepEqual(cutB.items.filter((it) => it.track === 'au').map((it) => [it.start, it.link]), [[2.5, 'B'], [3.5, 'n0']])
// Deleting B keeps its voice, now unlinked, and the free sound; both move to where B was.
const noB = structuredClone(linked)
removeItems(noB, ['B'])
assert.deepEqual(noB.items.map((it) => [it.id, it.start, it.link]), [['A', 0, undefined], ['v', 2, undefined], ['f', 2, undefined]])
// A sound has no held frame: splitting one never gives it one.
const [s1, s2] = splitAt(line, 3, 's')!
assert.ok(!('hold' in s1) && !('hold' in s2))
// Word-by-word captions: one item, words timed from its start; cutting it gives each half its words.
const cap = { id: 'c', track: 't', start: 10, label: 'Caption', text: 'one two three', duration: 1.5, words: [{ text: 'one', start: 0, end: 0.4 }, { text: 'two', start: 0.5, end: 0.9 }, { text: 'three', start: 1, end: 1.4 }] }
assert.deepEqual([litWord(cap.words, 0), litWord(cap.words, 0.45), litWord(cap.words, 0.5), litWord(cap.words, 1.4)], [0, 0, 1, 2])
const [c1, c2] = splitAt(cap, 10.7, 'c2') as [typeof cap, typeof cap]
assert.deepEqual([c1.text, c2.text, c2.words[0].start, c2.words.length], ['one two', 'three', 0.3, 1])
assert.equal(toFrame(4.933, 30), 148 / 30)
// Upgrading a project saved before versions: a frame rate, and one item per caption instead of one per word.
const old = upgrade({ id: 'o', title: '', aspect: '9:16', imports: [], exports: [], createdAt: 0, tracks: [], items: [
  { id: 'w0', track: 't', start: 1, label: 'Caption', text: 'hi there', style: 'caption', hl: 0, y: 0.68, duration: 0.5 },
  { id: 'w1', track: 't', start: 1.5, label: 'Caption', text: 'hi there', style: 'caption', hl: 1, y: 0.68, duration: 0.6 },
  { id: 'w2', track: 't', start: 2.2, label: 'Caption', text: 'bye', style: 'caption', hl: 0, y: 0.68, duration: 0.4 },
  { id: 'v0', track: MAIN, start: 0, label: 'clip', media: 'video', ref: vref, in: 0, out: 2 }] })
assert.deepEqual([old.version, old.fps], [EDIT_VERSION, 30])
assert.deepEqual(old.items.map((it) => it.id), ['w0', 'w2', 'v0'])
assert.deepEqual(old.items[0].words, [{ text: 'hi', start: 0, end: 0.5 }, { text: 'there', start: 0.5, end: 1.1 }])
assert.equal(old.items[0].duration, 1.1)
assert.ok(!('hl' in old.items[0]) && !('hl' in old.items[1]))
assert.equal(old.items[2].speed, 1)
// Upgrading is safe to run again.
assert.deepEqual(upgrade(old), old)
// Export sizes: 1080p by default, 720p and 4K on request, for every shape.
assert.deepEqual([sizeOf('9:16'), sizeOf('4:5'), sizeOf('4:5', '720p'), sizeOf('9:16', '2160p'), sizeOf('16:9', '2160p')], [[1080, 1920], [1080, 1350], [720, 900], [2160, 3840], [3840, 2160]])
// Crossfades: the clip fading in overlaps the one before by the fade's length (at most half of either), so the video is
// that much shorter; other transitions don't move anything.
const fadeProj = layout({ id: 'x', version: 2, fps: 30, title: '', aspect: '9:16', imports: [], exports: [], createdAt: 0, tracks: [], items: [
  { ...clipA, id: 'f1', out: 3 }, { ...clipB, id: 'f2', start: 0, transition: { type: 'fade' as const, seconds: 1 } }, { ...clipA, id: 'f3', start: 0, transition: { type: 'black' as const, seconds: 0.2 } }] })
assert.deepEqual(fadeProj.items.map((it) => it.start), [0, 2, 5])
assert.equal(overlap({ ...clipA, out: 0.6 }, { ...clipB, transition: { type: 'fade', seconds: 1 } }), 0.3)
// Keyframes: straight lines between keys, held outside them; the slider sets the key at the playhead, the diamond adds
// or removes one; cutting an item keeps the value at the cut on both sides.
const ks = [{ t: 1, v: 0 }, { t: 3, v: 1 }]
assert.deepEqual([valueAt(ks, 0, 9), valueAt(ks, 2, 9), valueAt(ks, 5, 9), valueAt(undefined, 2, 9)], [0, 0.5, 1, 9])
const fadingIn = { ...clipA, id: 'k', out: 4 } as Item
let plain = 0
setKeyed(fadingIn, 'volume', 1, 0.7, (v) => (plain = v))
assert.deepEqual([plain, fadingIn.keys], [0.7, undefined])
toggleKey(fadingIn, 'volume', 0, 0.2)
toggleKey(fadingIn, 'volume', 2, 1)
setKeyed(fadingIn, 'volume', 2, 0.8, () => {})
assert.deepEqual(fadingIn.keys!.volume, [{ t: 0, v: 0.2 }, { t: 2, v: 0.8 }])
assert.ok(keyAt(fadingIn.keys!.volume, 2.01))
const [kA, kB] = splitAt(fadingIn, 1, 'k2')!
assert.deepEqual([kA.keys!.volume!.at(-1), kB.keys!.volume![0], kB.keys!.volume![1]], [{ t: 1, v: 0.5 }, { t: 0, v: 0.5 }, { t: 1, v: 0.8 }])
toggleKey(fadingIn, 'volume', 0, 0)
toggleKey(fadingIn, 'volume', 2, 0)
assert.equal(fadingIn.keys, undefined)
// A reversed clip's first part is the end of its footage; the second part never repeats the transition into the clip.
const back = { ...clipA, out: 4, reverse: true, transition: { type: 'black' as const, seconds: 0.2 } }
const [r1, r2] = splitAt(back, 1, 'r2')!
assert.deepEqual([r1.in, r1.out, r2.in, r2.out, r2.transition], [3, 4, 0, 3, undefined])
// A sped-up sound is shorter, and cut where its sped-up footage is.
const fast = { ...line, out: 4, speed: 2 }
assert.equal(itemLength(fast), 2)
assert.equal(splitAt(fast, 3.5, 'q')![0].out, 2)
// Solo: when any track is soloed, only soloed tracks are heard; otherwise every track not muted.
const solo = { ...linked, tracks: [{ id: 'au', kind: 'audio' as const, name: 'a', solo: true }, { id: 'au2', kind: 'audio' as const, name: 'b' }, { id: 'au3', kind: 'audio' as const, name: 'c', muted: true }] }
assert.deepEqual([audible(solo, 'au'), audible(solo, 'au2'), audible({ ...solo, tracks: solo.tracks.slice(1) }, 'au2'), audible({ ...solo, tracks: solo.tracks.slice(1) }, 'au3')], [true, false, true, false])
// Upgrading from 1: a transition gets its length, an export becomes a record.
const v1 = upgrade({ ...linked, version: 1, exports: ['a.mp4'], createdAt: 5, items: [{ ...clipA, transition: 'zoom' }] })
assert.deepEqual([v1.version, v1.items[0].transition, v1.exports], [EDIT_VERSION, { type: 'zoom', seconds: 0.3 }, [{ file: 'a.mp4', at: 5 }]])
// Slow clips chain atempo, which only goes down to 0.5×.
assert.equal(atempo(1.25), 'atempo=1.25')
assert.equal(atempo(0.25), 'atempo=0.5,atempo=0.5')
assert.equal(atempo(0.1), 'atempo=0.5,atempo=0.5,atempo=0.5,atempo=0.8')

// @ mentions
const a = img('a.png'), b = img('b.png')
assert.equal(resolveMentions('from @img1 to @img2', model('kling-4-keyframes'), { first_frame_url: [a], last_frame_url: [b] }), 'from @first_frame to @last_frame')
assert.equal(resolveMentions('@img2 wears @img1', model('kling-4-reference'), { image_urls: [a, b] }), '@image_2 wears @image_1')
assert.equal(resolveMentions('put @img2 on @img1', model('nano-banana-pro'), { image_input: [a, b] }), 'put image 2 on image 1')
assert.equal(resolveMentions('fade @img1 into @img2', model('minimax-h3'), { first_frame_url: [a], last_frame_url: [b] }), 'fade the start frame into the end frame')
assert.equal(resolveMentions('@img9 stays', model('nano-banana-pro'), { image_input: [a] }), '@img9 stays')

// Frames or references (Seedance 2.x, Wan 3.0, Gemini Omni Flash): one image is the start frame, two become references,
// filling one mode by hand empties the other, and files only go into slots that take their kind.
const sd = slotsOf(model('seedance-2'))
assert.deepEqual(Object.entries(fill({}, sd, [a])).filter(([, v]) => v.length).map(([k]) => k), ['first_frame_url'])
const two2 = fill({}, sd, [a, b])
assert.deepEqual([two2.first_frame_url, two2.last_frame_url, two2.reference_image_urls], [undefined, undefined, [a, b]])
assert.deepEqual(fill(fill({}, sd, [a]), sd, [b]).reference_image_urls, [a, b])
const ended = fill(two2, sd, [b], 'last_frame_url')
assert.deepEqual([ended.reference_image_urls, ended.last_frame_url], [undefined, [b]])
assert.deepEqual(fill({}, slotsOf(model('kling-4-keyframes')), [a, b]).first_frame_url, [a]) // keyframes aren't references
const voice: Attachment = { kind: 'uploads', file: 'v.mp3', name: 'v.mp3', mime: 'audio/mpeg' }
const av = fill({}, slotsOf(model('kling-avatar')), [voice, a])
assert.deepEqual([av.image_url, av.audio_url], [[a], [voice]])
const mo = fill({}, slotsOf(model('kling-motion')), [{ kind: 'uploads', file: 'm.mp4', name: 'm.mp4', mime: 'video/mp4' }, a])
assert.deepEqual([mo.input_urls?.[0].file, mo.video_urls?.[0].file], ['a.png', 'm.mp4'])
assert.equal(slotLabel(slotsOf(model('kling-motion')).find((f) => f.accept === 'video')!, 'video'), 'Motion video')

// Reference videos: a video makes it references (the start frame moves over), and kie's "with video input" rate applies,
// over the clip's seconds too on Seedance 2.x.
const refClip: Attachment = { kind: 'uploads', file: 'c.mp4', name: 'c.mp4', mime: 'video/mp4' }
const sv = fill(fill({}, sd, [a]), sd, [refClip])
assert.deepEqual([sv.first_frame_url, sv.reference_image_urls, sv.reference_video_urls], [undefined, [a], [refClip]])
assert.equal(slotLabel(sd.find((f) => f.name === 'reference_video_urls')!, 'video'), 'Reference videos')
const sdIn = (refs: Refs) => buildInput(model('seedance-2'), { resolution: '720p', duration: '5' }, refs).input
assert.equal(credits('seedance-2', sdIn({ reference_image_urls: [a] })).hi, 41 * 5)
assert.equal(estimate('seedance-2', sdIn(sv), 0, 4)!.hi, 25 * 9)
const ko = buildInput(model('kling-3-omni-video'), { resolution: '1080p', duration: '5' }, { image_urls: [a], video_urls: [refClip] })
assert.deepEqual([ko.missing, estimate('kling-3-omni-video', ko.input, 0, 4)!.hi], [undefined, 30.2 * 5])

// Settings kie turns down together are changed, with a note.
const hai = buildInput(model('hailuo-2-3'), { duration: '10', resolution: '1080P' }, { image_url: [a] })
assert.deepEqual([hai.input.resolution, hai.notes.length], ['768P', 1])
const veo = buildInput(model('veo-3-1'), { duration: '4' }, { image_urls: [a, b, a] })
assert.equal(veo.input.duration, '8')
const grok = buildInput(model('grok-imagine'), { mode: 'spicy', resolution: '1080p' }, { image_urls: [a, b] })
assert.deepEqual([grok.input.mode, grok.input.resolution], ['normal', '720p'])
assert.deepEqual(buildInput(model('grok-imagine'), { mode: 'spicy' }, {}).notes, [])

console.log(`\nAll checks passed. ${generators('image').length + generators('video').length + generators('audio').length} models, ${unpriced} without a price.`)
