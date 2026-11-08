import { ArrowLeft, Clapperboard, Download, Film, ImagePlus, LoaderCircle, Plus, RotateCcw, Square, Trash2, TriangleAlert, UserRound } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { buildInput, fill, slotsOf } from '../../shared/inputs'
import { MEDIA_MODELS, withBest } from '../../shared/models'
import { estimate, priceLabel } from '../../shared/prices'
import type { Attachment, Character, Episode, MediaModel, Series, Shot, Task } from '../../shared/types'
import { elapsed, isVideo, Media } from './Create'
import { api, errMsg, mediaUrl } from './lib'
import { Header, IconButton, SelectChip } from './ui'

// --- Store: one copy of every series, shared by the screen and the episode runs (which keep going when you leave) ---

let docs: Series[] = []
type Run = { step: string; error?: string; note?: string; stop?: boolean }
let runs: Record<string, Run> = {}
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())
const subscribe = (f: () => void) => (subs.add(f), () => void subs.delete(f))
let snapshot = { docs, runs }
const getSnapshot = () => snapshot
const changed = () => ((snapshot = { docs, runs }), emit())
const load = () => api.series().then((list) => ((docs = list), changed()))

const get = (id: string) => docs.find((s) => s.id === id)!
async function update(id: string, fn: (s: Series) => void) {
  const next = structuredClone(get(id))
  fn(next)
  docs = docs.map((s) => (s.id === id ? next : s))
  changed()
  await api.saveSeries(next)
}
const setRun = (key: string, r?: Run) => {
  runs = { ...runs }
  if (r) runs[key] = r
  else delete runs[key]
  changed()
}

// --- Models and inputs ---

const IMAGE_MODELS = ['gpt-image-2', 'nano-banana-2', 'nano-banana-pro', 'seedream-4-5', 'wan-2-7-image', 'grok-imagine-image']
const VIDEO_MODELS = ['grok-imagine', 'seedance-2-fast', 'kling-3']
const model = (id: string) => MEDIA_MODELS.find((m) => m.id === id)!
const spec = (m: MediaModel) => (m.image ?? m.text)!
const has = (m: MediaModel, name: string) => [m.text, m.image].some((s) => s?.fields.some((f) => f.name === name))
// Video models with sound say the lines themselves; for the others locco adds an ElevenLabs voice.
const speaks = (m: MediaModel) => has(m, 'sound') || has(m, 'generate_audio')
const lowest = (m: MediaModel, name: string) => spec(m).fields.find((f) => f.name === name)?.enum?.[0]
const shotSeconds = (m: MediaModel) => Number(lowest(m, 'duration')) || 5
const shotCount = (s: Series) => Math.max(3, Math.min(12, Math.round(s.seconds / shotSeconds(model(s.videoModel)))))
function videoValues(m: MediaModel) {
  const v: Record<string, unknown> = { aspect_ratio: '9:16', duration: lowest(m, 'duration'), resolution: lowest(m, 'resolution') }
  if (has(m, 'sound')) v.sound = true
  if (has(m, 'generate_audio')) v.generate_audio = true
  if (has(m, 'mode') && m.id.startsWith('kling')) v.mode = 'std'
  return v
}
const img = (file: string): Attachment => ({ kind: 'media', file, name: file, mime: 'image/png' })
const VOICES = Object.entries(spec(model('tts-turbo')).fields.find((f) => f.name === 'voice')?.enumLabels ?? {})

type Tasks = Record<string, Task>
const stateOf = (tasks: Tasks, id?: string) =>
  !id ? 'none' : !tasks[id] ? 'busy' : tasks[id].state === 'success' ? 'done' : tasks[id].state === 'fail' ? 'fail' : 'busy'
const fileOf = (tasks: Tasks, id?: string) => (id && tasks[id]?.state === 'success' ? tasks[id].files[0] : undefined)
const needs = (tasks: Tasks, id?: string) => ['none', 'fail'].includes(stateOf(tasks, id))
const castOf = (s: Series, shot: Shot) =>
  s.characters.filter((c) => c.name && (shot.speaker === c.name || shot.description.toLowerCase().includes(c.name.toLowerCase())))

// --- Making things (each returns the new task id) ---

