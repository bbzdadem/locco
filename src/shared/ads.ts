// Product ads: organic TikTok/Reels product videos (the dropshipping style). The formats, and how an ad's hook
// variants become its versions.
import { MEDIA_MODELS } from './models'
import { clipFor } from './timing'
import type { Episode, Scene } from './types'

// Ranked by how often store reels in each format pass a million plays (a review of 990 product reels, 2026): pets,
// compilations and skits spread most; plain demos and POV skits least. No talking review: the people here are made by AI,
// so one recommending the product would be a fake testimonial.
export const AD_FORMATS: { id: string; name: string; beats: string; viral?: true }[] = [
  { id: 'pet', name: 'Pet moment', beats: 'A pet uses, wears, plays with, steals or reacts to the product; the pet\'s reaction is the peak; end on the pet or the owner\'s small laugh.' },
  { id: 'compilation', name: 'Compilation', beats: 'Four to six of the product\'s best moments back to back, about 2-3 s each, building to the funniest or most surprising one, held at the end. For a product that records (a camera), its best captured clips, full frame.' },
  { id: 'skit', name: 'Prank / skit', beats: 'Two people: a quick setup ("don\'t let my husband see this"), the product causes the twist, the other person\'s reaction is the payoff.' },
  { id: 'reaction', name: 'Reaction / gift', beats: 'Open on the product doing its thing or a reaction at its peak; cut to what caused it; a second reaction or the gift moment.' },
  { id: 'before-after', name: 'Before / after', beats: 'The before state; the product used; the after state from the exact same angle and light; a close look at the difference.' },
  { id: 'problem-fix', name: 'Problem → fix', beats: 'Open on the frustrating moment; the old way failing; the product just works, close enough to see; the result, held.' },
  { id: 'asmr', name: 'Satisfying / ASMR', beats: 'No talking: macro shots of the product\'s most satisfying actions and sounds (click, pour, snap, peel, fizz); the last frame flows back into the first so it loops.' },
  { id: 'versus', name: 'This vs that', beats: 'The old way or a cheaper alternative against the product on one job, back to back from the same angle; the clear winner.' },
  { id: 'uses', name: '3 ways to use it', beats: 'Three situations where the product helps, one quick payoff each.' },
  { id: 'unboxing', name: 'Unboxing', beats: 'Hands only, top-down or POV: the sealed package; opening it; lifting the product to camera; first use.' },
  { id: 'tutorial', name: 'How to use', beats: 'The steps in order, one per shot, hands close to the lens; the finished result.' },
  // Viral: the formats of this season's most-shared gift-product reels (up to 1.2M likes, Nov 2026). Used only with Viral on.
  { id: 'concept', name: 'Concept vs product', viral: true, beats: 'A clumsy homemade version of the idea (tape, cardboard, a hack) is built and fails comically; a clean hands-only unboxing of the real product; the product doing the same job at its best (at dusk or night if it lights up); hold the payoff.' },
  { id: 'store', name: 'Store reaction', viral: true, beats: 'The hook line is a partner or friend\'s eye-roll quote ("Babe, the dog doesn\'t need that 🙄"); in a warehouse store someone spots a whole pallet of the product and collapses to the floor; hands-only unboxing at home; the product in real use with family or strangers reacting; end on the best reaction.' },
  { id: 'then-now', name: 'Then vs now', viral: true, beats: 'The old way going comically wrong, framed as years ago ("Christmas decor in 1986 🤮"); hands-only unboxing and setup; a reveal (a door opening, a switch flicked) onto the product at its best; a second angle of the payoff, held.' },
  // Hook-led viral formats: the first frame alone raises a question (absurd, alarming or strange); the product explains it.
  { id: 'disaster', name: 'Comic disaster', viral: true, beats: 'Open mid-disaster with the old way or a cheap fake (it breaks, spills, floods, collapses, tangles), funny not frightening, nobody hurt; a beat of shock; cut to the product doing the job easily; end on the calm result.' },
  { id: 'fake-danger', name: 'Fake danger', viral: true, beats: 'Open on something that looks alarming (a glow like fire, smoke, a crash about to happen, a scream from the next room); a second of tension; reveal it is the product working as it should; end on the relieved or delighted face.' },
  { id: 'mystery', name: 'Mystery close-up', viral: true, beats: 'Open on an extreme close-up of the product\'s strangest part, light or motion, impossible to identify; slowly pull back or cut wider, shot by shot, until the whole product in use is revealed; end on the full reveal, held.' },
  { id: 'strangers', name: 'Stranger reactions', viral: true, beats: 'Filmed from a distance in a public place (street, park, campus steps, store): the product in use; passers-by stop, point, laugh and film it; one or two closer reactions; end on the best face or a stranger asking about it.' },
  { id: 'kid', name: 'Kid reaction', viral: true, beats: 'Open on a child\'s face at the peak of the reaction (jaw drop, gasp, joyful scream); cut to what they are seeing, the product at its best; the child running to it or hugging a parent; end on the child playing with it.' },
  { id: 'revenge', name: 'Revenge / prank', viral: true, beats: 'Petty family or roommate drama as the hook line ("My brother hid my ball, so I bought THIS"); the setup in one shot; the product used to win, out-do or prank them; the other person\'s outraged or impressed reaction is the payoff. Harmless and playful, never mean.' },
  { id: 'countdown', name: 'Countdown / challenge', viral: true, beats: 'A day-count or challenge hook line ("Day 1 of making my dad believe in Christmas again"); the goal and the doubter in one shot; the product as today\'s attempt; the reaction showing whether it worked; end on a cliffhanger or a small win that invites the next part.' },
  { id: 'pov', name: 'POV', beats: 'First person: the viewer\'s own hands and day, the moment the product saves it; the text line tells the story ("POV: …").' },
]
export const formatOf = (id?: string) => AD_FORMATS.find((f) => f.id === id)
// Viral on: only the viral formats; off: only the others.
export const formatsFor = (viral?: boolean) => AD_FORMATS.filter((f) => !!f.viral === !!viral)
export const VIRAL_PLAYBOOK = 'Viral mode, the pattern of this season\'s most-shared gift-product reels: the hook is everything: the first frame alone, without the text, must be absurd, alarming or strange enough that a scroller has to know what is going on, and the product is the explanation; about 15 seconds of music and on-screen text, no talking; a hook line ending in an emoji (🤮 for the bad old way, 🙄 for the doubter, 🤩 or 😳 for the reveal); hands-only POV unboxing; a payoff that looks spectacular on camera (glowing, at dusk or night, a room or yard transformed) but only shows what the product really does; family, kids, pets or strangers reacting. The ending invites a keyword comment for the link (e.g. Comment "GLOW").'

