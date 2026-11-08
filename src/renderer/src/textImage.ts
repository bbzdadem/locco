// Text items are drawn once on a canvas, full frame and transparent; the same picture is shown in the preview and laid
// over the video on export, so what you see is what you get.
import { SIZE } from '../../shared/timeline'
import type { Aspect, Item } from '../../shared/types'

const cache = new Map<string, string>()
const keyOf = (it: Item, aspect: Aspect) => JSON.stringify([it.text, it.style, it.position, aspect])

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number) {
  const lines: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word
      if (ctx.measureText(next).width > width && line) (lines.push(line), (line = word))
      else line = next
    }
    lines.push(line)
  }
  return lines
}

export function textImage(it: Item, aspect: Aspect): string {
  const key = keyOf(it, aspect)
  const hit = cache.get(key)
  if (hit) return hit
  const [W, H] = SIZE[aspect]
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const title = it.style === 'title'
  const size = Math.round((title ? 0.09 : 0.064) * Math.min(W, H * 0.5625))
  ctx.font = `${title ? 800 : 700} ${size}px -apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const lines = wrap(ctx, (it.text ?? '').trim(), W * 0.84)
  const lh = size * 1.22
  const block = lines.length * lh
  const pos = it.position ?? (title ? 'middle' : 'bottom')
  const top = pos === 'top' ? H * 0.12 : pos === 'middle' ? H / 2 - block / 2 : H * 0.8 - block
  lines.forEach((l, i) => {
    const y = top + i * lh + lh / 2
    ctx.lineJoin = 'round'
    ctx.lineWidth = Math.max(4, size * 0.16)
    ctx.strokeStyle = 'rgba(0,0,0,0.85)'
    ctx.strokeText(l, W / 2, y)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(l, W / 2, y)
  })
  const url = canvas.toDataURL('image/png')
  cache.set(key, url)
  return url
}

export const pngBytes = (dataUrl: string) => Uint8Array.from(atob(dataUrl.split(',')[1]), (c) => c.charCodeAt(0))