async function makeOne(modelId: string, values: Record<string, unknown>, files: Attachment[], prompt: string) {
  const m = model(modelId)
  const { variant, input } = buildInput(m, values, slotsOf(m).length ? fill({}, slotsOf(m), files) : {})
  const [id] = await api.generate({ modelId, variant, prompt, input, count: 1 })
  return id
}
const portraitPrompt = (s: Series, c: Character) =>
  `Character reference portrait for a short film: ${c.name}, ${c.look}. ${s.style} Head and shoulders, facing the camera, neutral expression, plain light grey background, sharp focus, no text.`
function framePrompt(s: Series, shot: Shot, cast: Character[], fix?: string) {
  const refs = cast.length ? ` Keep each person exactly as in their reference image: ${cast.map((c, i) => `${c.name} is image ${i + 1}`).join(', ')}.` : ''
  return `${s.style} ${shot.description}. Camera: ${shot.camera}. A vertical 9:16 still from a short film, cinematic, no text, no captions, no subtitles.${refs}${fix ? ` Fix: ${fix}` : ''}`
}
function videoPrompt(s: Series, shot: Shot, m: MediaModel) {
  const line = shot.line && shot.speaker ? (speaks(m) ? ` ${shot.speaker} says: "${shot.line}"` : ` ${shot.speaker} is talking.`) : ''
  return `${shot.description}. Camera: ${shot.camera}.${line} ${s.style}`
}
const voiceOf = (s: Series, shot: Shot) => s.characters.find((c) => c.name === shot.speaker)?.voice

// Starts one job per item, saves the ids and waits for all of them, showing how long kie is taking.
// A job kie times out on is started once more on its own; any other failure stops the run with kie's reason.
// optional: failures don't stop the run; their count is returned instead.
async function makeAll<T>(key: string, label: string, what: string, items: T[], make: (it: T) => Promise<string>, save: (pairs: [T, string][]) => Promise<void>, optional = false) {
  if (!items.length) return { failed: 0, error: '' }
  const ids = await Promise.all(items.map(make))
  await save(items.map((it, i) => [it, ids[i]]))
  const retried = new Set<number>()
  const started = Date.now()
  for (;;) {
    if (runs[key]?.stop) throw new Error('Stopped. Press Make episode to carry on where it left off.')
    const all = await api.tasks()
    const mine = ids.map((id) => all.find((t) => t.id === id))
    const again = mine.flatMap((t, i) => (t?.state === 'fail' && /time ?out|timed out/i.test(t.error ?? '') && !retried.has(i) ? [i] : []))
    if (again.length) {
      for (const i of again) (retried.add(i), (ids[i] = await make(items[i])))
      await save(again.map((i) => [items[i], ids[i]]))
      continue
    }
    if (mine.every((t) => t && (t.state === 'success' || t.state === 'fail'))) {
      const failed = mine.filter((t) => t!.state === 'fail')
      if (failed.length && !optional) throw new Error(`${failed.length} ${what} failed: ${failed[0]!.error}. Press Make episode to retry them.`)
      return { failed: failed.length, error: failed[0]?.error ?? '' }
    }
    const waited = Date.now() - started
    setRun(key, { step: `${label} ${elapsed(waited)}${waited > 120_000 ? ' · kie is slow right now; you can Stop and pick another model' : ''}` })
    await new Promise((r) => setTimeout(r, 3000))
  }
}

