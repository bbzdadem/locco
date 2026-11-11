// Text items are drawn once on a canvas, full frame and transparent; the same picture is shown in the preview and laid
// over the video on export, so what you see is what you get.
import { SIZE, sizeOf } from '../../shared/timeline'
import type { Aspect, EditProject, Item } from '../../shared/types'

const cache = new Map<string, string>()
const keyOf = (it: Item, aspect: Aspect, res?: string) => JSON.stringify([it.text, it.style, it.position, it.color, it.size, it.x, it.y, it.hl, aspect, res])
export const HIGHLIGHT = '#FFE14D'

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number) {
  const lines: string[][] = []
  for (const para of text.split('\n')) {
    let line: string[] = []
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = [...line, word]
      if (ctx.measureText(next.join(' ')).width > width && line.length) (lines.push(line), (line = [word]))
      else line = next
    }
    lines.push(line)
  }
  return lines
}
// Black or white, whichever reads on the given colour.
const ink = (hex: string) => {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16)
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 150 ? '#000000' : '#ffffff'
}
// Where a text's block sits by default (its centre, 0-1 of the frame), for each preset position.
export function textCentre(it: Item) {
  const pos = it.position ?? (it.style === 'title' ? 'middle' : 'bottom')
  return { x: it.x ?? 0.5, y: it.y ?? (pos === 'top' ? 0.17 : pos === 'middle' ? 0.5 : 0.74) }
}

export function textImage(it: Item, aspect: Aspect, res?: EditProject['resolution']): string {
  const key = keyOf(it, aspect, res)
  const hit = cache.get(key)
  if (hit) return hit
  const [W, H] = res ? sizeOf(aspect, res) : SIZE[aspect]
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const title = it.style === 'title'
  const box = it.style === 'box'
  const size = Math.round((title ? 0.09 : 0.064) * Math.min(W, H * 0.5625) * (it.size ?? 1))
  ctx.font = `${title ? 800 : 700} ${size}px -apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  const lines = wrap(ctx, (it.text ?? '').trim(), W * 0.84)
  const lh = size * (box ? 1.42 : 1.22)
  const block = lines.length * lh
  const c = textCentre(it)
  const top = c.y * H - block / 2
  const color = it.color ?? (box ? '#ffffff' : '#ffffff')
  let word = 0
  lines.forEach((words, i) => {
    const line = words.join(' ')
    const w = ctx.measureText(line).width
    const y = top + i * lh + lh / 2
    const left = Math.min(Math.max(c.x * W - w / 2, W * 0.04), W * 0.96 - w)
    if (box) {
      // Native-style text: each line on its own rounded box in the chosen colour, text in black or white to match.
      const pad = size * 0.32
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.roundRect(left - pad, y - lh / 2 + size * 0.06, w + pad * 2, lh - size * 0.12, size * 0.22)
      ctx.fill()
    } else {
      ctx.lineJoin = 'round'
      ctx.lineWidth = Math.max(4, size * 0.16)
      ctx.strokeStyle = 'rgba(0,0,0,0.85)'
      ctx.strokeText(line, left, y)
    }
    // Word by word, so one word can be highlighted (word-by-word captions).
    let x = left
    for (const part of words) {
      const lit = it.hl === word
      ctx.fillStyle = box ? (lit ? '#e11d48' : ink(color)) : lit ? (color.toLowerCase() === HIGHLIGHT.toLowerCase() ? '#ffffff' : HIGHLIGHT) : color
      ctx.fillText(part, x, y)
      x += ctx.measureText(`${part} `).width
      word++
    }
  })
  const url = canvas.toDataURL('image/png')
  cache.set(key, url)
  return url
}

export const pngBytes = (dataUrl: string) => Uint8Array.from(atob(dataUrl.split(',')[1]), (c) => c.charCodeAt(0))
