import { Check, ImagePlus, LoaderCircle, Pause, Plus, RotateCcw, Trash2, UserRound, Volume2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ELEVEN_VOICES } from '../../shared/models'
import { estimate, priceLabel } from '../../shared/prices'
import type { Character, Series } from '../../shared/types'
import { ACCEPT_IMAGES, api, errMsg, mediaUrl, toAttachments } from './lib'
import { fileOf, getChar, img, makeOne, portraitPrompt, removeChar, saveChar, sheetPrompt, stateOf, type Tasks, updateChar, voiceName } from './seriesStore'
import { IconButton } from './ui'
import { VoiceTools } from './Voices'

const CHAR_MODEL = 'gpt-image-2'
const field = 'w-full rounded-lg border border-line bg-bg px-2.5 py-1.5 text-[13px] leading-relaxed focus:border-fg'

export function Avatar({ c, t, size = 'size-12' }: { c?: Character; t: Tasks; size?: string }) {
  const file = fileOf(t, c?.portraitTask)
  return (
    <span className={`${size} flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-raised text-muted`}>
      {file ? <img src={mediaUrl({ kind: 'media', file })} alt={c?.name} className="size-full object-cover" /> : <UserRound size={18} />}
    </span>
  )
}

// Every character you build is kept here and can be cast in any series.
export function CharacterLibrary({ characters, series, tasks, onOpen }: { characters: Character[]; series: Series[]; tasks: Tasks; onOpen: (id: string) => void }) {
  async function create() {
    const c: Character = { id: crypto.randomUUID(), name: '', look: '', personality: '', createdAt: Date.now() }
    await saveChar(c)
    onOpen(c.id)
  }
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 px-6 pt-6 pb-16">
      <p className="text-muted">Characters are saved here and keep the same face, clothes and voice in every series. Mention one in a scene as @Name.</p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
        <button type="button" onClick={create} className="flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line text-muted hover:border-fg hover:text-fg">
          <Plus size={22} /> New character
        </button>
        {characters.map((c) => {
          const used = series.filter((s) => s.cast.includes(c.id)).length
          const file = fileOf(tasks, c.portraitTask)
          return (
            <button key={c.id} type="button" onClick={() => onOpen(c.id)} className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface text-left hover:border-faint">
              <span className="flex aspect-square items-center justify-center bg-raised text-muted">
                {file ? <img src={mediaUrl({ kind: 'media', file })} alt={c.name} className="size-full object-cover" /> : <UserRound size={28} />}
              </span>
              <span className="flex flex-col px-3 py-2">
                <span className="truncate font-medium">{c.name || 'Unnamed'}</span>
                <span className="truncate text-xs text-muted">
                  {voiceName(c.voice) ? `Voice: ${voiceName(c.voice)}` : 'No voice yet'}
                  {used > 0 && ` · ${used} series`}
                </span>
                {!c.portraitTask && <span className="text-xs text-faint">Portrait not picked yet</span>}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// Building a character, in order: 1 describe (or start from a photo) → 2 pick one of three portraits → 3 reference sheet → 4 voice.
// Every change is saved at once; Done just closes.
export function CharacterBuilder({ id, tasks, usedIn, onClose }: { id: string; tasks: Tasks; usedIn: string[]; onClose: () => void }) {
  const c = getChar(id)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [, redraw] = useState(0)
  const picker = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', h)
    return () => removeEventListener('keydown', h)
  }, [onClose])
  if (!c) return null
  const set = (patch: Partial<Character>) => void updateChar(id, (x) => Object.assign(x, patch))
  const act = async (what: string, fn: () => Promise<void>) => {
    setBusy(what)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy('')
    }
  }
  const options = c.options ?? []
  const portrait = fileOf(tasks, c.portraitTask)
  const sheet = fileOf(tasks, c.sheetTask)
  const canPortraits = !!c.name.trim() && (!!c.look.trim() || !!c.photo)
  // A voice from before the ElevenLabs switch (kie's list) may not exist in the account; it doesn't count until replaced.
  const known = ELEVEN_VOICES.some((v) => v.id === c.voice)
  const each = priceLabel(estimate(CHAR_MODEL, { resolution: '1K' }))

  const makeOptions = () => act('options', async () => {
    const ids = await makeOne(CHAR_MODEL, { aspect_ratio: '3:4', resolution: '1K' }, c.photo ? [c.photo] : [],
      `${portraitPrompt(c)}${c.photo ? ' Base the person on the reference photo.' : ''}`, 3)
    set({ options: ids, portraitTask: undefined, sheetTask: undefined })
  })
  const pick = (taskId: string) => act('sheet', async () => {
    const file = fileOf(tasks, taskId)!
    const [sheetTask] = await makeOne(CHAR_MODEL, { aspect_ratio: '16:9', resolution: '1K' }, [img(file)], sheetPrompt(c))
    set({ portraitTask: taskId, sheetTask })
  })
  const redoSheet = () => act('sheet', async () => {
    const [sheetTask] = await makeOne(CHAR_MODEL, { aspect_ratio: '16:9', resolution: '1K' }, [img(portrait!)], sheetPrompt(c))
    set({ sheetTask })
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6 backdrop-blur-sm" onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()} className="flex max-h-full w-full max-w-[720px] flex-col gap-6 overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <Avatar c={c} t={tasks} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold">{c.name || 'New character'}</h2>
            <p className="text-xs text-muted">Saved to Characters as you go{usedIn.length > 0 && ` · in ${usedIn.join(', ')}`}</p>
          </div>
          <IconButton title="Close" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>

        <Section n={1} title="Describe" done={canPortraits}>
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div className="flex flex-col gap-2">
              <input id="char-name" aria-label="Name" value={c.name} placeholder="Name" autoFocus={!c.name} onChange={(e) => set({ name: e.target.value })} className={field} />
              <textarea aria-label="Look" rows={3} value={c.look} onChange={(e) => set({ look: e.target.value })} className={`${field} resize-none`}
                placeholder="Look, precisely: age, face, skin, hair, build, clothes. A small grey cat with blue-grey fur, white chin, green eyes, mustard raincoat." />
              <input aria-label="Personality" value={c.personality} placeholder="Personality: calm, deadpan, secretly kind" onChange={(e) => set({ personality: e.target.value })} className={field} />
            </div>
            <div className="flex w-28 flex-col items-center gap-1.5">
              <button type="button" onClick={() => picker.current?.click()} title="Start from a photo (optional)"
                className="flex aspect-[3/4] w-full items-center justify-center overflow-hidden rounded-xl border border-dashed border-line text-muted hover:border-fg hover:text-fg">
                {c.photo ? <img src={mediaUrl(c.photo)} alt="Reference photo" className="size-full object-cover" /> : <ImagePlus size={20} />}
              </button>
              <span className="text-center text-[11px] text-faint">{c.photo ? <button type="button" className="underline" onClick={() => set({ photo: undefined })}>Remove photo</button> : 'Photo (optional)'}</span>
              <input ref={picker} type="file" accept={ACCEPT_IMAGES} hidden onChange={async (e) => {
                const [a] = e.target.files ? await toAttachments(e.target.files, ACCEPT_IMAGES) : []
                if (a) set({ photo: a })
                e.target.value = ''
              }} />
            </div>
          </div>
        </Section>

        <Section n={2} title="Pick a portrait" done={!!c.portraitTask} locked={!canPortraits} hint="Write a name and a look first.">
          {!options.length && portrait && (
            <img src={mediaUrl({ kind: 'media', file: portrait })} alt={`${c.name}'s portrait`} className="aspect-[3/4] w-40 rounded-xl object-cover ring-2 ring-fg" />
          )}
          {options.length ? (
            <div className="grid grid-cols-3 gap-2">
              {options.map((o) => {
                const file = fileOf(tasks, o)
                const st = stateOf(tasks, o)
                return (
                  <button key={o} type="button" disabled={!file || !!busy} onClick={() => pick(o)}
                    className={`relative aspect-[3/4] overflow-hidden rounded-xl bg-raised ${c.portraitTask === o ? 'ring-2 ring-fg' : 'hover:opacity-90'}`}>
                    {file ? <img src={mediaUrl({ kind: 'media', file })} alt="Portrait option" className="size-full object-cover" />
                      : <span className="flex size-full items-center justify-center text-[13px] text-muted">{st === 'fail' ? tasks[o]?.error : <LoaderCircle size={18} className="animate-spin" />}</span>}
                    {c.portraitTask === o && <span className="absolute top-2 right-2 flex size-6 items-center justify-center rounded-full bg-inverse text-on-inverse"><Check size={14} /></span>}
                  </button>
                )
              })}
            </div>
          ) : null}
          <button type="button" disabled={!canPortraits || !!busy} onClick={makeOptions}
            className="inline-flex h-9 w-fit items-center gap-2 rounded-full bg-inverse px-4 font-medium text-on-inverse disabled:opacity-35">
            {busy === 'options' ? <LoaderCircle size={15} className="animate-spin" /> : options.length ? <RotateCcw size={15} /> : <Plus size={15} />}
            {options.length ? 'Three new options' : 'Make 3 portraits'} <span className="font-normal opacity-70">({each} each)</span>
          </button>
        </Section>

        <Section n={3} title="Reference sheet" done={!!sheet} locked={!c.portraitTask} hint="Pick a portrait first; the sheet is made from it.">
          {c.sheetTask && (
            <div className="relative aspect-video overflow-hidden rounded-xl bg-raised">
              {sheet ? <img src={mediaUrl({ kind: 'media', file: sheet })} alt="Reference sheet" className="size-full object-contain" />
                : <span className="flex size-full items-center justify-center gap-2 text-[13px] text-muted">
                    {stateOf(tasks, c.sheetTask) === 'fail' ? tasks[c.sheetTask]?.error : <><LoaderCircle size={16} className="animate-spin" /> Drawing front, side and full-body views…</>}
                  </span>}
            </div>
          )}
          {portrait && (
            <button type="button" disabled={!!busy} onClick={redoSheet} className="inline-flex h-8 w-fit items-center gap-1.5 rounded-full border border-line px-3 text-[13px] text-muted hover:bg-raised hover:text-fg disabled:opacity-40">
              <RotateCcw size={13} /> {c.sheetTask ? 'Redo sheet' : 'Make reference sheet'}
            </button>
          )}
          <p className="text-xs text-faint">Scenes are drawn from the sheet and the portrait, so the face and clothes stay the same everywhere.</p>
        </Section>

        <Section n={4} title="Voice" done={known}>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Voice" value={c.voice ?? ''} onChange={(e) => set({ voice: e.target.value || undefined })} className={`${field} w-auto max-w-80`}>
              <option value="">{ELEVEN_VOICES.length ? 'Pick a voice' : 'Add your ElevenLabs key in Settings'}</option>
              {c.voice && !known && <option value={c.voice}>Old voice, not in your ElevenLabs voices: pick another</option>}
              {ELEVEN_VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name.split(' - ')[0]}{v.about ? ` (${v.about})` : ''}
                </option>
              ))}
            </select>
            <HearIt c={c} />
            <VoiceTools onChange={(added) => (added ? set({ voice: added }) : redraw((n) => n + 1))} />
          </div>
        </Section>

        {error && <p className="text-[13px] text-danger">{error}</p>}
        <div className="flex items-center gap-2 border-t border-line pt-4 text-[13px]">
          {confirmDelete ? (
            <>
              <span className="min-w-0 flex-1">Delete {c.name || 'this character'}? {usedIn.length ? 'They leave the cast of every series.' : ''} Their images stay in Create.</span>
              <button type="button" onClick={() => removeChar(c.id).then(onClose)} className="h-8 shrink-0 rounded-full bg-inverse px-3 font-medium text-on-inverse">Delete</button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="h-8 shrink-0 rounded-full px-3 hover:bg-raised">Keep</button>
            </>
          ) : (
            <>
              <IconButton title="Delete character" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={15} />
              </IconButton>
              <button type="button" onClick={onClose} className="ml-auto h-9 rounded-full bg-inverse px-5 font-medium text-on-inverse">Done</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({ n, title, done, locked, hint, children }: { n: number; title: string; done?: boolean; locked?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <section className={`flex flex-col gap-3 ${locked ? 'opacity-45' : ''}`}>
      <h3 className="flex items-center gap-2 font-medium">
        <span className={`flex size-6 items-center justify-center rounded-full text-xs ${done ? 'bg-inverse text-on-inverse' : 'border border-line text-muted'}`}>
          {done ? <Check size={13} /> : n}
        </span>
        {title}
        {locked && hint && <span className="text-xs font-normal text-faint">{hint}</span>}
      </h3>
      {!locked && children}
    </section>
  )
}

// Plays a short line in the character's voice (ElevenLabs, a few characters of your plan). Made once per voice.
const samples = new Map<string, string>()
function HearIt({ c }: { c: Character }) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle')
  const [err, setErr] = useState('')
  const audio = useRef<HTMLAudioElement | null>(null)
  async function play() {
    if (state === 'playing') return audio.current?.pause()
    if (!c.voice || state === 'loading') return
    setErr('')
    try {
      const key = `${c.voice}:${c.name}`
      let file = samples.get(key)
      if (!file) {
        setState('loading')
        const [id] = await api.generate({ modelId: 'el-tts', variant: 'text', prompt: `Hi, I'm ${c.name || 'new here'}. Nice to meet you.`, input: { voice: c.voice }, count: 1 })
        for (let i = 0; i < 60 && !file; i++) {
          await new Promise((r) => setTimeout(r, 700))
          const t = (await api.tasks()).find((x) => x.id === id)
          if (t?.state === 'fail') throw new Error(t.error)
          if (t?.state === 'success') file = t.files[0]
        }
        if (!file) throw new Error('The voice took too long.')
        samples.set(key, file)
      }
      const a = new Audio(mediaUrl({ kind: 'media', file }))
      audio.current = a
      a.onended = a.onpause = () => setState('idle')
      await a.play()
      setState('playing')
    } catch (e) {
      setState('idle')
      setErr(errMsg(e))
    }
  }
  return (
    <>
      <button type="button" disabled={!c.voice} onClick={play} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-[13px] text-muted hover:bg-raised hover:text-fg disabled:opacity-40">
        {state === 'loading' ? <LoaderCircle size={14} className="animate-spin" /> : state === 'playing' ? <Pause size={14} /> : <Volume2 size={14} />} Hear it
      </button>
      {err && <span className="text-xs text-danger">{err}</span>}
    </>
  )
}