// Makes whatever an episode is still missing, in order: script, portraits, frames (checked by GPT 6 Sol), videos, voices, music, cut.
// Safe to run again after a failure or Stop: finished pieces are kept.
async function runEpisode(sid: string, eid: string) {
  const key = `${sid}:${eid}`
  const step = (text: string) => {
    if (runs[key]?.stop) throw new Error('Stopped. Press Make episode to carry on where it left off.')
    setRun(key, { step: text })
  }
  const ep = () => get(sid).episodes.find((e) => e.id === eid)!
  const shotIn = (s: Series, id: string) => s.episodes.find((e) => e.id === eid)!.shots.find((x) => x.id === id)!
  const tasks = async () => Object.fromEntries((await api.tasks()).map((t) => [t.id, t])) as Tasks
  try {
    let t = await tasks()
    const scripted = ep().shots.length > 0
    // Without a script yet every character gets a portrait; with one, only the cast of this episode.
    const cast = new Set(scripted ? ep().shots.flatMap((sh) => castOf(get(sid), sh).map((c) => c.id)) : get(sid).characters.map((c) => c.id))
    const portraits = get(sid).characters.filter((c) => cast.has(c.id) && needs(t, c.portraitTask))
    const drawPortrait = (c: Character) => makeOne(get(sid).imageModel, { aspect_ratio: '3:4' }, [], portraitPrompt(get(sid), c))
    const savePortraits = (pairs: [Character, string][]) => update(sid, (s) => pairs.forEach(([c, id]) => (s.characters.find((x) => x.id === c.id)!.portraitTask = id)))
    // Portraits don't need the script, so they're started first and drawn while it's written.
    const portraitsDone = makeAll(key, `Drawing ${portraits.length} character${portraits.length > 1 ? 's' : ''}…`, 'portraits', portraits, drawPortrait, savePortraits)
    portraitsDone.catch(() => {}) // awaited below; this only keeps an early failure from going unhandled while the script is written
    if (!scripted) {
      step(portraits.length ? 'Writing the script and drawing the characters…' : 'Writing the script…')
      const s0 = get(sid)
      const shots = await api.writeEpisode(s0, s0.episodes.findIndex((e) => e.id === eid), shotSeconds(model(s0.videoModel)))
      await update(sid, (s) => void (s.episodes.find((e) => e.id === eid)!.shots = shots))
    }
    await portraitsDone

    t = await tasks()
    const frame = (shot: Shot, fix?: string) => {
      const s = get(sid)
      const people = castOf(s, shot).filter((c) => fileOf(t, c.portraitTask))
      return makeOne(s.imageModel, { aspect_ratio: '9:16' }, people.map((c) => img(fileOf(t, c.portraitTask)!)), framePrompt(s, shot, people, fix))
    }
    const frames = ep().shots.filter((sh) => needs(t, sh.frameTask))
    await makeAll(key, `Making ${frames.length} frames…`, 'frames', frames, (sh) => frame(sh),
      (pairs) => update(sid, (s) => pairs.forEach(([sh, id]) => Object.assign(shotIn(s, sh.id), { frameTask: id, reviewed: false }))))

    t = await tasks()
    if (ep().shots.some((sh) => !sh.reviewed)) {
      step('Checking the frames…')
      const s = get(sid)
      const people = s.characters.filter((c) => fileOf(t, c.portraitTask)).map((c) => ({ name: c.name, file: fileOf(t, c.portraitTask)! }))
      const redo = await api.reviewFrames(people, ep().shots.map((sh, i) => ({ n: i + 1, description: sh.description, file: fileOf(t, sh.frameTask)! })))
      await update(sid, (s) => s.episodes.find((e) => e.id === eid)!.shots.forEach((sh) => (sh.reviewed = true)))
      const fixes = redo.map((r) => ({ shot: ep().shots[r.shot - 1], fix: r.fix }))
      await makeAll(key, `Redoing ${fixes.length} frame${fixes.length > 1 ? 's' : ''} (${redo.map((r) => `shot ${r.shot}`).join(', ')})…`, 'frames', fixes,
        (f) => frame(f.shot, f.fix), (pairs) => update(sid, (s) => pairs.forEach(([f, id]) => Object.assign(shotIn(s, f.shot.id), { frameTask: id, videoTask: undefined }))))
    }

    t = await tasks()
    const vm = model(get(sid).videoModel)
    const videos = ep().shots.filter((sh) => needs(t, sh.videoTask))
    await makeAll(key, `Animating ${videos.length} shots…`, 'videos', videos,
      (sh) => makeOne(vm.id, videoValues(vm), [img(fileOf(t, sh.frameTask)!)], videoPrompt(get(sid), sh, vm)),
      (pairs) => update(sid, (s) => pairs.forEach(([sh, id]) => (shotIn(s, sh.id).videoTask = id))))

    t = await tasks()
    const spoken = speaks(vm)
    const voices = spoken ? [] : ep().shots.filter((sh) => sh.line.trim() && needs(t, sh.voiceTask))
    const spokenLines = await makeAll(key, `Recording ${voices.length} voice lines…`, 'voice lines', voices,
      (sh) => {
        const voice = voiceOf(get(sid), sh)
        return makeOne('tts-turbo', voice ? { voice } : {}, [], sh.line)
      },
      (pairs) => update(sid, (s) => pairs.forEach(([sh, id]) => (shotIn(s, sh.id).voiceTask = id))), true)

    t = await tasks()
    await makeAll(key, 'Making the music…', 'music tracks', needs(t, ep().musicTask) ? [ep()] : [],
      (e) => makeOne('suno', { custom_mode: false, instrumental: true }, [], `Instrumental background score for a short-film episode. ${get(sid).style} Mood: ${e.summary}`.slice(0, 450)),
      (pairs) => update(sid, (s) => void (s.episodes.find((e) => e.id === eid)!.musicTask = pairs[0][1])))

    step('Cutting the episode…')
    t = await tasks()
    const s = get(sid)
    const file = await api.cut({
      name: `${s.title} ${ep().title}`,
      shots: ep().shots.map((sh) => ({ video: fileOf(t, sh.videoTask)!, voice: spoken ? undefined : fileOf(t, sh.voiceTask) })),
      music: fileOf(t, ep().musicTask),
    })
    await update(sid, (s) => void (s.episodes.find((e) => e.id === eid)!.cut = file))
    // Voice lines are a nice-to-have: when ElevenLabs fails the episode is cut without them, and a later run adds them.
    setRun(key, spokenLines?.failed
      ? { step: '', note: `Cut without ${spokenLines.failed} voice line${spokenLines.failed > 1 ? 's' : ''}: ElevenLabs said "${spokenLines.error}". Make episode again later adds them.` }
      : undefined)
  } catch (e) {
    setRun(key, { step: '', error: errMsg(e) })
  }
}

