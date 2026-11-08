import { Music, Type, Video, Volume2, VolumeX, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { duration, itemLength, MAIN, snap } from '../../shared/timeline'
import type { EditProject, Item, Track } from '../../shared/types'
import { IconButton } from './ui'

const LABEL = 112
// Keeps the drag going when the pointer leaves the element (some synthetic pointers can't be captured; that's fine).
const capture = (e: React.PointerEvent) => {
  try {
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  } catch {}
}
const HEIGHT: Record<Track['kind'], number> = { video: 56, text: 34, audio: 40 }
type Drag = { id: string; mode: 'move' | 'trim-l' | 'trim-r'; x: number; orig: Item; before: EditProject; index: number; moved?: boolean }

// The timeline: drag a clip to move it (reorder on the video track), drag its edges to trim, click the ruler to move the
// playhead, drop media from the left onto a track. Edges snap to other clips and the playhead.
export function TimelineView({ p, time, pps, thumbs, sel, onSeek, onSelect, change, commit, onDrop, onTrack }: {
  p: EditProject
  time: number
  pps: number
  thumbs: Record<string, string>
  sel: string | null
  onSeek: (t: number) => void
  onSelect: (id: string | null) => void
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
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const x = time * pps
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - LABEL - 40) el.scrollLeft = Math.max(0, x - 80)
  }, [time, pps])

  function down(e: React.PointerEvent, it: Item) {
    e.stopPropagation()
    onSelect(it.id)
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
    const dt = (e.clientX - drag.x) / pps
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
    <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto select-none" onPointerMove={move} onPointerUp={up}>
      <div style={{ width: width + LABEL }} className="relative">
        <div className="sticky top-0 z-20 flex h-6 bg-bg">
          <div className="sticky left-0 z-10 shrink-0 bg-bg" style={{ width: LABEL }} />
          <div className="relative flex-1 cursor-pointer border-b border-line" onPointerDown={scrub} onPointerMove={(e) => e.buttons && onSeek(tAt(e.clientX))}>
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
              <div className="sticky left-0 z-10 flex shrink-0 items-center gap-1 border-r border-line bg-bg pl-2 text-[11px] text-muted" style={{ width: LABEL }}>
                <Icon size={12} className="shrink-0" /> <span className="truncate">{tr.name}</span>
                {tr.kind === 'audio' && (
                  <IconButton title={tr.muted ? 'Unmute track' : 'Mute track'} className="size-6" onClick={() => onTrack(tr.id, (x) => void (x.muted = !x.muted))}>
                    {tr.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                  </IconButton>
                )}
                {tr.id !== MAIN && !items.length && (
                  <IconButton title="Remove empty track" className="ml-auto size-6" onClick={() => change((x) => void (x.tracks = x.tracks.filter((y) => y.id !== tr.id)))}><X size={12} /></IconButton>
                )}
              </div>
              <div className="relative flex-1" onPointerDown={(e) => (e.target === e.currentTarget ? (onSelect(null), onSeek(tAt(e.clientX))) : undefined)}
                onDragOver={(e) => e.preventDefault()} onDrop={(e) => (e.preventDefault(), onDrop(tr, tAt(e.clientX), e.dataTransfer.getData('text/x-locco')))}>
                {items.map((it) => {
                  const dragging = drag?.id === it.id && drag.mode === 'move' && it.track === MAIN
                  const thumb = it.ref && thumbs[`${it.ref.kind}/${it.ref.file}`]
                  return (
                    <div key={it.id} onPointerDown={(e) => down(e, it)}
                      style={{
                        left: it.start * pps, width: Math.max(4, itemLength(it) * pps - 2), top: 4, height: HEIGHT[tr.kind],
                        transform: dragging ? `translateX(${ghost}px)` : undefined, zIndex: dragging ? 5 : undefined,
                        backgroundImage: thumb ? `url("${thumb}")` : undefined,
                      }}
                      title={`${it.label} · ${itemLength(it).toFixed(2)} s`}
                      className={`group absolute cursor-grab overflow-hidden rounded-md bg-[length:auto_100%] bg-repeat-x text-[11px] leading-4 active:cursor-grabbing ${
                        tr.kind === 'video' ? 'bg-raised' : tr.kind === 'text' ? 'bg-fg/80 text-bg' : 'bg-line text-fg'
                      } ${sel === it.id ? 'ring-2 ring-fg ring-offset-1 ring-offset-bg' : ''} ${dragging ? 'opacity-80 shadow-lg' : ''}`}>
                      <span className={`pointer-events-none absolute inset-y-0 left-0 w-1.5 cursor-ew-resize ${sel === it.id ? 'bg-fg' : 'group-hover:bg-fg/60'}`} />
                      <span className={`pointer-events-none absolute inset-y-0 right-0 w-1.5 cursor-ew-resize ${sel === it.id ? 'bg-fg' : 'group-hover:bg-fg/60'}`} />
                      <span className={`pointer-events-none block truncate px-2.5 pt-0.5 ${tr.kind === 'video' ? 'w-fit max-w-full rounded-br bg-black/55 text-white' : ''}`}>
                        {tr.kind === 'text' ? it.text || 'Text' : it.label}
                        {(it.speed ?? 1) !== 1 && ` · ${it.speed}×`}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
        <div className="pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-fg" style={{ left: LABEL + time * pps }}>
          <span className="absolute -top-0.5 -left-[5px] size-[11px] rounded-full bg-fg" />
        </div>
      </div>
    </div>
  )
}
