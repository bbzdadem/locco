import { ArrowRight, Check, Mic, ChevronLeft, ChevronRight, Clapperboard, Download, FileText, Film, ImagePlus, LoaderCircle, Plus, RotateCcw, Square, TriangleAlert, Wand2, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { buildInput } from '../../shared/inputs'
import { chatModel, ELEVEN_VOICES, withBest } from '../../shared/models'
import { estimate, priceLabel } from '../../shared/prices'
import type { Character, Episode, Scene, Series, ShotPlan, Step } from '../../shared/types'
import { Avatar } from './Characters'
import { Media } from './Create'
import { episodeProject } from './Studio'
import { api, errMsg, mediaUrl } from './lib'
import {
  castOf, clipFor, defaultEdit, editPrompt, elementsOf, fileOf, getSeries, img, IMAGE_MODELS, makeAll, makeOne, model, motionPrompt, needs, ready, refsOf, type Run, scenePrompt,
  sceneRefs, setRun, stateOf, step, type Tasks, timing, toRender, updateSeries, VIDEO_MODELS, videoValues, voiceFor, voiceName,
} from './seriesStore'
import { IconButton, SelectChip } from './ui'

// Scene images at 1K: plenty for 720×1280 video, and the cheapest size.
const SCENE_IMAGE = { aspect_ratio: '9:16', resolution: '1K' }
const STEPS: [Step, string][] = [['script', 'Script'], ['scenes', 'Scenes'], ['voices', 'Voices'], ['video', 'Video'], ['cut', 'Cut']]
// Sizes are set where a field is used: full width alone, or a fixed size next to other fields.
const box = 'rounded-lg border border-line bg-bg px-2.5 py-1.5 text-[13px] leading-relaxed focus:border-fg'
const field = `${box} w-full`
const primary = 'inline-flex h-9 items-center gap-2 rounded-full bg-inverse px-4 font-medium text-on-inverse disabled:opacity-35'
const secondary = 'inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-[13px] text-muted hover:bg-raised hover:text-fg disabled:opacity-40'
const sum = (n: number[]) => n.reduce((a, b) => a + b, 0)
const fmt = (n: number) => `${n.toFixed(1)} s`
const priceOf = (credits: number) => (credits ? priceLabel({ lo: credits, hi: credits, perSecond: false }) : '')

type Props = { s: Series; ep: Episode; index: number; tasks: Tasks; cast: Character[]; things: Character[]; run?: Run; onCharacter: (id: string) => void; onOpenEdit: (id: string) => void }

export function EpisodeView(props: Props) {
  const { s, ep, index, run } = props
  const key = `${s.id}:${ep.id}`
  const reached = STEPS.findIndex(([k]) => k === ep.step)
  const [view, setView] = useState<Step>(ep.step)
  const [selected, setSelected] = useState(ep.scenes[0]?.id)
  const shown = STEPS.findIndex(([k]) => k === view) > reached ? ep.step : view
  const go = (next: Step) => (setView(next), void setEp((e) => void (STEPS.findIndex(([k]) => k === e.step) < STEPS.findIndex(([k]) => k === next) && (e.step = next))))
  const setEp = (fn: (e: Episode) => void) => updateSeries(s.id, (x) => fn(x.episodes.find((e) => e.id === ep.id)!))
  const p = { ...props, rk: key, setEp, go, selected, setSelected, onEdit: () => void episodeProject(s, ep, props.tasks).then(props.onOpenEdit) }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 border-b border-line px-6 pt-1 pb-3">
        <div className="flex items-baseline gap-3">
          <span className="text-faint tabular-nums">Episode {index + 1}</span>
          <input aria-label="Episode title" value={ep.title} onChange={(e) => setEp((x) => void (x.title = e.target.value))} className="min-w-0 flex-1 bg-transparent text-lg font-semibold" />
        </div>
        <Summary s={s} ep={ep} index={index} setEp={setEp} />
        <div className="flex flex-wrap items-center gap-1">
          {STEPS.map(([k, label], i) => (
            <button key={k} type="button" disabled={i > reached} onClick={() => setView(k)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] ${shown === k ? 'bg-inverse font-medium text-on-inverse' : i < reached ? 'text-fg hover:bg-raised' : 'text-faint'}`}>
              {i < reached ? <Check size={13} /> : <span className="tabular-nums">{i + 1}</span>} {label}
            </button>
          ))}
          <span className="ml-auto min-w-0 truncate text-[13px] text-muted">
            {run?.step ? <span className="inline-flex items-center gap-1.5"><LoaderCircle size={13} className="animate-spin" /> {run.step}</span>
              : run?.error ? <span className="inline-flex items-center gap-1.5 text-danger"><TriangleAlert size={13} /> {run.error}</span>
              : run?.note}
          </span>
          {run?.step && (
            <button type="button" onClick={() => setRun(key, { ...run, stop: true, step: 'Stopping after this part…' })} className={secondary}>
              <Square size={11} fill="currentColor" /> Stop
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-5xl flex-col gap-5 px-6 pt-4 pb-10">
          {shown === 'script' && <ScriptStep {...p} />}
          {shown === 'scenes' && <ScenesStep {...p} />}
          {shown === 'voices' && <VoicesStep {...p} />}
          {shown === 'video' && <VideoStep {...p} />}
          {shown === 'cut' && <CutStep {...p} />}
        </div>
      </div>
      {ep.scenes.length > 0 && <Timeline scenes={ep.scenes} selected={shown === 'scenes' ? selected : undefined} onPick={(id) => (setSelected(id), shown !== 'scenes' && reached >= 1 && setView('scenes'))} />}
    </div>
  )
}

type StepProps = Props & { onEdit: () => void; rk: string; setEp: (fn: (e: Episode) => void) => Promise<void>; go: (s: Step) => void; selected?: string; setSelected: (id: string) => void }
const busy = (run?: Run) => !!run?.step

// --- 1. Script: the writers' room (beat sheet and shots), then the director (a shot plan for every shot, reviewed
// against the social checklist). Edit anything, improve one shot, or ask for a change; then approve ---

const WRITERS = ['claude-sonnet-5-5', 'claude-opus-5-5', 'gpt-6-sol']
const PLAN_FIELDS: [keyof ShotPlan, string, string][] = [
  ['shot', 'Shot', 'Size, angle, lens, composition, depth of field'],
  ['beats', 'Action over time', '0-1 s …; 1-3 s …; 3-4 s …'],
  ['performance', 'Performance', 'Who stands where, eyelines, expressions, gestures'],
  ['move', 'Camera move', 'Slow push-in, whip pan, handheld drift, locked off'],
  ['environment', 'Environment', 'Time, weather, light sources and direction, atmosphere, background life, props'],
  ['sound', 'Sound', 'Ambience and sound effects'],
  ['text', 'On-screen text', 'Only where it helps the hook (6 words at most)'],
  ['transition', 'Transition', 'Smash cut, match cut, whip, cut on action'],
]
const writerLabel = (id: string) => chatModel(id).label

function ScriptStep({ s, ep, index, cast, things, run, rk: k, setEp, go }: StepProps) {
  const [change, setChange] = useState('')
  const hasImages = ep.scenes.some((sc) => sc.frameTask)
  const names = [...cast.map((c) => c.name), 'Narrator']
  const writer = s.writer ?? WRITERS[0]
  const setScene = (id: string, fn: (sc: Scene) => void) => setEp((e) => fn(e.scenes.find((x) => x.id === id)!))
  const fellBack = (by: string) => (by.split('|')[0] !== writer ? `${writerLabel(writer)} didn't answer${by.includes('|') ? ` (${by.split('|')[1]})` : ''}, so ${writerLabel(by.split('|')[0])} wrote this.` : undefined)
  const unplanned = ep.scenes.filter((sc) => !sc.plan).length
  const notes = (...n: (string | undefined)[]) => n.filter(Boolean).join(' ') || undefined
  const missed = (n: number) => (n ? `${n} shot${n > 1 ? 's' : ''} didn't get a plan (the writer didn't answer); press Plan ${n} shot${n > 1 ? 's' : ''} to try again.` : undefined)
  const hasMedia = ep.scenes.some((sc) => sc.frameTask || sc.videoTask || sc.lines.some((l) => l.voiceTask))

  const write = () => step(k, `Writers' room: beat sheet and shots (${writerLabel(writer)})…`, async () => {
    const draft = await api.writeScript(getSeries(s.id), index)
    await setEp((e) => void ((e.scenes = draft.scenes), (e.beats = draft.beats)))
    setRun(k, { step: `Director: planning ${draft.scenes.length} shots…` })
    const directed = await api.directScript(getSeries(s.id), index, draft.scenes)
    await setEp((e) => e.scenes.forEach((sc, i) => (sc.plan = directed.plans[i] ?? sc.plan)))
    return notes(missed(directed.failed), fellBack(directed.by) ?? fellBack(draft.by))
  })
  // Plans for the shots that have none (written before the director pass, added later, or missed). The story stays as it is.
  const addPlans = () => step(k, `Director: planning ${unplanned} shot${unplanned > 1 ? 's' : ''}…`, async () => {
    const out = await api.directScript(getSeries(s.id), index, ep.scenes)
    await setEp((e) => e.scenes.forEach((sc, i) => (sc.plan = out.plans[i] ?? sc.plan)))
    return notes(missed(out.failed), fellBack(out.by))
  })
  const improve = (sc: Scene, note: string) => step(k, `Improving shot ${ep.scenes.indexOf(sc) + 1}…`, async () => {
    const out = await api.improveScene(getSeries(s.id), index, ep.scenes, ep.scenes.indexOf(sc), note)
    const media = !!(sc.frameTask || sc.videoTask || sc.lines.some((l) => l.voiceTask))
    // A shot that already has pictures or voices keeps its story; only the plan changes.
    await setScene(sc.id, (x) => Object.assign(x, media ? { plan: out.scene.plan } : { ...out.scene, id: x.id }))
    return fellBack(out.by)
  })
  const revise = () => step(k, 'Revising the script…', async () => {
    const scenes = await api.reviseScript(getSeries(s.id), index, ep.scenes, change)
    await setEp((e) => void (e.scenes = scenes))
    setChange('')
  })
  const writerChip = (
    <SelectChip title="Who writes the script" label={<>Writer: {writerLabel(writer)}</>} value={writer} onChange={(v) => void updateSeries(s.id, (x) => void (x.writer = v))}
      options={WRITERS.map((id) => ({ value: id, label: withBest(writerLabel(id), id) }))} />
  )

  if (!ep.scenes.length)
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line px-6 py-14 text-center">
        <FileText size={22} className="text-muted" />
        <p className="max-w-lg text-muted">
          Two passes. The writers' room plans the episode as a beat sheet built for TikTok and Reels (hook in 2 seconds, a turn every few seconds, a payoff)
          and writes it as shots of 2–4 seconds. Then the director plans every shot (framing, lens, action over time, performance, camera move, light,
          weather, sound) and reviews the whole against a checklist. You approve it before anything is drawn. Takes a minute or two.
        </p>
        <div className="flex items-center gap-2">
          {writerChip}
          <button type="button" disabled={busy(run)} onClick={write} className={primary}>
            {busy(run) ? <LoaderCircle size={15} className="animate-spin" /> : <Wand2 size={15} />} Write the script
          </button>
        </div>
      </div>
    )

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {writerChip}
        {unplanned > 0 && (
          <button type="button" disabled={busy(run)} onClick={addPlans} className={secondary} title={hasMedia ? 'Plans for the shots without one; the story, pictures and voices stay as they are' : 'A shot plan for each shot without one'}>
            <Clapperboard size={13} /> Plan {unplanned} shot{unplanned > 1 ? 's' : ''}
          </button>
        )}
        <span className="ml-auto text-xs text-faint tabular-nums">{ep.scenes.length} shots · {sum(ep.scenes.map((sc) => sc.lines.length))} lines</span>
      </div>
      {ep.beats && (
        <details className="rounded-2xl border border-line bg-surface p-3">
          <summary className="cursor-pointer text-[13px] font-medium select-none">Beat sheet</summary>
          <textarea aria-label="Beat sheet" rows={6} value={ep.beats} onChange={(e) => setEp((x) => void (x.beats = e.target.value))} className={`${field} mt-2 resize-y`} />
        </details>
      )}
      <div className="flex flex-col gap-3">
        {ep.scenes.map((sc, i) => (
          <ShotCard key={sc.id} n={i + 1} sc={sc} names={names} onScreen={[...castOf(s, cast, sc), ...elementsOf(s, things, sc)].map((c) => c.name)}
            busy={busy(run)} setScene={(fn) => setScene(sc.id, fn)} onImprove={(note) => improve(sc, note)}
            onRemove={() => setEp((e) => void (e.scenes = e.scenes.filter((x) => x.id !== sc.id)))} />
        ))}
        {ep.scenes.length < 15 && (
          <button type="button" className={`${secondary} w-fit`} onClick={() => setEp((e) => void e.scenes.push({ id: crypto.randomUUID(), place: '', action: '', camera: '', cast: [], lines: [] }))}>
            <Plus size={13} /> Shot
          </button>
        )}
      </div>
      <div className="sticky bottom-0 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface p-3 shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
        {hasImages ? (
          <span className="flex-1 text-[13px] text-muted">Scene images exist, so whole-script rewrites are off. Improve single shots or edit them directly.</span>
        ) : (
          <>
            <input aria-label="Change to the script" value={change} onChange={(e) => setChange(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && change.trim() && !busy(run) && revise()}
              placeholder="Ask for a change: make Lala the one who breaks the machine" className="h-9 min-w-60 flex-1 rounded-full border border-line bg-transparent px-4 text-[13px] focus:border-fg" />
            <button type="button" disabled={!change.trim() || busy(run)} onClick={revise} className={secondary}><Wand2 size={13} /> Revise</button>
          </>
        )}
        <button type="button" disabled={busy(run) || !ep.scenes.length} onClick={() => go('scenes')} className={primary}>
          {ep.step === 'script' ? 'Approve script' : 'Scenes'} <ArrowRight size={15} />
        </button>
      </div>
    </>
  )
}

// One shot: place, action and lines, then its plan (open to edit), with Improve.
function ShotCard({ n, sc, names, onScreen, busy: working, setScene, onImprove, onRemove }: {
  n: number; sc: Scene; names: string[]; onScreen: string[]; busy: boolean
  setScene: (fn: (sc: Scene) => void) => void; onImprove: (note: string) => void; onRemove: () => void
}) {
  const [note, setNote] = useState('')
  const p = sc.plan
  return (
    <div className="flex gap-3 rounded-2xl border border-line bg-surface p-3">
      <span className="w-6 shrink-0 pt-1.5 text-right text-faint tabular-nums">{n}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex gap-2">
          <input aria-label={`Shot ${n} place`} value={sc.place} placeholder="Place and time: lighthouse kitchen, night" onChange={(e) => setScene((x) => void (x.place = e.target.value))} className={`${field} font-medium`} />
          {!p && <input aria-label={`Shot ${n} camera`} value={sc.camera} placeholder="Camera: close-up, slow push-in" onChange={(e) => setScene((x) => void (x.camera = e.target.value))} className={`${field} max-w-60`} />}
        </div>
        <textarea aria-label={`Shot ${n} action`} rows={2} value={sc.action} placeholder="What happens in this shot. Name characters with @: @Mochi raises the dripping keys." onChange={(e) => setScene((x) => void (x.action = e.target.value))} className={`${field} resize-none`} />
        {sc.lines.map((l, li) => (
          <div key={li} className="flex items-center gap-2">
            <select aria-label="Speaker" value={l.speaker} onChange={(e) => setScene((x) => Object.assign(x.lines[li], { speaker: e.target.value, voiceTask: undefined, seconds: undefined }))} className={`${box} w-36 shrink-0`}>
              {[...new Set([...names, l.speaker])].map((nm) => <option key={nm} value={nm}>{nm}</option>)}
            </select>
            <input aria-label="Line" value={l.text} placeholder="What they say (about 2.5 words a second)" onChange={(e) => setScene((x) => Object.assign(x.lines[li], { text: e.target.value, voiceTask: undefined, seconds: undefined }))} className={`${box} min-w-0 flex-1`} />
            <IconButton title="Remove line" className="size-7" onClick={() => setScene((x) => void x.lines.splice(li, 1))}><X size={13} /></IconButton>
          </div>
        ))}
        <div className="flex items-center gap-2">
          {sc.lines.length < 3 && <button type="button" onClick={() => setScene((x) => void x.lines.push({ speaker: names[0], text: '' }))} className="text-[13px] text-muted hover:text-fg">+ Line</button>}
          <span className="text-xs text-faint">On screen: {onScreen.join(', ') || 'nobody from the cast (name one with @)'}</span>
        </div>
        <details className="rounded-xl bg-raised/60 px-3 py-2" open={!!p && n === 1}>
          <summary className="cursor-pointer text-[13px] select-none">
            <span className="font-medium">Shot plan</span>
            <span className="ml-2 text-xs text-muted">{p ? [p.shot, p.move].filter(Boolean).join(' · ').slice(0, 110) : 'Not planned yet: Improve plans it'}</span>
          </summary>
          <div className="mt-2 grid grid-cols-[8rem_1fr] items-start gap-x-3 gap-y-1.5">
            {PLAN_FIELDS.map(([key, label, hint]) => (
              <label key={key} className="contents">
                <span className="pt-1.5 text-xs text-muted">{label}</span>
                <textarea rows={key === 'beats' || key === 'environment' ? 2 : 1} value={p?.[key] ?? ''} placeholder={hint}
                  onChange={(e) => setScene((x) => void (x.plan = { shot: '', beats: '', performance: '', move: '', environment: '', sound: '', ...x.plan, [key]: e.target.value }))}
                  className={`${field} resize-y text-xs`} />
              </label>
            ))}
          </div>
        </details>
        <div className="flex items-center gap-2">
          <input aria-label={`Note for improving shot ${n}`} value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !working && (onImprove(note), setNote(''))}
            placeholder="Optional note for Improve: more tension, a reveal at the end, rain" className="h-8 min-w-0 flex-1 rounded-full border border-line bg-transparent px-3 text-xs focus:border-fg" />
          <button type="button" disabled={working} onClick={() => (onImprove(note), setNote(''))} className={secondary}
            title="Sharper action and lines and a richer plan, in context with the shots around it. A shot with pictures or voices keeps its story; only its plan changes.">
            <Wand2 size={13} /> Improve shot
          </button>
        </div>
      </div>
      <IconButton title="Remove shot" className="size-7" onClick={onRemove}><X size={14} /></IconButton>
    </div>
  )
}

// --- 2. Scenes: one main image per scene, drawn from the cast's references; approve each, or ask for a change ---

function ScenesStep({ s, ep, tasks, cast, things, run, rk: k, setEp, go, selected, setSelected, onCharacter }: StepProps) {
  // Characters first, then the places and things the scene names: each brings its reference images.
  const people = (sc: Scene) => [...castOf(s, cast, sc), ...elementsOf(s, things, sc)]
  const unready = [...new Set(ep.scenes.flatMap(people))].filter((c) => !ready(tasks, c))
  const missing = ep.scenes.filter((sc) => needs(tasks, sc.frameTask))
  const im = model(s.imageModel)
  const each = estimate(im.id, buildInput(im, SCENE_IMAGE, {}).input)?.hi ?? 0
  const refs = (sc: Scene) => sceneRefs(s, people(sc), tasks)
  const draw = (sc: Scene) => makeOne(s.imageModel, SCENE_IMAGE, refs(sc), scenePrompt(s, sc, people(sc), tasks)).then((ids) => ids[0])
  const setScene = (id: string, fn: (sc: Scene) => void) => setEp((e) => fn(e.scenes.find((x) => x.id === id)!))
  const drawAll = () => step(k, 'Drawing scenes…', () => makeAll(k, `Drawing ${missing.length} scenes…`, 'scene images', missing, draw,
    (pairs) => setEp((e) => pairs.forEach(([sc, id]) => Object.assign(e.scenes.find((x) => x.id === sc.id)!, { frameTask: id, approved: false })))))
  const sc = ep.scenes.find((x) => x.id === selected) ?? ep.scenes[0]
  const approved = ep.scenes.filter((x) => x.approved && fileOf(tasks, x.frameTask)).length
  const allDone = approved === ep.scenes.length

  return (
    <>
      {unready.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-raised px-3 py-2.5 text-[13px]">
          <TriangleAlert size={14} className="text-muted" /> Finish these first (pick a portrait or image) so they look the same in every scene:
          {unready.map((c) => (
            <button key={c.id} type="button" onClick={() => onCharacter(c.id)} className="inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 font-medium hover:bg-line">
              <Avatar c={c} t={tasks} size="size-5" /> {c.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <SelectChip title="Image model" label={`Images: ${im.label}`} value={s.imageModel} onChange={(v) => void updateSeries(s.id, (x) => void (x.imageModel = v))}
          options={IMAGE_MODELS.map((id) => ({ value: id, label: withBest(model(id).label, id) }))} />
        {missing.length > 0 && (
          <button type="button" disabled={busy(run) || unready.length > 0} onClick={drawAll} className={primary}>
            <ImagePlus size={15} /> Draw {missing.length} scene{missing.length > 1 ? 's' : ''} <span className="font-normal opacity-70">{priceOf(each * missing.length)}</span>
          </button>
        )}
        <span className="ml-auto text-[13px] text-muted tabular-nums">{approved} of {ep.scenes.length} approved</span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
        {ep.scenes.map((x, i) => {
          const f = fileOf(tasks, x.frameTask)
          const st = stateOf(tasks, x.frameTask)
          return (
            <button key={x.id} type="button" onClick={() => setSelected(x.id)}
              className={`relative aspect-[9/16] overflow-hidden rounded-xl bg-raised ${x.id === sc?.id ? 'ring-2 ring-fg' : ''}`}>
              {f && <img src={mediaUrl({ kind: 'media', file: f })} alt={`Scene ${i + 1}`} className="size-full object-cover" />}
              {st === 'busy' && <span className="absolute inset-0 flex items-center justify-center bg-black/30 text-white"><LoaderCircle size={16} className="animate-spin" /></span>}
              {st === 'fail' && <span className="absolute inset-0 flex items-center justify-center p-2 text-[11px] text-danger">Failed</span>}
              <span className="absolute top-1 left-1 rounded bg-black/60 px-1.5 text-[11px] leading-5 text-white tabular-nums">{i + 1}</span>
              {x.approved && f && <span className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-inverse text-on-inverse"><Check size={12} /></span>}
            </button>
          )
        })}
      </div>
      {sc && <SceneDetail s={s} sc={sc} n={ep.scenes.indexOf(sc) + 1} tasks={tasks} run={run} refs={refs(sc)} people={people(sc)} k={k} setScene={setScene} draw={draw} />}
      <div className="flex items-center justify-end gap-2">
        {!allDone && ep.scenes.every((x) => fileOf(tasks, x.frameTask)) && (
          <button type="button" className={secondary} onClick={() => setEp((e) => e.scenes.forEach((x) => (x.approved = true)))}><Check size={13} /> Approve all</button>
        )}
        <button type="button" disabled={!allDone || busy(run)} onClick={() => go('voices')} className={primary}
          title={allDone ? undefined : 'Approve every scene first'}>
          Continue to voices <ArrowRight size={15} />
        </button>
      </div>
    </>
  )
}

function SceneDetail({ s, sc, n, tasks, run, refs, people, k, setScene, draw }: {
  s: Series; sc: Scene; n: number; tasks: Tasks; run?: Run; refs: ReturnType<typeof img>[]; people: Character[]; k: string
  setScene: (id: string, fn: (sc: Scene) => void) => Promise<void>; draw: (sc: Scene) => Promise<string>
}) {
  const [change, setChange] = useState('')
  const all = [...(sc.versions ?? []), ...(sc.frameTask ? [sc.frameTask] : [])]
  const [vi, setVi] = useState<number | null>(null)
  const at = vi ?? all.length - 1
  const file = fileOf(tasks, all[at])
  const current = fileOf(tasks, sc.frameTask)
  const replace = (id: string) => setScene(sc.id, (x) => Object.assign(x, { versions: [...(x.versions ?? []), ...(x.frameTask ? [x.frameTask] : [])], frameTask: id, approved: false, videoTask: undefined }))
  const edit = () => step(k, `Changing scene ${n}…`, () => makeAll(k, `Changing scene ${n}…`, 'scene images', [sc],
    () => makeOne(s.imageModel, SCENE_IMAGE, [img(current!), ...refs], editPrompt(change)).then((ids) => ids[0]),
    async ([[, id]]) => (await replace(id), setVi(null), setChange(''))))
  const redraw = () => step(k, `Redrawing scene ${n}…`, () => makeAll(k, `Redrawing scene ${n}…`, 'scene images', [sc], draw, async ([[, id]]) => (await replace(id), setVi(null))))
  const useVersion = () => setScene(sc.id, (x) => {
    const pick = all[at]
    Object.assign(x, { versions: all.filter((v) => v !== pick), frameTask: pick, approved: false, videoTask: undefined })
  }).then(() => setVi(null))

  return (
    <div className="flex gap-4 rounded-2xl border border-line bg-surface p-3">
      <div className="relative w-56 shrink-0">
        <div className="aspect-[9/16] overflow-hidden rounded-xl bg-raised">
          {file ? <img src={mediaUrl({ kind: 'media', file })} alt={`Scene ${n}`} className="size-full object-cover" />
            : <span className="flex size-full items-center justify-center text-muted">{stateOf(tasks, all[at]) === 'busy' ? <LoaderCircle size={18} className="animate-spin" /> : <ImagePlus size={20} />}</span>}
        </div>
        {all.length > 1 && (
          <div className="mt-1.5 flex items-center justify-center gap-1 text-xs text-muted tabular-nums">
            <IconButton title="Earlier version" className="size-6" disabled={at === 0} onClick={() => setVi(at - 1)}><ChevronLeft size={14} /></IconButton>
            v{at + 1} of {all.length}
            <IconButton title="Later version" className="size-6" disabled={at === all.length - 1} onClick={() => setVi(at + 1)}><ChevronRight size={14} /></IconButton>
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 text-[13px]">
        <div className="flex items-center gap-2">
          <span className="font-medium">Scene {n}</span>
          <span className="truncate text-muted">{sc.place}</span>
          <span className="ml-auto flex -space-x-1.5">{people.map((c) => <Avatar key={c.id} c={c} t={tasks} size="size-6" />)}</span>
        </div>
        <p className="leading-relaxed">{sc.action}</p>
        <p className="text-muted">Camera: {sc.camera}</p>
        {sc.lines.map((l, i) => <p key={i}><span className="font-medium">{l.speaker}:</span> “{l.text}”</p>)}
        <div className="mt-auto flex flex-col gap-2">
          {at !== all.length - 1 ? (
            <button type="button" onClick={useVersion} className={`${secondary} w-fit`}><Check size={13} /> Use this version</button>
          ) : current && (
            <div className="flex gap-2">
              <input aria-label="Change to this scene" value={change} onChange={(e) => setChange(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && change.trim() && !busy(run) && edit()}
                placeholder="Ask for a change: make it night, Rufat on the left" className="h-9 min-w-0 flex-1 rounded-full border border-line bg-transparent px-4 focus:border-fg" />
              <button type="button" disabled={!change.trim() || busy(run)} onClick={edit} className={secondary}><Wand2 size={13} /> Change</button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button type="button" disabled={busy(run)} onClick={redraw} className={secondary}><RotateCcw size={13} /> {current ? 'Draw again' : 'Draw'}</button>
            {current && at === all.length - 1 && (
              <button type="button" onClick={() => setScene(sc.id, (x) => void (x.approved = !x.approved))}
                className={`ml-auto inline-flex h-9 items-center gap-1.5 rounded-full px-4 font-medium ${sc.approved ? 'border border-line text-fg' : 'bg-inverse text-on-inverse'}`}>
                <Check size={14} /> {sc.approved ? 'Approved' : 'Approve'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// --- 3. Voices: every line in its character's ElevenLabs voice; their lengths set each scene's length ---

function VoicesStep({ s, ep, tasks, cast, run, rk: k, setEp, go }: StepProps) {
  const lines = ep.scenes.flatMap((sc) => sc.lines.map((l, li) => ({ sc, l, li })))
  const missing = lines.filter((x) => x.l.text.trim() && (needs(tasks, x.l.voiceTask) || x.l.seconds == null))
  type L = (typeof lines)[number]
  // Records the given lines (all missing ones, or a single line), then measures them: their length sets the scene's.
  const record = (todo: L[] = missing.filter((x) => needs(tasks, x.l.voiceTask))) => step(k, 'Recording voices…', async () => {
    await makeAll(k, `Recording ${todo.length} line${todo.length > 1 ? 's' : ''}…`, 'voice lines', todo,
      (x) => makeOne('el-tts', voiceFor(cast, x.l.speaker) ? { voice: voiceFor(cast, x.l.speaker) } : {}, [], x.l.text).then((ids) => ids[0]),
      (pairs) => setEp((e) => pairs.forEach(([x, id]) => Object.assign(e.scenes.find((s) => s.id === x.sc.id)!.lines[x.li], { voiceTask: id, seconds: undefined }))))
    const all = Object.fromEntries((await api.tasks()).map((t) => [t.id, t]))
    const latest = getSeries(s.id).episodes.find((e) => e.id === ep.id)!
    const measured = await Promise.all(latest.scenes.flatMap((sc) => sc.lines.map(async (l, li) => ({ sc: sc.id, li, s: l.seconds == null && fileOf(all, l.voiceTask) ? await api.mediaSeconds(fileOf(all, l.voiceTask)!) : undefined }))))
    await setEp((e) => measured.forEach((m) => m.s && (e.scenes.find((x) => x.id === m.sc)!.lines[m.li].seconds = m.s)))
  })
  const total = sum(ep.scenes.map((sc) => timing(sc).seconds))
  const done = lines.every((x) => !x.l.text.trim() || (fileOf(tasks, x.l.voiceTask) && x.l.seconds != null))

  return (
    <>
      {!ELEVEN_VOICES.length && <p className="rounded-xl bg-raised px-3 py-2.5 text-[13px]">Add your ElevenLabs key in Settings to record the voices.</p>}
      <div className="flex flex-wrap items-center gap-2">
        {missing.length > 0 && (
          <button type="button" disabled={busy(run) || !ELEVEN_VOICES.length} onClick={() => record()} className={primary}>
            <Clapperboard size={15} /> Record {missing.length} line{missing.length > 1 ? 's' : ''} <span className="font-normal opacity-70">ElevenLabs plan</span>
          </button>
        )}
        <span className="ml-auto text-[13px] text-muted tabular-nums">Episode length ≈ {fmt(total)}</span>
      </div>
      <div className="flex flex-col gap-2">
        {ep.scenes.map((sc, i) => (
          <div key={sc.id} className="flex gap-3 rounded-2xl border border-line bg-surface p-3 text-[13px]">
            <div className="w-16 shrink-0">
              <div className="aspect-[9/16] overflow-hidden rounded-lg bg-raised">
                {fileOf(tasks, sc.frameTask) && <img src={mediaUrl({ kind: 'media', file: fileOf(tasks, sc.frameTask)! })} alt="" className="size-full object-cover" />}
              </div>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="text-muted">Scene {i + 1} · {fmt(timing(sc).seconds)}{!sc.lines.length && ' · no dialogue'}</span>
              {sc.lines.map((l, li) => {
                const f = fileOf(tasks, l.voiceTask)
                return (
                  <div key={li} className="flex items-center gap-2">
                    <span className="w-24 shrink-0 truncate font-medium" title={voiceName(voiceFor(cast, l.speaker)) ? `Voice: ${voiceName(voiceFor(cast, l.speaker))}` : 'Default voice'}>{l.speaker}</span>
                    <span className="min-w-0 flex-1 truncate">“{l.text}”</span>
                    {f ? <audio src={mediaUrl({ kind: 'media', file: f })} controls preload="none" className="h-8 w-56 shrink-0" />
                      : stateOf(tasks, l.voiceTask) === 'busy' ? (tasks[l.voiceTask!]?.state === 'waiting'
                        ? <span className="text-faint">In queue</span> : <LoaderCircle size={14} className="animate-spin text-muted" />)
                      : stateOf(tasks, l.voiceTask) === 'fail' ? <span className="text-danger">{tasks[l.voiceTask!]?.error}</span> : <span className="text-faint">not recorded</span>}
                    {l.seconds != null && <span className="w-12 shrink-0 text-right text-faint tabular-nums">{fmt(l.seconds)}</span>}
                    {stateOf(tasks, l.voiceTask) !== 'busy' && l.text.trim() && (
                      <IconButton title={f ? 'Record this line again' : 'Record this line'} className="size-7" disabled={busy(run) || !ELEVEN_VOICES.length}
                        onClick={() => void record([{ sc, l, li }])}>
                        {f ? <RotateCcw size={13} /> : <Mic size={13} />}
                      </IconButton>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-end">
        <button type="button" disabled={!done || busy(run)} onClick={() => go('video')} className={primary} title={done ? undefined : 'Record every line first'}>
          Continue to video <ArrowRight size={15} />
        </button>
      </div>
    </>
  )
}

// --- 4. Video: each approved image animated, silent by default, just long enough for its dialogue ---

function VideoStep({ s, ep, tasks, run, rk: k, setEp, go }: StepProps) {
  const vm = model(s.videoModel)
  const sound = !!s.videoSound
  const missing = ep.scenes.filter((sc) => needs(tasks, sc.videoTask))
  const cost = (sc: Scene) => estimate(vm.id, buildInput(vm, videoValues(vm, timing(sc).seconds, sound), {}).input)?.hi ?? 0
  const animate = (sc: Scene) => makeOne(vm.id, videoValues(vm, timing(sc).seconds, sound), [img(fileOf(tasks, sc.frameTask)!)], motionPrompt(s, sc)).then((ids) => ids[0])
  const animateAll = () => step(k, 'Animating scenes…', () => makeAll(k, `Animating ${missing.length} scenes…`, 'videos', missing, animate,
    (pairs) => setEp((e) => pairs.forEach(([sc, id]) => (e.scenes.find((x) => x.id === sc.id)!.videoTask = id)))))
  const done = ep.scenes.every((sc) => fileOf(tasks, sc.videoTask))

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <SelectChip title="Video model" label={`Video: ${vm.label}`} value={s.videoModel} onChange={(v) => void updateSeries(s.id, (x) => void (x.videoModel = v))}
          options={VIDEO_MODELS.map((id) => ({ value: id, label: withBest(model(id).label, id) }))} />
        <button type="button" aria-pressed={sound} onClick={() => void updateSeries(s.id, (x) => void (x.videoSound = !sound))}
          title="Off: videos are made silent and only your script's voices are heard. On: the video model adds its own sound (ambience), kept quiet under the voices."
          className={`h-8 rounded-full border px-3 text-[13px] ${sound ? 'border-fg bg-raised' : 'border-line text-muted hover:bg-raised'}`}>
          Video sound: {sound ? 'on' : 'off'}
        </button>
        {missing.length > 0 && (
          <button type="button" disabled={busy(run)} onClick={animateAll} className={primary}>
            <Clapperboard size={15} /> Animate {missing.length} scene{missing.length > 1 ? 's' : ''} <span className="font-normal opacity-70">{priceOf(sum(missing.map(cost)))}</span>
          </button>
        )}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-2">
        {ep.scenes.map((sc, i) => {
          const v = fileOf(tasks, sc.videoTask)
          const f = fileOf(tasks, sc.frameTask)
          const st = stateOf(tasks, sc.videoTask)
          return (
            <div key={sc.id} className="flex flex-col gap-1">
              <div className="relative aspect-[9/16] overflow-hidden rounded-xl bg-raised">
                {v ? <Media file={v} alt={`Scene ${i + 1}`} className="size-full object-cover" /> : f && <img src={mediaUrl({ kind: 'media', file: f })} alt="" className="size-full object-cover opacity-60" />}
                {st === 'busy' && <span className="absolute inset-0 flex items-center justify-center text-white"><LoaderCircle size={18} className="animate-spin" /></span>}
                <span className="absolute top-1 left-1 rounded bg-black/60 px-1.5 text-[11px] leading-5 text-white tabular-nums">{i + 1}</span>
              </div>
              <div className="flex items-center text-[11px] text-muted tabular-nums">
                <span title="Scene length (from the voices) · clip the model makes">{fmt(timing(sc).seconds)} · {clipFor(vm, timing(sc).seconds)} s clip</span>
                {st === 'fail' && <span className="ml-1 truncate text-danger" title={tasks[sc.videoTask!]?.error}>failed</span>}
                {(v || st === 'fail') && (
                  <IconButton title="Animate again" className="ml-auto size-6" disabled={busy(run)} onClick={() => setEp((e) => void (e.scenes.find((x) => x.id === sc.id)!.videoTask = undefined))}>
                    <RotateCcw size={12} />
                  </IconButton>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex justify-end">
        <button type="button" disabled={!done || busy(run)} onClick={() => go('cut')} className={primary}>Continue to cut <ArrowRight size={15} /></button>
      </div>
    </>
  )
}

// --- 5. Cut: clips trimmed to their dialogue, voices in place, music underneath; then the story bible is updated ---

function CutStep({ s, ep, index, tasks, run, rk: k, setEp, onEdit }: StepProps) {
  const music = ep.music !== false
  const total = sum(ep.scenes.map((sc) => timing(sc).seconds))
  const make = () => step(k, 'Making the cut…', async () => {
    let t = tasks
    if (music && needs(t, ep.musicTask)) {
      await makeAll(k, 'Making the music…', 'music tracks', [ep],
        () => makeOne('suno', { custom_mode: false, instrumental: true }, [], `Instrumental background score for a short-film episode. ${s.style} Mood: ${ep.summary}`.slice(0, 450)).then((ids) => ids[0]),
        async ([[, id]]) => setEp((e) => void (e.musicTask = id)))
    }
    t = Object.fromEntries((await api.tasks()).map((x) => [x.id, x]))
    const latest = getSeries(s.id).episodes.find((e) => e.id === ep.id)!
    setRun(k, { step: 'Cutting…' })
    // Every scene once, as long as its dialogue. (Fine-tuning happens in the Edit section; its export replaces this cut.)
    const edit = { ...(await defaultEdit(getSeries(s.id), latest, t)), music }
    const file = await api.render(toRender(latest, edit, t, `${s.title} ${latest.title}`))
    await setEp((e) => {
      if (e.cut) e.cuts = [...(e.cuts ?? []), e.cut]
      e.cut = file
    })
    setRun(k, { step: 'Updating the story bible…' })
    const { recap, continuity } = await api.writeRecap(getSeries(s.id), index)
    await updateSeries(s.id, (x) => {
      x.continuity = continuity
      x.episodes.find((e) => e.id === ep.id)!.recap = recap
    })
    return 'Done. The story bible now includes this episode, so the next script continues from here.'
  })

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" aria-pressed={music} onClick={() => void setEp((e) => void (e.music = !music))}
          className={`h-8 rounded-full border px-3 text-[13px] ${music ? 'border-fg bg-raised' : 'border-line text-muted hover:bg-raised'}`}>
          Music: {music ? 'on' : 'off'}
        </button>
        <span className="text-[13px] text-muted">
          {`${ep.scenes.length} scenes · ${fmt(total)} · voices from the script${s.videoSound ? ' with quiet video sound' : ', video sound off'}`}
        </span>
        <button type="button" disabled={busy(run) || !ep.scenes.some((sc) => fileOf(tasks, sc.videoTask))} onClick={onEdit}
          title="Open this episode in the editor: trim, reorder, add text and captions, export. Scenes without video yet are left out."
          className="ml-auto inline-flex h-9 items-center gap-2 rounded-full border border-line px-4 hover:bg-raised disabled:opacity-40">
          <Film size={15} /> Open in editor
        </button>
        <button type="button" disabled={busy(run)} onClick={make} className={primary}>
          <Clapperboard size={15} /> {ep.cut ? 'Cut again' : 'Make the cut'} {music && needs(tasks, ep.musicTask) && <span className="font-normal opacity-70">{priceLabel(estimate('suno', {}))}</span>}
        </button>
      </div>
      {ep.cut && (
        <div className="flex items-end gap-5">
          <video src={mediaUrl({ kind: 'media', file: ep.cut })} controls playsInline className="max-h-[520px] rounded-xl bg-black" />
          <div className="flex max-w-72 flex-col gap-3 text-[13px]">
            <button type="button" onClick={() => api.saveAs({ kind: 'media', file: ep.cut! })} className={primary}><Download size={15} /> Save MP4</button>
            {ep.recap && <p className="leading-relaxed text-muted"><span className="font-medium text-fg">Recap for the next episode:</span> {ep.recap}</p>}
            {(ep.cuts?.length ?? 0) > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-muted">Earlier cuts</span>
                {[...ep.cuts!].reverse().map((f, i) => (
                  <div key={f} className="flex items-center gap-2">
                    <span className="text-faint tabular-nums">{ep.cuts!.length - i}</span>
                    <button type="button" className="underline underline-offset-2" onClick={() => void setEp((e) => {
                      e.cuts = [...(e.cuts ?? []).filter((x) => x !== f), e.cut!]
                      e.cut = f
                    })}>Use this one</button>
                    <button type="button" className="text-muted underline underline-offset-2" onClick={() => api.saveAs({ kind: 'media', file: f })}>Save</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

// Every scene as a block as long as it runs; click one to open it.
function Timeline({ scenes, selected, onPick }: { scenes: Scene[]; selected?: string; onPick: (id: string) => void }) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-0.5 border-t border-line px-6">
      {scenes.map((sc, i) => {
        const t = timing(sc).seconds
        return (
          <button key={sc.id} type="button" onClick={() => onPick(sc.id)} style={{ flex: t }} title={`Scene ${i + 1}: ${fmt(t)}`}
            className={`h-7 min-w-0 truncate rounded-md px-1.5 text-left text-[11px] tabular-nums ${sc.id === selected ? 'bg-inverse text-on-inverse' : 'bg-raised text-muted hover:text-fg'}`}>
            {i + 1} · {t.toFixed(1)}s
          </button>
        )
      })}
    </div>
  )
}

// The episode's brief: grows with its text (up to a point, then scrolls). Improve rewrites it from the story bible;
// Undo brings back what you had.
function Summary({ s, ep, index, setEp }: { s: Series; ep: Episode; index: number; setEp: (fn: (e: Episode) => void) => Promise<void> }) {
  const area = useRef<HTMLTextAreaElement>(null)
  const [busy, setBusy] = useState(false)
  const [before, setBefore] = useState<string | null>(null)
  const [error, setError] = useState('')
  const fit = () => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(Math.max(el.scrollHeight + el.offsetHeight - el.clientHeight, 64), 280)}px` // + borders
  }
  useLayoutEffect(fit, [ep.summary])
  useEffect(() => (addEventListener('resize', fit), () => removeEventListener('resize', fit)), [])
  async function improve() {
    setBusy(true)
    setError('')
    try {
      const text = await api.improveSummary(getSeries(s.id), index, ep.summary)
      setBefore(ep.summary)
      await setEp((x) => void (x.summary = text))
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="relative">
      <textarea ref={area} aria-label="Episode summary" value={ep.summary} placeholder="What happens: the hook, the turn, the punchline. A line is enough; Improve fills it out."
        onChange={(e) => (setBefore(null), void setEp((x) => void (x.summary = e.target.value)))} className={`${field} resize-none pr-28 pb-8`} />
      <div className="absolute right-2 bottom-2 flex items-center gap-1.5">
        {before !== null && !busy && (
          <button type="button" onClick={() => (void setEp((x) => void (x.summary = before)), setBefore(null))} className="text-xs text-muted underline underline-offset-2 hover:text-fg">Undo</button>
        )}
        <button type="button" disabled={busy} onClick={improve} title="Rewrite with GPT 6 Sol from the story bible: a short idea becomes hook, turn and punchline; a detailed script keeps every line and is tidied into beats"
          className="inline-flex h-7 items-center gap-1 rounded-full border border-line bg-surface px-2.5 text-xs text-muted hover:text-fg disabled:opacity-40">
          {busy ? <LoaderCircle size={12} className="animate-spin" /> : <Wand2 size={12} />} Improve
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  )
}