// What's still to pay for in an episode, at the chosen models.
function remaining(s: Series, ep: Episode, t: Tasks) {
  const image = estimate(s.imageModel, buildInput(model(s.imageModel), { aspect_ratio: '9:16' }, {}).input)?.hi ?? 0
  const vm = model(s.videoModel)
  const video = estimate(vm.id, buildInput(vm, videoValues(vm), {}).input)?.hi ?? 0
  const shots = ep.shots.length ? ep.shots : Array.from({ length: shotCount(s) }, () => ({ line: 'x'.repeat(60) }) as Shot)
  const cast = ep.shots.length ? new Set(ep.shots.flatMap((sh) => castOf(s, sh).map((c) => c.id))) : new Set(s.characters.map((c) => c.id))
  const credits =
    s.characters.filter((c) => cast.has(c.id) && needs(t, c.portraitTask)).length * image +
    shots.filter((sh) => needs(t, sh.frameTask)).length * image +
    shots.filter((sh) => needs(t, sh.videoTask)).length * video +
    (speaks(vm) ? 0 : shots.filter((sh) => sh.line && needs(t, sh.voiceTask)).reduce((n, sh) => n + (estimate('tts-turbo', {}, sh.line.length)?.hi ?? 0), 0)) +
    (needs(t, ep.musicTask) ? (estimate('suno', {})?.hi ?? 0) : 0) +
    3 // writing and checking with GPT 6 Sol
  return priceLabel({ lo: credits, hi: credits, perSecond: false })
}

// --- Screen ---

export function SeriesView({ header, onChanged }: { header: { collapsed: boolean; onExpand: () => void }; onChanged: () => void }) {
  const { docs: list, runs: running } = useSyncExternalStore(subscribe, getSnapshot)
  const [openId, setOpenId] = useState<string | null>(null)
  const [tasks, setTasks] = useState<Tasks>({})
  useEffect(() => {
    void load()
    const refresh = () => void api.tasks().then((all) => setTasks(Object.fromEntries(all.map((t) => [t.id, t]))))
    refresh()
    return api.onTasks(() => (refresh(), onChanged()))
  }, [onChanged])
  const open = list.find((s) => s.id === openId)
  if (!open) return <SeriesHome header={header} list={list} onOpen={setOpenId} />
  return <SeriesEditor header={header} series={open} tasks={tasks} runs={running} onBack={() => setOpenId(null)} />
}

