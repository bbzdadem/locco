import type { Scene } from './types'

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

// Shortest clip length (from what the model offers) that covers the scene; the longest one if none does.
export const clipFor = (lengths: number[], seconds: number) => lengths.find((n) => n >= seconds) ?? lengths.at(-1) ?? 5
