import { useEffect, useRef } from 'react'
import { DIP, itemLength, MAIN, motionAt, videoEnd, ZOOM_IN } from '../../shared/timeline'
import type { EditProject, Item } from '../../shared/types'
import { mediaUrl } from './lib'
import { textCentre, textImage } from './textImage'

// Live preview of a project: the main track's clips (moving and cutting as they will in the export), overlays, the text
// on top and every audio item, all following one clock. Clips around the playhead stay loaded, so cuts play without a gap.
// The selected text or overlay can be dragged into place; safe-zone guides show what TikTok's buttons and caption cover.
export function Player({ p, time, playing, onTime, onEnd, guides, selected, onPlace }: {
  p: EditProject; time: number; playing: boolean; onTime: (t: number) => void; onEnd: () => void
  guides?: boolean; selected?: Item; onPlace?: (x: number, y: number, done: boolean) => void
}) {
  const els = useRef(new Map<string, HTMLMediaElement>())
  const frame = useRef<HTMLDivElement>(null)
  const clock = useRef({ t: time, at: 0 })
  const latest = useRef({ p, playing })
  latest.current = { p, playing }
  const total = videoEnd(p)

  // Puts every video and audio element where the clock says it should be.
  const sync = (t: number, play: boolean) => {
    const proj = latest.current.p
    for (const it of proj.items) {
      const el = els.current.get(it.id)
      if (!el) continue
      const muted = proj.tracks.find((tr) => tr.id === it.track)?.muted
      const local = t - it.start
      const playable = ((it.out ?? 0) - (it.in ?? 0)) / (it.speed ?? 1)
      const inside = local >= 0 && local < itemLength(it)
      const expected = Math.min((it.in ?? 0) + Math.max(0, local) * (it.speed ?? 1), it.out ?? 0)
      el.playbackRate = it.speed ?? 1
      if (it.media === 'video') el.muted = !it.sound || !!muted
      if (it.media === 'audio') {
        const fade = Math.min(1, it.fadeIn ? local / it.fadeIn : 1, it.fadeOut ? (itemLength(it) - local) / it.fadeOut : 1)
        el.volume = Math.max(0, Math.min(1, (it.volume ?? 1) * fade))
        el.muted = !!muted
      } else el.volume = Math.max(0, Math.min(1, it.volume ?? 1))
      const run = play && inside && local < playable
      if (!inside && it.media === 'video' && local < 0 && local > -3) {
        if (Math.abs(el.currentTime - (it.in ?? 0)) > 0.05) el.currentTime = it.in ?? 0 // ready for the cut
      }
      if (run) {
        if (Math.abs(el.currentTime - expected) > 0.3) el.currentTime = expected
        if (el.paused) void el.play().catch(() => {})
      } else {
        if (!el.paused) el.pause()
        if (inside && Math.abs(el.currentTime - expected) > 0.04) el.currentTime = expected
      }
    }
  }

  useEffect(() => {
    if (!playing) return void sync(time, false)
    clock.current = { t: time, at: performance.now() }
    let raf = 0
    let last = 0
    const tick = (now: number) => {
      const t = clock.current.t + (now - clock.current.at) / 1000
      if (t >= total) return sync(total, false), onTime(total), onEnd()
      sync(t, true)
      if (now - last > 30) (onTime(t), (last = now))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing])
  useEffect(() => void (!playing && sync(time, false)), [time, p])
  useEffect(() => () => els.current.forEach((el) => el.pause()), [])

  const main = p.items.filter((it) => it.track === MAIN)
  const active = main.findIndex((it) => time >= it.start && time < it.start + itemLength(it))
  const shown = active < 0 ? main.length - 1 : active
  const near = main.filter((_, i) => Math.abs(i - shown) <= 2)
  const kindOf = (it: Item) => p.tracks.find((tr) => tr.id === it.track)?.kind
  const at = (it: Item) => time >= it.start && time < it.start + itemLength(it)
  const texts = p.items.filter((it) => kindOf(it) === 'text' && at(it))
  const overlays = p.items.filter((it) => kindOf(it) === 'video' && it.track !== MAIN && it.ref)
  const audio = p.items.filter((it) => it.media === 'audio' && it.ref)
  const register = (it: Item) => (el: HTMLMediaElement | null) => void (el ? els.current.set(it.id, el) : els.current.delete(it.id))

  // A main clip's framing at this moment: its zoom and reframe, its movement, and a zoom transition settling in.
  const frameStyle = (it: Item) => {
    const local = Math.max(0, time - it.start)
    const playable = it.media === 'video' ? ((it.out ?? 0) - (it.in ?? 0)) / (it.speed ?? 1) : itemLength(it)
    const m = motionAt(it.motion, local / Math.max(0.1, playable))
    const settle = it.transition === 'zoom' && local < ZOOM_IN.seconds ? 1 + ZOOM_IN.scale * (1 - local / ZOOM_IN.seconds) : 1
    const s = m.zoom * settle
    return { objectPosition: `${((it.pan ?? 0) + 1) * 50}% 50%`, transform: `scale(${it.zoom ?? 1}) translateX(${(0.5 - m.x) * (s - 1) * 100}%) scale(${s})` }
  }
  // A dip through black or white around a cut: the clip fades in from it, the clip before fades out to it.
  const cur = main[shown]
  const nxt = main[shown + 1]
  const dip = (() => {
    if (!cur) return null
    const local = time - cur.start
    const left = cur.start + itemLength(cur) - time
    const color = (t?: Item['transition']) => (t === 'flash' ? '#ffffff' : '#000000')
    if ((cur.transition === 'black' || cur.transition === 'flash') && local < DIP) return { color: color(cur.transition), opacity: 1 - local / DIP }
    if ((nxt?.transition === 'black' || nxt?.transition === 'flash') && left < DIP) return { color: color(nxt.transition), opacity: 1 - left / DIP }
    return null
  })()
  const textStyle = (it: Item) => {
    if (!it.anim) return undefined
    const local = time - it.start
    const len = itemLength(it)
    const slide = it.anim === 'slide' && local < 0.3 ? (1 - local / 0.3) * 4 : 0
    return { opacity: Math.max(0, Math.min(1, local / 0.25, (len - local) / 0.25)), transform: `translateY(${slide}%)` }
  }

  // Dragging the selected text or overlay: its centre follows the pointer, in parts of the frame.
  const handle = selected && (kindOf(selected) === 'text' || (kindOf(selected) === 'video' && selected.track !== MAIN)) && at(selected)
    ? kindOf(selected) === 'text' ? textCentre(selected) : { x: selected.x ?? 0.5, y: selected.y ?? 0.5 } : null
  const place = (e: React.PointerEvent, done: boolean) => {
    const r = frame.current!.getBoundingClientRect()
    const x = Math.min(0.98, Math.max(0.02, (e.clientX - r.left) / r.width))
    const y = Math.min(0.98, Math.max(0.02, (e.clientY - r.top) / r.height))
    onPlace?.(+x.toFixed(3), +y.toFixed(3), done)
  }

  return (
    <div ref={frame} className="relative h-full overflow-hidden rounded-lg bg-black" style={{ aspectRatio: p.aspect.replace(':', ' / ') }}>
      {near.map((it) =>
        it.media === 'image' ? (
          <img key={it.id} src={mediaUrl(it.ref!)} alt="" style={frameStyle(it)} className={`absolute inset-0 size-full object-cover ${it === cur ? '' : 'opacity-0'}`} />
        ) : (
          <video key={it.id} ref={register(it)} src={mediaUrl(it.ref!)} preload="auto" playsInline style={frameStyle(it)}
            className={`absolute inset-0 size-full object-cover ${it === cur ? '' : 'opacity-0'}`} />
        ),
      )}
      {dip && <div className="pointer-events-none absolute inset-0" style={{ background: dip.color, opacity: dip.opacity }} />}
      {overlays.map((it) => {
        const style = { left: `${(it.x ?? 0.5) * 100}%`, top: `${(it.y ?? 0.5) * 100}%`, width: `${(it.scale ?? 0.4) * 100}%`, transform: 'translate(-50%, -50%)' }
        const cls = `pointer-events-none absolute h-auto ${at(it) ? '' : 'invisible'}`
        return it.media === 'image'
          ? <img key={it.id} src={mediaUrl(it.ref!)} alt="" style={style} className={cls} />
          : <video key={it.id} ref={register(it)} src={mediaUrl(it.ref!)} preload="auto" playsInline style={style} className={cls} />
      })}
      {audio.map((it) => <audio key={it.id} ref={register(it)} src={mediaUrl(it.ref!)} preload="auto" />)}
      {texts.map((it) => <img key={it.id} src={textImage(it, p.aspect)} alt={it.text} style={textStyle(it)} className="pointer-events-none absolute inset-0 size-full" />)}
      {guides && p.aspect === '9:16' && (
        <div className="pointer-events-none absolute inset-0 text-[9px] font-medium text-white/80">
          <div className="absolute inset-x-0 top-0 flex h-[8%] items-center justify-center bg-white/15">TikTok top bar</div>
          <div className="absolute top-[38%] right-0 bottom-[20%] flex w-[14%] items-center justify-center bg-white/15 text-center [writing-mode:vertical-rl]">Like · comment · share</div>
          <div className="absolute right-[14%] bottom-0 left-0 flex h-[20%] items-center justify-center bg-white/15">Caption and account</div>
        </div>
      )}
      {handle && onPlace && (
        <button type="button" aria-label="Drag to place" title="Drag to place it"
          onPointerDown={(e) => { e.preventDefault(); try { e.currentTarget.setPointerCapture(e.pointerId) } catch {} }}
          onPointerMove={(e) => e.buttons && place(e, false)} onPointerUp={(e) => place(e, true)}
          style={{ left: `${handle.x * 100}%`, top: `${handle.y * 100}%` }}
          className="absolute size-6 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-full border-2 border-white bg-black/50 shadow" />
      )}
      {!main.length && <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-[13px] text-white/60">Add clips from the media on the left</div>}
    </div>
  )
}