function SeriesHome({ header, list, onOpen }: { header: { collapsed: boolean; onExpand: () => void }; list: Series[]; onOpen: (id: string) => void }) {
  const [idea, setIdea] = useState('')
  const [episodes, setEpisodes] = useState('3')
  const [seconds, setSeconds] = useState('45')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function write() {
    if (!idea.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const s = await api.writeSeries(idea.trim(), Number(episodes), Number(seconds))
      await api.saveSeries(s)
      await load()
      onOpen(s.id)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex h-full flex-col">
      <Header {...header}>
        <span className="font-medium">Series</span>
      </Header>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 pt-6 pb-16">
          <div className="flex flex-col gap-3 rounded-3xl border border-line bg-surface p-4 shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
            <textarea
              id="series-idea"
              rows={3}
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="Your series idea: who it's about, the world, the tone. Two baristas in Baku and an espresso machine that grants wishes, deadpan comedy."
              className="resize-none bg-transparent px-1 text-[15px] leading-relaxed placeholder:text-faint"
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <SelectChip title="Episodes" label={`${episodes} episodes`} value={episodes} onChange={setEpisodes} options={['3', '5', '8'].map((n) => ({ value: n, label: `${n} episodes` }))} />
              <SelectChip title="Episode length" label={`${seconds} s each`} value={seconds} onChange={setSeconds} options={['30', '45', '60'].map((n) => ({ value: n, label: `${n} seconds` }))} />
              <span className="text-xs text-faint">9:16 vertical</span>
              <button
                type="button"
                disabled={!idea.trim() || busy}
                onClick={write}
                className="ml-auto inline-flex h-9 items-center gap-2 rounded-full bg-inverse px-4 font-medium text-on-inverse disabled:opacity-35"
              >
                {busy ? <LoaderCircle size={15} className="animate-spin" /> : <Film size={15} />} {busy ? 'Writing…' : 'Write the series'}
              </button>
            </div>
            <p className="px-1 text-xs text-faint">GPT 6 Sol writes the characters, the look and the episode list (a few cents). Nothing is generated until you press Make episode.</p>
            {error && <p className="px-1 text-[13px] text-danger">{error}</p>}
          </div>
          {list.length > 0 && (
            <div className="flex flex-col gap-1">
              <h2 className="mb-1 font-medium">Your series</h2>
              {list.map((s) => (
                <button key={s.id} type="button" onClick={() => onOpen(s.id)} className="flex flex-col rounded-xl px-3 py-2.5 text-left hover:bg-raised">
                  <span className="font-medium">{s.title}</span>
                  <span className="line-clamp-1 text-[13px] text-muted">{s.logline}</span>
                  <span className="text-xs text-faint">
                    {s.episodes.length} episodes · {s.characters.map((c) => c.name).join(', ')}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const field = 'w-full rounded-lg border border-line bg-bg px-2.5 py-1.5 text-[13px] leading-relaxed focus:border-fg'

function SeriesEditor({ header, series: s, tasks, runs: running, onBack }: {
  header: { collapsed: boolean; onExpand: () => void }
  series: Series
  tasks: Tasks
  runs: typeof runs
  onBack: () => void
}) {
  const [epId, setEpId] = useState(s.episodes[0]?.id)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const ep = s.episodes.find((e) => e.id === epId) ?? s.episodes[0]
  const seriesBusy = Object.entries(running).some(([k, r]) => k.startsWith(`${s.id}:`) && r.step)
  const set = (fn: (x: Series) => void) => void update(s.id, fn)
  const setChar = (id: string, patch: Partial<Character>) => set((x) => Object.assign(x.characters.find((c) => c.id === id)!, patch))

  return (
    <div className="flex h-full flex-col">
      <Header {...header}>
        <IconButton title="All series" onClick={onBack}>
          <ArrowLeft size={16} />
        </IconButton>
        <span className="truncate font-medium">{s.title}</span>
      </Header>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-80 shrink-0 flex-col gap-5 overflow-y-auto border-r border-line px-4 pt-1 pb-8">
          <input id="series-title" aria-label="Series title" value={s.title} onChange={(e) => set((x) => void (x.title = e.target.value))} className="bg-transparent text-xl font-semibold tracking-tight" />
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Logline</span>
            <textarea rows={2} value={s.logline} onChange={(e) => set((x) => void (x.logline = e.target.value))} className={`${field} resize-none`} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Look of every shot</span>
            <textarea rows={3} value={s.style} onChange={(e) => set((x) => void (x.style = e.target.value))} className={`${field} resize-none`} />
          </label>

          <div className="flex flex-col gap-3">
            <span className="text-xs text-muted">Characters</span>
            {s.characters.map((c) => {
              const portrait = fileOf(tasks, c.portraitTask)
              const st = stateOf(tasks, c.portraitTask)
              return (
                <div key={c.id} className="flex flex-col gap-2 rounded-xl border border-line p-2.5">
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      disabled={seriesBusy || st === 'busy'}
                      title={seriesBusy ? 'An episode is being made' : portrait ? 'Make a new portrait' : 'Make portrait'}
                      onClick={async () => setChar(c.id, { portraitTask: await makeOne(s.imageModel, { aspect_ratio: '3:4' }, [], portraitPrompt(s, c)) })}
                      className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-raised text-muted hover:text-fg"
                    >
                      {portrait ? <img src={mediaUrl({ kind: 'media', file: portrait })} alt={c.name} className="size-full object-cover" />
                        : st === 'busy' ? <LoaderCircle size={18} className="animate-spin" /> : <UserRound size={20} />}
                    </button>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <input aria-label="Character name" value={c.name} onChange={(e) => setChar(c.id, { name: e.target.value })} className="bg-transparent font-medium" />
                      <select aria-label={`${c.name}'s voice`} value={c.voice ?? ''} onChange={(e) => setChar(c.id, { voice: e.target.value || undefined })} className="w-full rounded-md bg-transparent text-xs text-muted">
                        <option value="">Default voice</option>
                        {VOICES.map(([id, name]) => (
                          <option key={id} value={id}>
                            Voice: {name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <textarea aria-label={`${c.name}'s look`} rows={3} value={c.look} onChange={(e) => setChar(c.id, { look: e.target.value })} className={`${field} resize-none text-xs`} />
                </div>
              )
            })}
            <button
              type="button"
              onClick={() => set((x) => void x.characters.push({ id: crypto.randomUUID(), name: 'New character', look: '', personality: '' }))}
              className="inline-flex h-8 w-fit items-center gap-1.5 rounded-full border border-line px-3 text-[13px] text-muted hover:bg-raised hover:text-fg"
            >
              <Plus size={14} /> Character
            </button>
          </div>

          <div className="flex flex-col gap-0.5">
            <span className="mb-1 text-xs text-muted">Episodes</span>
            {s.episodes.map((e, i) => (
              <button key={e.id} type="button" onClick={() => setEpId(e.id)} className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] ${e.id === ep?.id ? 'bg-raised' : 'hover:bg-raised'}`}>
                <span className="text-faint tabular-nums">{i + 1}</span>
                <span className="truncate">{e.title || 'Untitled'}</span>
                {running[`${s.id}:${e.id}`]?.step && <LoaderCircle size={13} className="ml-auto shrink-0 animate-spin text-muted" />}
                {!running[`${s.id}:${e.id}`]?.step && e.cut && <Film size={13} className="ml-auto shrink-0 text-muted" />}
              </button>
            ))}
            <button
              type="button"
              onClick={() => set((x) => void x.episodes.push({ id: crypto.randomUUID(), title: `Episode ${x.episodes.length + 1}`, summary: '', shots: [] }))}
              className="inline-flex h-8 w-fit items-center gap-1.5 rounded-full px-2.5 text-[13px] text-muted hover:bg-raised hover:text-fg"
            >
              <Plus size={14} /> Episode
            </button>
          </div>

          <div className="mt-auto flex items-center gap-2 border-t border-line pt-3 text-[13px]">
            {confirmDelete ? (
              <>
                <span>Delete this series? Its images and videos stay in Create.</span>
                <button type="button" onClick={() => api.deleteSeries(s.id).then(load).then(onBack)} className="h-8 shrink-0 rounded-full bg-inverse px-3 font-medium text-on-inverse">
                  Delete
                </button>
              </>
            ) : (
              <IconButton title="Delete series" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={15} />
              </IconButton>
            )}
          </div>
        </aside>

        {ep ? <EpisodePanel key={ep.id} s={s} ep={ep} index={s.episodes.indexOf(ep)} tasks={tasks} run={running[`${s.id}:${ep.id}`]} /> : <div className="flex-1" />}
      </div>
    </div>
  )
}

function EpisodePanel({ s, ep, index, tasks, run }: { s: Series; ep: Episode; index: number; tasks: Tasks; run?: Run }) {
  const setEp = (fn: (e: Episode) => void) => void update(s.id, (x) => fn(x.episodes.find((e) => e.id === ep.id)!))
  const setShot = (id: string, patch: Partial<Shot>) => setEp((e) => void Object.assign(e.shots.find((x) => x.id === id)!, patch))
  const busy = !!run?.step
  const key = `${s.id}:${ep.id}`
  const vm = model(s.videoModel)

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-5xl flex-col gap-5 px-6 pt-1 pb-10">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline gap-3">
              <span className="text-faint tabular-nums">Episode {index + 1}</span>
              <input aria-label="Episode title" value={ep.title} onChange={(e) => setEp((x) => void (x.title = e.target.value))} className="min-w-0 flex-1 bg-transparent text-lg font-semibold" />
            </div>
            <textarea aria-label="Episode summary" rows={2} value={ep.summary} placeholder="What happens: the hook, the turn, the punchline." onChange={(e) => setEp((x) => void (x.summary = e.target.value))} className={`${field} resize-none`} />
          </div>

          {ep.cut && (
            <div className="flex items-end gap-4">
              <video src={mediaUrl({ kind: 'media', file: ep.cut })} controls playsInline className="max-h-[460px] rounded-xl bg-black" />
              <div className="flex flex-col gap-2 text-[13px]">
                <span className="font-medium">Finished episode</span>
                <button type="button" onClick={() => api.saveAs({ kind: 'media', file: ep.cut! })} className="inline-flex h-9 items-center gap-2 rounded-full bg-inverse px-4 font-medium text-on-inverse">
                  <Download size={15} /> Save MP4
                </button>
                <span className="max-w-56 text-xs text-faint">Changed a shot? Make episode again re-cuts it with the new pieces.</span>
              </div>
            </div>
          )}

          {ep.shots.length ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
              {ep.shots.map((sh, i) => (
                <ShotCard key={sh.id} n={i + 1} s={s} shot={sh} tasks={tasks} disabled={busy} onChange={(p) => setShot(sh.id, p)} onRemove={() => setEp((e) => void (e.shots = e.shots.filter((x) => x.id !== sh.id)))} />
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-muted">
              No shots yet. Make episode writes the script first ({shotCount(s)} shots of {shotSeconds(vm)} s), then makes everything else.
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line px-6 py-3">
        <SelectChip title="Frames" label={`Frames: ${model(s.imageModel).label}`} value={s.imageModel} onChange={(v) => void update(s.id, (x) => void (x.imageModel = v))}
          options={IMAGE_MODELS.map((id) => ({ value: id, label: `${withBest(model(id).label, id)} · ${priceLabel(estimate(id, buildInput(model(id), { aspect_ratio: '9:16' }, {}).input))}` }))} />
        <SelectChip title="Video" label={`Video: ${vm.label}${vm.id === 'grok-imagine' ? ' (draft)' : ''}`} value={s.videoModel} onChange={(v) => void update(s.id, (x) => void (x.videoModel = v))}
          options={VIDEO_MODELS.map((id) => ({ value: id, label: `${withBest(model(id).label, id)}${id === 'grok-imagine' ? ' · 480p draft' : speaks(model(id)) ? ' · speaks the lines' : ''}` }))} />
        <span className="min-w-0 flex-1 truncate text-[13px] text-muted">
          {run?.step ? (
            <span className="inline-flex items-center gap-1.5"><LoaderCircle size={13} className="animate-spin" /> {run.step}</span>
          ) : run?.error ? (
            <span className="inline-flex items-center gap-1.5 text-danger"><TriangleAlert size={13} /> {run.error}</span>
          ) : run?.note ? (
            <span title={run.note}>{run.note}</span>
          ) : speaks(vm) ? 'The video model speaks the lines.' : 'Lines are voiced with ElevenLabs.'}
        </span>
        {busy ? (
          <button type="button" onClick={() => setRun(key, { ...run!, stop: true, step: 'Stopping after this step…' })} className="inline-flex h-9 items-center gap-2 rounded-full border border-line px-4 hover:bg-raised">
            <Square size={12} fill="currentColor" /> Stop
          </button>
        ) : (
          <div className="flex flex-col items-end gap-0.5">
            <button type="button" onClick={() => void runEpisode(s.id, ep.id)} className="inline-flex h-9 items-center gap-2 rounded-full bg-inverse px-4 font-medium text-on-inverse">
              <Clapperboard size={15} /> {ep.cut ? 'Make episode again' : 'Make episode'}
            </button>
            <span className="pr-1 text-[11px] text-faint tabular-nums" title="What's still missing, at the chosen models. Finished pieces aren't paid for again.">
              {remaining(s, ep, tasks)}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function ShotCard({ n, s, shot, tasks, disabled, onChange, onRemove }: {
  n: number
  s: Series
  shot: Shot
  tasks: Tasks
  disabled: boolean
  onChange: (p: Partial<Shot>) => void
  onRemove: () => void
}) {
  const frame = fileOf(tasks, shot.frameTask)
  const video = fileOf(tasks, shot.videoTask)
  const busy = stateOf(tasks, shot.frameTask) === 'busy' || stateOf(tasks, shot.videoTask) === 'busy'
  const failed = [shot.frameTask, shot.videoTask, shot.voiceTask].map((id) => (id && tasks[id]?.state === 'fail' ? tasks[id].error : '')).find(Boolean)
  const [err, setErr] = useState('')
  const act = (p: Promise<Partial<Shot>>) => void p.then(onChange, (e) => setErr(errMsg(e)))
  const vm = model(s.videoModel)
  const people = castOf(s, shot).filter((c) => fileOf(tasks, c.portraitTask))
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-2">
      <div className="relative aspect-[9/16] overflow-hidden rounded-xl bg-raised">
        {video ? <Media file={video} alt={shot.description} className="size-full object-cover" />
          : frame ? <img src={mediaUrl({ kind: 'media', file: frame })} alt={shot.description} className="size-full object-cover" />
          : <div className="flex size-full items-center justify-center text-muted"><ImagePlus size={20} /></div>}
        {busy && <div className="absolute inset-0 flex items-center justify-center bg-black/35 text-white"><LoaderCircle size={20} className="animate-spin" /></div>}
        <span className="absolute top-1.5 left-1.5 rounded bg-black/60 px-1.5 text-[11px] leading-5 text-white tabular-nums">{n}</span>
        {video && isVideo(video) && <span className="absolute top-1.5 right-1.5 rounded bg-black/60 px-1.5 text-[11px] leading-5 text-white">video</span>}
      </div>
      <textarea aria-label={`Shot ${n}`} rows={3} value={shot.description} onChange={(e) => onChange({ description: e.target.value })} className={`${field} resize-none text-xs`} />
      <input aria-label={`Shot ${n} camera`} value={shot.camera} placeholder="Camera" onChange={(e) => onChange({ camera: e.target.value })} className={`${field} text-xs`} />
      <div className="flex gap-1">
        <input aria-label={`Shot ${n} speaker`} value={shot.speaker} placeholder="Who" onChange={(e) => onChange({ speaker: e.target.value, voiceTask: undefined })} className={`${field} w-20 text-xs`} />
        <input aria-label={`Shot ${n} line`} value={shot.line} placeholder="Line" onChange={(e) => onChange({ line: e.target.value, voiceTask: undefined })} className={`${field} min-w-0 flex-1 text-xs`} />
      </div>
      {(failed || err) && <p className="text-[11px] text-danger">{err || failed}</p>}
      <div className="flex items-center">
        <IconButton title={`${frame ? 'New frame' : 'Make frame'} (${priceLabel(estimate(s.imageModel, { aspect_ratio: '9:16', resolution: '1K' }))})`} className="size-7" disabled={disabled || busy}
          onClick={() => act(makeOne(s.imageModel, { aspect_ratio: '9:16' }, people.map((c) => img(fileOf(tasks, c.portraitTask)!)), framePrompt(s, shot, people)).then((id) => ({ frameTask: id, videoTask: undefined, reviewed: true })))}>
          <RotateCcw size={14} />
        </IconButton>
        <IconButton title={`${video ? 'New video' : 'Animate'} (${priceLabel(estimate(vm.id, buildInput(vm, videoValues(vm), {}).input))})`} className="size-7" disabled={disabled || busy || !frame}
          onClick={() => act(makeOne(vm.id, videoValues(vm), [img(frame!)], videoPrompt(s, shot, vm)).then((id) => ({ videoTask: id })))}>
          <Clapperboard size={14} />
        </IconButton>
        <IconButton title="Remove shot" className="ml-auto size-7" disabled={disabled} onClick={onRemove}>
          <Trash2 size={14} />
        </IconButton>
      </div>
    </div>
  )
}