// What the chosen video model can and can't do, so the writer and director plan shots it will get right. Every shot
// is animated from its still alone (no end frame). ponytail: hand-written from the models' strengths; tune from results.
const VIDEO_LIMITS = 'Every shot is animated from its still image by the video model, so the still must already show the setup, and each clip can carry one clear action. Small fast objects (a thrown ball or frisbee in flight, flying sparks) blur, vanish or change shape: show the throw and the landing or catch as separate shots, or keep the object big in frame and slow. Fine hand work (taping, peeling, threading, small buttons) often warps fingers: keep hand actions simple and the hands large. A change of state inside one clip (lights switching on, a room transforming, an object appearing) is unreliable: start the shot already in the new state, or cut to it. No readable text or logos appearing in the motion. One simple camera move per shot.'
const VIDEO_NOTES: Record<string, string> = {
  'kling-3': 'Kling 3.0: the best here at people: natural body motion, faces and hands; a throw, jump or fall reads well. Clips are 3 s.',
  'kling-2-6': 'Kling 2.6: steady and reliable but calmer motion: keep actions modest, no fast sports moves.',
  'kling-4-flash-keyframes': 'Kling 4.0 Flash Keyframes: smooth, gentle motion from the still; weak at energetic action. Favour slow reveals and calm moments.',
  'seedance-2-5': 'Seedance 2.5: follows a multi-beat action and a camera move well and keeps the product\'s shape steady; clips are at least 4 s, so give shots a little more to do.',
  'seedance-2': 'Seedance 2.0: good camera moves and prompt following, keeps products steady; clips are at least 4 s.',
  'seedance-2-fast': 'Seedance 2.0 Fast: like Seedance 2.0 with less detail: simple actions, medium shots.',
  'seedance-2-mini': 'Seedance 2.0 Mini: a cheap draft model: one simple action per shot, medium or wide framing, little hand work.',
  'wan-3': 'Wan 3.0: good prompt following and steady scenes; moderate motion: avoid fast sports or chaotic action.',
  'minimax-h3': 'MiniMax H3: lively, dynamic motion; faces can drift between frames, so keep faces small or turned away in fast shots.',
  'hailuo-2-3': 'Hailuo 2.3: strong at dynamic action and physics (falls, splashes, throws, collapses): good for disasters and fast moments; faces can drift.',
  'grok-imagine': 'Grok Imagine: cheap drafts and less consistent: simplest actions only, products large and still, few people.',
}
export const videoNote = (modelId?: string) => [VIDEO_LIMITS, modelId && VIDEO_NOTES[modelId]].filter(Boolean).join(' ')

export const HOOKS = ['A', 'B', 'C']
// The clip a video model makes for a shot of SHOT_SECONDS (3 s on Kling 3.0, 4 s on Seedance): every shot is paid for this long.
export function clipSeconds(modelId?: string) {
  const m = MEDIA_MODELS.find((x) => x.id === modelId)
  const spec = m && (m.image ?? m.text)
  const lengths = (spec?.fields.find((f) => f.name === 'duration')?.enum ?? []).map(Number).filter((n) => n > 0).sort((a, b) => a - b)
  return clipFor(lengths, SHOT_SECONDS)
}
// Shots in an ad's body: the best product reels run about 5 shots of about 3 s (one action each; each is made as one clip and
// its best 3 s used), so the body is what's left after a 3 s hook, 3 s a shot.
export const SHOT_SECONDS = 3
export const adShots = (seconds: number) => Math.max(2, Math.min(8, Math.round((seconds - SHOT_SECONDS) / SHOT_SECONDS)))

// A post of one version of an ad, with its numbers after about 48 hours. The test sellers use: keep a product or idea
// when a post passes about 1,000 views with a few "where do I buy" comments; otherwise move on.
export const working = (r: { views: number; asks: number }) => r.views >= 1000 && r.asks >= 2

// The shots that make it into the video: shots you left out never do, and once you approve a hook, the hooks you didn't
// approve are left out too (no voices, videos or versions for them).
export function playing(ep: Pick<Episode, 'scenes'>) {
  const kept = ep.scenes.filter((sc) => !sc.skip)
  return kept.some((sc) => sc.hook && sc.approved) ? kept.filter((sc) => !sc.hook || sc.approved) : kept
}

// The versions of an ad: each hook followed by the body. An ad without hooks has one version, all its shots.
export function adVersions(ep: Pick<Episode, 'scenes'>): { hook?: string; scenes: Scene[] }[] {
  const scenes = playing(ep)
  const hooks = scenes.filter((sc) => sc.hook)
  const body = scenes.filter((sc) => !sc.hook)
  return hooks.length ? hooks.map((h) => ({ hook: h.hook, scenes: [h, ...body] })) : [{ scenes }]
}
