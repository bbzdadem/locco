import type { EditClip, Scene } from './types'

// When each line starts inside its scene, and how long the scene runs: short pauses around the dialogue, never under 2.5 s.
export function timing(scene: Pick<Scene, 'lines'>) {
  let at = 0.3
  const voices = scene.lines.map((l) => {
    const start = at
    at += (l.seconds ?? 2.5) + 0.35
    return start
  })
  return { voices, seconds: Math.max(2.5, scene.lines.length ? at + 0.3 : 3) }
}

// Shots of about 3 seconds (social pacing), at least 5, at most 15.
export const sceneTarget = (seconds: number) => Math.max(5, Math.min(15, Math.round(seconds / 3)))

// Shortest clip length (from what the model offers) that covers the scene; the longest one if none does.
export const clipFor = (lengths: number[], seconds: number) => lengths.find((n) => n >= seconds) ?? lengths.at(-1) ?? 5

// How long a clip runs in the episode: the trimmed part at its speed, plus any held last frame.
export const clipLength = (c: Pick<EditClip, 'in' | 'out' | 'speed' | 'hold'>) => Math.max(0.1, (c.out - c.in) / c.speed + c.hold)
// Where each clip starts in the episode, and the total length.
export function starts(clips: Pick<EditClip, 'in' | 'out' | 'speed' | 'hold'>[]) {
  let t = 0
  const at = clips.map((c) => {
    const start = t
    t += clipLength(c)
    return start
  })
  return { at, total: t }
}
// Splitting a clip at a point of its source video: the first part keeps the voices that start before the cut,
// the second part gets the rest (moved to its own start) and the held frame.
export function split(c: EditClip, source: number, newId: string): [EditClip, EditClip] | null {
  if (source <= c.in + 0.1 || source >= c.out - 0.1) return null
  const cutAt = (source - c.in) / c.speed
  return [
    { ...c, out: source, hold: 0, voices: c.voices.filter((v) => v.at < cutAt) },
    { ...c, id: newId, in: source, voices: c.voices.filter((v) => v.at >= cutAt).map((v) => ({ ...v, at: +(v.at - cutAt).toFixed(2) })) },
  ]
}
