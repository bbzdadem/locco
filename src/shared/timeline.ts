// Timeline math for the editor, shared by the screen and the checks.
import type { EditProject, Item } from './types'

export const MAIN = 'main'
// How long an item runs on the timeline.
export function itemLength(it: Item) {
  if (it.media === 'video' || it.media === 'audio') return Math.max(0.1, ((it.out ?? 0) - (it.in ?? 0)) / (it.speed ?? 1) + (it.hold ?? 0))
  return Math.max(0.1, it.duration ?? 3)
}
// The main track plays its clips back to back, in order; their start times follow from that.
export function layout(p: EditProject): EditProject {
  let t = 0
  return {
    ...p,
    items: p.items.map((it) => {
      if (it.track !== MAIN) return it
      const start = +t.toFixed(3)
      t += itemLength(it)
      return { ...it, start }
    }),
  }
}
export const mainItems = (p: EditProject) => p.items.filter((it) => it.track === MAIN)
export const duration = (p: EditProject) => Math.max(0, ...p.items.map((it) => it.start + itemLength(it)))
// The video's length is the video track's: audio or text running past its end is cut off, as in any editor.
export const videoEnd = (p: EditProject) => Math.max(0, ...p.items.filter((it) => it.track === MAIN).map((it) => it.start + itemLength(it)))
export const itemAt = (p: EditProject, track: string, t: number) => p.items.find((it) => it.track === track && t >= it.start && t < it.start + itemLength(it))

// Cuts an item in two at timeline time t. Returns null when t is too close to either end.
export function splitAt(it: Item, t: number, newId: string): [Item, Item] | null {
  const local = t - it.start
  if (local <= 0.05 || local >= itemLength(it) - 0.05) return null
  if (it.media === 'video' || it.media === 'audio') {
    const playable = ((it.out ?? 0) - (it.in ?? 0)) / (it.speed ?? 1)
    if (local >= playable) return [{ ...it, hold: +(local - playable).toFixed(3) }, { ...it, id: newId, start: t, in: it.out, hold: +((it.hold ?? 0) - (local - playable)).toFixed(3) }]
    const cut = +((it.in ?? 0) + local * (it.speed ?? 1)).toFixed(3)
    return [{ ...it, out: cut, hold: 0, fadeOut: 0 }, { ...it, id: newId, start: t, in: cut, fadeIn: 0 }]
  }
  return [{ ...it, duration: +local.toFixed(3) }, { ...it, id: newId, start: t, duration: +(itemLength(it) - local).toFixed(3) }]
}

// Pulls a time onto the nearest edge (clip starts and ends, the playhead) within `within` seconds.
export function snap(t: number, edges: number[], within: number) {
  let best = t
  let gap = within
  for (const e of edges) if (Math.abs(e - t) < gap) (gap = Math.abs(e - t)), (best = e)
  return best
}

export const SIZE: Record<EditProject['aspect'], [number, number]> = { '9:16': [720, 1280], '16:9': [1280, 720], '1:1': [720, 720] }
