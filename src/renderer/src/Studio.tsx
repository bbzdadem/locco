import {
  ArrowLeft, AudioLines, Captions, Copy, Download, FolderOpen, Image as ImageIcon, LoaderCircle, Music, Pause, Play, Plus, Redo2, Scissors, SkipBack, Trash2, TriangleAlert,
  ArrowDown, ArrowLeftRight, ArrowUp, History, Layers, Maximize2, Mic, RefreshCw, ScanLine, Snowflake, Square, Type, Undo2, Upload, Video, X, ZoomIn, ZoomOut,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { audible, duration, ducks, EDIT_VERSION, FRAME_RATES, itemLength, keyAt, layout, MAIN, removeItems, setKeyed, speechSpans, splitAt, splitClip, toFrame, toggleKey, trackVolume, TRANSITION_SECONDS, valueAt, videoEnd } from '../../shared/timeline'
import { timing } from '../../shared/timing'
import { adVersions } from '../../shared/ads'
import type { Aspect, Attachment, EditProject, Episode, ExportRecord, Item, KeyProp, Look, ProjectRender, Ref, Scene, Series, Task, Track, VideoItem } from '../../shared/types'
import { isAudio, isVideo } from './Create'
import { api, errMsg, mediaUrl, toAttachments } from './lib'
import { Player } from './Player'
import { allTasks, clipOf, fileOf, getSnapshot, loadAll, synced, type Tasks, updateSeries } from './seriesStore'
import { pngBytes, textImage } from './textImage'
import { clipName, LABEL, TimelineView, zoomTo } from './TimelineView'
import { Header, IconButton, SelectChip } from './ui'

type HeaderProps = { collapsed: boolean; onExpand: () => void }
type MediaKind = 'video' | 'image' | 'audio'
type Media = { ref: Ref; media: MediaKind; label: string }
const ACCEPT_IMPORT = 'video/mp4,video/quicktime,video/webm,image/png,image/jpeg,image/webp,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/aac,audio/webm'
const kindOfFile = (f: string): MediaKind => (isVideo(f) || /\.(mov|webm)$/i.test(f) && !/audio/.test(f) ? 'video' : isAudio(f) || /\.aac$/i.test(f) ? 'audio' : 'image')
// Colours for text in the video (any look the video needs; the app itself stays grey).
const TEXT_COLOURS = ['#ffffff', '#000000', '#FFE14D', '#FF3B30', '#34C759', '#0A84FF', '#FF2D95']
// The shapes a video can be, with what each is for.
const ASPECTS: Aspect[] = ['9:16', '4:5', '1:1', '16:9']
const SHAPE: Record<Aspect, { name: string; use: string; w: number; h: number }> = {
  '9:16': { name: 'Vertical', use: 'Reels, TikTok, Shorts', w: 30, h: 54 },
  '4:5': { name: 'Portrait', use: 'Instagram and Facebook feed', w: 40, h: 50 },
  '1:1': { name: 'Square', use: 'Feed posts', w: 44, h: 44 },
  '16:9': { name: 'Wide', use: 'YouTube', w: 64, h: 36 },
}
const chip = (on: boolean) => `h-8 shrink-0 rounded-full border px-3 text-[13px] whitespace-nowrap tabular-nums ${on ? 'border-fg bg-raised text-fg' : 'border-line text-muted hover:bg-raised hover:text-fg'}`
const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`
const tracksFor = (): Track[] => [
  { id: MAIN, kind: 'video', name: 'Video' },
  { id: crypto.randomUUID(), kind: 'text', name: 'Text' },
  { id: crypto.randomUUID(), kind: 'audio', name: 'Audio 1' },
]
const newProject = (title: string, aspect: Aspect): EditProject =>
  ({ id: crypto.randomUUID(), version: EDIT_VERSION, title, aspect, fps: 30, tracks: tracksFor(), items: [], imports: [], exports: [], createdAt: Date.now() })

// An episode as an editing project: its scene videos on the video track (as long as their dialogue), each voice line on
// a Voices track at its time, the music underneath. Made once; opening the episode again reopens the same project.
export async function episodeProject(s: Series, ep: Episode, t: Tasks): Promise<string> {
  const found = (await api.edits()).find((p) => p.episode?.series === s.id && p.episode.episode === ep.id)
  if (found) return found.id
  // An ad opens as its first version (hook A and the body).
  const p = await buildEpisodeProject(s, ep, t, adVersions(ep)[0].scenes)
  await api.saveEdit(p)
  return p.id
}

// The given shots of an episode as an editor project (not saved): clips, the director's on-screen text, voices, music.
// Ads keep each shot's text for the whole shot and caption every line, since most people watch them on mute.
export async function buildEpisodeProject(s: Series, ep: Episode, t: Tasks, scenes = ep.scenes): Promise<EditProject> {
  const ad = s.kind === 'ad'
  const p = newProject(`${s.title} · ${ep.title}`, '9:16')
  const voices: Track = { id: crypto.randomUUID(), kind: 'audio', name: 'Voices' }
  const music: Track = { id: crypto.randomUUID(), kind: 'audio', name: 'Music' }
  p.tracks = [p.tracks[0], p.tracks[1], voices, music]
  p.episode = { series: s.id, episode: ep.id }
  const captions: Track = { id: crypto.randomUUID(), kind: 'text', name: 'Captions' }
  if (ad) p.tracks.splice(2, 0, captions)
  let at = 0
  // An ad's length, for its hook line: the best product reels keep one line of text up from the first frame to the last.
  const length = scenes.reduce((n, sc) => n + (clipOf(t, sc) ? timing(sc).seconds : 0), 0)
  for (const [i, sc] of scenes.entries()) {
    const file = clipOf(t, sc)
    const tm = timing(sc)
    if (!file) continue // a scene without video yet is left out, with its lines
    const src = await api.mediaSeconds(file)
    const out = Math.min(src || tm.seconds, tm.seconds)
    const clip = { track: MAIN, start: at, ref: { kind: 'media' as const, file }, media: 'video' as const, source: src, speed: 1, pan: 0, sound: !!s.videoSound && !synced(t, sc), volume: 1 }
    const hold = +Math.max(0, tm.seconds - out).toFixed(3)
    // An ad's long shot (a whole 4-5 s clip) is cut in two with a punch-in on the second half: a new picture every
    // 2-3 s without paying for another clip.
    const mid = ad && out >= 4 ? +(out / 2).toFixed(3) : 0
    const parts: VideoItem[] = mid
      ? [{ ...clip, id: crypto.randomUUID(), label: `Scene ${i + 1}`, in: 0, out: mid, hold: 0, zoom: 1 },
        { ...clip, id: crypto.randomUUID(), label: `Scene ${i + 1} (closer)`, in: mid, out: +out.toFixed(3), hold, zoom: 1.2 }]
      : [{ ...clip, id: crypto.randomUUID(), label: `Scene ${i + 1}`, in: 0, out: +out.toFixed(3), hold, zoom: 1 }]
    p.items.push(...parts)
    // The shot's text, voices and captions belong to its clip (the half they start in): they move with it.
    const owner = (offset: number) => (mid && offset >= mid ? parts[1] : parts[0]).id
    // The director's on-screen text goes on the text track at the start of its shot. An ad's hook line is native-style text
    // just below every app's top bar (above most faces), up for the whole video; any other line sits lower, for its shot.
    const words = sc.plan?.text?.trim()
    if (words && ad)
      p.items.push({ id: crypto.randomUUID(), track: p.tracks[1].id, start: +at.toFixed(3), label: 'Text', text: words, style: 'box', x: 0.5, y: sc.hook ? 0.22 : 0.58,
        duration: +(sc.hook ? length - at : tm.seconds).toFixed(3), link: sc.hook ? undefined : owner(0) })
    else if (words)
      p.items.push({ id: crypto.randomUUID(), track: p.tracks[1].id, start: +at.toFixed(3), label: 'Text', text: words, style: 'title', position: 'top', duration: +Math.min(tm.seconds, 2.5).toFixed(3), link: owner(0) })
    sc.lines.forEach((l, li) => {
      const vf = fileOf(t, l.voiceTask)
      if (!vf) return
      p.items.push({ id: crypto.randomUUID(), track: voices.id, start: +(at + tm.voices[li]).toFixed(3), label: `${l.speaker}: ${l.text}`, ref: { kind: 'media', file: vf },
        media: 'audio', source: l.seconds, in: 0, out: l.seconds ?? 2, volume: 1, link: owner(tm.voices[li]) })
      if (ad) p.items.push({ id: crypto.randomUUID(), track: captions.id, start: +(at + tm.voices[li]).toFixed(3), label: 'Caption', text: l.text, style: 'caption', position: 'bottom',
        duration: +(l.seconds ?? 2).toFixed(3), link: owner(tm.voices[li]) })
    })
    at += tm.seconds
  }
  const mf = ep.music !== false ? fileOf(t, ep.musicTask) : undefined
  if (mf) {
    const len = await api.mediaSeconds(mf)
    p.items.push({ id: crypto.randomUUID(), track: music.id, start: 0, label: 'Music', ref: { kind: 'media', file: mf }, media: 'audio', source: len, in: 0, out: +Math.min(len, at).toFixed(3), volume: 0.16, fadeOut: 1.5 })
  }
  return layout(p)
}

// A project as ffmpeg gets it: text drawn to full-frame PNGs; hidden tracks left out, sound only where it's heard (mute and
// solo), at its track's volume; overlays and texts with their track's place in the list, so they're drawn in that order.
const lookOf = (it: Item): Look | undefined => (it.bright || it.warm || (it.contrast ?? 1) !== 1 || (it.sat ?? 1) !== 1 ? { bright: it.bright, contrast: it.contrast, sat: it.sat, warm: it.warm } : undefined)
export async function toProjectRender(p: EditProject, opts: Pick<ProjectRender, 'quality' | 'range'> = {}): Promise<ProjectRender> {
  const shownOn = (kind: Track['kind']) => new Set(p.tracks.filter((t) => t.kind === kind && !t.hidden && t.id !== MAIN).map((t) => t.id))
  const [textTracks, overlayTracks] = [shownOn('text'), shownOn('video')]
  const layer = (it: Item) => p.tracks.findIndex((t) => t.id === it.track)
  const res = p.resolution ?? '1080p'
  // A word-by-word caption is one picture per word (that word lit), each up until the next word starts.
  const shown = p.items.filter((it) => textTracks.has(it.track) && it.text?.trim()).flatMap((it): { it: Item; hl?: number; start: number; length: number; anim?: Item['anim'] }[] => {
    if (!it.words?.length) return [{ it, hl: undefined, start: it.start, length: itemLength(it), anim: it.anim }]
    const ws = it.words
    return ws.map((w, i) => {
      const from = i ? w.start : 0
      return { it, hl: i, start: it.start + from, length: (i < ws.length - 1 ? ws[i + 1].start : itemLength(it)) - from, anim: undefined }
    }).filter((x) => x.length > 0.01)
  })
  const texts = await Promise.all(shown.map(async (x) => ({
    layer: layer(x.it), ref: await api.saveFile(`text-${x.it.id}-${x.hl ?? ''}.png`, 'image/png', pngBytes(textImage(x.it, p.aspect, res, x.hl))), start: x.start, length: x.length, anim: x.anim,
  })))
  const speech = speechSpans(p)
  const sound = (it: Item) => ({ volume: (it.volume ?? 1) * trackVolume(p, it.track), fadeIn: it.fadeIn ?? 0, fadeOut: it.fadeOut ?? 0, balance: it.balance ?? 0, keys: it.keys })
  return {
    name: p.title, aspect: p.aspect, fps: p.fps, texts, resolution: res, background: p.background ?? '#000000', normalize: p.normalize !== false, ...opts,
    main: p.items.filter((it) => it.track === MAIN && it.ref).map((it) => ({
      ...sound(it), ref: it.ref!, media: it.media === 'image' ? 'image' : 'video', start: it.start, in: it.in ?? 0, out: it.out ?? 0, length: itemLength(it), speed: it.speed ?? 1, reverse: !!it.reverse,
      fit: it.fit ?? 'fill', pan: it.pan ?? 0, tilt: it.tilt ?? 0, zoom: it.zoom ?? 1, flip: !!it.flip, sound: !!it.sound && audible(p, it.track), motion: it.motion, transition: it.transition, look: lookOf(it),
    })),
    overlays: p.items.filter((it) => overlayTracks.has(it.track) && it.ref).map((it) => ({
      ...sound(it), layer: layer(it), ref: it.ref!, media: it.media === 'image' ? 'image' : 'video', start: it.start, in: it.in ?? 0, out: it.out ?? 0, length: itemLength(it), speed: it.speed ?? 1,
      x: it.x ?? 0.5, y: it.y ?? 0.5, scale: it.scale ?? 0.4, rotate: it.rotate ?? 0, opacity: it.opacity ?? 1, crop: it.crop, flip: !!it.flip, sound: !!it.sound && audible(p, it.track), look: lookOf(it),
    })),
    // Music is lowered under speech: the speech spans, in the item's own seconds.
    audio: p.items.filter((it) => it.media === 'audio' && it.ref && audible(p, it.track)).map((it) => ({
      ...sound(it), ref: it.ref!, start: it.start, in: it.in ?? 0, out: it.out ?? 0, speed: it.speed ?? 1, duckTo: it.duckTo ?? 0.3,
      duck: ducks(p, it) ? speech.map(([a, b]) => [+(a - it.start).toFixed(3), +(b - it.start).toFixed(3)] as [number, number]).filter(([, b]) => b > 0) : undefined,
    })),
  }
}

// An ad's edit with another hook in its first slot: the hook's clip, on-screen text, voices and captions from its lines
// are swapped for the other hook's, in the same places; word-by-word captions of the old hook are dropped (run Auto
// captions on each version for those). Everything after the hook stays as edited.
function withHook(p: EditProject, from: Scene, to: Scene, t: Tasks): EditProject {
  const q = structuredClone(p)
  const [a, b] = [clipOf(t, from), clipOf(t, to)]
  const voicesOf = (sc: Scene) => sc.lines.map((l) => fileOf(t, l.voiceTask))
  const [va, vb] = [voicesOf(from), voicesOf(to)]
  const slot = q.items.filter((it) => it.track === MAIN && it.ref?.file === a)
  const end = Math.max(0, ...slot.map((it) => it.start + itemLength(it)))
  const gone = new Set<string>()
  for (const it of q.items) {
    if (it.ref?.file === a && b) it.ref = { kind: 'media', file: b }
    if (it.text !== undefined) {
      if (it.words && it.start < end) gone.add(it.id)
      else if (from.plan?.text && it.text.trim() === from.plan.text.trim()) to.plan?.text?.trim() ? (it.text = to.plan.text.trim()) : gone.add(it.id)
      else {
        const li = from.lines.findIndex((l) => l.text.trim() === it.text!.trim())
        if (li >= 0) to.lines[li] ? (it.text = to.lines[li].text) : gone.add(it.id)
      }
    }
    const vi = it.media === 'audio' && it.ref ? va.indexOf(it.ref.file) : -1
    if (vi >= 0) {
      const f = vb[vi]
      if (!f) gone.add(it.id)
      else Object.assign(it, { ref: { kind: 'media', file: f }, in: 0, out: to.lines[vi].seconds ?? it.out, source: to.lines[vi].seconds, label: `${to.lines[vi].speaker}: ${to.lines[vi].text}` })
    }
  }
  q.items = q.items.filter((it) => !gone.has(it.id))
  return q
}

export function StudioView({ header, openId, onOpen }: { header: HeaderProps; openId?: string; onOpen: (id?: string) => void }) {
  const [projects, setProjects] = useState<EditProject[] | null>(null)
  const refresh = useCallback(() => void api.edits().then(setProjects), [])
  useEffect(refresh, [openId])
  const open = projects?.find((p) => p.id === openId)
  if (open) return <ProjectEditor key={open.id} initial={open} onBack={() => (onOpen(undefined), refresh())} />
  return <ProjectList header={header} projects={projects ?? []} onOpen={onOpen} refresh={refresh} />
}

function ProjectList({ header, projects, onOpen, refresh }: { header: HeaderProps; projects: EditProject[]; onOpen: (id: string) => void; refresh: () => void }) {
  const [confirm, setConfirm] = useState<string | null>(null)
  const create = async (aspect: Aspect) => {
    const p = newProject(`Untitled ${SHAPE[aspect].name.toLowerCase()} video`, aspect)
    await api.saveEdit(p)
    onOpen(p.id)
  }
  return (
    <div className="flex h-full flex-col">
      <Header {...header}><span className="font-medium">Edit</span></Header>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 pt-6 pb-16">
          <div className="flex flex-col gap-3">
            <h2 className="font-medium">New video</h2>
            <div className="flex gap-3">
              {ASPECTS.map((a) => (
                <button key={a} type="button" onClick={() => create(a)} className="flex flex-1 flex-col items-center gap-2 rounded-2xl border border-line p-4 hover:bg-raised">
                  <span className="rounded-md border-2 border-muted" style={{ width: SHAPE[a].w, height: SHAPE[a].h }} />
                  <span className="text-[13px] font-medium">{SHAPE[a].name} {a}</span>
                  <span className="text-center text-xs text-faint">{SHAPE[a].use}</span>
                </button>
              ))}
            </div>
            <p className="text-xs text-faint">Cut, trim, reorder, add text, music and voice-overs from locco or your own files. Everything renders on your Mac, free. Series episodes open here from their Cut step.</p>
          </div>
          {projects.length > 0 && (
            <div className="flex flex-col gap-1">
              <h2 className="mb-1 font-medium">Your edits</h2>
              {projects.map((p) => (
                <div key={p.id} className="group flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-raised">
                  <button type="button" onClick={() => onOpen(p.id)} className="flex min-w-0 flex-1 flex-col text-left">
                    <span className="truncate font-medium">{p.title}</span>
                    <span className="text-xs text-faint tabular-nums">{p.aspect} · {p.items.filter((it) => it.track === MAIN).length} clips · {fmt(videoEnd(p))}{p.episode ? ' · Series episode' : ''}{p.exports.length ? ` · exported ${p.exports.length}×` : ''}</span>
                  </button>
                  {confirm === p.id ? (
                    <>
                      <span className="text-[13px]">Delete this edit? Its media stays.</span>
                      <button type="button" onClick={() => api.deleteEdit(p.id).then(refresh)} className="h-8 rounded-full bg-inverse px-3 text-[13px] font-medium text-on-inverse">Delete</button>
                      <button type="button" onClick={() => setConfirm(null)} className="h-8 rounded-full px-3 text-[13px] hover:bg-line">Keep</button>
                    </>
                  ) : (
                    <>
                      {/* A copy to try another cut: same clips, text and sound; its own exports, and no longer tied to a series episode. */}
                      <IconButton title="Duplicate edit" className="hidden size-7 group-hover:inline-flex"
                        onClick={() => { const { episode: _, ...rest } = structuredClone(p); void api.saveEdit({ ...rest, id: crypto.randomUUID(), title: `${p.title} (copy)`, exports: [], createdAt: Date.now() }).then(refresh) }}><Copy size={14} /></IconButton>
                      <IconButton title="Delete edit" className="hidden size-7 group-hover:inline-flex" onClick={() => setConfirm(p.id)}><Trash2 size={14} /></IconButton>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ProjectEditor({ initial, onBack }: { initial: EditProject; onBack: () => void }) {
  const [p, setP] = useState(() => layout(initial))
  const current = useRef(p)
  current.current = p
  const [past, setPast] = useState<EditProject[]>([])
  const [future, setFuture] = useState<EditProject[]>([])
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  // Shuttle speed for J/K/L (negative plays backwards); back to normal whenever playback stops.
  const [rate, setRate] = useState(1)
  useEffect(() => void (!playing && setRate(1)), [playing])
  // When playback stops, the playhead settles on a whole frame, so cuts and splits land on one.
  useEffect(() => void (!playing && setTime((t) => Math.min(toFrame(t, current.current.fps), videoEnd(current.current)))), [playing])
  const stage = useRef<HTMLDivElement>(null)
  const timeline = useRef<HTMLDivElement>(null)
  const [sel, setSel] = useState<string | null>(null)
  // Shift- or ⌘-clicked items join the selection (sel stays the one the inspector shows).
  const [picked, setPicked] = useState<string[]>([])
  const [waves, setWaves] = useState<Record<string, string>>({})
  const clipboard = useRef<Item[]>([])
  const [rec, setRec] = useState<{ stop: () => void; since: number } | null>(null)
  const [, tick] = useState(0)
  const [exportPanel, setExportPanel] = useState(false)
  const exportBox = useRef<HTMLDivElement>(null)
  // The export panel closes on a click anywhere else (and on Escape).
  useEffect(() => {
    if (!exportPanel) return
    const h = (e: PointerEvent) => !exportBox.current?.contains(e.target as Node) && setExportPanel(false)
    addEventListener('pointerdown', h)
    return () => removeEventListener('pointerdown', h)
  }, [exportPanel])
  const [quality, setQuality] = useState<'standard' | 'high'>('standard')
  // The part to export (I and O) is kept with the edit.
  const part = p.range ?? null
  const setPart = (r: [number, number] | null) => change((x) => void (r ? (x.range = r) : delete x.range), false)
  const [pps, setPps] = useState(60)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [exported, setExported] = useState<string | null>(null)
  const [guides, setGuides] = useState(false)
  const [history, setHistory] = useState(false)
  // An episode or ad's edit is made once; if its clips change afterwards (redrawn, animated again), offer to rebuild it.
  const [fresh, setFresh] = useState<EditProject | null>(null)
  const placing = useRef<EditProject | null>(null)
  const saving = useRef(0)
  const total = videoEnd(p)

  const persist = (next: EditProject) => {
    clearTimeout(saving.current)
    saving.current = window.setTimeout(() => void api.saveEdit(next), 300)
  }
  const set = (next: EditProject, before?: EditProject) => {
    if (before) (setPast((h) => [...h.slice(-80), before]), setFuture([]))
    setP(next)
    persist(next)
  }
  // Every change goes through here: the main track is laid out again and the change saved. record: false while dragging.
  // group: changes in a row with the same group (one slider's moves, typing in one box) are one undo step.
  const group = useRef<string | null>(null)
  const change = useCallback((fn: (x: EditProject) => void, record = true, key?: string) => {
    const cur = current.current
    const next = structuredClone(cur)
    fn(next)
    const fresh = record && !(key && key === group.current)
    if (record) group.current = key ?? null
    set(layout(next), fresh ? cur : undefined)
  }, [])
  const commit = (before: EditProject) => ((group.current = null), setPast((h) => [...h.slice(-80), before]), setFuture([]))
  const undo = () => past.length && ((group.current = null), setFuture((f) => [p, ...f]), setPast((h) => h.slice(0, -1)), set(past.at(-1)!))
  const redo = () => future.length && ((group.current = null), setPast((h) => [...h, p]), setFuture((f) => f.slice(1)), set(future[0]))

  useEffect(() => {
    const ref = initial.episode
    if (!ref) return
    void (async () => {
      await loadAll()
      const s = getSnapshot().series.find((x) => x.id === ref.series)
      const ep = s?.episodes.find((e) => e.id === ref.episode)
      if (!s || !ep) return
      const built = await buildEpisodeProject(s, ep, await allTasks(), adVersions(ep)[0].scenes)
      const files = (x: EditProject) => new Set(x.items.filter((it) => it.track === MAIN).map((it) => it.ref?.file))
      const have = files(current.current)
      if ([...files(built)].some((f) => !have.has(f))) setFresh(built)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const rebuild = () => fresh && (change((x) => void ((x.tracks = fresh.tracks), (x.items = fresh.items))), setFresh(null), setSel(null))
  // Dragging text or an overlay on the preview. Word-by-word captions move together.
  const place = (px: number, py: number, done: boolean) => {
    if (!sel) return
    if (!placing.current) placing.current = current.current
    change((x) => {
      const it = x.items.find((y) => y.id === sel)
      if (!it) return
      const group = it.words ? x.items.filter((y) => y.track === it.track && y.words) : [it]
      // A keyframed place moves its key at the playhead.
      group.forEach((y) => {
        setKeyed(y, 'x', time - y.start, px, (v) => void (y.x = v))
        setKeyed(y, 'y', time - y.start, py, (v) => void (y.y = v))
      })
    }, false)
    if (done) (commit(placing.current), (placing.current = null))
  }

  // Thumbnails for every video and waveforms for every sound on the timeline, each asked for once (the timeline changes
  // many times a second while dragging, long before ffmpeg has made one).
  const asked = useRef(new Set<string>())
  useEffect(() => {
    for (const it of p.items) {
      if (!it.ref) continue
      const key = `${it.ref.kind}/${it.ref.file}`
      if (asked.current.has(key)) continue
      asked.current.add(key)
      if (it.media === 'image') setThumbs((m) => ({ ...m, [key]: mediaUrl(it.ref!) }))
      else if (it.media === 'video') void api.thumb(it.ref).then((r) => setThumbs((m) => ({ ...m, [key]: mediaUrl(r) })), () => {})
      else if (it.media === 'audio') void api.waveform(it.ref).then((r) => setWaves((m) => ({ ...m, [key]: mediaUrl(r) })), () => {})
    }
  }, [p.items])

  // Files this edit uses that are gone (moved to the Trash from Create, say): checked when the clips change and when you
  // come back to the window (after putting one back).
  const [missing, setMissing] = useState<Set<string>>(new Set())
  const refsKey = [...new Set(p.items.flatMap((it) => (it.ref ? [`${it.ref.kind}/${it.ref.file}`] : [])))].join('|')
  useEffect(() => {
    const check = () => void api.missing(current.current.items.flatMap((it) => (it.ref ? [it.ref] : []))).then((m) => setMissing(new Set(m)))
    check()
    addEventListener('focus', check)
    return () => removeEventListener('focus', check)
  }, [refsKey])

  const selected = p.items.find((it) => it.id === sel)
  const chosen = [...new Set([...(sel ? [sel] : []), ...picked])].filter((id) => p.items.some((it) => it.id === id))
  // The track whose settings show on the right (clicking an item shows the item's instead).
  const [selTrack, setSelTrack] = useState<string | null>(null)
  const select = (id: string | null, add?: boolean) => {
    if (id) setSelTrack(null)
    if (add && id) {
      setPicked((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, ...(sel && sel !== id ? [sel] : []), id]))
      setSel(id)
    } else (setPicked([]), setSel(id))
  }
  // Split and freeze say why when there's nothing to do at the playhead.
  const splitHere = () => {
    const under = (it: Item) => time > it.start && time < it.start + itemLength(it)
    const target = p.items.find((it) => it.id === sel && under(it)) ?? p.items.find((it) => it.track === MAIN && under(it))
    if (!target || !splitAt(target, time, '')) return setError('Nothing to split here: move the playhead inside a clip, not onto its edge.')
    setError('')
    change((x) => void splitClip(x, target.id, time, () => crypto.randomUUID()))
  }
  // Deleting a clip on the video track closes its gap and keeps the other tracks in sync (see removeItems).
  const locked = (id: string) => !!p.tracks.find((t) => t.id === p.items.find((it) => it.id === id)?.track)?.locked
  const remove = () => {
    const ids = chosen.filter((id) => !locked(id))
    if (!ids.length) return
    change((x) => removeItems(x, ids))
    select(null)
  }
  // Copy, paste (at the playhead) and duplicate (right after). Video-track clips are inserted where they land.
  const copy = () => void (clipboard.current = structuredClone(p.items.filter((it) => chosen.includes(it.id))))
  const paste = (at = time) => {
    const items = clipboard.current
    if (!items.length) return
    const first = Math.min(...items.map((it) => it.start))
    // New ids; what was linked to a pasted clip is linked to its copy (and moves with it), anything else loses its link.
    const ids = new Map(items.map((it) => [it.id, crypto.randomUUID()]))
    const fresh = (it: Item): Item => ({ ...structuredClone(it), id: ids.get(it.id)!, link: it.link && ids.get(it.link) })
    change((x) => {
      const mains = items.filter((it) => it.track === MAIN).map(fresh)
      if (mains.length) {
        const main = x.items.filter((it) => it.track === MAIN)
        main.splice(main.filter((it) => it.start + itemLength(it) / 2 < at).length, 0, ...mains)
        x.items = [...main, ...x.items.filter((it) => it.track !== MAIN)]
      }
      // A pasted clip keeps its old start until it's laid out; what's linked to it keeps its own too, and moves with it.
      for (const it of items.filter((y) => y.track !== MAIN && x.tracks.some((t) => t.id === y.track)))
        x.items.push(it.link && ids.has(it.link) ? fresh(it) : { ...fresh(it), start: +(at + it.start - first).toFixed(3) })
    })
  }
  const duplicate = () => {
    copy()
    const done = p.items.filter((it) => chosen.includes(it.id))
    if (done.length) paste(Math.max(...done.map((it) => it.start + itemLength(it))))
  }
  // Freeze frame: the clip under the playhead holds that frame for a second, and everything after moves along.
  const freeze = () => {
    const under = (it: Item) => it.track === MAIN && it.media === 'video' && time > it.start + 0.05 && time < it.start + itemLength(it) - 0.05
    const target = p.items.find(under)
    if (!target || !splitAt(target, time, '')) return setError('Freeze needs a video clip under the playhead: move it inside one (pictures already hold still).')
    setError('')
    change((x) => {
      splitClip(x, target.id, time, () => crypto.randomUUID())
      const first = x.items.find((y) => y.id === target.id)
      if (first?.media === 'video') first.hold = +((first.hold ?? 0) + 1).toFixed(3)
      // Linked items follow their clip on their own.
      for (const y of x.items) if (y.track !== MAIN && !y.link && y.start >= time - 0.01) y.start = +(y.start + 1).toFixed(3)
    })
  }

  // A voice-over recorded from the mic, starting at the playhead, while the video plays (use headphones).
  useEffect(() => {
    if (!rec) return
    const t = setInterval(() => tick((n) => n + 1), 500)
    return () => clearInterval(t)
  }, [rec])
  async function record() {
    if (rec) return rec.stop()
    setError('')
    if (!(await api.micAccess())) return setError('Allow the microphone for locco in System Settings › Privacy & Security › Microphone.')
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true })
      const type = ['audio/mp4', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported(t))
      const r = new MediaRecorder(media, type ? { mimeType: type } : undefined)
      const chunks: Blob[] = []
      const at = time
      r.ondataavailable = (e) => chunks.push(e.data)
      r.onstop = async () => {
        media.getTracks().forEach((t) => t.stop())
        setRec(null)
        setPlaying(false)
        const mime = r.mimeType.split(';')[0]
        const a = await api.saveFile(`voice-over-${Date.now()}.${mime.includes('mp4') ? 'm4a' : 'webm'}`, mime, new Uint8Array(await new Blob(chunks, { type: mime }).arrayBuffer()))
        await add({ ref: { kind: a.kind, file: a.file }, media: 'audio', label: 'Voice-over' }, at)
      }
      r.start()
      setRec({ stop: () => r.stop(), since: Date.now() })
      setPlaying(true)
    } catch (e) {
      setError(errMsg(e))
    }
  }

  // Keyboard shortcuts, the same keys as CapCut where it has one. Typing in a field never triggers them.
  // Moves the selected text, sound and overlays along the timeline (video-track clips stay back to back).
  const nudge = (d: number) => {
    const ids = chosen.filter((id) => p.items.find((it) => it.id === id)?.track !== MAIN)
    if (ids.length) change((x) => void x.items.forEach((it) => ids.includes(it.id) && (it.start = Math.max(0, toFrame(it.start + d, x.fps)))))
  }
  // The playhead to the previous or next cut on any track, or marker.
  const jump = (dir: number) => {
    const cuts = [0, total, ...(p.markers ?? []), ...p.items.flatMap((it) => [it.start, it.start + itemLength(it)])].filter((c) => c <= total && (dir < 0 ? c < time - 0.01 : c > time + 0.01))
    if (cuts.length) (setPlaying(false), setTime(dir < 0 ? Math.max(...cuts) : Math.min(...cuts)))
  }
  // In and out marks (I, O) set the part to export.
  const mark = (out: boolean) => {
    const t = +time.toFixed(2)
    const [a, b] = part ?? [0, +total.toFixed(2)]
    setPart(out ? [a < t ? a : 0, t] : [t, b > t ? b : +total.toFixed(2)])
  }
  // A marker at the playhead (M), or off again if there's one there.
  const marker = () => change((x) => {
    const t = toFrame(time, x.fps)
    const had = (x.markers ?? []).some((m) => Math.abs(m - t) < 0.02)
    x.markers = had ? x.markers!.filter((m) => Math.abs(m - t) >= 0.02) : [...(x.markers ?? []), t].sort((a, b) => a - b)
    if (!x.markers.length) delete x.markers
  })
  const fit = () => setPps(zoomTo((timeline.current!.clientWidth - LABEL - 24) / Math.max(1, duration(p))))
  const fullScreen = () => (document.fullscreenElement ? document.exitFullscreen() : stage.current!.requestFullscreen()).catch(() => {})
  const shuttle = (dir: number) => (setRate((r) => (playing && Math.sign(r) === dir ? Math.max(-4, Math.min(4, r * 2)) : dir)), setPlaying(true))
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      // A slider keeps the keys it uses (arrows, Home, End); every other shortcut still works after you've moved one.
      const el = e.target as HTMLInputElement
      const k = e.key.toLowerCase()
      if (/TEXTAREA|SELECT/.test(el.tagName) || (el.tagName === 'INPUT' && (el.type !== 'range' || /^(arrow|home|end|page)/.test(k)))) return
      if (k === 'escape' && exportPanel) return setExportPanel(false)
      const arrow = k === 'arrowleft' ? -1 : k === 'arrowright' ? 1 : 0
      const stop = () => e.preventDefault()
      if (e.metaKey) {
        if (k === 'z') return stop(), e.shiftKey ? redo() : undo()
        if (k === 'c') return copy()
        if (k === 'x') return stop(), copy(), remove()
        if (k === 'v') return stop(), paste()
        if (k === 'd') return stop(), duplicate()
        if (k === 'b') return stop(), splitHere()
        if (k === 'a') return stop(), setSel(null), setPicked(p.items.map((it) => it.id))
        if (k === 'f' && e.shiftKey) return stop(), void fullScreen()
        return
      }
      if (e.altKey && arrow) return stop(), nudge(arrow * (e.shiftKey ? 1 : 1 / p.fps))
      if (e.altKey && e.code === 'KeyX') return setPart(null)
      if (k === ' ') return stop(), setRate(1), setPlaying((v) => !v)
      if (k === 'j' || k === 'l') return shuttle(k === 'l' ? 1 : -1)
      if (k === 'k') return setPlaying(false)
      if (k === 'z' && e.shiftKey) return fit()
      if (k === 's') return splitHere()
      if (k === 'f') return freeze()
      if (k === 'i' || k === 'o') return mark(k === 'o')
      if (k === 'm') return marker()
      if (k === 'backspace' || k === 'delete') return remove()
      if (arrow) return stop(), setPlaying(false), setTime((t) => Math.min(total, Math.max(0, toFrame(t + arrow * (e.shiftKey ? 1 : 1 / p.fps), p.fps))))
      if (k === 'arrowup' || k === 'arrowdown') return stop(), jump(k === 'arrowup' ? -1 : 1)
      if (k === 'home' || k === 'end') return setPlaying(false), setTime(k === 'home' ? 0 : total)
      if (k === '=' || k === '+') return setPps((v) => zoomTo(v * 1.3))
      if (k === '-') return setPps((v) => zoomTo(v / 1.3))
      if (k === 'escape') (select(null), setSelTrack(null), setHistory(false))
    }
    addEventListener('keydown', h)
    return () => removeEventListener('keydown', h)
  })

  // Adds media at time t: pictures and video onto the video track at that point, sound onto an audio track with room.
  async function add(m: Media, t = time, track?: Track) {
    const id = crypto.randomUUID()
    const src = m.media === 'image' ? 0 : await api.mediaSeconds(m.ref)
    // Past the end of the video nothing is seen or heard (and the playhead rests there after playing): a sound or overlay
    // added there is pulled back so it ends with the video.
    const end = videoEnd(current.current)
    if ((m.media === 'audio' || (track?.kind === 'video' && track.id !== MAIN)) && end > 0 && t > end - 0.1) t = Math.max(0, end - (src || 3))
    change((x) => {
      // On an overlay track a picture or clip sits where it's dropped, a third of the way down, 40% wide.
      if (m.media !== 'audio' && track?.kind === 'video' && track.id !== MAIN) {
        const base = { id, track: track.id, start: +t.toFixed(3), label: m.label, ref: m.ref, x: 0.5, y: 0.33, scale: 0.4 }
        x.items.push(m.media === 'image' ? { ...base, media: 'image', duration: 3 } : { ...base, media: 'video', source: src, in: 0, out: src || 5, speed: 1, hold: 0, sound: false, volume: 1 })
        return
      }
      if (m.media !== 'audio') {
        const at = x.items.filter((it) => it.track === MAIN && it.start + itemLength(it) / 2 < t).length
        const main = x.items.filter((it) => it.track === MAIN)
        main.splice(at, 0, m.media === 'image'
          ? { id, track: MAIN, start: 0, label: m.label, ref: m.ref, media: 'image', duration: 3, pan: 0, zoom: 1 }
          : { id, track: MAIN, start: 0, label: m.label, ref: m.ref, media: 'video', source: src, in: 0, out: src || 5, speed: 1, pan: 0, zoom: 1, hold: 0, sound: true, volume: 1 })
        x.items = [...main, ...x.items.filter((it) => it.track !== MAIN)]
        return
      }
      const free = (tr: Track) => !x.items.some((it) => it.track === tr.id && it.start < t + src && t < it.start + itemLength(it))
      let target = track?.kind === 'audio' ? track : x.tracks.find((tr) => tr.kind === 'audio' && free(tr))
      if (!target) x.tracks.push((target = { id: crypto.randomUUID(), kind: 'audio', name: `Audio ${x.tracks.filter((tr) => tr.kind === 'audio').length + 1}` }))
      // Music longer than the video is trimmed to it, with a fade-out (drag its edge to change that).
      const room = videoEnd(x) - t
      const fit = src > 30 && room > 1 && src > room
      x.items.push({ id, track: target.id, start: +t.toFixed(3), label: m.label, ref: m.ref, media: 'audio', source: src, in: 0, out: +(fit ? room : src || 3).toFixed(3),
        volume: fit ? 0.4 : 1, fadeIn: 0, fadeOut: fit ? 1.5 : 0 })
    })
    setSel(id)
  }
  // Extract sound: the clip's sound becomes its own audio item right under it (on a free audio track) and the clip goes
  // silent, so the sound can be moved, trimmed, faded or kept after the picture is cut.
  async function extract(it: Item) {
    setError('')
    try {
      const { ref, seconds } = await api.extractSound(it.ref!, it.in ?? 0, it.out ?? 0, it.speed ?? 1, !!it.reverse)
      const id = crypto.randomUUID()
      change((x) => {
        const free = (tr: Track) => !x.items.some((y) => y.track === tr.id && y.start < it.start + seconds && it.start < y.start + itemLength(y))
        let target = x.tracks.find((tr) => tr.kind === 'audio' && free(tr))
        if (!target) x.tracks.push((target = { id: crypto.randomUUID(), kind: 'audio', name: `Audio ${x.tracks.filter((tr) => tr.kind === 'audio').length + 1}` }))
        // Linked to its clip, so it moves, is cut and is deleted with it.
        x.items.push({ id, track: target.id, start: it.start, label: `${it.label} (sound)`, ref, media: 'audio', source: seconds, in: 0, out: seconds, volume: it.volume ?? 1, fadeIn: 0, fadeOut: 0,
          link: it.track === MAIN ? it.id : undefined })
        const clip = x.items.find((y) => y.id === it.id)
        if (clip) clip.sound = false
      })
      setSel(id)
    } catch (e) {
      setError(errMsg(e))
    }
  }
  function addText(text = 'Your text', at = time, len = 3, style: Item['style'] = 'caption') {
    const id = crypto.randomUUID()
    change((x) => {
      let tr = x.tracks.find((t) => t.kind === 'text')
      if (!tr) x.tracks.splice(1, 0, (tr = { id: crypto.randomUUID(), kind: 'text', name: 'Text' }))
      x.items.push({ id, track: tr.id, start: +at.toFixed(3), label: 'Text', text, style, position: style === 'title' ? 'middle' : 'bottom', duration: len })
    })
    setSel(id)
  }
  // Captions from the episode's script: one text item per voice line, at the line's time on the Voices track.
  function captions() {
    const voices = p.items.filter((it) => it.media === 'audio' && /^[^:]{1,40}: /.test(it.label) && p.tracks.find((t) => t.id === it.track)?.name === 'Voices')
    if (!voices.length) return setError('This episode has no recorded voice lines on its Voices track, so there is nothing to caption.')
    change((x) => {
      let tr = x.tracks.find((t) => t.kind === 'text' && t.name === 'Captions')
      if (!tr) x.tracks.splice(1, 0, (tr = { id: crypto.randomUUID(), kind: 'text', name: 'Captions' }))
      x.items = x.items.filter((it) => it.track !== tr!.id)
      for (const v of voices)
        x.items.push({ id: crypto.randomUUID(), track: tr.id, start: v.start, label: 'Caption', text: v.label.replace(/^[^:]+: /, ''), style: 'caption', position: 'bottom', duration: +itemLength(v).toFixed(3) })
    })
  }

  // Word-by-word captions from whatever speaks on the timeline (voices, voice-overs, clips with their sound on; music is
  // skipped): kie transcribes it with a time for every word, words are grouped three at a time, and the word being said
  // lights up.
  async function autoCaptions() {
    setBusy('captions')
    setError('')
    try {
      const music = (it: Item) => /music/i.test(`${it.label} ${p.tracks.find((t) => t.id === it.track)?.name ?? ''}`)
      const sources = p.items.filter((it) => it.ref && audible(p, it.track) && ((it.media === 'audio' && !music(it)) || (it.media === 'video' && it.sound && !it.reverse)))
      if (!sources.length) throw new Error('Nothing on the timeline speaks: add a voice-over, or turn a clip’s sound on, then try again.')
      const words: { text: string; start: number; end: number }[] = []
      for (const it of sources) {
        const sp = it.speed ?? 1
        const end = it.start + itemLength(it)
        for (const w of await api.wordsIn(it.ref!, it.in ?? 0, it.out ?? 0)) {
          const start = it.start + w.start / sp
          if (start < end) words.push({ text: w.text, start, end: Math.min(end, it.start + w.end / sp) })
        }
      }
      if (!words.length) throw new Error('No speech was found in the voices or clips on the timeline.')
      words.sort((a, b) => a.start - b.start)
      const chunks: (typeof words)[] = []
      for (const w of words) {
        const c = chunks.at(-1)
        if (c && c.length < 3 && w.start - c.at(-1)!.end < 0.5 && !/[.!?]$/.test(c.at(-1)!.text)) c.push(w)
        else chunks.push([w])
      }
      change((x) => {
        let tr = x.tracks.find((t) => t.kind === 'text' && t.name === 'Captions')
        if (!tr) x.tracks.splice(1, 0, (tr = { id: crypto.randomUUID(), kind: 'text', name: 'Captions' }))
        x.items = x.items.filter((it) => it.track !== tr!.id)
        // One caption per group of words, holding each word's time from the caption's start.
        for (const c of chunks) {
          const at = c[0].start
          const words = c.map((w) => ({ text: w.text, start: +(w.start - at).toFixed(3), end: +(w.end - at).toFixed(3) }))
          x.items.push({ id: crypto.randomUUID(), track: tr!.id, start: +at.toFixed(3), label: 'Caption', text: c.map((q) => q.text).join(' '), style: 'caption',
            words, y: 0.68, size: 1.1, duration: +Math.max(0.12, c.at(-1)!.end + 0.15 - at).toFixed(3) })
        }
      })
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy('')
    }
  }

  // Each export is kept in the edit's list with how it was made, and the edit as it was then is saved as a version.
  function logExport(files: string[], what: ExportRecord['what']) {
    const at = Date.now()
    change((x) => void x.exports.push(...files.map((file) => ({ file, at, what, quality, resolution: x.resolution ?? '1080p', fps: x.fps, ...(part && what !== 'hook' && { range: part }) }))), false)
    void api.saveVersion(current.current, `Exported ${new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`)
  }
  async function exportVideo() {
    setBusy('export')
    setError('')
    setPlaying(false)
    setExportPanel(false)
    try {
      const file = await api.renderEdit(await toProjectRender(p, { quality, range: part ?? undefined }))
      logExport([file], part ? 'part' : 'video')
      // An episode's edit becomes the episode's cut (the earlier cut is kept in its list).
      if (p.episode) {
        await loadAll()
        await updateSeries(p.episode.series, (s) => {
          const e = s.episodes.find((y) => y.id === p.episode!.episode)
          if (!e) return
          if (e.cut) e.cuts = [...(e.cuts ?? []), e.cut]
          e.cut = file
        })
      }
      setExported(file)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy('')
    }
  }

  // An ad's edit, exported once per hook: this edit with each other hook in the first slot (its clip, text and voices
  // swapped in; everything after stays as edited). The versions become the ad's cut.
  const [hooks, setHooks] = useState(0)
  // Text versions: the same video with other hook lines, one post each (how sellers test hooks cheaply). An ad starts
  // with the extra lines its writer suggested.
  const [lines, setLines] = useState('')
  useEffect(() => {
    const ref = initial.episode
    if (!ref) return
    void loadAll().then(() => {
      const s = getSnapshot().series.find((x) => x.id === ref.series)
      const ep = s?.kind === 'ad' ? s.episodes.find((e) => e.id === ref.episode) : undefined
      if (ep) (setHooks(adVersions(ep).length), setLines((ep.textHooks ?? []).join('\n')))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  async function exportHooks() {
    setBusy('hooks')
    setError('')
    setPlaying(false)
    setExportPanel(false)
    try {
      await loadAll()
      const s = getSnapshot().series.find((x) => x.id === p.episode!.series)!
      const ep = s.episodes.find((e) => e.id === p.episode!.episode)!
      const t = await allTasks()
      const versions = adVersions(ep)
      const onTrack = new Set(p.items.filter((it) => it.track === MAIN).map((it) => it.ref?.file))
      const mine = versions.map((v) => v.scenes[0]).find((h) => onTrack.has(clipOf(t, h)))
      if (!mine) throw new Error('This edit no longer has any of the ad’s hook clips, so the hooks can’t be swapped. Rebuild it from the latest first.')
      const files: string[] = []
      for (const v of versions) files.push(await api.renderEdit(await toProjectRender(v.scenes[0].id === mine.id ? p : withHook(p, mine, v.scenes[0], t), { quality })))
      logExport(files, 'hook')
      await updateSeries(s.id, (x) => {
        const e = x.episodes.find((y) => y.id === ep.id)
        if (!e) return
        if (e.cut) e.cuts = [...(e.cuts ?? []), e.cut]
        e.adCuts = files
        e.cut = files[0]
      })
      setExported(files[0])
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy('')
    }
  }
  // The hook line is the longest text that starts the video (word-by-word captions aside); without one, a line is added
  // just below the top bar for the whole video.
  function withLine(x: EditProject, line: string) {
    const q = structuredClone(x)
    const hook = q.items.filter((it) => it.text !== undefined && !it.words && it.start < 0.05).sort((a, b) => itemLength(b) - itemLength(a))[0]
    if (hook) hook.text = line
    else {
      const tr = q.tracks.find((t) => t.kind === 'text')
      if (tr) q.items.push({ id: crypto.randomUUID(), track: tr.id, start: 0, label: 'Text', text: line, style: 'box', x: 0.5, y: 0.22, duration: +videoEnd(q).toFixed(3) })
    }
    return q
  }
  const textVersions = lines.split('\n').map((l) => l.trim()).filter(Boolean)
  async function exportTexts() {
    setBusy('texts')
    setError('')
    setPlaying(false)
    setExportPanel(false)
    try {
      const files: string[] = []
      for (const line of textVersions) files.push(await api.renderEdit(await toProjectRender(withLine(p, line), { quality, range: part ?? undefined })))
      logExport(files, 'text')
      setExported(files[0])
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy('')
    }
  }
  async function saveCover() {
    if (!exported) return
    try {
      await api.reveal(await api.cover(exported, part ? Math.max(0, time - part[0]) : time))
    } catch (e) {
      setError(errMsg(e))
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="drag flex h-14 shrink-0 items-center gap-2 px-4">
        <IconButton title="All edits" onClick={onBack}><ArrowLeft size={16} /></IconButton>
        <input aria-label="Title" value={p.title} onChange={(e) => change((x) => void (x.title = e.target.value), false)} className="min-w-0 max-w-80 flex-1 bg-transparent font-medium" />
        <SelectChip title="Shape" label={p.aspect} value={p.aspect} onChange={(v) => change((x) => void (x.aspect = v as Aspect))}
          options={ASPECTS.map((a) => ({ value: a, label: `${SHAPE[a].name} ${a}` }))} />
        <SelectChip title="Export size" label={p.resolution ?? '1080p'} value={p.resolution ?? '1080p'} onChange={(v) => change((x) => void (x.resolution = v as EditProject['resolution']))}
          options={[{ value: '1080p', label: '1080p (best for TikTok and Reels)' }, { value: '2160p', label: '4K (2160p: sharpest, slowest export)' }, { value: '720p', label: '720p (faster export)' }]} />
        <SelectChip title="Frame rate" label={`${p.fps} fps`} value={String(p.fps)} onChange={(v) => change((x) => void (x.fps = +v))}
          options={FRAME_RATES.map((f) => ({ value: String(f), label: f === 30 ? '30 fps (TikTok, Reels, Shorts)' : f === 24 ? '24 fps (film look)' : f === 60 ? '60 fps (smooth motion)' : `${f} fps` }))} />
        <div className="ml-auto flex items-center gap-1">
          <IconButton title="Undo (⌘Z)" disabled={!past.length} onClick={undo}><Undo2 size={16} /></IconButton>
          <IconButton title="Redo (⇧⌘Z)" disabled={!future.length} onClick={redo}><Redo2 size={16} /></IconButton>
          <div className="relative">
            <IconButton title="History: exports and saved versions" onClick={() => setHistory(!history)}><History size={16} /></IconButton>
            {history && <HistoryPanel p={p} onClose={() => setHistory(false)} onRestore={(v) => change((x) => void Object.assign(x, v, { id: x.id, exports: x.exports, createdAt: x.createdAt, episode: x.episode }))} />}
          </div>
          <div ref={exportBox} className="relative">
            <button type="button" disabled={!!busy || !p.items.some((it) => it.track === MAIN)} onClick={() => setExportPanel(!exportPanel)} aria-expanded={exportPanel}
              className="inline-flex h-9 items-center gap-2 rounded-full bg-inverse px-4 font-medium text-on-inverse disabled:opacity-35">
              {busy === 'export' || busy === 'hooks' || busy === 'texts' ? <LoaderCircle size={15} className="animate-spin" /> : <Download size={15} />} {busy === 'hooks' ? 'Exporting hooks…' : busy === 'texts' ? 'Exporting text versions…' : 'Export'}
            </button>
            {exportPanel && (
              <div className="no-drag absolute top-11 right-0 z-40 flex w-80 flex-col gap-3 rounded-xl border border-line bg-surface p-3 text-[13px] shadow-lg">
                <div className="flex flex-wrap items-center gap-1.5"><span className="w-full text-xs text-muted">Quality</span>
                  <button type="button" className={chip(quality === 'standard')} onClick={() => setQuality('standard')}>Standard</button>
                  <button type="button" className={chip(quality === 'high')} onClick={() => setQuality('high')} title="A larger, sharper file; takes longer">High</button>
                </div>
                <label className="flex items-start gap-2 text-[13px]" title="Raises quiet videos and lowers loud ones to -14 LUFS, the level TikTok, Reels and YouTube play at, so yours isn't turned down or sounds weak next to others">
                  <input type="checkbox" className="mt-0.5" checked={p.normalize !== false} onChange={(e) => change((x) => void (e.target.checked ? delete x.normalize : (x.normalize = false)))} />
                  <span>Even out the loudness <span className="text-muted">(−14 LUFS, what social apps play at)</span></span>
                </label>
                <div className="flex flex-wrap items-center gap-1.5"><span className="w-full text-xs text-muted">What to export</span>
                  <button type="button" className={chip(!part)} onClick={() => setPart(null)}>The whole video</button>
                  <button type="button" className={chip(!!part)} onClick={() => setPart([+Math.min(time, Math.max(0, total - 1)).toFixed(2), +total.toFixed(2)])}>A part</button>
                  {part && (
                    <span className="flex w-full items-center gap-1.5 tabular-nums">
                      From <NumberBox label="From (seconds)" value={part[0]} min={0} max={+total.toFixed(2)} step={0.1} className="w-20" onChange={(v) => setPart([v, part[1]])} />
                      to <NumberBox label="To (seconds)" value={part[1]} min={0} max={+total.toFixed(2)} step={0.1} className="w-20" onChange={(v) => setPart([part[0], v])} /> s
                    </span>
                  )}
                </div>
                <button type="button" onClick={exportVideo} className="inline-flex h-9 items-center justify-center gap-2 rounded-full bg-inverse px-4 font-medium text-on-inverse"><Download size={15} /> Export {part ? 'this part' : 'video'}</button>
                {hooks > 1 && !part && (
                  <button type="button" onClick={exportHooks} title="This edit once per hook: each other hook's clip, text and voices go into the first slot; everything after stays as you edited it"
                    className={`${chip(false)} inline-flex items-center justify-center gap-1.5`}><Layers size={13} /> Export all {hooks} hooks</button>
                )}
                <div className="flex flex-col gap-1.5 border-t border-line pt-3">
                  <span className="text-xs text-muted">Text versions: this video with other hook lines, one post each</span>
                  <textarea aria-label="Text versions" rows={4} value={lines} onChange={(e) => setLines(e.target.value)} placeholder="One hook line per version"
                    className="resize-none rounded-lg border border-line bg-bg px-2.5 py-1.5 focus:border-fg" />
                  <button type="button" disabled={!textVersions.length} onClick={exportTexts}
                    className={`${chip(false)} inline-flex items-center justify-center gap-1.5 disabled:opacity-40`}><Type size={13} /> Export {textVersions.length || ''} text version{textVersions.length === 1 ? '' : 's'}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {fresh && (
        <div className="mx-4 mb-2 flex items-center gap-3 rounded-xl bg-raised px-3 py-2 text-[13px]">
          <RefreshCw size={14} className="shrink-0 text-muted" />
          <span className="min-w-0 flex-1">This {p.episode ? 'ad or episode' : 'video'} has new clips since this edit was made. Rebuilding replaces this edit’s tracks with the latest clips, text and voices; Undo brings yours back.</span>
          <button type="button" onClick={rebuild} className="h-8 shrink-0 rounded-full bg-inverse px-3 font-medium text-on-inverse">Rebuild from the latest</button>
          <IconButton title="Keep this edit" className="size-7" onClick={() => setFresh(null)}><X size={13} /></IconButton>
        </div>
      )}
      {missing.size > 0 && (
        <p className="mx-4 mb-2 flex items-center gap-2 rounded-xl bg-raised px-3 py-2 text-[13px] text-danger">
          <TriangleAlert size={14} className="shrink-0" />
          {missing.size === 1 ? 'A file' : `${missing.size} files`} this edit uses {missing.size === 1 ? 'is' : 'are'} missing, probably moved to the Trash from Create. Put {missing.size === 1 ? 'it' : 'them'} back from the Trash, or delete the clips marked missing.
        </p>
      )}
      {error && <p className="mx-4 mb-2 flex items-center gap-2 rounded-xl bg-raised px-3 py-2 text-[13px] text-danger"><TriangleAlert size={14} /> {error}<button type="button" className="ml-auto" onClick={() => setError('')}><X size={14} /></button></p>}
      {exported && (
        <div className="mx-4 mb-2 flex items-center gap-3 rounded-xl bg-raised px-3 py-2 text-[13px]">
          <span className="min-w-0 flex-1 truncate">Exported{p.episode ? ' and set as the episode’s cut' : ''}.</span>
          <button type="button" className="font-medium underline underline-offset-2" onClick={() => api.reveal({ kind: 'media', file: exported })}>Show in Finder</button>
          <button type="button" className="underline underline-offset-2" title="Makes a PNG of the frame at the playhead from this export, for the post's cover, and shows it in Finder" onClick={saveCover}>Make cover</button>
          <IconButton title="Dismiss" className="size-7" onClick={() => setExported(null)}><X size={13} /></IconButton>
        </div>
      )}
      {exported && p.episode && (
        <p className="mx-4 -mt-1 mb-2 px-3 text-xs text-muted">
          When you post: turn on the AI label (TikTok: AI-generated content; Instagram and Facebook: AI info; YouTube: altered or synthetic content), and add a trending sound from the app.
        </p>
      )}

      <div className="flex min-h-0 flex-[3] gap-3 px-4">
        <Bin p={p} onAdd={(m) => void add(m)} onImport={(a) => change((x) => void x.imports.push(...a.filter((i) => !x.imports.some((y) => y.file === i.file))))} />
        <div className="flex min-w-0 flex-1 flex-col items-center gap-2">
          <div ref={stage} className="flex min-h-0 w-full flex-1 items-center justify-center [&:fullscreen]:bg-black">
            <Player p={p} time={time} playing={playing} rate={rate} onTime={setTime} onEnd={() => setPlaying(false)} guides={guides} selected={selected} onPlace={place} />
          </div>
          <div className="flex items-center gap-2 text-[13px] text-muted tabular-nums">
            <IconButton title="To the start (Home)" onClick={() => (setPlaying(false), setTime(0))}><SkipBack size={16} /></IconButton>
            <button type="button" title="Play / pause (Space)" onClick={() => (setRate(1), setPlaying((v) => !v))} className="flex size-9 items-center justify-center rounded-full bg-inverse text-on-inverse">
              {playing ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <span className="w-36">{fmt(time)} / {fmt(total)}{rate !== 1 && playing && ` · ${rate}×`}</span>
            <IconButton title="Full-screen preview (⇧⌘F)" onClick={fullScreen}><Maximize2 size={15} /></IconButton>
            {p.aspect === '9:16' && (
              <button type="button" aria-pressed={guides} onClick={() => setGuides(!guides)} title="Shades what the buttons, top bar and caption cover on TikTok, Reels and Shorts (not exported)"
                className={`${chip(guides)} inline-flex items-center gap-1.5`}><ScanLine size={13} /> Safe zones</button>
            )}
          </div>
        </div>
        <aside className="w-80 shrink-0 overflow-y-auto">
          {selected ? <Inspector it={selected} p={p} time={time} say={setError} onExtract={() => void extract(selected)} change={(fn, key) => change((x) => fn(x.items.find((y) => y.id === selected.id)!), true, key && `${selected.id}:${key}`)} changeAll={(fn) => change(fn)} />
            : selTrack && p.tracks.some((t) => t.id === selTrack) ? <TrackPanel p={p} id={selTrack} change={change} onClose={() => setSelTrack(null)} />
            : <Tips />}
        </aside>
      </div>

      <div ref={timeline} className="flex min-h-0 flex-[2] flex-col border-t border-line">
        <div className="flex shrink-0 flex-wrap items-center gap-1 px-3 py-1.5">
          <button type="button" title="Split at the playhead (S or ⌘B)" onClick={splitHere} className={`${chip(false)} inline-flex items-center gap-1.5`}><Scissors size={13} /> Split</button>
          <button type="button" title="Delete the selected items (⌫); a video-track clip closes its gap" disabled={!chosen.length} onClick={remove} className={`${chip(false)} inline-flex items-center gap-1.5 disabled:opacity-40`}><Trash2 size={13} /> Delete{chosen.length > 1 ? ` ${chosen.length}` : ''}</button>
          <button type="button" title="Hold the frame at the playhead for a second (F)" onClick={freeze} className={`${chip(false)} inline-flex items-center gap-1.5`}><Snowflake size={13} /> Freeze</button>
          <button type="button" title="Record a voice-over from the mic, starting at the playhead while the video plays. Use headphones." onClick={record}
            className={`${chip(!!rec)} inline-flex items-center gap-1.5`}>{rec ? <><Square size={11} fill="currentColor" /> Stop {fmt((Date.now() - rec.since) / 1000)}</> : <><Mic size={13} /> Voice-over</>}</button>
          <button type="button" title="Add text at the playhead" onClick={() => addText()} className={`${chip(false)} inline-flex items-center gap-1.5`}><Type size={13} /> Text</button>
          <button type="button" disabled={!!busy} title="Word-by-word captions from the voices and clips with sound (transcribed on kie, a few credits a minute)" onClick={autoCaptions}
            className={`${chip(false)} inline-flex items-center gap-1.5 disabled:opacity-40`}>{busy === 'captions' ? <LoaderCircle size={13} className="animate-spin" /> : <Captions size={13} />} Auto captions</button>
          {p.episode && <button type="button" title="One caption per voice line, timed to it" onClick={captions} className={`${chip(false)} inline-flex items-center gap-1.5`}><Captions size={13} /> Captions from script</button>}
          <button type="button" title="A layer over the video: drag pictures or clips onto it (picture in picture, logos, screen recordings)"
            onClick={() => change((x) => void x.tracks.splice(1, 0, { id: crypto.randomUUID(), kind: 'video', name: `Overlay ${x.tracks.filter((t) => t.kind === 'video').length}` }))}
            className={`${chip(false)} inline-flex items-center gap-1.5`}><Layers size={13} /> Overlay track</button>
          <button type="button" title="Another track for music, voices or sounds" onClick={() => change((x) => void x.tracks.push({ id: crypto.randomUUID(), kind: 'audio', name: `Audio ${x.tracks.filter((t) => t.kind === 'audio').length + 1}` }))}
            className={`${chip(false)} inline-flex items-center gap-1.5`}><Plus size={13} /> Audio track</button>
          <div className="ml-auto flex shrink-0 items-center gap-1 text-muted">
            <IconButton title="Fit the whole video (⇧Z)" onClick={fit}><ArrowLeftRight size={15} /></IconButton>
            <IconButton title="Zoom out (− or pinch)" onClick={() => setPps((v) => zoomTo(v / 1.3))}><ZoomOut size={15} /></IconButton>
            <input aria-label="Zoom" type="range" min={8} max={400} value={pps} onChange={(e) => setPps(+e.target.value)} className="w-28" />
            <IconButton title="Zoom in (+ or pinch)" onClick={() => setPps((v) => zoomTo(v * 1.3))}><ZoomIn size={15} /></IconButton>
          </div>
        </div>
        <TimelineView p={p} fps={p.fps} missing={missing} time={time} pps={pps} range={part} onZoom={setPps} thumbs={thumbs} waves={waves} sel={sel} picked={chosen} selTrack={selTrack} onTrackSelect={(id) => (select(null), setSelTrack(id))} onSelect={select} change={change} commit={commit}
          onSeek={(t) => (setPlaying(false), setTime(Math.min(toFrame(t, p.fps), total)))}
          onTrack={(id, fn) => change((x) => fn(x.tracks.find((t) => t.id === id)!))}
          onDrop={(track, t, data) => {
            if (!data) return
            const m = JSON.parse(data) as Media
            void add(m, t, track)
          }} />
      </div>
    </div>
  )
}

// Media to put on the timeline: the episode's own pieces, everything locco made, and files you import.
function Bin({ p, onAdd, onImport }: { p: EditProject; onAdd: (m: Media) => void; onImport: (a: Attachment[]) => void }) {
  const [tab, setTab] = useState<'locco' | 'imported' | 'sounds'>('locco')
  const [kind, setKind] = useState<MediaKind | 'all'>('all')
  const [tasks, setTasks] = useState<Task[]>([])
  const picker = useRef<HTMLInputElement>(null)
  useEffect(() => void api.tasks().then((all) => setTasks(all.filter((t) => t.state === 'success' && t.files.length))), [])
  const made: Media[] = tasks.flatMap((t) => t.files.filter((f) => !/-cover\./.test(f)).map((f) => ({ ref: { kind: 'media' as const, file: f }, media: kindOfFile(f), label: t.prompt.slice(0, 60) || t.label })))
  const imported: Media[] = p.imports.map((a) => ({ ref: { kind: a.kind, file: a.file }, media: kindOfFile(a.name), label: a.name }))
  const list = (tab === 'locco' ? made : imported).filter((m) => kind === 'all' || m.media === kind)
  return (
    <aside className="flex w-72 shrink-0 flex-col gap-2 overflow-hidden">
      <div className="flex items-center gap-0.5">
        {(['locco', 'imported', 'sounds'] as const).map((k) => (
          <button key={k} type="button" onClick={() => setTab(k)} title={k === 'locco' ? 'Everything made in locco' : undefined}
            className={`h-8 shrink-0 rounded-full px-2.5 text-[13px] whitespace-nowrap ${tab === k ? 'bg-raised font-medium text-fg' : 'text-muted hover:text-fg'}`}>
            {k === 'locco' ? 'Generated' : k === 'sounds' ? 'Sounds' : 'Imported'}
            {k === 'imported' && p.imports.length > 0 && <span className="ml-1 text-faint tabular-nums">{p.imports.length}</span>}
          </button>
        ))}
        <IconButton title="Import files from your Mac" className="ml-auto shrink-0" onClick={() => (setTab('imported'), picker.current?.click())}><Upload size={15} /></IconButton>
        <input ref={picker} type="file" multiple hidden accept={ACCEPT_IMPORT} onChange={async (e) => {
          if (e.target.files) onImport(await toAttachments(e.target.files, ACCEPT_IMPORT))
          e.target.value = ''
        }} />
      </div>
      {tab === 'sounds' ? <Sounds onAdd={onAdd} /> : <>
      <div className="flex gap-1">
        {(['all', 'video', 'image', 'audio'] as const).map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={`h-7 rounded-full px-2.5 text-xs ${kind === k ? 'bg-raised text-fg' : 'text-muted hover:text-fg'}`}>
            {k === 'all' ? 'All' : k === 'video' ? 'Video' : k === 'image' ? 'Images' : 'Audio'}
          </button>
        ))}
      </div>
      <div className="grid flex-1 auto-rows-min grid-cols-3 gap-1.5 overflow-y-auto pb-2">
        {list.map((m) => (
          <button key={`${m.ref.kind}/${m.ref.file}`} type="button" draggable onDragStart={(e) => e.dataTransfer.setData('text/x-locco', JSON.stringify(m))}
            onClick={() => onAdd(m)} title={`${m.label}\nClick to add at the playhead, or drag onto a track.`}
            className="group relative aspect-square overflow-hidden rounded-lg bg-raised text-muted">
            {m.media === 'image' ? <img src={mediaUrl(m.ref)} alt="" loading="lazy" className="size-full object-cover" />
              : m.media === 'video' ? <video src={`${mediaUrl(m.ref)}#t=0.5`} muted preload="metadata" className="size-full object-cover" />
              : <span className="flex size-full flex-col items-center justify-center gap-1 p-1 text-center text-[10px] leading-tight"><AudioLines size={16} /> <span className="line-clamp-2">{m.label}</span></span>}
            <span className="absolute top-1 left-1 rounded bg-black/55 p-0.5 text-white">
              {m.media === 'video' ? <Video size={10} /> : m.media === 'image' ? <ImageIcon size={10} /> : <Music size={10} />}
            </span>
            <span className="absolute inset-0 hidden items-center justify-center bg-black/35 text-white group-hover:flex"><Plus size={18} /></span>
          </button>
        ))}
        {!list.length && (
          <p className="col-span-3 px-1 py-6 text-center text-xs text-faint">
            {tab === 'imported' ? <>Nothing imported yet. <button type="button" className="underline" onClick={() => picker.current?.click()}>Import files</button>: videos, images, music, voice-overs.</> : 'Nothing here yet.'}
          </p>
        )}
      </div>
      </>}
    </aside>
  )
}

