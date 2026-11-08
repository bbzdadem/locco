import { useEffect, useRef } from 'react'
import { itemLength, MAIN, videoEnd } from '../../shared/timeline'
import type { EditProject, Item } from '../../shared/types'
import { mediaUrl } from './lib'
import { textImage } from './textImage'

// Live preview of a project: the main track's clips, the text on top and every audio item, all following one clock.
// Clips around the playhead stay loaded, so cuts play without a gap. The export is rendered by ffmpeg and matches this.
export function Player({ p, time, playing, onTime, onEnd }: { p: EditProject; time: number; playing: boolean; onTime: (t: number) => void; onEnd: () => void }) {
  const els = useRef(new Map<string, HTMLMediaElement>())
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
      if (now - last > 40) (onTime(t), (last = now))
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
  const texts = p.items.filter((it) => p.tracks.find((tr) => tr.id === it.track)?.kind === 'text' && time >= it.start && time < it.start + itemLength(it))
  const audio = p.items.filter((it) => it.media === 'audio' && it.ref)
  const register = (it: Item) => (el: HTMLMediaElement | null) => void (el ? els.current.set(it.id, el) : els.current.delete(it.id))
  const frameStyle = (it: Item) => ({ objectPosition: `${((it.pan ?? 0) + 1) * 50}% 50%`, transform: `scale(${it.zoom ?? 1})` })

  return (
    <div className="relative h-full overflow-hidden rounded-lg bg-black" style={{ aspectRatio: p.aspect.replace(':', ' / ') }}>
      {near.map((it) =>
        it.media === 'image' ? (
          <img key={it.id} src={mediaUrl(it.ref!)} alt="" style={frameStyle(it)} className={`absolute inset-0 size-full object-cover ${it === main[shown] ? '' : 'opacity-0'}`} />
        ) : (
          <video key={it.id} ref={register(it)} src={mediaUrl(it.ref!)} preload="auto" playsInline style={frameStyle(it)}
            className={`absolute inset-0 size-full object-cover ${it === main[shown] ? '' : 'opacity-0'}`} />
        ),
      )}
      {audio.map((it) => <audio key={it.id} ref={register(it)} src={mediaUrl(it.ref!)} preload="auto" />)}
      {texts.map((it) => <img key={it.id} src={textImage(it, p.aspect)} alt={it.text} className="pointer-events-none absolute inset-0 size-full" />)}
      {!main.length && <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-[13px] text-white/60">Add clips from the media on the left</div>}
    </div>
  )
}
