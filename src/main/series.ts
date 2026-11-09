// Short series: the character library, the writers (bible, script, revisions, recaps) and the voice-timed cut.
// The renderer owns the documents (it's the only writer); this file stores them and does the work it can't.
import { app } from 'electron'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { AD_FORMATS, adShots, formatOf, HOOKS } from '../shared/ads'
import { ELEVEN_VOICES } from '../shared/models'
import { clipLength, sceneTarget } from '../shared/timing'
import type { Attachment, Character, Episode, Ref, RenderRequest, Scene, Series, ShotPlan } from '../shared/types'
import { complete } from './chat'
import { db, dirs } from './db'
import { pathOf } from './media'
import { getTask } from './tasks'

export const run = promisify(execFile)
const WRITER = 'gpt-6-sol'
const DAY = 86_400_000

// --- Characters ---

export const listCharacters = () =>
  (db.prepare('SELECT data FROM characters ORDER BY updated_at DESC').all() as { data: string }[]).map((r) => JSON.parse(r.data) as Character)
export const saveCharacter = (c: Character) =>
  void db.prepare('INSERT INTO characters (id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
    .run(c.id, JSON.stringify(c), Date.now())
export const deleteCharacter = (id: string) => void db.prepare('DELETE FROM characters WHERE id = ?').run(id)
const charactersById = (ids: string[]) => listCharacters().filter((c) => ids.includes(c.id))

// --- Series ---

// Series made before the redesign kept their characters inside and had "shots": move the characters to the library
// and turn shots into finished, approved scenes.
function migrate(raw: any): Series {
  if (!raw.characters && raw.cast) return raw
  for (const c of raw.characters ?? []) if (!listCharacters().some((x) => x.id === c.id)) saveCharacter({ ...c, createdAt: raw.createdAt ?? Date.now() })
  const s: Series = {
    ...raw, cast: (raw.characters ?? []).map((c: Character) => c.id), continuity: raw.continuity ?? '',
    episodes: raw.episodes.map((e: any): Episode => ({
      id: e.id, title: e.title, summary: e.summary, cut: e.cut, musicTask: e.musicTask, music: true,
      step: e.cut ? 'cut' : e.shots?.length ? 'scenes' : 'script',
      scenes: (e.shots ?? []).map((sh: any): Scene => ({
        id: sh.id, place: '', action: sh.description, camera: sh.camera, approved: !!sh.frameTask,
        cast: (raw.characters ?? []).filter((c: Character) => sh.speaker === c.name || sh.description.includes(c.name)).map((c: Character) => c.name),
        lines: sh.line ? [{ speaker: sh.speaker, text: sh.line, voiceTask: sh.voiceTask }] : [], frameTask: sh.frameTask, videoTask: sh.videoTask,
      })),
    })),
  }
  delete (s as any).characters
  saveSeries(s)
  return s
}
export const listSeries = () =>
  (db.prepare('SELECT data FROM series WHERE deleted_at IS NULL ORDER BY updated_at DESC').all() as { data: string }[]).map((r) => migrate(JSON.parse(r.data)))
// Saving never brings a deleted series back (an episode still being made keeps saving into it).
export const saveSeries = (s: Series) =>
  void db.prepare('INSERT INTO series (id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
    .run(s.id, JSON.stringify(s), Date.now())
// Deleted series stay restorable for 30 days, then they're removed for good.
export const deleteSeries = (id: string) => void db.prepare('UPDATE series SET deleted_at = ? WHERE id = ?').run(Date.now(), id)
export const restoreSeries = (id: string) => void db.prepare('UPDATE series SET deleted_at = NULL WHERE id = ?').run(id)
export function deletedSeries() {
  db.prepare('DELETE FROM series WHERE deleted_at < ?').run(Date.now() - 30 * DAY)
  return (db.prepare('SELECT data, deleted_at FROM series WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC').all() as { data: string; deleted_at: number }[])
    .map((r) => ({ series: migrate(JSON.parse(r.data)), deletedAt: r.deleted_at }))
}

// --- Writers (GPT 6 Sol, JSON replies) ---

// Models wrap JSON in prose or code fences now and then; take the outermost object.
function json<T>(text: string): T {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('The writer didn’t send back a usable answer. Try again.')
  return JSON.parse(text.slice(start, end + 1))
}
const voiceId = (name?: string) => ELEVEN_VOICES.find((v) => v.name.toLowerCase() === String(name ?? '').trim().toLowerCase())?.id
const voiceList = () => ELEVEN_VOICES.slice(0, 60).map((v) => (v.about ? `${v.name} (${v.about})` : v.name)).join('; ') || 'none (leave voice empty)'
const castText = (cast: Character[]) => cast.map((c) => `${c.name}: ${c.personality}. Looks: ${c.look}`).join('\n') || 'none yet'
const elementText = (els: Character[]) => els.map((e) => `${e.name} (${e.category ?? 'thing'}): ${e.look}`).join('\n') || 'none yet'

const str = (v: unknown) => String(v ?? '').trim()
function planFrom(p: any): ShotPlan | undefined {
  if (!p || typeof p !== 'object') return undefined
  return { shot: str(p.shot), beats: str(p.beats), performance: str(p.performance), move: str(p.move), environment: str(p.environment), sound: str(p.sound),
    ...(str(p.text) && { text: str(p.text) }), ...(str(p.transition) && { transition: str(p.transition) }) }
}
// A shot whose plan has only on-screen text (an ad writer's hook text) still waits for the director: see planned().
const textOnly = (text: string): ShotPlan => ({ shot: '', beats: '', performance: '', move: '', environment: '', sound: '', text })
const planned = (sc: Scene) => !!sc.plan?.shot
function scenesFrom(out: { scenes?: any[] }): Scene[] {
  return (out.scenes ?? []).slice(0, 15).map((x) => {
    const plan = planFrom(x.plan) ?? (str(x.text) ? textOnly(str(x.text)) : undefined)
    return {
      id: randomUUID(), place: str(x.place), action: str(x.action), camera: str(x.camera) || (plan ? [plan.shot, plan.move].filter(Boolean).join('; ') : ''),
      cast: Array.isArray(x.cast) ? x.cast.map(String) : [],
      lines: (Array.isArray(x.lines) ? x.lines : []).slice(0, 2).map((l: any) => ({ speaker: str(l.speaker), text: str(l.text) })).filter((l: any) => l.text),
      ...(HOOKS.includes(str(x.hook)) && { hook: str(x.hook) }),
      ...(Number(x.seconds) > 0 && { seconds: Math.min(4, Math.max(1.2, Number(x.seconds))) }),
      ...(plan && { plan }),
    }
  })
}

// Scripts are written by the series' writer (Claude Sonnet 5.5 unless chosen otherwise), thinking hard. If Claude can't be
// reached after its retries, GPT 6 Sol writes instead, so a script always arrives; `by` says who wrote it.
const writerOf = (s: Series) => s.writer ?? 'claude-sonnet-5-5'
// When kie's Claude fails (it has outages), skip it for 10 minutes instead of spending ~20 s of retries on every call.
let claudeDownUntil = 0
let claudeWhy = ''
async function write(s: Series, system: string, user: string) {
  const first = writerOf(s)
  const skip = first !== 'gpt-6-sol' && Date.now() < claudeDownUntil
  if (!skip) {
    try {
      return { text: await complete(first, system, user, undefined, [], true), by: first }
    } catch (e) {
      if (first === 'gpt-6-sol') throw e
      claudeDownUntil = Date.now() + 10 * 60_000
      claudeWhy = String((e as Error).message).slice(0, 120)
    }
  }
  return { text: await complete('gpt-6-sol', system, user, undefined, [], true), by: `gpt-6-sol|${claudeWhy}` }
}

// Runs jobs a few at a time (kie and the writers handle a handful of parallel calls well).
async function pool<T>(jobs: (() => Promise<T>)[], size: number) {
  const out: T[] = []
  let next = 0
  await Promise.all(Array.from({ length: Math.min(size, jobs.length) }, async () => {
    while (next < jobs.length) {
      const i = next++
      out[i] = await jobs[i]()
    }
  }))
  return out
}

// The series bible: title, look, episode outlines, and any characters the story needs beyond the chosen cast
// (those are saved to the library too, so every character built is kept).
export async function writeSeries(idea: string, episodes: number, seconds: number, castIds: string[], style: { text?: string; refs?: Attachment[] } = {}, elementIds: string[] = []):
  Promise<{ series: Series; created: Character[] }> {
  const cast = charactersById(castIds)
  const elements = charactersById(elementIds)
  const refs = (style.refs ?? []).slice(0, 3)
  const out = json<any>(await complete(WRITER, [
    `You are the showrunner of a vertical short-form series (9:16, about ${seconds}-second episodes, for TikTok and Reels).`,
    'From the idea, write the series bible. Reply with JSON only:',
    '{"title": "...", "logline": "one sentence", "style": "the visual style every scene shares: palette, light, lens, film look (1-2 sentences)",',
    ' "continuity": "the ground rules of this world and its characters that every episode must respect (short bullet lines)",',
    ' "new_characters": [{"name": "...", "look": "precise visual description an image model can repeat: age, face, skin, hair, build, clothes",',
    '   "personality": "...", "voice": "one voice name from the list"}],',
    ' "new_elements": [{"name": "short name, e.g. The Lighthouse", "category": "place, prop, creature or other", "look": "precise visual description an image model can repeat"}],',
    ` "episodes": [{"title": "...", "summary": "2-3 sentences: a hook in the first seconds, a clear turn, a punchline or cliffhanger; episodes build on each other"}]}`,
    `Write exactly ${episodes} episodes. The cast below is fixed; add new_characters only if the story truly needs them (0 to 3).`,
    `Cast:\n${castText(cast)}`,
    `Recurring places and things already chosen:\n${elementText(elements)}`,
    'Add new_elements (0 to 3) only for places or things that recur across episodes and must look the same every time.',
    `Voices to choose from (name only): ${voiceList()}.`,
    style.text && `The look is chosen: ${style.text} Build the "style" field on it.`,
    refs.length && `The ${refs.length} attached image${refs.length > 1 ? 's are' : ' is a'} style reference${refs.length > 1 ? 's' : ''}: describe their art style, rendering, palette and lighting in "style" (not what they show).`,
    "Write in the language of the user's idea.",
  ].filter(Boolean).join('\n'), idea, undefined, refs))
  const created: Character[] = (out.new_characters ?? []).map((c: any) => ({
    id: randomUUID(), name: String(c.name ?? ''), look: String(c.look ?? ''), personality: String(c.personality ?? ''), voice: voiceId(c.voice), createdAt: Date.now(),
  }))
  const createdElements: Character[] = (out.new_elements ?? []).slice(0, 3).map((e: any) => ({
    id: randomUUID(), kind: 'element', name: String(e.name ?? ''), look: String(e.look ?? ''), personality: '',
    category: ['place', 'prop', 'creature'].includes(e.category) ? e.category : 'other', createdAt: Date.now(),
  }))
  created.push(...createdElements)
  created.forEach(saveCharacter)
  return {
    created,
    series: {
      id: randomUUID(), title: String(out.title ?? 'Untitled series'), idea, logline: String(out.logline ?? ''), style: String(out.style ?? ''),
      seconds, imageModel: 'gpt-image-2', videoModel: 'kling-3', videoSound: false, styleRefs: refs,
      cast: [...cast, ...created.filter((c) => !c.kind)].map((c) => c.id), elements: [...elements, ...createdElements].map((e) => e.id), continuity: String(out.continuity ?? ''),
      episodes: (out.episodes ?? []).map((e: any) => ({ id: randomUUID(), title: String(e.title ?? ''), summary: String(e.summary ?? ''), step: 'script', scenes: [], music: true })),
      createdAt: Date.now(),
    },
  }
}

const isAd = (s: Series) => s.kind === 'ad'
// Ads are always written in English, whatever language the product's description or label is in.
const ENGLISH = 'Write everything in English, even when the description, brief or product label is in another language; quote label text exactly as printed.'
const languageOf = (s: Series) => (isAd(s) ? ENGLISH : 'Write in the language of the series.')
const adContext = (s: Series, index: number) => {
  const product = charactersById([s.product ?? ''])[0]
  return [
    `Product: ${product?.name ?? s.title}. Looks: ${product?.look ?? ''}`,
    `Angle: ${s.logline}`,
    `Product brief (facts every ad must respect):\n${s.continuity || 'none'}`,
    `Look of every shot: ${s.style}`,
    `People who can appear:\n${castText(charactersById(s.cast))}`,
    `Places and props (name them exactly when they appear, so they look the same):\n${elementText(charactersById((s.elements ?? []).filter((id) => id !== s.product)))}`,
    `The other ads for this product (this one needs a different hook and angle):\n${s.episodes.filter((_, i) => i !== index).map((e) => `- ${e.title}${formatOf(e.format) ? ` (${formatOf(e.format)!.name})` : ''}: ${e.summary}`).join('\n') || 'none'}`,
  ].join('\n\n')
}
// A product's ads: the product brief, the product as an element (from your photo), people and places, and the ads to make.
// A saved product (id) is used as it is: its name, look, photos and picked image; otherwise one is made from the photos.
export async function writeAds(product: { description: string; photos: Attachment[]; id?: string }, ads: number, seconds: number, castIds: string[], elementIds: string[]):
  Promise<{ series: Series; created: Character[] }> {
  const cast = charactersById(castIds)
  const elements = charactersById(elementIds)
  const saved = product.id ? charactersById([product.id])[0] : undefined
  if (product.id && !saved) throw new Error('That product is no longer in Elements.')
  const picked = saved?.portraitTask && getTask(saved.portraitTask)?.files[0]
  const photos = saved
    ? [saved.photo, ...(saved.photos ?? []), picked ? { kind: 'media' as const, file: picked, name: picked, mime: 'image/png' } : undefined].filter((p): p is Attachment => !!p).slice(0, 5)
    : product.photos.slice(0, 4)
  const description = product.description.trim() || saved?.look || ''
  const out = json<any>(await complete(WRITER, [
    'You are the creative strategist for organic TikTok/Reels product videos (the dropshipping style: filmed on a phone by real people, never like a commercial).',
    `From the product description${photos.length > 1 ? ' and the attached photos (the same product from different sides)' : photos.length ? ' and the attached photo' : ''}, write the product brief and plan the ads. Reply with JSON only:`,
    saved && `The product is already saved as "${saved.name}". Looks: ${saved.look} Use that name in the ads; leave "name" and "look" empty.`,
    '{"name": "the product\'s short name, as shots will mention it (2-3 words)",',
    ' "look": "a precise visual description of the product an image model can repeat: shape, size, colours, materials, finish, parts, logo and label text exactly as printed",',
    ' "logline": "the angle in one sentence: who it is for and what it does for them",',
    ' "brief": "short bullet lines: Buyer (who, their situation); Problem (in their words); The moment it works (what we see on camera); Proof we can show; Objections and answers; Price or offer if given; Never claim (what we must not say)",',
    ' "style": "the look of every shot: real phone footage, the kind of home, light and colour that suit this product and buyer (1-2 sentences)",',
    ' "new_characters": [{"name": "...", "look": "precise visual description: age, face, skin, hair, build, clothes", "personality": "...", "voice": "one voice name from the list"}],',
    ' "new_elements": [{"name": "short name, e.g. The Kitchen", "category": "place or prop", "look": "precise visual description"}],',
    ' "ads": [{"title": "...", "format": "a format id", "summary": "2-3 sentences: the hook (with its on-screen text), the moment the product works on camera, the payoff and the call to action"}]}',
    `Plan exactly ${ads} ads of about ${seconds} seconds, each with a different format and hook family. Formats (id: what it is):\n${AD_FORMATS.map((f) => `${f.id}: ${f.beats}`).join('\n')}`,
    `People already chosen:\n${castText(cast)}`,
    'Add new_characters (0 to 2) only if the ads need people (someone presenting, reacting, or using it); make them ordinary, believable people the buyer would trust.',
    `Places and props already chosen:\n${elementText(elements)}`,
    'Add new_elements (0 to 2) only for places or props that recur across the ads (the kitchen, the car).',
    `Voices to choose from (name only): ${voiceList()}.`,
    ENGLISH,
  ].filter(Boolean).join('\n'), description, undefined, photos))
  const item: Character = saved ?? {
    id: randomUUID(), kind: 'element', category: 'product', name: str(out.name) || 'The product', look: str(out.look), personality: '',
    ...(photos[0] && { photo: photos[0] }), ...(photos.length > 1 && { photos: photos.slice(1, 4) }), createdAt: Date.now(),
  }
  const people: Character[] = (out.new_characters ?? []).slice(0, 2).map((c: any) => ({
    id: randomUUID(), name: str(c.name), look: str(c.look), personality: str(c.personality), voice: voiceId(c.voice), createdAt: Date.now(),
  }))
  const places: Character[] = (out.new_elements ?? []).slice(0, 2).map((e: any) => ({
    id: randomUUID(), kind: 'element', name: str(e.name), look: str(e.look), personality: '', category: e.category === 'prop' ? 'prop' : 'place', createdAt: Date.now(),
  }))
  const created = [...(saved ? [] : [item]), ...people, ...places]
  created.forEach(saveCharacter)
  return {
    created,
    series: {
      id: randomUUID(), kind: 'ad', product: item.id, title: item.name, idea: description, logline: str(out.logline), style: str(out.style),
      seconds, imageModel: 'gpt-image-2', videoModel: 'kling-3', videoSound: false,
      cast: [...cast, ...people].map((c) => c.id), elements: [item, ...elements, ...places].map((e) => e.id), continuity: str(out.brief),
      episodes: (out.ads ?? []).slice(0, ads).map((e: any) => ({ id: randomUUID(), title: str(e.title), summary: str(e.summary), format: formatOf(str(e.format))?.id, step: 'script', scenes: [], music: false })),
      createdAt: Date.now(),
    },
  }
}

const storySoFar = (s: Series, index: number) => isAd(s) ? adContext(s, index) :
  [
    `Series "${s.title}": ${s.logline}`,
    `Look of every scene: ${s.style}`,
    `Cast:\n${castText(charactersById(s.cast))}`,
    `Recurring places and things (name them exactly when they appear, so they look the same):\n${elementText(charactersById(s.elements ?? []))}`,
    `Continuity notes (must be respected):\n${s.continuity || 'none yet'}`,
    `Earlier episodes:\n${s.episodes.slice(0, index).map((e, i) => `${i + 1}. ${e.title}: ${e.recap || e.summary}`).join('\n') || 'none'}`,
  ].join('\n\n')

const CRAFT = [
  'This is vertical 9:16 short-form video for TikTok, Reels and Shorts. Viewers decide in 1-2 seconds whether to keep watching.',
  'Structure: HOOK (0-2 s: a striking image plus a line or question that opens a gap) → SETUP → ESCALATION with a turn every 3-5 s → PAYOFF or twist → BUTTON (a final beat: punchline, cliffhanger, or a loop back to the opening image).',
  'Every shot must change something: a reveal, a reaction, a movement, new information. No two shots in a row may say the same thing.',
  'Vary shot size, angle and place; never three similar shots in a row. Let pictures carry information; dialogue adds character, subtext and wit.',
  'Dialogue: natural, specific, in character, never on-the-nose; at most 2 lines per shot, each short enough to say in the shot (about 2.5 words a second).',
].join('\n')

const DIRECTION = [
  'For every shot write a plan an image model and a video model can follow exactly. Be concrete and visual; no vague words like "dramatic" or "cinematic" on their own.',
  '- shot: shot size (extreme close-up, close-up, medium, wide, over-the-shoulder, POV, insert), angle, lens (e.g. 24mm, 50mm, 100mm macro), composition in 9:16 (keep faces and key action in the middle; the top 15% and bottom 25% stay free of key action because the app UI covers them), depth of field.',
  '- beats: what happens over the shot, timed, 2-4 beats, e.g. "0-1 s the headlights sweep; 1-3 s Sol leans in; 3-4 s he looks up".',
  '- performance: who stands where, eyelines, expressions, gestures, body language.',
  '- move: one clear camera move and its speed (slow push-in, whip pan, handheld drift, static), or "locked off".',
  '- environment: time, weather, light sources with direction and colour, atmosphere (rain, haze, dust, steam), background life, props and their state (carried over between shots).',
  '- sound: ambience and 1-3 sound effects.',
  '- text: on-screen text only where it helps retention (usually the hook), at most 6 words; otherwise empty.',
  '- transition: how this shot cuts to the next (smash cut, match cut, whip, hard cut on action).',
].join('\n')

// From the research on organic (dropshipping-style) product videos: what hooks, holds and sells, and what looks real.
const AD_CRAFT = [
  'This is an organic product video for TikTok, Reels and Shorts (the dropshipping style): it must look filmed on a phone by a real person in a real home, never like a commercial. Vertical 9:16; sound on, but it must work on mute.',
  'Viewers decide in 1-2 seconds. The HOOK shot (the first 1.5-3 s) is about the product or the problem it solves: start mid-action on the most striking moment, with hook text on screen (3-8 words). Never open with a greeting or a logo.',
  'Hook families: call out the person ("If you have a small apartment…"), show the problem ("If your cables look like this…"), curiosity ("I didn\'t know I needed this until…"), price ("$8 vs $40"), a controlled test ("Same spill, one change"), POV or gift ("POV: you found the perfect gift for your dad"), a warning ("Don\'t buy this until you…"), or the most satisfying visual first.',
  'Then: PROBLEM (the viewer\'s real pain, in their words) → DEMO (the product working, close and clear, one benefit per shot) → PROOF (the result, a reaction, a test) → CALL TO ACTION (soft: "link\'s below", "comment LINK", "save this for later"), or end on a frame that flows back into the first so it loops.',
  'Pacing: a new picture every 1.5-3 s; nothing static longer than 4 s; every shot shows something new.',
  'Show, don\'t tell: the product doing its job on camera is the proof. One feature per shot, close enough to see.',
  'Reactions: small, specific and real (eyebrows up, a laugh, a "wait…", leaning in, a dog tilting its head), 1-1.5 s, either as the hook (the face at its peak, then what caused it) or right after the result. No big fake gasps.',
  'Voice: a casual voiceover (speaker "Narrator") or a person talking to the camera, like a friend: contractions, "okay so", "honestly"; at most one short sentence per shot (3-8 words, about 2.5 words a second); nothing corporate. Satisfying/ASMR ads have no voice.',
  'On-screen text: 3-8 words where it helps; it carries the story for viewers on mute. The hook shot always has it.',
  'Honesty: show only what the product really does (from the brief); no invented reviews, ratings, statistics, prices or health claims; before/after must be realistic and typical.',
].join('\n')

const AD_DIRECTION = [
  'For every shot write a plan an image model and a video model can follow exactly. Concrete and visual; it must look like real phone footage.',
  '- shot: one of POV hands (first person, the product held toward the lens), top-down (table and hands), macro detail (texture, button, mechanism, label), hero three-quarter (the product on a real surface), in use (someone using it in a real place, medium), selfie talking (arm\'s length, slightly above eye level, a little off-centre), over the shoulder, reaction close-up, locked before/after (identical framing both times). A phone lens (26mm main, 13mm wide, 77mm tele, close-up macro). Composition in 9:16: key action in the middle; the top 15% and bottom 25% stay free (the app UI and the text cover them).',
  '- beats: what happens over the shot, timed, 2-3 beats, e.g. "0-1 s the thumb presses the button; 1-2 s the light comes on".',
  '- performance: hands relaxed and simple (hold, turn, press, pour, peel), never covering the label; the label faces the camera, never mirrored; the logo first on a reveal; people look into the lens when they talk; reactions small and real.',
  '- move: a phone move: slight handheld drift, a quick push-in, a follow, or locked off on the counter for tests.',
  '- environment: a real lived-in place (kitchen, bathroom, bedroom, car, desk, outdoors) with natural window light or warm lamps and soft shadows; never a studio or a plain backdrop; props stay where they were.',
  '- sound: the product\'s own sounds (click, zip, pour, snap, fizz) and room tone.',
  '- text: the on-screen text for this shot (3-8 words) or empty; keep the text the shot already has.',
  '- transition: hard cut on action, match cut, whip.',
].join('\n')
const craft = (s: Series) => (isAd(s) ? AD_CRAFT : CRAFT)
const direction = (s: Series) => (isAd(s) ? AD_DIRECTION : DIRECTION)
const role = (s: Series) => (isAd(s) ? 'organic product videos (ads)' : 'a vertical short series')
const AD_SHOT = '{"place": "where and when", "action": "what happens in this shot, naming the product and people exactly", "cast": ["people on screen"], "lines": [{"speaker": "Narrator or a name", "text": "the line"}], "text": "on-screen text, 3-8 words, or empty", "seconds": 2}'
const AD_SCRIPT_JSON = `{"beats": "the beat sheet: numbered beats with their seconds", "format": "the format id", "hooks": [${AD_SHOT}], "scenes": [${AD_SHOT}]}`

const SCRIPT_JSON = '{"beats": "the beat sheet: numbered beats with their seconds", "scenes": [{"place": "where and when", "action": "what happens in this shot, by name", "cast": ["characters on screen"], "lines": [{"speaker": "name or Narrator", "text": "the line"}]}]}'
// Ads also carry each shot's hook letter and silent length; series shots don't.
const directedJson = (s: Series) => (isAd(s) ? DIRECTED_JSON : DIRECTED_JSON.replace('"hook": "", "seconds": 0, ', ''))
const DIRECTED_JSON = '{"scenes": [{"hook": "", "seconds": 0, "place": "...", "action": "...", "cast": ["..."], "lines": [{"speaker": "...", "text": "..."}], "plan": {"shot": "...", "beats": "...", "performance": "...", "move": "...", "environment": "...", "sound": "...", "text": "", "transition": "..."}}]}'

// Pass 1, the writers' room: a beat sheet built for social, then the script as short shots.
export async function writeScript(s: Series, index: number): Promise<{ beats: string; scenes: Scene[]; by: string; format?: string }> {
  const ep = s.episodes[index]
  if (isAd(s)) return writeAd(s, index)
  const n = sceneTarget(s.seconds)
  const { text, by } = await write(s, [
    'You are the head writer of a vertical short series. First plan the episode as a beat sheet, then write it as shots.',
    CRAFT,
    storySoFar(s, index),
    `Episode ${index + 1} runs about ${s.seconds} seconds: write about ${n} shots of 2-4 seconds each (never more than 15).`,
    'Use only the cast (walk-on people unnamed, only if essential) and name recurring places and things exactly. Stay consistent with the continuity notes and earlier episodes.',
    'If the episode brief already has lines, beats or timings, keep them; build on them.',
    `Reply with JSON only:\n${SCRIPT_JSON}`,
    'Write in the language of the series.',
  ].join('\n\n'), `Episode ${index + 1}: ${ep.title}\n${ep.summary}`)
  const out = json<{ beats?: string; scenes?: any[] }>(text)
  return { beats: str(out.beats), scenes: scenesFrom(out), by }
}

// An ad: three alternative hook shots (A, B, C), then the body every hook leads into.
async function writeAd(s: Series, index: number) {
  const ep = s.episodes[index]
  const product = charactersById([s.product ?? ''])[0]
  const f = formatOf(ep.format)
  const { text, by } = await write(s, [
    'You are the creative lead for organic product videos. First plan the ad as a beat sheet, then write it as shots.',
    AD_CRAFT,
    storySoFar(s, index),
    f ? `Format: ${f.name}. ${f.beats}` : `Pick the format that fits this ad best (reply with its id): ${AD_FORMATS.map((x) => `${x.id}: ${x.beats}`).join(' ')}`,
    `The ad runs about ${s.seconds} seconds. Write 3 alternative HOOK shots (1.5-3 s each, each from a different hook family, each with its own on-screen text and, if the ad has a voice, its own opening line), then the body: about ${adShots(s.seconds)} shots that follow on from any of the hooks.`,
    `Name the product exactly as "${product?.name ?? s.title}" in every shot it is in; name people, places and props exactly. A shot without a line gets "seconds" (1.5-3); a shot with a line runs as long as the line.`,
    'If the ad brief already has lines, beats or timings, keep them; build on them.',
    `Reply with JSON only:\n${AD_SCRIPT_JSON}`,
    ENGLISH,
  ].join('\n\n'), `Ad ${index + 1}: ${ep.title}\n${ep.summary}`)
  const out = json<{ beats?: string; format?: string; hooks?: any[]; scenes?: any[] }>(text)
  const hooks = (out.hooks ?? []).slice(0, 3).map((h, i) => ({ ...h, hook: HOOKS[i] }))
  return { beats: str(out.beats), scenes: scenesFrom({ scenes: [...hooks, ...(out.scenes ?? [])] }), by, format: formatOf(str(out.format))?.id }
}

const plain = (scenes: Scene[]) => scenes.map(({ place, action, cast, lines, plan, hook, seconds }) =>
  ({ ...(hook && { hook }), place, action, cast, lines: lines.map(({ speaker, text }) => ({ speaker, text })), ...(seconds && !lines.length && { seconds }), ...(plan && { plan }) }))

// Pass 2, the director: a plan for every shot that has none. Each shot is planned on its own (five at a time) with the
// whole episode as context, so plans stay in continuity and a full episode is planned in about a minute. A shot that
// fails is left without a plan (the others keep theirs) and counted in `failed`, so "Plan N shots" can try it again.
export async function directScript(s: Series, index: number, scenes: Scene[]): Promise<{ plans: (ShotPlan | undefined)[]; by: string; failed: number }> {
  const context = JSON.stringify({ episode: s.episodes[index].title, shots: plain(scenes) })
  const errors: unknown[] = []
  const results = await pool(scenes.map((sc, i) => async () => {
    if (planned(sc)) return undefined
    try {
      const { text, by } = await write(s, [
        `You are the director of ${role(s)}. Write the shot plan for ONE shot of the ${isAd(s) ? 'ad' : 'episode'}, in continuity with the shots around it.`,
        craft(s),
        direction(s),
        storySoFar(s, index),
        'Keep the shot\'s place, action, cast and lines as they are. Vary framing and movement from the neighbouring shots.',
        isAd(s) && 'Shots marked with a hook letter are alternative openings: each must work as the first shot of the ad on its own.',
        'Reply with JSON only: {"shot": "...", "beats": "...", "performance": "...", "move": "...", "environment": "...", "sound": "...", "text": "", "transition": "..."}',
        languageOf(s),
      ].filter(Boolean).join('\n\n'), `Plan shot ${i + 1} of ${scenes.length}${sc.hook ? ` (hook ${sc.hook})` : ''}, this one:\n${JSON.stringify(plain([sc])[0])}\n\nAll the shots, for context:\n${context}`)
      const raw = json<any>(text)
      const plan = planFrom(raw.plan ?? raw)
      return { plan: plan && { ...plan, ...(!plan.text && sc.plan?.text && { text: sc.plan.text }) }, by }
    } catch (e) {
      errors.push(e)
      return undefined
    }
  }), 5)
  const done = results.filter((r) => r?.plan)
  if (!done.length && errors.length) throw errors[0]
  return { plans: results.map((r) => r?.plan), by: done.find((r) => r!.by !== writerOf(s))?.by ?? writerOf(s), failed: results.filter((r, i) => !planned(scenes[i]) && !r?.plan).length }
}

// Rewrites one shot (and its plan) to be stronger, in context, optionally following your note.
export async function improveScene(s: Series, index: number, scenes: Scene[], at: number, note: string): Promise<{ scene: Scene; by: string }> {
  const { text, by } = await write(s, [
    `You are the director of ${role(s)}. Make one shot stronger: sharper action and lines, a richer, filmable plan. Keep it in the ${isAd(s) ? 'ad' : 'story'} and in continuity with the shots around it.`,
    craft(s),
    direction(s),
    storySoFar(s, index),
    `Reply with JSON only, just this shot:\n${directedJson(s).replace('{"scenes": [', '').replace(/\]\}$/, '')}`,
    languageOf(s),
  ].join('\n\n'), JSON.stringify({ shotToImprove: at + 1, note: note || 'make it better', scenes: plain(scenes) }))
  const raw = json<any>(text)
  const [scene] = scenesFrom({ scenes: [raw.scenes?.[0] ?? raw] })
  if (!scene) throw new Error('The writer didn’t send back a usable shot. Try again.')
  return { scene, by }
}

// A change you asked for ("make Lala the one who breaks the machine"), applied to the whole script, plans included.
export async function reviseScript(s: Series, index: number, scenes: Scene[], change: string): Promise<Scene[]> {
  const { text } = await write(s, [
    `You revise one ${isAd(s) ? 'ad of a set of organic product videos' : 'episode of a vertical short series'}. Apply the requested change and keep everything else as it is, shot plans included (update them where the change needs it).`,
    craft(s),
    isAd(s) && 'Keep each shot\'s "hook" letter (alternative openings) and "seconds".',
    storySoFar(s, index),
    `Current episode:\n${JSON.stringify({ scenes: plain(scenes) })}`,
    `Reply with the full revised ${isAd(s) ? 'ad' : 'episode'}, JSON only:\n${directedJson(s)}`,
    'Never more than 15 shots, at most 2 lines per shot.',
    languageOf(s),
  ].filter(Boolean).join('\n\n'), change)
  return scenesFrom(json(text))
}

// Sharpens an episode summary (the brief its script is written from) using the story bible and earlier episodes.
// A short idea becomes hook, turn and punchline; a detailed script keeps every line, name, fact and timing, tidied into beats.
export async function improveSummary(s: Series, index: number, text: string) {
  return complete(WRITER, [
    `You edit the brief for one ${isAd(s) ? 'organic product ad' : 'episode of a vertical short series'}; a script will be written from it.`,
    storySoFar(s, index),
    isAd(s) ? `This is ad ${index + 1}, about ${s.seconds} seconds.${formatOf(s.episodes[index].format) ? ` Format: ${formatOf(s.episodes[index].format)!.name}.` : ''}` : `This is episode ${index + 1}, about ${s.seconds} seconds.`,
    isAd(s)
      ? 'If the brief is short or vague: rewrite it as 2-3 sentences: the hook (with its on-screen text), the moment the product works on camera, the payoff and a soft call to action, different from the other ads.'
      : 'If the brief is short or vague: rewrite it as 2-4 sentences with a hook in the first seconds, a clear turn and a punchline or cliffhanger, consistent with the story so far.',
    'If it is already detailed (beats, timings, dialogue): keep every line of dialogue, name, fact and timing exactly; only tidy it into clear numbered beats and fix gaps.',
    `Reply with the brief only: plain text (no Markdown, no bold), no preamble, ${isAd(s) ? 'in English' : 'in the language it was written in'}.`,
  ].join('\n\n'), text.trim() || '(empty: propose a strong next episode)')
}

// After an episode is cut: a short recap for the next scripts, and the continuity notes brought up to date.
export async function writeRecap(s: Series, index: number): Promise<{ recap: string; continuity: string }> {
  const ep = s.episodes[index]
  const script = ep.scenes.map((sc, i) => `${i + 1}. ${sc.place}: ${sc.action} ${sc.lines.map((l) => `${l.speaker}: "${l.text}"`).join(' ')}`).join('\n')
  const out = json<{ recap?: string; continuity?: string }>(await complete(WRITER, [
    'You keep the story bible of a vertical short series.',
    `Continuity notes so far:\n${s.continuity || 'none'}`,
    'Reply with JSON only: {"recap": "2-3 sentences on what happened in this episode", "continuity": "the full, updated continuity notes as short bullet lines: facts later episodes must respect (who knows what, what changed, where things are)"}',
    'Write in the language of the series.',
  ].join('\n\n'), `Episode ${index + 1}: ${ep.title}\n${script}`))
  return { recap: String(out.recap ?? ''), continuity: String(out.continuity ?? s.continuity) }
}

// --- The cut ---

export const ffmpeg = () => (app.isPackaged ? join(process.resourcesPath, 'ffmpeg') : join(app.getAppPath(), 'node_modules/ffmpeg-static/ffmpeg'))

// ffmpeg prints a file's details to stderr (and exits with an error when given no output); read length and audio from that.
export async function probe(path: string) {
  const err: string = await run(ffmpeg(), ['-hide_banner', '-i', path]).then(() => '', (e) => String(e.stderr ?? ''))
  const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(err)
  return { seconds: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0, audio: /Stream #\S+.*Audio:/.test(err) }
}
// One shot's voices laid on its clip's timeline (silence elsewhere), as long as the clip: the audio lip sync follows.
export async function voiceTrack(video: string, voices: { file: string; at: number }[]) {
  const seconds = (await probe(join(dirs.media, video))).seconds
  const out = `voices-${randomUUID()}.wav`
  const delayed = voices.map((v, i) => `[${i + 1}:a]aformat=sample_rates=44100:channel_layouts=mono,adelay=${Math.round(v.at * 1000)}:all=1[v${i}]`)
  const mix = `[0:a]${voices.map((_, i) => `[v${i}]`).join('')}amix=inputs=${voices.length + 1}:normalize=0:duration=first[out]`
  await run(ffmpeg(), ['-y', '-f', 'lavfi', '-t', seconds.toFixed(3), '-i', 'anullsrc=r=44100:cl=mono', ...voices.flatMap((v) => ['-i', join(dirs.media, v.file)]),
    '-filter_complex', [...delayed, mix].join(';'), '-map', '[out]', '-t', seconds.toFixed(3), '-c:a', 'pcm_s16le', join(dirs.media, out)])
  return out
}

// Length of a file in locco's media folder (a name) or of any stored file (a Ref: your uploads included).
export const mediaSeconds = async (file: string | Ref) => (await probe(typeof file === 'string' ? join(dirs.media, file) : pathOf(file))).seconds

// Renders an edit: each clip trimmed (in/out), sped up or down, reframed (pan/zoom inside the 9:16 crop) and held on its
// last frame for `hold` seconds; its own sound kept only if `sound`; voices placed from the clip's start; music underneath.
// A preview renders fast to one reused file per episode; a final render gets its own file.
export async function render(req: RenderRequest): Promise<string> {
  if (!req.clips.length) throw new Error('There are no clips to render.')
  const media = (f: string) => join(dirs.media, f)
  const info = await Promise.all(req.clips.map((c) => probe(media(c.video))))
  const even = (n: number) => Math.round(n / 2) * 2
  const args = ['-y', '-hide_banner', '-loglevel', 'error']
  const filters: string[] = []
  req.clips.forEach((c) => args.push('-i', media(c.video)))
  let input = req.clips.length
  let start = 0
  const mix: string[] = []
  req.clips.forEach((c, i) => {
    const len = clipLength(c).toFixed(3)
    const [w, h] = [even(720 * c.zoom), even(1280 * c.zoom)]
    const x = ((c.pan + 1) / 2).toFixed(3)
    filters.push(
      `[${i}:v]trim=start=${c.in}:end=${c.out},setpts=(PTS-STARTPTS)/${c.speed},scale=${w}:${h}:force_original_aspect_ratio=increase,` +
        `crop=720:1280:(iw-720)*${x}:(ih-1280)/2,fps=30,setsar=1,format=yuv420p,tpad=stop_mode=clone:stop_duration=${(c.hold + 30).toFixed(2)},` +
        `trim=duration=${len},setpts=PTS-STARTPTS[v${i}]`,
    )
    filters.push(c.sound && info[i].audio
      ? `[${i}:a]atrim=start=${c.in}:end=${c.out},asetpts=PTS-STARTPTS,atempo=${c.speed},aformat=sample_rates=48000:channel_layouts=stereo,` +
        `volume=${c.voices.length ? 0.35 : 1},apad,atrim=0:${len},asetpts=PTS-STARTPTS[a${i}]`
      : `anullsrc=r=48000:cl=stereo:d=${len}[a${i}]`)
    c.voices.forEach((v, j) => {
      args.push('-i', media(v.file))
      const ms = Math.max(0, Math.round((start + v.at) * 1000))
      filters.push(`[${input}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${ms}|${ms}[vo${i}_${j}]`)
      mix.push(`[vo${i}_${j}]`)
      input++
    })
    start += clipLength(c)
  })
  filters.push(`${req.clips.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${req.clips.length}:v=1:a=1[v][base]`)
  if (req.music) {
    args.push('-i', media(req.music.file))
    filters.push(`[${input}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${req.music.volume.toFixed(2)},afade=t=out:st=${Math.max(0, start - 1.5).toFixed(2)}:d=1.5[music]`)
    mix.push('[music]')
  }
  filters.push(mix.length ? `[base]${mix.join('')}amix=inputs=${mix.length + 1}:duration=first:normalize=0[aout]` : '[base]anull[aout]')
  const safe = req.name.replace(/[^a-z0-9-]+/gi, '-').slice(0, 60)
  const file = req.preview ? `preview-${safe}.mp4` : `${safe}-${Date.now()}.mp4`
  args.push('-filter_complex', filters.join(';'), '-map', '[v]', '-map', '[aout]', '-c:v', 'libx264', '-preset', req.preview ? 'ultrafast' : 'veryfast',
    '-crf', req.preview ? '28' : '20', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', media(file))
  await run(ffmpeg(), args, { maxBuffer: 16 * 1024 * 1024 }).catch((e) => {
    throw new Error(`Rendering failed: ${String(e.stderr || e.message).trim().split('\n').at(-1)}`)
  })
  return file
}
