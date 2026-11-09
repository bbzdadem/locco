// Product ads: organic TikTok/Reels product videos (the dropshipping style). The formats, and how an ad's hook
// variants become its versions.
import type { Episode, Scene } from './types'

export const AD_FORMATS: { id: string; name: string; beats: string }[] = [
  { id: 'problem-fix', name: 'Problem → fix', beats: 'Open on the frustrating moment; the old way failing; the product appears; it just works, close enough to see; the result; a soft call to action.' },
  { id: 'before-after', name: 'Before / after', beats: 'The before state; the product used; the after state from the exact same angle and light; a close look at the difference.' },
  { id: 'unboxing', name: 'Unboxing', beats: 'Hands only, top-down or POV: the sealed package; opening it; lifting the product and turning the label to camera; what is inside; first use.' },
  { id: 'tutorial', name: 'How to use', beats: 'The steps in order, one per shot, hands close to the lens; the finished result.' },
  { id: 'review', name: 'Talking review', beats: 'A person talks to the camera selfie-style, product held at shoulder height with the label forward; cutaways of the product in use every 2-3 s; their honest verdict.' },
  { id: 'reaction', name: 'Reaction / gift', beats: 'Open on a real reaction close-up (surprise, a laugh, "wait…"); cut to what caused it; the product doing its thing; a second reaction or the gift moment.' },
  { id: 'asmr', name: 'Satisfying / ASMR', beats: 'No talking: macro shots of the product\'s most satisfying actions and sounds (click, pour, snap, peel, fizz); the last frame flows back into the first so it loops.' },
  { id: 'versus', name: 'This vs that', beats: 'The old way or a cheaper alternative against the product on one job, back to back from the same angle; the clear winner.' },
  { id: 'uses', name: '3 ways to use it', beats: 'The same person in three situations where the product helps, one quick payoff each.' },
  { id: 'pov', name: 'POV', beats: 'First person: the viewer\'s own hands and day, the moment the product saves it; the on-screen text tells the story ("POV: …").' },
]
export const formatOf = (id?: string) => AD_FORMATS.find((f) => f.id === id)

export const HOOKS = ['A', 'B', 'C']
// Shots in an ad's body: one every 2.5 s or so (ads cut faster than stories).
export const adShots = (seconds: number) => Math.max(4, Math.min(12, Math.round(seconds / 2.5)))

// The shots that make it into the ad: once you approve a hook, the hooks you didn't approve are left out (no voices,
// videos or versions for them). A series, or an ad with no hook approved yet, keeps every shot.
export const playing = (ep: Pick<Episode, 'scenes'>) =>
  ep.scenes.some((sc) => sc.hook && sc.approved) ? ep.scenes.filter((sc) => !sc.hook || sc.approved) : ep.scenes

// The versions of an ad: each hook followed by the body. An ad without hooks has one version, all its shots.
export function adVersions(ep: Pick<Episode, 'scenes'>): { hook?: string; scenes: Scene[] }[] {
  const scenes = playing(ep)
  const hooks = scenes.filter((sc) => sc.hook)
  const body = scenes.filter((sc) => !sc.hook)
  return hooks.length ? hooks.map((h) => ({ hook: h.hook, scenes: [h, ...body] })) : [{ scenes }]
}
