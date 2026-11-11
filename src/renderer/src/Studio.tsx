import {
  ArrowLeft, AudioLines, Captions, Download, FolderOpen, Image as ImageIcon, LoaderCircle, Music, Pause, Play, Plus, Redo2, Scissors, SkipBack, Trash2, TriangleAlert,
  Type, Undo2, Upload, Video, X, ZoomIn, ZoomOut,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { itemLength, layout, MAIN, splitAt, videoEnd } from '../../shared/timeline'
import { timing } from '../../shared/timing'
import { adVersions } from '../../shared/ads'
import type { Aspect, Attachment, EditProject, Episode, Item, ProjectRender, Ref, Series, Task, Track } from '../../shared/types'
import { isAudio, isVideo } from './Create'
import { api, errMsg, mediaUrl, toAttachments } from './lib'
import { Player } from './Player'
import { clipOf, fileOf, loadAll, synced, type Tasks, updateSeries } from './seriesStore'
import { pngBytes, textImage } from './textImage'
import { TimelineView } from './TimelineView'
import { Header, IconButton, SelectChip } from './ui'

type HeaderProps = { collapsed: boolean; onExpand: () => void }
type MediaKind = 'video' | 'image' | 'audio'
type Media = { ref: Ref; media: MediaKind; label: string }
const ACCEPT_IMPORT = 'video/mp4,video/quicktime,video/webm,image/png,image/jpeg,image/webp,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/aac,audio/webm'
const kindOfFile = (f: string): MediaKind => (isVideo(f) || /\.(mov|webm)$/i.test(f) && !/audio/.test(f) ? 'video' : isAudio(f) || /\.aac$/i.test(f) ? 'audio' : 'image')
const chip = (on: boolean) => `h-8 rounded-full border px-3 text-[13px] tabular-nums ${on ? 'border-fg bg-raised text-fg' : 'border-line text-muted hover:bg-raised hover:text-fg'}`
const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`
const tracksFor = (): Track[] => [
  { id: MAIN, kind: 'video', name: 'Video' },
  { id: crypto.randomUUID(), kind: 'text', name: 'Text' },
  { id: crypto.randomUUID(), kind: 'audio', name: 'Audio 1' },
]
const newProject = (title: string, aspect: Aspect): EditProject =>
  ({ id: crypto.randomUUID(), title, aspect, tracks: tracksFor(), items: [], imports: [], exports: [], createdAt: Date.now() })

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
  for (const [i, sc] of scenes.entries()) {
    const file = clipOf(t, sc)
    const tm = timing(sc)
    if (!file) continue // a scene without video yet is left out, with its lines
    {
      const src = await api.mediaSeconds(file)
      const out = Math.min(src || tm.seconds, tm.seconds)
      const clip = { track: MAIN, start: at, ref: { kind: 'media' as const, file }, media: 'video' as const, source: src, speed: 1, pan: 0, sound: !!s.videoSound && !synced(t, sc), volume: 1 }
      const hold = +Math.max(0, tm.seconds - out).toFixed(3)
      // An ad's long shot (a whole 4-5 s clip) is cut in two with a punch-in on the second half: a new picture every
      // 2-3 s without paying for another clip.
      if (ad && out >= 4) {
        const mid = +(out / 2).toFixed(3)
        p.items.push({ ...clip, id: crypto.randomUUID(), label: `Scene ${i + 1}`, in: 0, out: mid, hold: 0, zoom: 1 })
        p.items.push({ ...clip, id: crypto.randomUUID(), label: `Scene ${i + 1} (closer)`, in: mid, out: +out.toFixed(3), hold, zoom: 1.2 })
      } else p.items.push({ ...clip, id: crypto.randomUUID(), label: `Scene ${i + 1}`, in: 0, out: +out.toFixed(3), hold, zoom: 1 })
    }
    // The director's on-screen text (usually the hook) goes on the text track at the start of its shot.
    if (sc.plan?.text?.trim())
      p.items.push({ id: crypto.randomUUID(), track: p.tracks[1].id, start: +at.toFixed(3), label: 'Text', text: sc.plan.text.trim(), style: 'title', position: 'top',
        duration: +(ad ? tm.seconds : Math.min(tm.seconds, 2.5)).toFixed(3) })
    sc.lines.forEach((l, li) => {
      const vf = fileOf(t, l.voiceTask)
      if (!vf) return
      p.items.push({ id: crypto.randomUUID(), track: voices.id, start: +(at + tm.voices[li]).toFixed(3), label: `${l.speaker}: ${l.text}`, ref: { kind: 'media', file: vf },
        media: 'audio', source: l.seconds, in: 0, out: l.seconds ?? 2, volume: 1 })
      if (ad) p.items.push({ id: crypto.randomUUID(), track: captions.id, start: +(at + tm.voices[li]).toFixed(3), label: 'Caption', text: l.text, style: 'caption', position: 'bottom',
        duration: +(l.seconds ?? 2).toFixed(3) })
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

// A project as ffmpeg gets it: text drawn to full-frame PNGs, muted tracks left out.
export async function toProjectRender(p: EditProject): Promise<ProjectRender> {
  const textTracks = new Set(p.tracks.filter((t) => t.kind === 'text').map((t) => t.id))
  const muted = new Set(p.tracks.filter((t) => t.muted).map((t) => t.id))
  const texts = await Promise.all(p.items.filter((it) => textTracks.has(it.track) && it.text?.trim()).map(async (it) => ({
    ref: await api.saveFile(`text-${it.id}.png`, 'image/png', pngBytes(textImage(it, p.aspect))), start: it.start, length: itemLength(it),
  })))
  return {
    name: p.title, aspect: p.aspect, texts,
    main: p.items.filter((it) => it.track === MAIN && it.ref).map((it) => ({
      ref: it.ref!, media: it.media === 'image' ? 'image' : 'video', in: it.in ?? 0, out: it.out ?? 0, length: itemLength(it), speed: it.speed ?? 1,
      pan: it.pan ?? 0, zoom: it.zoom ?? 1, sound: !!it.sound && !muted.has(it.track), volume: it.volume ?? 1,
    })),
    audio: p.items.filter((it) => it.media === 'audio' && it.ref && !muted.has(it.track)).map((it) => ({
      ref: it.ref!, start: it.start, in: it.in ?? 0, out: it.out ?? 0, volume: it.volume ?? 1, fadeIn: it.fadeIn ?? 0, fadeOut: it.fadeOut ?? 0,
    })),
  }
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
    const p = newProject(`Untitled ${aspect === '9:16' ? 'vertical' : aspect === '16:9' ? 'wide' : 'square'} video`, aspect)
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
              {(['9:16', '16:9', '1:1'] as Aspect[]).map((a) => (
                <button key={a} type="button" onClick={() => create(a)} className="flex flex-1 flex-col items-center gap-2 rounded-2xl border border-line p-4 hover:bg-raised">
                  <span className="rounded-md border-2 border-muted" style={{ width: a === '16:9' ? 64 : a === '1:1' ? 44 : 30, height: a === '16:9' ? 36 : a === '1:1' ? 44 : 54 }} />
                  <span className="text-[13px] font-medium">{a === '9:16' ? 'Vertical 9:16' : a === '16:9' ? 'Wide 16:9' : 'Square 1:1'}</span>
                  <span className="text-xs text-faint">{a === '9:16' ? 'Reels, TikTok, Shorts' : a === '16:9' ? 'YouTube' : 'Feed posts'}</span>
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
                    <IconButton title="Delete edit" className="hidden size-7 group-hover:inline-flex" onClick={() => setConfirm(p.id)}><Trash2 size={14} /></IconButton>
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
  const [sel, setSel] = useState<string | null>(null)
  const [pps, setPps] = useState(60)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [exported, setExported] = useState<string | null>(null)
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
  const change = useCallback((fn: (x: EditProject) => void, record = true) => {
    const cur = current.current
    const next = structuredClone(cur)
    fn(next)
    set(layout(next), record ? cur : undefined)
  }, [])
  const commit = (before: EditProject) => (setPast((h) => [...h.slice(-80), before]), setFuture([]))
  const undo = () => past.length && (setFuture((f) => [p, ...f]), setPast((h) => h.slice(0, -1)), set(past.at(-1)!))
  const redo = () => future.length && (setPast((h) => [...h, p]), setFuture((f) => f.slice(1)), set(future[0]))

  // Thumbnails for every video on the timeline.
  useEffect(() => {
    for (const it of p.items) {
      if (!it.ref || it.media === 'audio') continue
      const key = `${it.ref.kind}/${it.ref.file}`
      if (thumbs[key]) continue
      if (it.media === 'image') setThumbs((m) => ({ ...m, [key]: mediaUrl(it.ref!) }))
      else void api.thumb(it.ref).then((r) => setThumbs((m) => ({ ...m, [key]: mediaUrl(r) })), () => {})
    }
  }, [p.items])

  const selected = p.items.find((it) => it.id === sel)
  const splitHere = () => change((x) => {
    const target = x.items.find((it) => it.id === sel && time > it.start && time < it.start + itemLength(it))
      ?? x.items.find((it) => it.track === MAIN && time > it.start && time < it.start + itemLength(it))
    if (!target) return
    const parts = splitAt(target, time, crypto.randomUUID())
    if (parts) x.items.splice(x.items.indexOf(target), 1, ...parts)
  })
  const remove = () => sel && (change((x) => void (x.items = x.items.filter((it) => it.id !== sel))), setSel(null))

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName)) return
      const k = e.key.toLowerCase()
      if (e.metaKey && k === 'z') return e.preventDefault(), e.shiftKey ? redo() : undo()
      if (e.metaKey) return
      if (k === ' ') return e.preventDefault(), setPlaying((v) => !v)
      if (k === 's') return splitHere()
      if (k === 'backspace' || k === 'delete') return remove()
      if (k === 'arrowleft' || k === 'arrowright') return e.preventDefault(), setPlaying(false), setTime((t) => Math.min(total, Math.max(0, t + (k === 'arrowleft' ? -1 : 1) * (e.shiftKey ? 1 : 1 / 30))))
      if (k === 'home') return setTime(0)
      if (k === '=' || k === '+') return setPps((v) => Math.min(400, v * 1.3))
      if (k === '-') return setPps((v) => Math.max(8, v / 1.3))
      if (k === 'escape') setSel(null)
    }
    addEventListener('keydown', h)
    return () => removeEventListener('keydown', h)
  })

  // Adds media at time t: pictures and video onto the video track at that point, sound onto an audio track with room.
  async function add(m: Media, t = time, track?: Track) {
    const id = crypto.randomUUID()
    const src = m.media === 'image' ? 0 : await api.mediaSeconds(m.ref)
    change((x) => {
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

  async function exportVideo() {
    setBusy('export')
    setError('')
    setPlaying(false)
    try {
      const file = await api.renderEdit(await toProjectRender(p))
      change((x) => void x.exports.push(file), false)
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

  return (
    <div className="flex h-full flex-col">
      <div className="drag flex h-14 shrink-0 items-center gap-2 px-4">
        <IconButton title="All edits" onClick={onBack}><ArrowLeft size={16} /></IconButton>
        <input aria-label="Title" value={p.title} onChange={(e) => change((x) => void (x.title = e.target.value), false)} className="min-w-0 max-w-80 flex-1 bg-transparent font-medium" />
        <SelectChip title="Shape" label={p.aspect} value={p.aspect} onChange={(v) => change((x) => void (x.aspect = v as Aspect))}
          options={[{ value: '9:16', label: 'Vertical 9:16' }, { value: '16:9', label: 'Wide 16:9' }, { value: '1:1', label: 'Square 1:1' }]} />
        <div className="ml-auto flex items-center gap-1">
          <IconButton title="Undo (⌘Z)" disabled={!past.length} onClick={undo}><Undo2 size={16} /></IconButton>
          <IconButton title="Redo (⇧⌘Z)" disabled={!future.length} onClick={redo}><Redo2 size={16} /></IconButton>
          <button type="button" disabled={!!busy || !p.items.some((it) => it.track === MAIN)} onClick={exportVideo}
            className="inline-flex h-9 items-center gap-2 rounded-full bg-inverse px-4 font-medium text-on-inverse disabled:opacity-35">
            {busy === 'export' ? <LoaderCircle size={15} className="animate-spin" /> : <Download size={15} />} Export
          </button>
        </div>
      </div>
      {error && <p className="mx-4 mb-2 flex items-center gap-2 rounded-xl bg-raised px-3 py-2 text-[13px] text-danger"><TriangleAlert size={14} /> {error}<button type="button" className="ml-auto" onClick={() => setError('')}><X size={14} /></button></p>}
      {exported && (
        <div className="mx-4 mb-2 flex items-center gap-3 rounded-xl bg-raised px-3 py-2 text-[13px]">
          <span className="min-w-0 flex-1 truncate">Exported{p.episode ? ' and set as the episode’s cut' : ''}.</span>
          <button type="button" className="font-medium underline underline-offset-2" onClick={() => api.saveAs({ kind: 'media', file: exported })}>Save as…</button>
          <button type="button" className="underline underline-offset-2" onClick={() => api.reveal({ kind: 'media', file: exported })}>Show in Finder</button>
          <IconButton title="Dismiss" className="size-7" onClick={() => setExported(null)}><X size={13} /></IconButton>
        </div>
      )}

      <div className="flex min-h-0 flex-[3] gap-3 px-4">
        <Bin p={p} onAdd={(m) => void add(m)} onImport={(a) => change((x) => void x.imports.push(...a.filter((i) => !x.imports.some((y) => y.file === i.file))))} />
        <div className="flex min-w-0 flex-1 flex-col items-center gap-2">
          <div className="flex min-h-0 w-full flex-1 items-center justify-center">
            <Player p={p} time={time} playing={playing} onTime={setTime} onEnd={() => setPlaying(false)} />
          </div>
          <div className="flex items-center gap-2 text-[13px] text-muted tabular-nums">
            <IconButton title="To the start (Home)" onClick={() => (setPlaying(false), setTime(0))}><SkipBack size={16} /></IconButton>
            <button type="button" title="Play / pause (Space)" onClick={() => setPlaying((v) => !v)} className="flex size-9 items-center justify-center rounded-full bg-inverse text-on-inverse">
              {playing ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <span className="w-36">{fmt(time)} / {fmt(total)}</span>
          </div>
        </div>
        <aside className="w-80 shrink-0 overflow-y-auto">
          {selected ? <Inspector it={selected} p={p} change={(fn, record) => change((x) => fn(x.items.find((y) => y.id === selected.id)!), record)} /> : <Tips />}
        </aside>
      </div>

      <div className="flex min-h-0 flex-[2] flex-col border-t border-line">
        <div className="flex shrink-0 items-center gap-1 px-3 py-1.5">
          <button type="button" title="Split at the playhead (S)" onClick={splitHere} className={`${chip(false)} inline-flex items-center gap-1.5`}><Scissors size={13} /> Split</button>
          <button type="button" title="Delete the selected item (⌫)" disabled={!sel} onClick={remove} className={`${chip(false)} inline-flex items-center gap-1.5 disabled:opacity-40`}><Trash2 size={13} /> Delete</button>
          <button type="button" onClick={() => addText()} className={`${chip(false)} inline-flex items-center gap-1.5`}><Type size={13} /> Text</button>
          {p.episode && <button type="button" title="One caption per voice line, timed to it" onClick={captions} className={`${chip(false)} inline-flex items-center gap-1.5`}><Captions size={13} /> Captions from script</button>}
          <button type="button" onClick={() => change((x) => void x.tracks.push({ id: crypto.randomUUID(), kind: 'audio', name: `Audio ${x.tracks.filter((t) => t.kind === 'audio').length + 1}` }))}
            className={`${chip(false)} inline-flex items-center gap-1.5`}><Plus size={13} /> Audio track</button>
          <div className="ml-auto flex items-center gap-1 text-muted">
            <IconButton title="Zoom out (−)" onClick={() => setPps((v) => Math.max(8, v / 1.3))}><ZoomOut size={15} /></IconButton>
            <input aria-label="Zoom" type="range" min={8} max={400} value={pps} onChange={(e) => setPps(+e.target.value)} className="w-28" />
            <IconButton title="Zoom in (+)" onClick={() => setPps((v) => Math.min(400, v * 1.3))}><ZoomIn size={15} /></IconButton>
          </div>
        </div>
        <TimelineView p={p} time={time} pps={pps} thumbs={thumbs} sel={sel} onSelect={setSel} change={change} commit={commit}
          onSeek={(t) => (setPlaying(false), setTime(Math.min(t, total)))}
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
  const [tab, setTab] = useState<'locco' | 'imported'>('locco')
  const [kind, setKind] = useState<MediaKind | 'all'>('all')
  const [tasks, setTasks] = useState<Task[]>([])
  const picker = useRef<HTMLInputElement>(null)
  useEffect(() => void api.tasks().then((all) => setTasks(all.filter((t) => t.state === 'success' && t.files.length))), [])
  const made: Media[] = tasks.flatMap((t) => t.files.filter((f) => !/-cover\./.test(f)).map((f) => ({ ref: { kind: 'media' as const, file: f }, media: kindOfFile(f), label: t.prompt.slice(0, 60) || t.label })))
  const imported: Media[] = p.imports.map((a) => ({ ref: { kind: a.kind, file: a.file }, media: kindOfFile(a.name), label: a.name }))
  const list = (tab === 'locco' ? made : imported).filter((m) => kind === 'all' || m.media === kind)
  return (
    <aside className="flex w-72 shrink-0 flex-col gap-2 overflow-hidden">
      <div className="flex items-center gap-1">
        {(['locco', 'imported'] as const).map((k) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`h-8 rounded-full px-3 text-[13px] ${tab === k ? 'bg-raised font-medium text-fg' : 'text-muted hover:text-fg'}`}>
            {k === 'locco' ? 'Made in locco' : `Imported${p.imports.length ? ` · ${p.imports.length}` : ''}`}
          </button>
        ))}
        <IconButton title="Import files from your Mac" className="ml-auto" onClick={() => (setTab('imported'), picker.current?.click())}><Upload size={15} /></IconButton>
        <input ref={picker} type="file" multiple hidden accept={ACCEPT_IMPORT} onChange={async (e) => {
          if (e.target.files) onImport(await toAttachments(e.target.files, ACCEPT_IMPORT))
          e.target.value = ''
        }} />
      </div>
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
    </aside>
  )
}

function Inspector({ it, p, change }: { it: Item; p: EditProject; change: (fn: (it: Item) => void, record?: boolean) => void }) {
  const row = 'flex flex-wrap items-center gap-1.5'
  const label = 'w-full text-xs text-muted'
  const track = p.tracks.find((t) => t.id === it.track)
  const num = (v: number) => +v.toFixed(2)
  return (
    <div className="flex flex-col gap-4 text-[13px]">
      <div>
        <h3 className="truncate font-medium">{it.text ? 'Text' : it.label}</h3>
        <p className="text-xs text-faint tabular-nums">{track?.name} · starts {fmt(it.start)} · runs {itemLength(it).toFixed(2)} s</p>
      </div>
      {it.text !== undefined && (
        <>
          <textarea aria-label="Text" rows={3} value={it.text} onChange={(e) => change((x) => void (x.text = e.target.value))}
            className="resize-none rounded-lg border border-line bg-bg px-2.5 py-1.5 leading-relaxed focus:border-fg" />
          <div className={row}><span className={label}>Style</span>
            {(['caption', 'title'] as const).map((s) => <button key={s} type="button" className={chip(it.style === s)} onClick={() => change((x) => void (x.style = s))}>{s === 'caption' ? 'Caption' : 'Title'}</button>)}
          </div>
          <div className={row}><span className={label}>Position</span>
            {(['top', 'middle', 'bottom'] as const).map((s) => <button key={s} type="button" className={chip((it.position ?? 'bottom') === s)} onClick={() => change((x) => void (x.position = s))}>{s[0].toUpperCase() + s.slice(1)}</button>)}
          </div>
        </>
      )}
      {(it.media === 'image' || it.text !== undefined) && (
        <label className={row}><span className={label}>Length (seconds)</span>
          <input type="number" min={0.2} step={0.1} value={num(it.duration ?? 3)} onChange={(e) => change((x) => void (x.duration = Math.max(0.2, +e.target.value || 0.2)))}
            className="h-8 w-24 rounded-lg border border-line bg-bg px-2 tabular-nums focus:border-fg" />
        </label>
      )}
      {(it.media === 'video' || it.media === 'image') && (
        <>
          <div className={row}><span className={label}>Reframe</span>
            {([[-1, 'Left'], [0, 'Center'], [1, 'Right']] as const).map(([v, l]) => <button key={v} type="button" className={chip((it.pan ?? 0) === v)} onClick={() => change((x) => void (x.pan = v))}>{l}</button>)}
          </div>
          <div className={row}><span className={label}>Zoom</span>
            {[1, 1.15, 1.3, 1.5].map((z) => <button key={z} type="button" className={chip((it.zoom ?? 1) === z)} onClick={() => change((x) => void (x.zoom = z))}>{z === 1 ? 'None' : `${z}×`}</button>)}
          </div>
        </>
      )}
      {it.media === 'video' && (
        <>
          <div className={row}><span className={label}>Speed</span>
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => <button key={s} type="button" className={chip((it.speed ?? 1) === s)} onClick={() => change((x) => void (x.speed = s))}>{s}×</button>)}
          </div>
          <div className={row}><span className={label}>Hold the last frame</span>
            {[0, 0.5, 1, 2].map((h) => <button key={h} type="button" className={chip(Math.abs((it.hold ?? 0) - h) < 0.05)} onClick={() => change((x) => void (x.hold = h))}>{h ? `+${h} s` : 'None'}</button>)}
          </div>
          <div className={row}><span className={label}>Clip sound</span>
            <button type="button" className={chip(!!it.sound)} onClick={() => change((x) => void (x.sound = !x.sound))}>{it.sound ? 'On' : 'Off'}</button>
            {it.sound && <input aria-label="Clip volume" type="range" min={0} max={1} step={0.05} value={it.volume ?? 1} onChange={(e) => change((x) => void (x.volume = +e.target.value), false)} className="w-36" />}
          </div>
          <p className="text-xs text-faint tabular-nums">Using {num(it.in ?? 0)}–{num(it.out ?? 0)} s of a {num(it.source ?? it.out ?? 0)} s clip. Drag its edges on the timeline to trim.</p>
        </>
      )}
      {it.media === 'audio' && (
        <>
          <div className={row}><span className={label}>Volume {Math.round((it.volume ?? 1) * 100)}%</span>
            <input aria-label="Volume" type="range" min={0} max={1.5} step={0.02} value={it.volume ?? 1} onChange={(e) => change((x) => void (x.volume = +e.target.value), false)} className="w-full" />
          </div>
          <div className={row}><span className={label}>Fade in</span>
            {[0, 0.5, 1, 2].map((f) => <button key={f} type="button" className={chip((it.fadeIn ?? 0) === f)} onClick={() => change((x) => void (x.fadeIn = f))}>{f ? `${f} s` : 'None'}</button>)}
          </div>
          <div className={row}><span className={label}>Fade out</span>
            {[0, 0.5, 1, 2].map((f) => <button key={f} type="button" className={chip((it.fadeOut ?? 0) === f)} onClick={() => change((x) => void (x.fadeOut = f))}>{f ? `${f} s` : 'None'}</button>)}
          </div>
          <p className="text-xs text-faint tabular-nums">Using {num(it.in ?? 0)}–{num(it.out ?? 0)} s. Drag to move it, drag its edges to trim.</p>
        </>
      )}
    </div>
  )
}

function Tips() {
  const keys: [string, string][] = [['Space', 'Play / pause'], ['S', 'Split at the playhead'], ['⌫', 'Delete the selected item'], ['← →', 'One frame back / forward (⇧ one second)'],
    ['+ −', 'Zoom the timeline'], ['⌘Z / ⇧⌘Z', 'Undo / redo']]
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <p className="text-muted">Click a clip on the timeline to change it. Drag clips to move them, drag their edges to trim, click the ruler to move the playhead.</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
        {keys.map(([k, v]) => [<dt key={k} className="font-medium tabular-nums">{k}</dt>, <dd key={v} className="text-muted">{v}</dd>])}
      </dl>
      <p className="flex items-center gap-1.5 text-xs text-faint"><FolderOpen size={12} /> Exports are saved with your media; use Save as… to put one anywhere.</p>
    </div>
  )
}