// Sound effects: the built-in ones are made on this Mac the first time (free); anything else is described and made by
// ElevenLabs on your plan. Click one to put it at the playhead.
function Sounds({ onAdd }: { onAdd: (m: Media) => void }) {
  const [list, setList] = useState<{ id: string; label: string }[]>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [ask, setAsk] = useState('')
  // ElevenLabs' own guess at the length tends to be half a second, which cuts most sounds off.
  const [len, setLen] = useState('2')
  useEffect(() => void api.sounds().then(setList), [])
  const go = async (key: string, make: () => Promise<Ref>, label: string) => {
    setBusy(key)
    setError('')
    try {
      onAdd({ ref: await make(), media: 'audio', label })
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy('')
    }
  }
  // ElevenLabs answers in seconds; the job is kept in Create like any other.
  const describe = () => go('describe', async () => {
    const [id] = await api.generate({ modelId: 'el-sfx', variant: 'text', prompt: ask.trim(), input: { duration_seconds: len }, count: 1 })
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      const t = (await api.tasks()).find((x) => x.id === id)
      if (t?.state === 'fail') throw new Error(t.error || 'ElevenLabs couldn’t make that sound.')
      if (t?.state === 'success') return { kind: 'media', file: t.files[0] }
    }
    throw new Error('The sound took too long. Try again.')
  }, ask.trim().slice(0, 40))
  return (
    <div className="flex flex-1 flex-col gap-2 overflow-y-auto pb-2 text-[13px]">
      <div className="grid grid-cols-2 gap-1.5">
        {list.map((x) => (
          <button key={x.id} type="button" disabled={!!busy} onClick={() => go(x.id, () => api.sound(x.id), x.label)} title="Add at the playhead"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-raised px-2.5 text-left hover:bg-line disabled:opacity-50">
            {busy === x.id ? <LoaderCircle size={13} className="animate-spin" /> : <AudioLines size={13} className="text-muted" />} {x.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-faint">Made on your Mac, free.</p>
      <div className="mt-2 flex flex-col gap-1.5">
        <span className="text-xs text-muted">Any other sound (ElevenLabs, your plan)</span>
        <input aria-label="Describe a sound" value={ask} onChange={(e) => setAsk(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ask.trim() && !busy && describe()}
          placeholder="A cash register ding, a crowd gasping" className="h-9 rounded-lg border border-line bg-bg px-2.5 focus:border-fg" />
        <div className="flex items-center gap-1.5">
          <button type="button" disabled={!ask.trim() || !!busy} onClick={describe} className={`${chip(false)} inline-flex w-fit items-center gap-1.5 disabled:opacity-40`}>
            {busy === 'describe' ? <LoaderCircle size={13} className="animate-spin" /> : <Plus size={13} />} Make and add
          </button>
          <select aria-label="Length" value={len} onChange={(e) => setLen(e.target.value)} className="h-8 rounded-lg border border-line bg-bg px-1.5 text-[13px]">
            {['1', '2', '3', '5', '10'].map((n) => <option key={n} value={n}>{n} s</option>)}
            <option value="auto">Auto</option>
          </select>
        </div>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  )
}

// A track's settings: its name, its place in the list (lower is drawn on top), and how it's heard and seen.
function TrackPanel({ p, id, change, onClose }: { p: EditProject; id: string; change: (fn: (p: EditProject) => void, record?: boolean, key?: string) => void; onClose: () => void }) {
  const tr = p.tracks.find((t) => t.id === id)!
  const i = p.tracks.indexOf(tr)
  const set = (fn: (t: Track) => void, key?: string) => change((x) => fn(x.tracks.find((t) => t.id === id)!), true, key && `${id}:${key}`)
  const move = (d: number) => change((x) => {
    const j = i + d
    if (j < 1 || j >= x.tracks.length) return // the video track stays first
    ;[x.tracks[i], x.tracks[j]] = [x.tracks[j], x.tracks[i]]
  })
  const items = p.items.filter((it) => it.track === id)
  const heard = tr.kind !== 'text'
  const row = 'flex flex-wrap items-center gap-1.5'
  const label = 'w-full text-xs text-muted'
  return (
    <div className="flex flex-col gap-4 text-[13px]">
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate font-medium">Track</h3>
        <IconButton title="Close" className="size-7" onClick={onClose}><X size={13} /></IconButton>
      </div>
      <label className={row}><span className={label}>Name</span>
        <input aria-label="Track name" value={tr.name} onChange={(e) => set((t) => void (t.name = e.target.value), 'name')} className="h-8 w-full rounded-lg border border-line bg-bg px-2.5 focus:border-fg" />
      </label>
      {tr.id !== MAIN && (
        <div className={row}><span className={label}>Order (tracks lower in the list are drawn on top)</span>
          <button type="button" disabled={i <= 1} className={`${chip(false)} inline-flex items-center gap-1 disabled:opacity-40`} onClick={() => move(-1)}><ArrowUp size={13} /> Up</button>
          <button type="button" disabled={i >= p.tracks.length - 1} className={`${chip(false)} inline-flex items-center gap-1 disabled:opacity-40`} onClick={() => move(1)}><ArrowDown size={13} /> Down</button>
        </div>
      )}
      {heard && (
        <>
          <div className={row}><span className={label}>Sound</span>
            <button type="button" className={chip(!!tr.muted)} onClick={() => set((t) => void (t.muted ? delete t.muted : (t.muted = true)))}>{tr.muted ? 'Muted' : 'Mute'}</button>
            <button type="button" className={chip(!!tr.solo)} title="Only soloed tracks are heard, in the preview and the export" onClick={() => set((t) => void (t.solo ? delete t.solo : (t.solo = true)))}>{tr.solo ? 'Soloed' : 'Solo'}</button>
          </div>
          <div className={row}><span className={label}>Track volume {Math.round((tr.volume ?? 1) * 100)}%</span>
            <input aria-label="Track volume" type="range" min={0} max={1.5} step={0.05} value={tr.volume ?? 1} onChange={(e) => set((t) => void (+e.target.value === 1 ? delete t.volume : (t.volume = +e.target.value)), 'volume')} className="w-full" />
          </div>
        </>
      )}
      {tr.id !== MAIN && tr.kind !== 'audio' && (
        <div className={row}><span className={label}>Seen</span>
          <button type="button" className={chip(!!tr.hidden)} title="Leaves it out of the preview and the export" onClick={() => set((t) => void (t.hidden ? delete t.hidden : (t.hidden = true)))}>{tr.hidden ? 'Hidden' : 'Hide'}</button>
        </div>
      )}
      <div className={row}><span className={label}>Editing</span>
        <button type="button" className={chip(!!tr.locked)} title="Its items can't be picked, moved, trimmed or deleted" onClick={() => set((t) => void (t.locked ? delete t.locked : (t.locked = true)))}>{tr.locked ? 'Locked' : 'Lock'}</button>
      </div>
      {tr.id !== MAIN && (
        <button type="button" disabled={!!items.length} className={`${chip(false)} w-fit disabled:opacity-40`} title={items.length ? 'Empty it first' : undefined}
          onClick={() => (change((x) => void (x.tracks = x.tracks.filter((t) => t.id !== id))), onClose())}>Remove track</button>
      )}
    </div>
  )
}

// Exports (with how each was made) and saved versions of the edit: a version is kept with every export, or when you save
// one; restoring one brings its clips, tracks and settings back (Undo takes it back again).
function HistoryPanel({ p, onClose, onRestore }: { p: EditProject; onClose: () => void; onRestore: (v: EditProject) => void }) {
  const [versions, setVersions] = useState<{ id: string; at: number; label: string }[] | null>(null)
  const load = () => void api.versions(p.id).then(setVersions)
  useEffect(load, [p.id])
  const when = (at: number) => new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  const kind = { video: 'Video', part: 'Part', hook: 'Hook version', text: 'Text version' }
  return (
    <div className="no-drag absolute top-11 right-0 z-40 flex max-h-[70vh] w-96 flex-col gap-3 overflow-y-auto rounded-xl border border-line bg-surface p-3 text-[13px] shadow-lg">
      <div className="flex items-center gap-2">
        <span className="flex-1 font-medium">History</span>
        <button type="button" className={chip(false)} onClick={() => void api.saveVersion(p, `Saved ${when(Date.now())}`).then(load)}>Save a version now</button>
        <IconButton title="Close" className="size-7" onClick={onClose}><X size={13} /></IconButton>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted">Exports</span>
        {!p.exports.length && <p className="text-xs text-faint">Nothing exported yet.</p>}
        {[...p.exports].reverse().map((e) => (
          <div key={e.file + e.at} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-raised">
            <span className="min-w-0 flex-1">
              <span className="block truncate">{kind[e.what ?? 'video']} · {when(e.at)}</span>
              <span className="block truncate text-xs text-faint tabular-nums">{[e.resolution, e.fps && `${e.fps} fps`, e.quality === 'high' && 'high quality', e.range && `${e.range[0]}–${e.range[1]} s`].filter(Boolean).join(' · ') || e.file}</span>
            </span>
            <button type="button" className="shrink-0 text-xs underline underline-offset-2" onClick={() => api.reveal({ kind: 'media', file: e.file })}>Show in Finder</button>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted">Versions (the last 30)</span>
        {versions?.length === 0 && <p className="text-xs text-faint">None yet: one is saved with every export.</p>}
        {versions?.map((v) => (
          <div key={v.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-raised">
            <span className="min-w-0 flex-1 truncate">{v.label}</span>
            <button type="button" className="shrink-0 text-xs underline underline-offset-2" onClick={() => void api.version(v.id).then((x) => x && (onRestore(x), onClose()))}>Restore</button>
          </div>
        ))}
      </div>
    </div>
  )
}

// A setting that can change over the item: its slider sets it at the playhead (on the key there when it has keys), and
// the diamond adds a key at the playhead or takes it away. local is the playhead's seconds into the item.
function Keyed({ it, prop, label, local, min, max, step, plain, show, set, change }: {
  it: Item; prop: KeyProp; label: string; local: number; min: number; max: number; step: number; plain: number; show: (v: number) => string
  set: (x: Item, v: number) => void; change: (fn: (it: Item) => void, key?: string) => void
}) {
  const keys = it.keys?.[prop]
  const over = local >= 0 && local <= itemLength(it)
  const value = valueAt(keys, local, plain)
  const on = !!keyAt(keys, local)
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="flex w-full items-center gap-1.5 text-xs text-muted">
        {label} {show(value)}{keys?.length ? <span className="text-faint">· {keys.length} key{keys.length === 1 ? '' : 's'}</span> : null}
        <button type="button" disabled={!over} aria-pressed={on} onClick={() => change((x) => toggleKey(x, prop, local, value))}
          title={!over ? 'Move the playhead over it to add a key' : on ? 'Remove the key at the playhead' : 'Add a key at the playhead: the setting can then change over the item (set another value at another moment)'}
          className={`ml-auto text-sm leading-none disabled:opacity-30 ${on ? 'text-fg' : 'text-faint hover:text-fg'}`}>{on ? '◆' : '◇'}</button>
      </span>
      <input aria-label={label} type="range" min={min} max={max} step={step} value={value} disabled={!!keys?.length && !over}
        onChange={(e) => change((x) => setKeyed(x, prop, local, +e.target.value, (v) => set(x, v)), `${prop}@${keys?.length ? local.toFixed(2) : ''}`)} className="w-full" />
    </div>
  )
}

const FONTS: [NonNullable<Item['font']>, string][] = [['sans', 'Sans'], ['rounded', 'Rounded'], ['serif', 'Serif'], ['mono', 'Mono'], ['impact', 'Impact']]
// Speed ramps: the clip cut in five equal parts of its footage, each at these times its speed.
const RAMPS: [string, number[]][] = [['Slow-mo in the middle', [1, 0.6, 0.3, 0.6, 1]], ['Speeds up', [0.7, 1, 1.4, 2, 2.6]], ['Slows down', [2.6, 2, 1.4, 1, 0.7]]]

function Inspector({ it, p, time, change, changeAll, onExtract, say }: {
  it: Item; p: EditProject; time: number; onExtract: () => void; say: (message: string) => void
  change: (fn: (it: Item) => void, key?: string) => void; changeAll: (fn: (p: EditProject) => void) => void
}) {
  const row = 'flex flex-wrap items-center gap-1.5'
  const label = 'w-full text-xs text-muted'
  const track = p.tracks.find((t) => t.id === it.track)
  const overlay = track?.kind === 'video' && it.track !== MAIN
  const owner = it.link ? p.items.find((c) => c.id === it.link) : undefined
  const num = (v: number) => +v.toFixed(2)
  const local = time - it.start
  const pct = (v: number) => `${Math.round(v * 100)}%`
  const keyed = { it, local, change }
  const tabs = it.text !== undefined ? ['Look', 'Layout', 'Timing'] : it.media === 'audio' ? ['Sound', 'Timing']
    : ['Frame', ...(it.track === MAIN ? ['Motion'] : []), 'Timing', ...(it.media === 'video' ? ['Sound'] : []), 'Colour']
  const [picked, setPicked] = useState('Frame')
  const tab = tabs.includes(picked) ? picked : tabs[0]
  const bar = (
    <div role="tablist" className="flex rounded-lg bg-raised p-0.5">
      {tabs.map((t) => (
        <button key={t} type="button" role="tab" aria-selected={t === tab} onClick={() => setPicked(t)}
          className={`flex-1 rounded-md px-1.5 py-1 text-xs ${t === tab ? 'bg-bg font-medium text-fg shadow-sm' : 'text-muted hover:text-fg'}`}>{t}</button>
      ))}
    </div>
  )
  const fades = (
    <>
      <div className={row}><span className={label}>Fade in</span>
        {[0, 0.5, 1, 2].map((f) => <button key={f} type="button" className={chip((it.fadeIn ?? 0) === f)} onClick={() => change((x) => void (x.fadeIn = f))}>{f ? `${f} s` : 'None'}</button>)}
      </div>
      <div className={row}><span className={label}>Fade out</span>
        {[0, 0.5, 1, 2].map((f) => <button key={f} type="button" className={chip((it.fadeOut ?? 0) === f)} onClick={() => change((x) => void (x.fadeOut = f))}>{f ? `${f} s` : 'None'}</button>)}
      </div>
      <div className={row}><span className={label}>Left / right {(it.balance ?? 0) === 0 ? 'centre' : (it.balance ?? 0) < 0 ? `${pct(-(it.balance ?? 0))} left` : `${pct(it.balance ?? 0)} right`} · heard in the export</span>
        <input aria-label="Left or right" type="range" min={-1} max={1} step={0.05} value={it.balance ?? 0} onChange={(e) => change((x) => void (+e.target.value ? (x.balance = +e.target.value) : delete x.balance), 'balance')} className="w-full" />
      </div>
    </>
  )
  // A speed ramp: the clip cut in five parts of equal footage, each at its own speed.
  const ramp = (speeds: number[]) => {
    if (it.media !== 'video' || (it.out - it.in) / speeds.length / it.speed < 0.2) return say('This clip is too short for a speed ramp.')
    changeAll((q) => {
      const clip = q.items.find((y) => y.id === it.id)
      if (clip?.media !== 'video') return
      const base = clip.speed
      const seg = (clip.out - clip.in) / speeds.length
      const ids = [clip.id]
      for (let k = 1; k < speeds.length; k++) {
        // The first id splitClip asks for is the clip's second part (the rest go to what's linked to it).
        let made = ''
        splitClip(q, ids.at(-1)!, clip.start + (k * seg) / base, () => {
          const id = crypto.randomUUID()
          made ||= id
          return id
        })
        ids.push(made)
      }
      ids.forEach((id, k) => {
        const part = q.items.find((y) => y.id === id)
        if (part?.media === 'video') part.speed = +(base * speeds[k]).toFixed(3)
      })
    })
  }
  return (
    <div className="flex flex-col gap-4 text-[13px]">
      <div>
        <h3 className="truncate font-medium" title={it.label}>{it.text !== undefined ? 'Text' : clipName(it.label)}</h3>
        <p className="text-xs text-faint tabular-nums">{track?.name} · starts {fmt(it.start)} · runs {itemLength(it).toFixed(2)} s</p>
        {owner && (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
            <span className="min-w-0 truncate">Moves with “{clipName(owner.label)}”</span>
            <button type="button" className="shrink-0 underline underline-offset-2" title="Let it move on its own: it stays where it is when the clip moves, and isn't cut with it"
              onClick={() => change((x) => void delete x.link)}>Unlink</button>
          </p>
        )}
        {it.keys && <p className="mt-1 text-xs text-faint">◆ marks keys: a setting with keys changes over the item. The sliders set it at the playhead.</p>}
      </div>
      {it.text === undefined && bar}
      {it.text !== undefined && (
        <>
          <textarea aria-label="Text" rows={3} value={it.text} onChange={(e) => change((x) => void setText(x, e.target.value), 'text')}
            className="resize-none rounded-lg border border-line bg-bg px-2.5 py-1.5 leading-relaxed focus:border-fg" />
          {it.words && <p className="text-xs text-faint">A word-by-word caption: the word being said lights up. Keep the same number of words to keep their timing. Moving one caption on the preview moves them all.</p>}
          {bar}
          <Group on={tab} title="Look">
          <div className={row}><span className={label}>Style</span>
            {([['caption', 'Outline'], ['title', 'Title'], ['box', 'Box']] as const).map(([s, l]) => <button key={s} type="button" className={chip((it.style ?? 'caption') === s)} onClick={() => change((x) => void (x.style = s))}>{l}</button>)}
          </div>
          <div className={row}><span className={label}>Font</span>
            {FONTS.map(([f, l]) => <button key={f} type="button" className={chip((it.font ?? 'sans') === f)} onClick={() => change((x) => void (f === 'sans' ? delete x.font : (x.font = f)))}>{l}</button>)}
          </div>
          <div className={row}><span className={label}>{it.style === 'box' ? 'Box colour (the text turns black or white to match)' : 'Colour'}</span>
            {TEXT_COLOURS.map((c) => (
              <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={(it.color ?? '#ffffff') === c} onClick={() => change((x) => void (x.color = c))}
                style={{ background: c }} className={`size-7 rounded-full border ${(it.color ?? '#ffffff') === c ? 'border-fg ring-2 ring-fg ring-offset-1 ring-offset-bg' : 'border-line'}`} />
            ))}
          </div>
          {it.words && (
            <div className={row}><span className={label}>The word being said</span>
              {TEXT_COLOURS.map((c) => (
                <button key={c} type="button" aria-label={`Lit word ${c}`} aria-pressed={(it.hlColor ?? '#FFE14D') === c} onClick={() => change((x) => void (x.hlColor = c))}
                  style={{ background: c }} className={`size-7 rounded-full border ${(it.hlColor ?? '#FFE14D') === c ? 'border-fg ring-2 ring-fg ring-offset-1 ring-offset-bg' : 'border-line'}`} />
              ))}
            </div>
          )}
          {it.style === 'box' ? (
            <div className={row}><span className={label}>Box opacity {pct(it.boxAlpha ?? 1)}</span>
              <input aria-label="Box opacity" type="range" min={0.2} max={1} step={0.05} value={it.boxAlpha ?? 1} onChange={(e) => change((x) => void (x.boxAlpha = +e.target.value), 'boxAlpha')} className="w-full" />
            </div>
          ) : (
            <div className={row}><span className={label}>Outline {(it.outline ?? 1) ? pct(it.outline ?? 1) : 'none'}</span>
              <input aria-label="Outline" type="range" min={0} max={2.5} step={0.1} value={it.outline ?? 1} onChange={(e) => change((x) => void (x.outline = +e.target.value), 'outline')} className="w-full" />
            </div>
          )}
          <div className={row}><span className={label}>Shadow</span>
            <button type="button" className={chip(!!it.shadow)} onClick={() => change((x) => void (x.shadow ? delete x.shadow : (x.shadow = true)))}>{it.shadow ? 'On' : 'Off'}</button>
          </div>
          </Group>
          <Group on={tab} title="Layout">
          <div className={row}><span className={label}>Size {pct(it.size ?? 1)}</span>
            <input aria-label="Text size" type="range" min={0.6} max={1.8} step={0.05} value={it.size ?? 1} onChange={(e) => change((x) => void (x.size = +e.target.value), 'size')} className="w-full" />
          </div>
          <div className={row}><span className={label}>Line width {pct(it.width ?? 0.84)} of the frame</span>
            <input aria-label="Line width" type="range" min={0.3} max={0.95} step={0.01} value={it.width ?? 0.84} onChange={(e) => change((x) => void (x.width = +e.target.value), 'width')} className="w-full" />
          </div>
          <div className={row}><span className={label}>Align</span>
            {(['left', 'center', 'right'] as const).map((a) => <button key={a} type="button" className={chip((it.align ?? 'center') === a)} onClick={() => change((x) => void (a === 'center' ? delete x.align : (x.align = a)))}>{a[0].toUpperCase() + a.slice(1)}</button>)}
          </div>
          <div className={row}><span className={label}>Position (or drag the dot on the preview)</span>
            {(['top', 'middle', 'bottom'] as const).map((s) => <button key={s} type="button" className={chip(it.x === undefined && (it.position ?? 'bottom') === s)} onClick={() => change((x) => void ((x.position = s), delete x.x, delete x.y))}>{s[0].toUpperCase() + s.slice(1)}</button>)}
          </div>
          </Group>
          <Group on={tab} title="Timing">
          <div className={row}><span className={label}>Comes in</span>
            {([[undefined, 'At once'], ['fade', 'Fades'], ['slide', 'Slides up']] as const).map(([a, l]) => <button key={l} type="button" className={chip(it.anim === a)} onClick={() => change((x) => void (a ? (x.anim = a) : delete x.anim))}>{l}</button>)}
          </div>
      {(it.media === 'image' || it.text !== undefined) && (
        <label className={row}><span className={label}>Length (seconds)</span>
          <NumberBox label="Length" value={it.duration ?? 3} min={0.2} max={600} step={0.1} className="w-24" onChange={(v) => change((x) => void (x.duration = v), 'length')} />
        </label>
      )}
          </Group>
        </>
      )}
      {(it.media === 'video' || it.media === 'image') && (
        <Group on={tab} title="Frame">
          {overlay && (
            <>
          <div className={row}><span className={label}>Size (width of the frame)</span>
            {[0.25, 0.4, 0.6, 0.8, 1].map((z) => <button key={z} type="button" className={chip(Math.abs((it.scale ?? 0.4) - z) < 0.01)} onClick={() => change((x) => void (x.scale = z))}>{pct(z)}</button>)}
          </div>
          <div className={row}><span className="flex w-full items-center text-xs text-muted">Place (or drag the dot on the preview)
            <button type="button" disabled={local < 0 || local > itemLength(it)} aria-pressed={!!keyAt(it.keys?.x, local)}
              title="Add (or remove) a key for its place at the playhead: drag it elsewhere at another moment and it moves there"
              onClick={() => change((x) => {
                toggleKey(x, 'x', local, valueAt(it.keys?.x, local, it.x ?? 0.5))
                toggleKey(x, 'y', local, valueAt(it.keys?.y, local, it.y ?? 0.5))
              })} className={`ml-auto text-sm leading-none disabled:opacity-30 ${keyAt(it.keys?.x, local) ? 'text-fg' : 'text-faint hover:text-fg'}`}>{keyAt(it.keys?.x, local) ? '◆' : '◇'}</button></span>
            {([['Top left', 0.28, 0.22], ['Top right', 0.72, 0.22], ['Centre', 0.5, 0.5], ['Bottom left', 0.28, 0.66], ['Bottom right', 0.72, 0.66]] as const).map(([l, px, py]) => (
              <button key={l} type="button" className={chip(it.x === px && it.y === py)} onClick={() => change((x) => {
                setKeyed(x, 'x', local, px, (v) => void (x.x = v))
                setKeyed(x, 'y', local, py, (v) => void (x.y = v))
              })}>{l}</button>
            ))}
          </div>
          <Keyed {...keyed} prop="rotate" label="Turn" min={-180} max={180} step={1} plain={it.rotate ?? 0} show={(v) => `${Math.round(v)}°`} set={(x, v) => void (x.rotate = v)} />
          <Keyed {...keyed} prop="opacity" label="Opacity" min={0.05} max={1} step={0.05} plain={it.opacity ?? 1} show={pct} set={(x, v) => void (x.opacity = v)} />
          <div className={row}><span className={label}>Crop the edges (% of the picture)</span>
            {(['l', 't', 'r', 'b'] as const).map((k) => (
              <span key={k} className="inline-flex items-center gap-1 text-xs text-muted">{{ l: 'Left', t: 'Top', r: 'Right', b: 'Bottom' }[k]}
                <NumberBox label={`Crop ${k}`} value={Math.round((it.crop?.[k] ?? 0) * 100)} min={0} max={45} step={1} className="w-14"
                  onChange={(v) => change((x) => {
                    const c = { l: 0, t: 0, r: 0, b: 0, ...x.crop, [k]: v / 100 }
                    if (c.l || c.t || c.r || c.b) x.crop = c
                    else delete x.crop
                  }, `crop-${k}`)} />
              </span>
            ))}
          </div>
            </>
          )}
          {it.track === MAIN && (
            <>
          <div className={row}><span className={label}>Fill the frame</span>
            {([['fill', 'Crop to fill'], ['fit', 'Whole, with bars'], ['blur', 'Whole, blurred behind']] as const).map(([f, l]) => (
              <button key={f} type="button" className={chip((it.fit ?? 'fill') === f)} title={f === 'blur' ? 'The whole picture over a blurred copy of itself: the usual way to put a wide clip in a vertical video' : undefined}
                onClick={() => change((x) => void (f === 'fill' ? delete x.fit : (x.fit = f)))}>{l}</button>
            ))}
          </div>
          {it.fit === 'fit' && (
            <div className={row}><span className={label}>Bars colour (the whole video)</span>
              {['#000000', '#ffffff', '#1c1c1e', ...TEXT_COLOURS.slice(2)].map((c) => (
                <button key={c} type="button" aria-label={`Bars ${c}`} aria-pressed={(p.background ?? '#000000') === c} onClick={() => changeAll((q) => void (q.background = c))}
                  style={{ background: c }} className={`size-7 rounded-full border ${(p.background ?? '#000000') === c ? 'border-fg ring-2 ring-fg ring-offset-1 ring-offset-bg' : 'border-line'}`} />
              ))}
            </div>
          )}
          <div className={row}><span className={label}>Reframe{(it.fit ?? 'fill') !== 'fill' && ' (when zoomed in)'}</span>
            {([[-1, 'Left'], [0, 'Center'], [1, 'Right']] as const).map(([v, l]) => <button key={v} type="button" className={chip((it.pan ?? 0) === v)} onClick={() => change((x) => void (x.pan = v))}>{l}</button>)}
            <span className="w-full" />
            {([[-1, 'Top'], [0, 'Middle'], [1, 'Bottom']] as const).map(([v, l]) => <button key={v} type="button" className={chip((it.tilt ?? 0) === v)} onClick={() => change((x) => void (v ? (x.tilt = v) : delete x.tilt))}>{l}</button>)}
          </div>
          <Keyed {...keyed} prop="zoom" label="Zoom" min={1} max={3} step={0.05} plain={it.zoom ?? 1} show={(v) => `${v.toFixed(2)}×`} set={(x, v) => void (x.zoom = v)} />
            </>
          )}
      {(it.media === 'video' || it.media === 'image') && (
        <div className={row}><span className={label}>Mirror</span>
          <button type="button" className={chip(!!it.flip)} onClick={() => change((x) => void (x.flip ? delete x.flip : (x.flip = true)))}>{it.flip ? 'Mirrored' : 'Off'}</button>
        </div>
      )}
        </Group>
      )}
      {it.track === MAIN && (it.media === 'video' || it.media === 'image') && (
        <Group on={tab} title="Motion">
          <div className={row}><span className={label}>Movement over the clip</span>
            {([[undefined, 'None'], ['push-in', 'Push in'], ['pull-out', 'Pull out'], ['pan-left', 'Pan left'], ['pan-right', 'Pan right']] as const).map(([m, l]) => (
              <button key={l} type="button" className={chip(it.motion === m)} onClick={() => change((x) => void (m ? (x.motion = m) : delete x.motion))}>{l}</button>
            ))}
          </div>
          <div className={row}><span className={label}>Into this clip</span>
            {([[undefined, 'Cut'], ['fade', 'Crossfade'], ['black', 'Dip to black'], ['flash', 'Flash'], ['zoom', 'Zoom in']] as const).map(([m, l]) => (
              <button key={l} type="button" className={chip(it.transition?.type === m)} title={m === 'fade' ? 'The clip before fades into this one: they overlap, so the video gets shorter by its length' : undefined}
                onClick={() => change((x) => void (m ? (x.transition = { type: m, seconds: x.transition?.type === m ? x.transition.seconds : TRANSITION_SECONDS[m] }) : delete x.transition))}>{l}</button>
            ))}
            {it.transition && (
              <span className="flex w-full items-center gap-2 text-xs text-muted">Length
                <input aria-label="Transition length" type="range" min={0.1} max={it.transition.type === 'fade' ? 2 : 1} step={0.05} value={it.transition.seconds}
                  onChange={(e) => change((x) => void (x.transition && (x.transition = { ...x.transition, seconds: +e.target.value })), 'transition')} className="min-w-0 flex-1" />
                <span className="w-10 text-right tabular-nums">{it.transition.seconds.toFixed(2)} s</span>
              </span>
            )}
          </div>
        </Group>
      )}
      {it.media === 'image' && (
        <Group on={tab} title="Timing"><label className={row}><span className={label}>Length (seconds)</span>
          <NumberBox label="Length" value={it.duration ?? 3} min={0.2} max={600} step={0.1} className="w-24" onChange={(v) => change((x) => void (x.duration = v), 'length')} />
        </label></Group>
      )}
      {it.media === 'video' && (
        <>
          <Group on={tab} title="Timing">
          <div className={row}><span className={label}>Speed</span>
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => <button key={s} type="button" className={chip((it.speed ?? 1) === s)} onClick={() => change((x) => void (x.speed = s))}>{s}×</button>)}
            <Exact label="Speed" value={it.speed ?? 1} min={0.1} max={4} step={0.05} unit="×" onChange={(v) => change((x) => void (x.speed = v), 'speed')} />
          </div>
          {it.track === MAIN && (
            <div className={row}><span className={label}>Speed ramp (cuts the clip in five, each at its own speed)</span>
              {RAMPS.map(([l, speeds]) => <button key={l} type="button" className={chip(false)} onClick={() => ramp(speeds)}>{l}</button>)}
            </div>
          )}
          <div className={row}><span className={label}>Direction</span>
            <button type="button" className={chip(!it.reverse)} onClick={() => change((x) => void delete x.reverse)}>Forwards</button>
            <button type="button" className={chip(!!it.reverse)} title="Plays it backwards (its sound too, in the export; the preview shows it frame by frame, silent)" onClick={() => change((x) => void (x.reverse = true))}>Backwards</button>
          </div>
          <div className={row}><span className={label}>Hold the last frame</span>
            {[0, 0.5, 1, 2].map((h) => <button key={h} type="button" className={chip(Math.abs((it.hold ?? 0) - h) < 0.05)} onClick={() => change((x) => void (x.hold = h))}>{h ? `+${h} s` : 'None'}</button>)}
            <Exact label="Hold" value={it.hold ?? 0} min={0} max={10} step={0.1} unit="s" onChange={(v) => change((x) => void (x.hold = v), 'hold')} />
          </div>
          <p className="text-xs text-faint tabular-nums">Using {num(it.in ?? 0)}–{num(it.out ?? 0)} s of a {num(it.source ?? it.out ?? 0)} s clip. Drag its edges on the timeline to trim.</p>
          </Group>
          <Group on={tab} title="Sound">
          <div className={row}><span className={label}>Clip sound</span>
            <button type="button" className={chip(!!it.sound)} onClick={() => change((x) => void (x.sound = !x.sound))}>{it.sound ? 'On' : 'Off'}</button>
            {it.ref && <button type="button" title="Put the clip's sound on its own audio track (the clip goes silent), to move, trim or fade it apart from the picture"
              className={chip(false)} onClick={onExtract}>Extract sound</button>}
          </div>
          {it.sound && (
            <>
              <Keyed {...keyed} prop="volume" label="Clip volume" min={0} max={1} step={0.05} plain={it.volume ?? 1} show={pct} set={(x, v) => void (x.volume = v)} />
              {fades}
            </>
          )}
          </Group>
        </>
      )}
      {(it.media === 'video' || it.media === 'image') && (
        <Group on={tab} title="Colour">
        <div className="flex flex-col gap-2">
          <span className={label}>Colour</span>
          {([['bright', 'Brightness', -0.3, 0.3, 0], ['contrast', 'Contrast', 0.6, 1.6, 1], ['sat', 'Saturation', 0, 2, 1], ['warm', 'Warmth', -1, 1, 0]] as const).map(([k, l, lo, hi, base]) => (
            <label key={k} className="flex items-center gap-2 text-xs text-muted">
              <span className="w-20 shrink-0">{l}</span>
              <input aria-label={l} type="range" min={lo} max={hi} step={0.01} value={it[k] ?? base} onChange={(e) => change((x) => void (x[k] = +e.target.value), k)} className="min-w-0 flex-1" />
              <span className="w-10 text-right tabular-nums">{(it[k] ?? base).toFixed(2)}</span>
            </label>
          ))}
          <div className="flex gap-1.5">
            <button type="button" className={chip(false)} title="Gives every clip on the video track this colour, so AI clips match"
              onClick={() => changeAll((q) => q.items.filter((y) => y.track === MAIN && y.media !== 'audio').forEach((y) => Object.assign(y, { bright: it.bright, contrast: it.contrast, sat: it.sat, warm: it.warm })))}>Apply to all clips</button>
            <button type="button" className={chip(false)} onClick={() => change((x) => void (delete x.bright, delete x.contrast, delete x.sat, delete x.warm))}>Reset</button>
          </div>
        </div>
        </Group>
      )}
      {it.media === 'audio' && (
        <>
          <Group on={tab} title="Sound">
          <div className={row}><span className={label}>While someone speaks</span>
            <button type="button" className={chip(ducks(p, it))} title="Lowers it under voices, easing in and out" onClick={() => change((x) => void (x.duck = !ducks(p, it)))}>{ducks(p, it) ? 'Lowered' : 'Stays at its volume'}</button>
            {ducks(p, it) && (
              <span className="flex w-full items-center gap-2 text-xs text-muted">to
                <input aria-label="Lowered to" type="range" min={0} max={0.8} step={0.05} value={it.duckTo ?? 0.3} onChange={(e) => change((x) => void (x.duckTo = +e.target.value), 'duckTo')} className="min-w-0 flex-1" />
                <span className="w-10 text-right tabular-nums">{pct(it.duckTo ?? 0.3)}</span>
              </span>
            )}
          </div>
          <Keyed {...keyed} prop="volume" label="Volume" min={0} max={1.5} step={0.02} plain={it.volume ?? 1} show={(v) => `${pct(v)}${v > 1 ? ' (above 100% only the export is louder)' : ''}`} set={(x, v) => void (x.volume = v)} />
            {fades}
          </Group>
          <Group on={tab} title="Timing">
          <div className={row}><span className={label}>Speed (keeps the pitch)</span>
            {[0.75, 1, 1.25, 1.5, 2].map((s) => <button key={s} type="button" className={chip((it.speed ?? 1) === s)} onClick={() => change((x) => void (s === 1 ? delete x.speed : (x.speed = s)))}>{s}×</button>)}
            <Exact label="Speed" value={it.speed ?? 1} min={0.5} max={4} step={0.05} unit="×" onChange={(v) => change((x) => void (x.speed = v), 'speed')} />
          </div>
          <p className="text-xs text-faint tabular-nums">Using {num(it.in ?? 0)}–{num(it.out ?? 0)} s. Drag to move it, drag its edges to trim.</p>
          </Group>
        </>
      )}
    </div>
  )
}

function Group({ title, on, children }: { title: string; on: string; children: React.ReactNode }) {
  return title === on ? <div role="tabpanel" className="flex flex-col gap-4">{children}</div> : null
}

// A caption's words keep their timing while the text has as many words; otherwise it becomes plain text.
function setText(x: Item, text: string) {
  if (x.media !== undefined) return
  x.text = text
  if (!x.words) return
  const said = text.trim().split(/\s+/)
  if (said.length === x.words.length) x.words = x.words.map((w, i) => ({ ...w, text: said[i] }))
  else delete x.words
}

// A number box that lets you type freely: what you type is used once it's a number in range, and it settles to the
// nearest allowed value when you leave the box (or press Enter).
function NumberBox({ label, value, min, max, step, className = '', onChange }: { label: string; value: number; min: number; max: number; step: number; className?: string; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const settle = () => {
    if (draft !== null && draft.trim() !== '' && Number.isFinite(+draft)) onChange(Math.min(max, Math.max(min, +draft)))
    setDraft(null)
  }
  return (
    <input aria-label={label} type="number" min={min} max={max} step={step} value={draft ?? +value.toFixed(2)}
      onChange={(e) => {
        setDraft(e.target.value)
        const v = +e.target.value
        if (e.target.value.trim() !== '' && v >= min && v <= max) onChange(v)
      }}
      onBlur={settle} onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      className={`h-8 rounded-lg border border-line bg-bg px-2 text-[13px] text-fg tabular-nums focus:border-fg ${className}`} />
  )
}

// A number box beside the presets, for exact values.
function Exact({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted">
      <NumberBox label={`${label}, exact`} value={value} min={min} max={max} step={step} className="w-16" onChange={onChange} />{unit}
    </span>
  )
}

function Tips() {
  const keys: [string, string][] = [['Space', 'Play / pause'], ['J K L', 'Play backwards, pause, play (again for 2×, 4×)'],
    ['← →', 'One frame back / forward (⇧ one second)'], ['↑ ↓', 'Previous / next cut'], ['Home End', 'To the start / end'],
    ['S or ⌘B', 'Split at the playhead'], ['F', 'Freeze the frame at the playhead for a second'], ['⌫', 'Delete the selected items'],
    ['⇧ or ⌘ click', 'Select more than one'], ['⌘A', 'Select everything'], ['⌘C ⌘X ⌘V', 'Copy, cut, paste at the playhead'], ['⌘D', 'Duplicate'],
    ['⌥← ⌥→', 'Nudge the selected text, sound or overlay a frame (⇧ a second)'], ['I O', 'Mark the part to export (⌥X clears)'], ['M', 'Add or remove a marker at the playhead (↑ ↓ stop at markers too)'],
    ['+ − or pinch', 'Zoom the timeline (⌘ scroll too)'], ['⇧Z', 'Fit the whole video'], ['⇧⌘F', 'Full-screen preview'], ['⌘Z ⇧⌘Z', 'Undo / redo']]
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <p className="text-muted">Click a clip on the timeline to change it. Drag clips to move them, drag their edges to trim, click the ruler to move the playhead.</p>
      <p className="text-muted">For picture in picture, a logo or a screen recording, add an Overlay track and drag the picture or clip onto it. Selected text and overlays can be dragged on the preview.</p>
      <details className="group">
        <summary className="cursor-pointer list-none text-muted hover:text-fg"><span className="inline-block w-3 transition-transform group-open:rotate-90">›</span> Keyboard shortcuts</summary>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
          {keys.map(([k, v]) => [<dt key={k} className="font-medium whitespace-nowrap tabular-nums">{k}</dt>, <dd key={v} className="text-muted">{v}</dd>])}
        </dl>
      </details>
      <p className="flex items-center gap-1.5 text-xs text-faint"><FolderOpen size={12} /> Exports are saved with your media; Show in Finder opens the file.</p>
    </div>
  )
}
