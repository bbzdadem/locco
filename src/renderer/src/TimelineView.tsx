import { EyeOff, Lock, Music, Type, Video, Volume2, VolumeX, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { duration, itemLength, MAIN, snap, toFrame } from '../../shared/timeline'
import type { EditProject, Item, Track } from '../../shared/types'
import { IconButton } from './ui'

export const LABEL = 112
// A clip's name without its file extension (imported files are named after the file).
export const clipName = (label: string) => label.replace(/\.(mp4|mov|m4v|webm|m4a|mp3|wav|aac|png|jpe?g|webp)\b/gi, '')
// The timeline's zoom, in pixels per second.
export const zoomTo = (pps: number) => Math.min(400, Math.max(8, pps))
// Keeps the drag going when the pointer leaves the element (some synthetic pointers can't be captured; that's fine).
const capture = (e: React.PointerEvent) => {
  try {
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  } catch {}
}
const HEIGHT: Record<Track['kind'], number> = { video: 56, text: 34, audio: 40 }
type Drag = { id: string; mode: 'move' | 'trim-l' | 'trim-r'; x: number; orig: Item; before: EditProject; index: number; moved?: boolean }

// The timeline: drag a clip to move it (reorder on the video track), drag its edges to trim, click the ruler to move the
// playhead, drop media from the left onto a track. Edges snap to other clips and the playhead. Shift- or ⌘-click adds to the
// selection; audio shows its waveform. On a trackpad, pinch (or ⌘-scroll) zooms around the pointer and two fingers scroll.
// range is the in/out marks (I and O), shaded on the ruler; markers (M) sit on it too. A track's name opens its settings;
// a locked track's items can't be picked or moved, a hidden one's are dimmed. Diamonds on an item are its keys.
export function TimelineView({ p, fps, missing, time, pps, range, thumbs, waves, sel, picked, selTrack, onTrackSelect, onSeek, onZoom, onSelect, change, commit, onDrop, onTrack }: {
  p: EditProject
  fps: number
  // kind/file of the files that are gone; their items are marked.
  missing: Set<string>
  time: number
  pps: number
  range?: [number, number] | null
  onZoom: (pps: number) => void
  thumbs: Record<string, string>
  waves: Record<string, string>
  sel: string | null
  picked: string[]
  selTrack: string | null
  onTrackSelect: (id: string) => void
  onSeek: (t: number) => void
  onSelect: (id: string | null, add?: boolean) => void
  change: (fn: (p: EditProject) => void, record?: boolean) => void
  commit: (before: EditProject) => void
  onDrop: (track: Track, t: number, data: string) => void
  onTrack: (id: string, fn: (t: Track) => void) => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  // The drag lives in a ref so every pointer event sees it at once (state would lag a render behind fast moves).
  const dragRef = useRef<Drag | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [ghost, setGhost] = useState(0)
  const ghostRef = useRef(0)
  const total = duration(p)
  const width = Math.max((total + 6) * pps, 600)
  const step = pps > 120 ? 0.5 : pps > 50 ? 1 : pps > 20 ? 2 : 5
  const marks = Array.from({ length: Math.ceil((total + 6) / step) }, (_, i) => +(i * step).toFixed(2))
  const tAt = (clientX: number) => {
    const r = scroller.current!.getBoundingClientRect()
    return Math.max(0, (clientX - r.left - LABEL + scroller.current!.scrollLeft) / pps)
  }

  // While playing, keep the playhead in view.
  const follow = () => {
    const el = scroller.current
    if (!el) return
    const x = time * pps
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - LABEL - 40) el.scrollLeft = Math.max(0, x - 80)
  }
  useEffect(follow, [time])

  // Pinch zoom keeps the moment under the pointer where it is; other zooms keep the playhead in view.
  const anchor = useRef<{ t: number; x: number } | null>(null)
  const zoom = useRef({ shown: pps, target: pps })
  zoom.current = { shown: pps, target: pps }
  useLayoutEffect(() => {
    const a = anchor.current
    anchor.current = null
    if (a) scroller.current!.scrollLeft = a.t * pps - a.x
    else follow()
  }, [pps])
  useEffect(() => {
    const el = scroller.current!
    const wheel = (e: WheelEvent) => {
      // A mouse wheel with no tracks to scroll through moves along the timeline instead.
      if (!e.ctrlKey && !e.metaKey) return void (el.scrollHeight <= el.clientHeight && Math.abs(e.deltaY) > Math.abs(e.deltaX) && (e.preventDefault(), (el.scrollLeft += e.deltaY)))
      e.preventDefault()
      const z = zoom.current
      const next = zoomTo(z.target * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.003)))
      if (next === z.target) return
      const x = e.clientX - el.getBoundingClientRect().left - LABEL
      anchor.current = { t: anchor.current?.t ?? (x + el.scrollLeft) / z.shown, x }
      z.target = next
      onZoom(next)
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [onZoom])

  function down(e: React.PointerEvent, it: Item) {
    e.stopPropagation()
    if (p.tracks.find((t) => t.id === it.track)?.locked) return
    onSelect(it.id, e.shiftKey || e.metaKey)
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const off = e.clientX - r.left
    const mode = off < 7 ? 'trim-l' : off > r.width - 7 ? 'trim-r' : 'move'
    capture(e)
    dragRef.current = { id: it.id, mode, x: e.clientX, orig: it, before: structuredClone(p), index: p.items.filter((x) => x.track === MAIN).indexOf(it) }
    setDrag(dragRef.current)
    setGhost((ghostRef.current = 0))
  }
  function move(e: React.PointerEvent) {
    const drag = dragRef.current
    if (!drag) return
    // Moves and trims go a whole frame at a time.
    const dt = toFrame((e.clientX - drag.x) / pps, fps)
    if (Math.abs(e.clientX - drag.x) > 1) drag.moved = true
    const o = drag.orig
    const edges = [time, ...p.items.filter((x) => x.id !== o.id).flatMap((x) => [x.start, x.start + itemLength(x)])]
    const within = 8 / pps
    const media = o.media === 'video' || o.media === 'audio'
    const speed = o.speed ?? 1
    if (drag.mode === 'move') {
      if (o.track === MAIN) return setGhost((ghostRef.current = dt * pps))
      const start = Math.max(0, snap(o.start + dt, edges, within))
      const end = snap(start + itemLength(o), edges, within) - itemLength(o)
      return change((x) => void (x.items.find((y) => y.id === o.id)!.start = +(Math.abs(end - start) < within ? end : start).toFixed(3)), false)
    }
    change((x) => {
      const it = x.items.find((y) => y.id === o.id)!
      if (drag.mode === 'trim-l') {
        if (media) {
          const free = o.track !== MAIN
          const t0 = free ? snap(o.start + dt, edges, within) : o.start + dt
          const inn = Math.min(Math.max(0, (o.in ?? 0) + (t0 - o.start) * speed), (o.out ?? 0) - 0.1)
          it.in = +inn.toFixed(3)
          if (free) it.start = +(o.start + (inn - (o.in ?? 0)) / speed).toFixed(3)
        } else {
          const d = Math.max(0.2, (o.duration ?? 3) - dt)
          it.duration = +d.toFixed(3)
          if (o.track !== MAIN) it.start = +(o.start + (o.duration ?? 3) - d).toFixed(3)
          // A word-by-word caption's word times count from its start, so they move back by as much as the start moved on.
          const shift = (o.duration ?? 3) - d
          if (o.words && it.media === undefined && o.track !== MAIN)
            it.words = o.words.map((w) => ({ ...w, start: +Math.max(0, w.start - shift).toFixed(3), end: +(w.end - shift).toFixed(3) })).filter((w) => w.end > 0.01)
        }
      } else if (media) {
        const end = snap(o.start + itemLength(o) + dt, edges, within)
        const out = Math.min(Math.max((o.in ?? 0) + 0.1, (o.out ?? 0) + (end - o.start - itemLength(o)) * speed), o.source ?? Infinity)
        it.out = +out.toFixed(3)
      } else it.duration = +Math.max(0.2, snap(o.start + (o.duration ?? 3) + dt, edges, within) - o.start).toFixed(3)
    }, false)
  }
  function up() {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    const ghost = ghostRef.current
    const o = drag.orig
    if (drag.mode === 'move' && o.track === MAIN) {
      // Drop position on the video track: the clip goes before the first clip whose middle it passed.
      const mid = o.start + ghost / pps + itemLength(o) / 2
      const others = p.items.filter((x) => x.track === MAIN && x.id !== o.id)
      const to = others.filter((x) => x.start + itemLength(x) / 2 < mid).length
      if (to !== drag.index) {
        change((x) => {
          const main = x.items.filter((y) => y.track === MAIN && y.id !== o.id)
          main.splice(to, 0, x.items.find((y) => y.id === o.id)!)
          x.items = [...main, ...x.items.filter((y) => y.track !== MAIN)]
        }, false)
        commit(drag.before)
      }
    } else if (drag.moved) commit(drag.before)
    setDrag(null)
    setGhost(0)
  }

  const scrub = (e: React.PointerEvent) => {
    capture(e)
    onSeek(tAt(e.clientX))
  }

  return (
    <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto overscroll-x-contain select-none" onPointerMove={move} onPointerUp={up}>
      <div style={{ width: width + LABEL }} className="relative">
        <div className="sticky top-0 z-50 flex h-6 bg-bg">
          <div className="sticky left-0 z-10 shrink-0 bg-bg" style={{ width: LABEL }} />
          <div className="relative flex-1 cursor-pointer border-b border-line" onPointerDown={scrub} onPointerMove={(e) => e.buttons && onSeek(tAt(e.clientX))}>
            <div className="pointer-events-none absolute top-0 bottom-0 z-[1] w-px bg-fg" style={{ left: time * pps }}>
              <span className="absolute -top-0.5 -left-[5px] size-[11px] rounded-full bg-fg" />
            </div>
            {range && <div className="pointer-events-none absolute inset-y-0 border-x-2 border-fg bg-fg/20" style={{ left: range[0] * pps, width: Math.max(0, range[1] - range[0]) * pps }} />}
            {(p.markers ?? []).map((m) => (
              <button key={m} type="button" title={`Marker at ${m.toFixed(2)} s: click to go there (M at the playhead adds or removes one)`} onPointerDown={(e) => (e.stopPropagation(), onSeek(m))}
                className="absolute top-0 z-[2] -ml-[5px] h-0 w-0 border-x-[5px] border-t-[8px] border-x-transparent border-t-fg/70 hover:border-t-fg" style={{ left: m * pps }} />
            ))}
            {marks.map((m) => (
              <span key={m} className="absolute top-0 h-full border-l border-line pl-1 text-[10px] text-faint tabular-nums" style={{ left: m * pps }}>
                {m % 1 === 0 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` : ''}
              </span>
            ))}
          </div>
        </div>
        {p.tracks.map((tr) => {
          const items = p.items.filter((it) => it.track === tr.id)
          const Icon = tr.kind === 'video' ? Video : tr.kind === 'text' ? Type : Music
          return (
            <div key={tr.id} className="flex border-b border-line/60" style={{ height: HEIGHT[tr.kind] + 8 }}>
              <div className={`sticky left-0 z-40 flex shrink-0 items-center gap-1 border-r border-line pl-2 text-[11px] text-muted ${selTrack === tr.id ? 'bg-raised' : 'bg-bg'}`} style={{ width: LABEL }}>
                <button type="button" title="Track settings: name, order, volume, solo, hide, lock" onClick={() => onTrackSelect(tr.id)}
                  className="flex min-w-0 items-center gap-1 hover:text-fg"><Icon size={12} className="shrink-0" /> <span className="truncate">{tr.name}</span></button>
                {tr.solo && <span title="Soloed: only soloed tracks are heard" className="shrink-0 rounded bg-fg px-0.5 text-[9px] font-semibold text-bg">S</span>}
                {tr.hidden && <EyeOff size={11} className="shrink-0" aria-label="Hidden" />}
                {tr.locked && <Lock size={11} className="shrink-0" aria-label="Locked" />}
                {tr.kind === 'audio' && (
                  <IconButton title={tr.muted ? 'Unmute track' : 'Mute track'} className="size-6" onClick={() => onTrack(tr.id, (x) => void (x.muted = !x.muted))}>
                    {tr.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                  </IconButton>
                )}
                {tr.id !== MAIN && !items.length && !tr.locked && (
                  <IconButton title="Remove empty track" className="ml-auto size-6" onClick={() => change((x) => void (x.tracks = x.tracks.filter((y) => y.id !== tr.id)))}><X size={12} /></IconButton>
                )}
              </div>
              <div className="relative flex-1" onPointerDown={(e) => (e.target === e.currentTarget ? (onSelect(null), onSeek(tAt(e.clientX))) : undefined)}
                onDragOver={(e) => e.preventDefault()} onDrop={(e) => (e.preventDefault(), !tr.locked && onDrop(tr, tAt(e.clientX), e.dataTransfer.getData('text/x-locco')))}>
                {items.map((it) => {
                  const dragging = drag?.id === it.id && drag.mode === 'move' && it.track === MAIN
                  const thumb = it.ref && thumbs[`${it.ref.kind}/${it.ref.file}`]
                  const wave = it.media === 'audio' && it.ref && waves[`${it.ref.kind}/${it.ref.file}`]
                  const on = sel === it.id || picked.includes(it.id)
                  const lost = !!it.ref && missing.has(`${it.ref.kind}/${it.ref.file}`)
                  const w = Math.max(4, itemLength(it) * pps - 2)
                  return (
                    <div key={it.id} onPointerDown={(e) => down(e, it)}
                      style={{
                        left: it.start * pps, width: w, top: 4, height: HEIGHT[tr.kind],
                        transform: dragging ? `translateX(${ghost}px)` : undefined, zIndex: dragging ? 5 : undefined,
                        backgroundImage: thumb ? `url("${thumb}")` : wave ? `url("${wave}")` : undefined,
                        // A waveform covers the whole file; the part in use shows under the clip.
                        ...(wave && { backgroundSize: `${((it.source ?? it.out ?? 1) / (it.speed ?? 1)) * pps}px 100%`, backgroundPosition: `${(-(it.in ?? 0) / (it.speed ?? 1)) * pps}px 0`, backgroundRepeat: 'no-repeat' }),
                      }}
                      title={`${lost ? 'Missing file (moved to the Trash?) · ' : ''}${tr.kind === 'text' ? it.text : clipName(it.label)} · ${itemLength(it).toFixed(2)} s`}
                      className={`group absolute cursor-grab overflow-hidden rounded-md bg-[length:auto_100%] bg-repeat-x text-[11px] leading-4 active:cursor-grabbing ${
                        tr.kind === 'video' ? 'bg-raised' : tr.kind === 'text' ? 'bg-fg/80 text-bg' : 'bg-line text-fg'
                      } ${on ? 'ring-2 ring-fg ring-offset-1 ring-offset-bg' : lost ? 'ring-2 ring-danger' : ''} ${dragging ? 'opacity-80 shadow-lg' : ''} ${tr.hidden ? 'opacity-40' : ''} ${tr.locked ? 'cursor-not-allowed' : ''}`}>
                      <span className={`pointer-events-none absolute inset-y-0 left-0 w-1.5 cursor-ew-resize ${on ? 'bg-fg' : 'group-hover:bg-fg/60'}`} />
                      <span className={`pointer-events-none absolute inset-y-0 right-0 w-1.5 cursor-ew-resize ${on ? 'bg-fg' : 'group-hover:bg-fg/60'}`} />
                      {/* Too narrow for a readable name: the tooltip has it. */}
                      {w >= 72 && (
                        <span className={`pointer-events-none block truncate px-2.5 pt-0.5 ${tr.kind === 'text' ? '' : 'w-fit max-w-full rounded-br bg-black/55 text-white'}`}>
                          {lost ? 'Missing file · ' : ''}{tr.kind === 'text' ? it.text || 'Text' : clipName(it.label)}
                          {(it.speed ?? 1) !== 1 && ` · ${it.speed}×`}
                          {it.reverse && ' · backwards'}
                        </span>
                      )}
                      {/* Its keys, at their moments. */}
                      {[...new Set(Object.values(it.keys ?? {}).flatMap((ks) => ks.map((k) => k.t)))].map((t) => (
                        <span key={t} className="pointer-events-none absolute bottom-0.5 -ml-1 text-[8px] leading-none text-white drop-shadow" style={{ left: t * pps }}>◆</span>
                      ))}
                      {/* A crossfade: the part where it overlaps the clip before. */}
                      {it.track === MAIN && it.transition?.type === 'fade' && (
                        <span className="pointer-events-none absolute inset-y-0 left-0 bg-gradient-to-r from-black/50 to-transparent" style={{ width: Math.min(w, it.transition.seconds * pps) }} />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
        <div className="pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-fg" style={{ left: LABEL + time * pps }} />
      </div>
    </div>
  )
}
