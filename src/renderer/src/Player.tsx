import { useEffect, useRef } from 'react'
import { audible, duckGain, ducks, itemLength, litWord, MAIN, motionAt, speechSpans, trackVolume, valueAt, videoEnd, ZOOM_IN } from '../../shared/timeline'
import type { EditProject, Item } from '../../shared/types'
import { mediaUrl } from './lib'
import { textCentre, textImage } from './textImage'

// A picture's colour in CSS, close to the export's (eq brightness, contrast, saturation; warmth as a colour temperature).
export const lookCss = (it: Item) => {
  const w = it.warm ?? 0
  const f = [it.bright && `brightness(${1 + it.bright * 1.5})`, (it.contrast ?? 1) !== 1 && `contrast(${it.contrast})`, (it.sat ?? 1) !== 1 && `saturate(${it.sat})`,
    w > 0 && `sepia(${w * 0.3})`, w < 0 && `hue-rotate(${w * 12}deg) saturate(${1 + w * 0.15})`].filter(Boolean)
  return f.length ? f.join(' ') : undefined
}

// Live preview of a project: the main track's clips (moving and cutting as they will in the export), overlays, the text
// on top and every audio item, all following one clock. Clips around the playhead stay loaded, so cuts play without a gap.
// The selected text or overlay can be dragged into place; safe-zone guides show what TikTok's buttons and caption cover.
// rate is the shuttle speed (J/K/L): 2 and 4 play faster; below 0 plays backwards, silent, frame by frame.
export function Player({ p, time, playing, rate = 1, onTime, onEnd, guides, selected, onPlace }: {
  p: EditProject; time: number; playing: boolean; rate?: number; onTime: (t: number) => void; onEnd: () => void
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
    const speech = speechSpans(proj)
    // A clip with a blurred background has a second, silent copy behind it that plays along.
    for (const [it, el, copy] of proj.items.flatMap((it) => [[it, els.current.get(it.id), false], [it, els.current.get(`${it.id}#bg`), true]] as const)) {
      if (!el) continue
      const heard = audible(proj, it.track)
      const local = t - it.start
      const speed = it.speed || 1
      const playable = ((it.out ?? 0) - (it.in ?? 0)) / speed
      const inside = local >= 0 && local < itemLength(it)
      // A reversed clip runs from out back to in; it's shown frame by frame (a video element can't play backwards).
      const along = Math.min(Math.max(0, local) * speed, (it.out ?? 0) - (it.in ?? 0))
      const expected = it.reverse ? (it.out ?? 0) - along : (it.in ?? 0) + along
      el.playbackRate = speed * Math.max(1, rate)
      if (it.media === 'video') el.muted = copy || !it.sound || !heard || !!it.reverse
      else if (it.media === 'audio') el.muted = !heard
      // Volume (keyframed or not), faded in and out, lowered under speech if it ducks, times its track's volume (above 100%
      // only the export is louder).
      const fade = Math.min(1, it.fadeIn ? local / it.fadeIn : 1, it.fadeOut ? (playable - local) / it.fadeOut : 1)
      const duck = ducks(proj, it) ? duckGain(speech, t, it.duckTo) : 1
      el.volume = Math.max(0, Math.min(1, valueAt(it.keys?.volume, local, it.volume ?? 1) * fade * duck * trackVolume(proj, it.track)))
      const run = play && inside && local < playable && !it.reverse
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
    // Play at the end starts again from the beginning.
    const from = rate > 0 && time >= total - 0.05 ? 0 : time
    if (from !== time) onTime(from)
    clock.current = { t: from, at: performance.now() }
    let raf = 0
    let last = 0
    const tick = (now: number) => {
      const t = clock.current.t + ((now - clock.current.at) / 1000) * rate
      if (t >= total) return sync(total, false), onTime(total), onEnd()
      if (rate < 0 && t <= 0) return sync(0, false), onTime(0), onEnd()
      sync(t, rate > 0)
      if (now - last > 30) (onTime(t), (last = now))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, rate])
  useEffect(() => void (!playing && sync(time, false)), [time, p])
  useEffect(() => () => els.current.forEach((el) => el.pause()), [])

  const main = p.items.filter((it) => it.track === MAIN)
  // The clip on screen is the last one under the playhead: during a crossfade, the one fading in.
  const active = main.findLastIndex((it) => time >= it.start && time < it.start + itemLength(it))
  const shown = active < 0 ? main.length - 1 : active
  const near = main.filter((_, i) => Math.abs(i - shown) <= 2)
  const kindOf = (it: Item) => p.tracks.find((tr) => tr.id === it.track)?.kind
  const at = (it: Item) => time >= it.start && time < it.start + itemLength(it)
  // Tracks are drawn in list order (later ones on top); hidden ones aren't.
  const layer = (it: Item) => p.tracks.findIndex((tr) => tr.id === it.track) + 1
  const shownTrack = (it: Item) => !p.tracks.find((tr) => tr.id === it.track)?.hidden
  const texts = p.items.filter((it) => kindOf(it) === 'text' && at(it) && shownTrack(it))
  const overlays = p.items.filter((it) => kindOf(it) === 'video' && it.track !== MAIN && it.ref && shownTrack(it))
  const audio = p.items.filter((it) => it.media === 'audio' && it.ref)
  const register = (it: Item, as = '') => (el: HTMLMediaElement | null) => void (el ? els.current.set(it.id + as, el) : els.current.delete(it.id + as))

  // A main clip's framing at this moment: its zoom and reframe, its movement, and a zoom transition settling in.
  const frameStyle = (it: Item) => {
    const local = Math.max(0, time - it.start)
    const playable = it.media === 'video' ? ((it.out ?? 0) - (it.in ?? 0)) / (it.speed ?? 1) : itemLength(it)
    const m = motionAt(it.motion, local / Math.max(0.1, playable))
    const tr = it.transition
    const settle = tr?.type === 'zoom' && local < tr.seconds ? 1 + ZOOM_IN.scale * (1 - local / tr.seconds) : 1
    const s = m.zoom * settle * valueAt(it.keys?.zoom, local, 1)
    const whole = it.fit === 'fit' || it.fit === 'blur'
    return {
      objectFit: whole ? 'contain' : 'cover', objectPosition: whole ? '50% 50%' : `${((it.pan ?? 0) + 1) * 50}% ${((it.tilt ?? 0) + 1) * 50}%`,
      transform: `scale(${it.keys?.zoom?.length ? 1 : it.zoom ?? 1}) translateX(${(0.5 - m.x) * (s - 1) * 100}%) scale(${s})${it.flip ? ' scaleX(-1)' : ''}`, filter: lookCss(it),
    } as const
  }
  // A dip through black or white around a cut: the clip fades in from it, the clip before fades out to it.
  const cur = main[shown]
  const nxt = main[shown + 1]
  const prev = main[shown - 1]
  const dip = (() => {
    if (!cur) return null
    const local = time - cur.start
    const left = cur.start + itemLength(cur) - time
    const dipping = (t?: Item['transition']) => (t?.type === 'black' || t?.type === 'flash' ? t : undefined)
    const [into, out] = [dipping(cur.transition), dipping(nxt?.transition)]
    if (into && local < into.seconds) return { color: into.type === 'flash' ? '#ffffff' : '#000000', opacity: 1 - local / into.seconds }
    if (out && left < out.seconds) return { color: out.type === 'flash' ? '#ffffff' : '#000000', opacity: 1 - left / out.seconds }
    return null
  })()
  // A crossfade: the clip before stays under the one fading in until the overlap is over.
  const fading = cur && prev && cur.transition?.type === 'fade' && time < prev.start + itemLength(prev) ? Math.min(1, (time - cur.start) / Math.max(0.01, prev.start + itemLength(prev) - cur.start)) : null
  const textStyle = (it: Item) => {
    if (!it.anim) return undefined
    const local = time - it.start
    const len = itemLength(it)
    const slide = it.anim === 'slide' && local < 0.3 ? (1 - local / 0.3) * 4 : 0
    return { opacity: Math.max(0, Math.min(1, local / 0.25, (len - local) / 0.25)), transform: `translateY(${slide}%)` }
  }

  // Dragging the selected text or overlay: its centre follows the pointer, in parts of the frame.
  const handle = selected && (kindOf(selected) === 'text' || (kindOf(selected) === 'video' && selected.track !== MAIN)) && at(selected)
    ? kindOf(selected) === 'text' ? textCentre(selected) : { x: valueAt(selected.keys?.x, time - selected.start, selected.x ?? 0.5), y: valueAt(selected.keys?.y, time - selected.start, selected.y ?? 0.5) } : null
  const place = (e: React.PointerEvent, done: boolean) => {
    const r = frame.current!.getBoundingClientRect()
    const x = Math.min(0.98, Math.max(0.02, (e.clientX - r.left) / r.width))
    const y = Math.min(0.98, Math.max(0.02, (e.clientY - r.top) / r.height))
    onPlace?.(+x.toFixed(3), +y.toFixed(3), done)
  }

  return (
    <div ref={frame} className="relative h-full overflow-hidden rounded-lg" style={{ aspectRatio: p.aspect.replace(':', ' / '), background: p.background ?? '#000000' }}>
      {near.map((it) => {
        const hide = it === cur || (it === prev && fading !== null) ? '' : 'opacity-0'
        const alpha = it === cur && fading !== null ? { opacity: fading } : {}
        // Blurred background: the same picture filling the frame, blurred, behind the whole one.
        const behind = it.fit === 'blur' && {
          style: { filter: `blur(${Math.round(frame.current ? frame.current.clientWidth / 40 : 8)}px)`, transform: `scale(1.1)${it.flip ? ' scaleX(-1)' : ''}` },
          className: `absolute inset-0 size-full object-cover ${hide}`,
        }
        return it.media === 'image' ? [
          behind && <img key={`${it.id}#bg`} src={mediaUrl(it.ref!)} alt="" {...behind} style={{ ...behind.style, ...alpha }} />,
          <img key={it.id} src={mediaUrl(it.ref!)} alt="" style={{ ...frameStyle(it), ...alpha }} className={`absolute inset-0 size-full ${hide}`} />,
        ] : [
          behind && <video key={`${it.id}#bg`} ref={register(it, '#bg')} src={mediaUrl(it.ref!)} preload="auto" playsInline muted {...behind} style={{ ...behind.style, ...alpha }} />,
          <video key={it.id} ref={register(it)} src={mediaUrl(it.ref!)} preload="auto" playsInline style={{ ...frameStyle(it), ...alpha }} className={`absolute inset-0 size-full ${hide}`} />,
        ]
      })}
      {dip && <div className="pointer-events-none absolute inset-0" style={{ background: dip.color, opacity: dip.opacity }} />}
      {overlays.map((it) => {
        const c = it.crop
        const local = time - it.start
        const k = it.keys
        const style = {
          left: `${valueAt(k?.x, local, it.x ?? 0.5) * 100}%`, top: `${valueAt(k?.y, local, it.y ?? 0.5) * 100}%`, width: `${(it.scale ?? 0.4) * 100}%`, filter: lookCss(it),
          opacity: valueAt(k?.opacity, local, it.opacity ?? 1), zIndex: layer(it),
          transform: `translate(-50%, -50%) rotate(${valueAt(k?.rotate, local, it.rotate ?? 0)}deg)${it.flip ? ' scaleX(-1)' : ''}`,
          // Cropping changes the picture's own shape, so its height follows the cropped part (as in the export).
          ...(c && { objectViewBox: `inset(${c.t * 100}% ${c.r * 100}% ${c.b * 100}% ${c.l * 100}%)` }),
        } as React.CSSProperties
        const cls = `pointer-events-none absolute h-auto ${at(it) ? '' : 'invisible'}`
        return it.media === 'image'
          ? <img key={it.id} src={mediaUrl(it.ref!)} alt="" style={style} className={cls} />
          : <video key={it.id} ref={register(it)} src={mediaUrl(it.ref!)} preload="auto" playsInline style={style} className={cls} />
      })}
      {audio.map((it) => <audio key={it.id} ref={register(it)} src={mediaUrl(it.ref!)} preload="auto" />)}
      {texts.map((it) => <img key={it.id} src={textImage(it, p.aspect, undefined, it.words && litWord(it.words, time - it.start))} alt={it.text} style={{ ...textStyle(it), zIndex: layer(it) }} className="pointer-events-none absolute inset-0 size-full" />)}
      {guides && p.aspect === '9:16' && (
        // What TikTok, Instagram and Facebook Reels and YouTube Shorts cover, together (Reels covers the most at the bottom).
        <div className="pointer-events-none absolute inset-0 z-50 text-[9px] font-medium text-white/80">
          <div className="absolute inset-x-0 top-0 flex h-[13%] items-center justify-center bg-white/15">Top bar</div>
          <div className="absolute top-[35%] right-0 bottom-[30%] flex w-[15%] items-center justify-center bg-white/15 text-center [writing-mode:vertical-rl]">Like · comment · share</div>
          <div className="absolute right-0 bottom-0 left-0 flex h-[30%] items-center justify-center bg-white/15">Caption, account and sound</div>
        </div>
      )}
      {handle && onPlace && (
        <button type="button" aria-label="Drag to place" title="Drag to place it"
          onPointerDown={(e) => { e.preventDefault(); try { e.currentTarget.setPointerCapture(e.pointerId) } catch {} }}
          onPointerMove={(e) => e.buttons && place(e, false)} onPointerUp={(e) => place(e, true)}
          style={{ left: `${handle.x * 100}%`, top: `${handle.y * 100}%` }}
          className="absolute z-50 size-6 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-full border-2 border-white bg-black/50 shadow" />
      )}
      {!main.length && <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-[13px] text-white/60">Add clips from the media on the left</div>}
    </div>
  )
}
