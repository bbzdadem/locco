import { AudioLines, AudioWaveform, Clapperboard, Download, Image, ImagePlus, LoaderCircle, Maximize2, MessageSquare, Music, Play, Plus, RotateCcw, Scissors, SlidersHorizontal, Sparkles, Star, Trash2, TriangleAlert, WandSparkles, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { generators, isEleven, kindOf, MEDIA_MODELS, withBest } from '../../shared/models'
import { buildInput, capOf, fill, isMain, refList, resolveMentions, slotLabel, slotsOf, valid, current, type Refs } from '../../shared/inputs'
import { estimate, priceLabel } from '../../shared/prices'
import type { Attachment, Field, MediaKind, Task } from '../../shared/types'
import { ACCEPT_IMAGES, api, errMsg, fmtCredits, load, mediaUrl, pretty, save, toAttachments } from './lib'
import { Header, IconButton, SelectChip } from './ui'
import { VoiceTools } from './Voices'

type Item = { task: Task; file?: string }
type HeaderProps = { collapsed: boolean; onExpand: () => void }
type Actions = {
  toChat: (it: Item) => void
  animate: (it: Item) => void
  useAsRef: (it: Item) => void
  reuse: (t: Task) => void
  tool: (id: string, it: Item) => void
  suno: (id: 'suno-extend' | 'suno-stems', it: Item) => void
  saveAs: (file: string) => void
  star: (t: Task) => void
  remove: (t: Task) => void
  retry: (t: Task) => void
}

const SHORT = new Set(['aspect_ratio', 'resolution', 'image_size', 'ratio'])
const EXAMPLES: Record<MediaKind, string[]> = {
  image: [
    'A glass perfume bottle on wet black stone, soft studio light, drifting mist',
    'Portrait of an old fisherman in a yellow raincoat, overcast, 35mm film grain',
    'Isometric tiny coffee shop on a floating island, warm evening light',
    'Minimal poster: the word LOCCO in brushed silver letters on charcoal',
  ],
  audio: [
    'A calm minimal piano piece for a rainy evening',
    'Upbeat indie pop song about a summer road trip along the Caspian coast',
    'Lo-fi hip hop beat for studying, vinyl crackle, soft keys',
    'A 20-second cinematic trailer sting with big drums and a rising synth',
  ],
  video: [
    'Slow dolly-in on a steaming cup of tea on a rainy window sill, soft morning light',
    'Drone shot gliding over the Caspian coast at sunset, waves rolling in',
    'A paper boat drifting down a city gutter after rain, macro, shallow depth of field',
    'Black and white street scene, people with umbrellas crossing in slow motion',
  ],
}

const isRef = (v: unknown): v is Attachment => !!v && typeof v === 'object' && 'kind' in v && 'file' in v
export const isVideo = (file?: string) => !!file && /\.(mp4|mov|m4v)$/i.test(file)
export const isAudio = (file?: string) => !!file && /\.(mp3|wav|m4a|webm|ogg)$/i.test(file)
const labelOf = (f: Field) => f.label ?? pretty(f.name)
const shown = (f: Field, v: unknown) => f.enumLabels?.[String(v)] ?? String(v)
const fmt = (f: Field, v: unknown) => (f.name === 'duration' ? `${v}s` : SHORT.has(f.name) ? shown(f, v) : `${labelOf(f)}: ${shown(f, v)}`)
export const elapsed = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`

export function ratioOf(task: Pick<Task, 'input' | 'modelId'>) {
  const v = String(task.input.aspect_ratio ?? task.input.image_size ?? task.input.ratio ?? '')
  const m = v.match(/(\d+)[:_](\d+)/)
  if (!m) return { video: '16 / 9', audio: '2 / 1', image: '1 / 1' }[kindOf(task.modelId)]
  return v.startsWith('portrait') ? `${m[2]} / ${m[1]}` : `${m[1]} / ${m[2]}`
}

export function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}

function useColumns(ref: RefObject<HTMLDivElement | null>) {
  const [n, setN] = useState(3)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setN(Math.max(1, Math.floor(e.contentRect.width / 250))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return n
}

export function Create({ header, onChanged, onSendToChat }: { header: HeaderProps; onChanged: () => void; onSendToChat: (a: Attachment) => void }) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [tab, setTab] = useState<MediaKind>(() => load('create.tab', 'image'))
  const [modelIds, setModelIds] = useState<Record<MediaKind, string>>(() => {
    const saved = load('create.models', { image: 'gpt-image-2', video: generators('video')[0].id, audio: generators('audio')[0].id })
    // GPT Image 2 became the default image model on 8 Nov 2026; switch existing setups over once.
    if (!load('create.gptDefault', false)) (saved.image = 'gpt-image-2'), save('create.models', saved), save('create.gptDefault', true)
    return saved
  })
  const [values, setValues] = useState<Record<string, Record<string, unknown>>>(() => load('create.values', {}))
  const [prompt, setPrompt] = useState(() => load('create.prompt', ''))
  const [refs, setRefs] = useState<Refs>({})
  const [count, setCount] = useState(1)
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<Item | null>(null)
  const [dragging, setDragging] = useState(false)
  const [mention, setMention] = useState<{ query: string; start: number; index: number } | null>(null)
  const [favorites, setFavorites] = useState(false)
  const [, redraw] = useState(0)
  const [enhancing, setEnhancing] = useState(false)
  const [before, setBefore] = useState<string | null>(null) // the prompt before ✨, for Undo
  const grid = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const pickTarget = useRef<string | undefined>(undefined)
  const area = useRef<HTMLTextAreaElement>(null)
  const changed = useRef(onChanged)
  changed.current = onChanged
  const cols = useColumns(grid)

  useEffect(() => {
    const refresh = () => void api.tasks().then(setTasks)
    refresh()
    return api.onTasks(() => (refresh(), changed.current()))
  }, [])
  useEffect(() => save('create.prompt', prompt), [prompt])
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }, [prompt])

  // The prompt bar is built from the chosen model's own field list (see scripts/sync-models.mjs).
  const list = generators(tab)
  const model = list.find((m) => m.id === modelIds[tab]) ?? list[0]
  const v = values[model.id] ?? {}
  const { slots, hasRefs, variant, spec, input, missing } = buildInput(model, v, refs)
  const fields = spec.fields.filter((f) => !f.media && !isMain(f))
  const chips = fields.filter((f) => f.enum || f.type === 'boolean')
  const extras = fields.filter((f) => !f.enum && f.type !== 'boolean' && f.type !== 'array')
  const promptField = spec.fields.find(isMain)
  const showExtras = more || v.custom_mode === true // custom lyrics need a style and a title
  const cost = priceLabel(estimate(model.id, input, prompt.length), count)

  // @ mentions: type @ to point at a numbered reference (@img1, @img2 …).
  const numbered = refList(slots, refs).map((r, i) => ({ ...r, n: i + 1 }))
  const mentionItems = mention ? numbered.filter((x) => `img${x.n}`.startsWith(mention.query.toLowerCase())) : []
  function detectMention(el: HTMLTextAreaElement) {
    const before = el.value.slice(0, el.selectionStart)
    const m = before.match(/@(\w*)$/)
    setMention(m && numbered.length ? { query: m[1], start: before.length - m[0].length, index: 0 } : null)
  }
  function insertMention(n: number) {
    const el = area.current
    if (!el || !mention) return
    const token = `@img${n} `
    const pos = mention.start + token.length
    setPrompt(prompt.slice(0, mention.start) + token + prompt.slice(el.selectionStart))
    setMention(null)
    requestAnimationFrame(() => (el.focus(), el.setSelectionRange(pos, pos)))
  }
  const canGenerate = !busy && !missing && (!promptField?.required || !!prompt.trim())

  function pickModel(kind: MediaKind, id: string, nextRefs?: Refs) {
    const m = MEDIA_MODELS.find((x) => x.id === id)!
    setModelIds((all) => {
      const next = { ...all, [kind]: id }
      save('create.models', next)
      return next
    })
    // Carry attached images over to the new model's slots.
    setRefs((r) => nextRefs ?? fill({}, slotsOf(m), Object.values(r).flat()))
  }
  function switchTab(kind: MediaKind) {
    if (kind === tab) return
    setTab(kind)
    save('create.tab', kind)
    setRefs({})
    setError('')
  }
  const setValue = (name: string, val: unknown) =>
    setValues((all) => {
      const next = { ...all, [model.id]: { ...all[model.id], [name]: val } }
      save('create.values', next)
      return next
    })

  async function addRefs(files: FileList | File[], only?: string) {
    const added = await toAttachments(files, ACCEPT_IMAGES)
    if (!added.length) return setError('Images must be PNG, JPG or WebP.')
    setError('')
    if (slots.length) return setRefs((r) => fill(r, slots, added, only))
    // This model takes no images: switch to one that does.
    const m = list.find((x) => slotsOf(x).length)!
    pickModel(tab, m.id, fill({}, slotsOf(m), added))
  }

  // ✨ Rewrites a short idea into a detailed prompt with GPT 6 Sol (a few chat credits). Speech text is never rewritten.
  async function enhance() {
    if (enhancing || !prompt.trim()) return
    setEnhancing(true)
    setError('')
    try {
      const better = await api.enhance(prompt, tab, model.label)
      setBefore(prompt)
      setPrompt(better)
      area.current?.focus()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setEnhancing(false)
    }
  }

  async function generate() {
    if (!canGenerate) return
    setBusy(true)
    setError('')
    try {
      await api.generate({ modelId: model.id, variant, prompt: resolveMentions(prompt, model, refs), input, count })
      scroller.current?.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const pending = tasks.some((t) => t.state !== 'success' && t.state !== 'fail')
  const now = useNow(pending)
  const items = useMemo<Item[]>(
    () =>
      tasks
        .filter((t) => kindOf(t.modelId) === tab && !MEDIA_MODELS.find((m) => m.id === t.modelId)?.hidden && (!favorites || t.starred))
        .flatMap((t) => (t.state === 'success' && t.files.length ? t.files.map((file) => ({ task: t, file })) : [{ task: t }])),
    [tasks, tab, favorites],
  )
  // Newest first, filled left to right across the columns.
  const columns = useMemo(() => {
    const c: Item[][] = Array.from({ length: cols }, () => [])
    items.forEach((it, i) => c[i % cols].push(it))
    return c
  }, [items, cols])

  const run = useCallback((p: Promise<unknown>) => void p.catch((e) => setError(errMsg(e))), [])
  const asAttachment = (file: string): Attachment => ({ kind: 'media', file, name: file, mime: 'image/png' })
  const actions: Actions = {
    toChat: (it) => onSendToChat(asAttachment(it.file!)),
    animate: (it) => {
      const videos = generators('video')
      const cur = videos.find((m) => m.id === modelIds.video)
      const m = cur && slotsOf(cur).length ? cur : videos.find((x) => slotsOf(x).length)!
      const s = slotsOf(m)
      const start = s.find((f) => /first|start/i.test(f.name)) ?? s[0]
      setTab('video')
      save('create.tab', 'video')
      pickModel('video', m.id, { [start.name]: [asAttachment(it.file!)] })
      setPrompt('')
      setOpen(null)
      area.current?.focus()
    },
    useAsRef: (it) => {
      if (slots.length) setRefs((r) => fill(r, slots, [asAttachment(it.file!)]))
      else pickModel(tab, 'nano-banana-pro', fill({}, slotsOf(MEDIA_MODELS.find((m) => m.id === 'nano-banana-pro')!), [asAttachment(it.file!)]))
      setOpen(null)
    },
    reuse: (t) => {
      const kind = kindOf(t.modelId)
      const plain: Record<string, unknown> = {}
      const media: Refs = {}
      for (const [k, val] of Object.entries(t.input)) {
        if (Array.isArray(val) && val.every(isRef)) media[k] = val
        else if (isRef(val)) media[k] = [val]
        else plain[k] = val
      }
      if (kind !== tab) (setTab(kind), save('create.tab', kind))
      if (generators(kind).some((m) => m.id === t.modelId)) {
        pickModel(kind, t.modelId, media)
        setValues((all) => {
          const next = { ...all, [t.modelId]: plain }
          save('create.values', next)
          return next
        })
      }
      setPrompt(t.prompt)
      setOpen(null)
      area.current?.focus()
    },
    tool: (id, it) => {
      const field = MEDIA_MODELS.find((m) => m.id === id)!.tool!.fields.find((f) => f.media)!.name
      run(api.generate({ modelId: id, variant: 'tool', prompt: it.task.prompt, input: { [field]: { kind: 'media', file: it.file! } }, count: 1 }))
      setOpen(null)
    },
    suno: (id, it) => {
      const track = it.task.meta?.tracks?.find((t) => t.file === it.file)
      if (!track) return setError('This track has no Suno id, so it can’t be extended or split.')
      const input = id === 'suno-stems' ? { task_id: it.task.id, audio_id: track.id, type: 'separate_vocal' } : { audio_id: track.id }
      run(api.generate({ modelId: id, variant: 'tool', prompt: id === 'suno-extend' ? '' : it.task.prompt, input, count: 1 }))
      setOpen(null)
    },
    saveAs: (file) => run(api.saveAs({ kind: 'media', file })),
    star: (t) => run(api.starTask(t.id, !t.starred)),
    remove: (t) => (run(api.removeTask(t.id)), setOpen(null)),
    retry: (t) => run(api.generate({ modelId: t.modelId, variant: t.variant, prompt: t.prompt, input: t.input, count: 1 })),
  }

  return (
    <div className="flex h-full flex-col">
      <Header {...header}>
        <span className="font-medium">Create</span>
        <div className="absolute left-1/2 flex -translate-x-1/2 gap-1 rounded-full bg-raised p-1 text-sm">
          {(['image', 'video', 'audio'] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={tab === k}
              onClick={() => switchTab(k)}
              className={`h-9 rounded-full px-6 font-medium transition-colors ${tab === k ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg'}`}
            >
              {{ image: 'Image', video: 'Video', audio: 'Audio' }[k]}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={favorites}
          onClick={() => setFavorites(!favorites)}
          title="Show only favorites"
          className={`ml-auto inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] ${favorites ? 'border-fg bg-raised text-fg' : 'border-line text-muted hover:bg-raised'}`}
        >
          <Star size={14} fill={favorites ? 'currentColor' : 'none'} /> Favorites
        </button>
      </Header>

      <div ref={scroller} className="flex-1 overflow-y-auto">
        <div ref={grid} className="flex gap-3 px-5 pt-1 pb-64">
          {items.length ? (
            columns.map((col, i) => (
              <div key={i} className="flex min-w-0 flex-1 flex-col gap-3">
                {col.map((it) => (
                  <Tile key={`${it.task.id}-${it.file ?? ''}`} item={it} now={now} actions={actions} onOpen={() => setOpen(it)} />
                ))}
              </div>
            ))
          ) : favorites ? (
            <p className="w-full py-[14vh] text-center text-muted">No favorites here yet. Hover a result and press the star.</p>
          ) : (
            <Empty kind={tab} onPick={(p) => (setPrompt(p), area.current?.focus())} />
          )}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 px-5 pb-5">
        <div
          onDragOver={(e) => (e.preventDefault(), setDragging(true))}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => (e.preventDefault(), setDragging(false), addRefs(e.dataTransfer.files))}
          className={`pointer-events-auto relative mx-auto flex max-w-3xl flex-col gap-2.5 rounded-3xl border bg-surface p-3 shadow-[0_10px_40px_rgba(0,0,0,0.14)] ${dragging ? 'border-fg' : 'border-line'}`}
        >
          <div className="flex items-start gap-2">
            {slots.length > 0 && (
              <div className="flex shrink-0 gap-2.5">
                {slots.map((f) => {
                  const mine = refs[f.name] ?? []
                  const label = slotLabel(f, tab)
                  return (
                    <div key={f.name} className="flex flex-col items-center gap-1">
                      <div className="flex gap-1.5">
                        {mine.map((r) => (
                          <div key={r.file} className="group relative">
                            <img src={mediaUrl(r)} alt={label || 'Reference'} className="size-12 rounded-lg border border-line object-cover" />
                            <span className="pointer-events-none absolute bottom-0.5 left-0.5 rounded bg-black/65 px-1 text-[10px] leading-4 font-medium text-white tabular-nums">
                              {numbered.find((x) => x.a === r)?.n}
                            </span>
                            <button
                              type="button"
                              aria-label={`Remove ${label || 'reference'}`}
                              onClick={() => setRefs((x) => ({ ...x, [f.name]: (x[f.name] ?? []).filter((y) => y !== r) }))}
                              className="absolute -top-1.5 -right-1.5 hidden size-5 items-center justify-center rounded-full bg-inverse text-on-inverse group-hover:flex"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ))}
                        {mine.length < capOf(f) && (
                          <button
                            type="button"
                            title={`${label || 'Add reference images'}${capOf(f) > 1 ? ` (up to ${capOf(f)})` : ''}${f.required ? ', required' : ''}`}
                            aria-label={label || 'Add reference images'}
                            onClick={() => ((pickTarget.current = f.name), picker.current?.click())}
                            className={`flex size-12 items-center justify-center rounded-lg border border-dashed text-muted hover:border-fg hover:text-fg ${f.required ? 'border-muted' : 'border-faint'}`}
                          >
                            <ImagePlus size={18} />
                          </button>
                        )}
                      </div>
                      {label && <span className="text-[10px] leading-none text-faint">{label}</span>}
                    </div>
                  )
                })}
                <input
                  ref={picker}
                  type="file"
                  multiple
                  accept={ACCEPT_IMAGES}
                  hidden
                  onChange={(e) => (e.target.files && addRefs(e.target.files, pickTarget.current), (e.target.value = ''))}
                />
              </div>
            )}
            <textarea
              id="create-prompt"
              ref={area}
              rows={2}
              value={prompt}
              placeholder={`${
                tab === 'audio'
                  ? promptField?.name === 'text' ? 'Type what the voice should say'
                  : model.id === 'el-sfx' ? 'Describe the sound: rain on a tin roof, then distant thunder'
                  : v.custom_mode === true ? 'Lyrics, with [Verse] and [Chorus] tags' : 'Describe the song: mood, genre, instruments, what it’s about'
                  : tab === 'video'
                  ? hasRefs ? 'Describe the motion, camera and sound' : 'Describe the video you want'
                  : hasRefs ? 'Describe what to change or create from the references' : 'Describe the image you want'
              }${numbered.length > 1 ? ' · type @ to point at one' : ''}`}
              onChange={(e) => (setPrompt(e.target.value), setBefore(null), detectMention(e.target))}
              onSelect={(e) => detectMention(e.currentTarget)}
              onBlur={() => setTimeout(() => setMention(null), 150)}
              onPaste={(e) => e.clipboardData.files.length && (e.preventDefault(), addRefs(e.clipboardData.files))}
              onKeyDown={(e) => {
                if (mention && mentionItems.length) {
                  const n = mentionItems.length
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault()
                    return setMention({ ...mention, index: (mention.index + (e.key === 'ArrowDown' ? 1 : n - 1)) % n })
                  }
                  if (e.key === 'Enter' || e.key === 'Tab') return e.preventDefault(), insertMention(mentionItems[mention.index].n)
                  if (e.key === 'Escape') return e.preventDefault(), setMention(null)
                }
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) (e.preventDefault(), generate())
              }}
              className="min-h-12 flex-1 resize-none bg-transparent px-1.5 pt-1 text-[15px] leading-relaxed placeholder:text-faint"
            />
          </div>

          <div className="flex flex-wrap items-start gap-1.5">
            <SelectChip
              title="Model"
              label={<><Sparkles size={13} /> {model.label}</>}
              value={model.id}
              onChange={(id) => pickModel(tab, id)}
              options={list.map((m) => ({ value: m.id, label: withBest(m.label, m.id) }))}
            />
            {chips.map((f) => {
              const cur = current(f, v[f.name])
              if (f.type === 'boolean')
                return (
                  <button
                    key={f.name}
                    type="button"
                    aria-pressed={cur === true}
                    title={f.description}
                    onClick={() => setValue(f.name, cur !== true)}
                    className={`h-8 rounded-full border px-3 text-[13px] ${cur === true ? 'border-fg bg-raised' : 'border-line text-muted hover:bg-raised'}`}
                  >
                    {labelOf(f)}
                  </button>
                )
              return (
                <SelectChip
                  key={f.name}
                  title={labelOf(f)}
                  muted={valid(f, v[f.name]) === undefined}
                  label={cur !== undefined ? fmt(f, cur) : labelOf(f)}
                  value={valid(f, v[f.name]) === undefined ? '' : String(v[f.name])}
                  onChange={(val) => setValue(f.name, val || undefined)}
                  options={[
                    { value: '', label: f.default !== undefined ? `Default (${fmt(f, f.default)})` : 'Default' },
                    ...f.enum!.map((o) => ({ value: String(o), label: shown(f, o) })),
                  ]}
                />
              )
            })}
            {model.id === 'el-tts' && <VoiceTools onChange={(id) => (id ? setValue('voice', id) : redraw((n) => n + 1))} />}
            <SelectChip
              title={`How many ${{ image: 'images', video: 'videos', audio: 'generations' }[tab]}`}
              label={`×${count}`}
              value={String(count)}
              onChange={(n) => setCount(Number(n))}
              options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: `${n} ${{ image: 'image', video: 'video', audio: 'generation' }[tab]}${n > 1 ? 's' : ''}` }))}
            />
            {extras.length > 0 && (
              <IconButton title="More settings" onClick={() => setMore(!more)} className={more ? 'bg-raised text-fg' : ''}>
                <SlidersHorizontal size={15} />
              </IconButton>
            )}
            {promptField?.name === 'prompt' && (
              <button
                type="button"
                onClick={enhance}
                disabled={enhancing || !prompt.trim()}
                title="Improve this prompt with GPT 6 Sol (costs a few chat credits)"
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-[13px] text-muted hover:bg-raised hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent"
              >
                {enhancing ? <LoaderCircle size={14} className="animate-spin" /> : <WandSparkles size={14} />} Improve
              </button>
            )}
            {before !== null && !enhancing && (
              <button type="button" onClick={() => (setPrompt(before), setBefore(null))} className="h-8 px-1.5 text-[13px] text-muted underline underline-offset-2 hover:text-fg">
                Undo
              </button>
            )}
            <div className="ml-auto flex flex-col items-end gap-1">
              <button
                type="button"
                disabled={!canGenerate}
                onClick={generate}
                title={missing ? `Add ${slotLabel(missing, tab).toLowerCase() || 'an image'} first` : undefined}
                className="inline-flex h-9 items-center gap-2 rounded-full bg-inverse px-4 font-medium text-on-inverse transition-opacity disabled:opacity-35"
              >
                {busy ? <LoaderCircle size={15} className="animate-spin" /> : <Sparkles size={15} />}
                Generate
              </button>
              {(missing || cost || isEleven(model.id)) && (
                <span
                  className="pr-1 text-[11px] text-faint tabular-nums"
                  title="Estimate from kie.ai's price list (1 credit ≈ $0.005). Each result shows what kie actually charged."
                >
                  {missing ? `Add a ${slotLabel(missing, tab).toLowerCase() || 'reference image'} to start` : isEleven(model.id) ? 'Billed to your ElevenLabs plan' : cost}
                </span>
              )}
            </div>
          </div>

          {showExtras && extras.length > 0 && (
            <div className="flex flex-wrap gap-2 border-t border-line pt-2.5">
              {extras.map((f) => (
                <input
                  key={f.name}
                  id={`field-${f.name}`}
                  type={f.type === 'string' ? 'text' : 'number'}
                  title={f.description}
                  value={String(v[f.name] ?? '')}
                  onChange={(e) => setValue(f.name, e.target.value || undefined)}
                  placeholder={labelOf(f) + (f.name === 'style' ? ' (e.g. dreamy synth-pop, female vocals)' : '')}
                  className={`h-8 rounded-full border border-line bg-transparent px-3 text-[13px] focus:border-fg ${f.type === 'string' ? 'min-w-64 flex-1' : 'w-32'}`}
                />
              ))}
            </div>
          )}
          {error && <p className="px-1.5 text-[13px] text-danger">{error}</p>}

          {mention && mentionItems.length > 0 && (
            <div role="listbox" aria-label="References" className="absolute bottom-full left-3 mb-2 flex w-72 flex-col gap-0.5 rounded-xl border border-line bg-surface p-1 shadow-xl">
              {mentionItems.map((x, i) => (
                <button
                  key={x.n}
                  type="button"
                  role="option"
                  aria-selected={i === mention.index}
                  onMouseDown={(e) => (e.preventDefault(), insertMention(x.n))}
                  className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left ${i === mention.index ? 'bg-raised' : 'hover:bg-raised'}`}
                >
                  <img src={mediaUrl(x.a)} alt="" className="size-8 rounded-md border border-line object-cover" />
                  <span className="font-medium tabular-nums">@img{x.n}</span>
                  <span className="truncate text-xs text-muted">{slotLabel(x.field, tab) || 'Reference'}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {open && <Lightbox item={open} actions={actions} onClose={() => setOpen(null)} />}
    </div>
  )
}

function actionList(it: Item, a: Actions) {
  const video = isVideo(it.file)
  if (isAudio(it.file)) {
    const suno = !!it.task.meta?.tracks?.some((t) => t.file === it.file)
    return [
      suno && { title: `Extend this song (${priceLabel(estimate('suno-extend', {}))})`, Icon: Plus, run: () => a.suno('suno-extend', it) },
      suno && { title: `Split vocals and music (${priceLabel(estimate('suno-stems', {}))})`, Icon: AudioLines, run: () => a.suno('suno-stems', it) },
      { title: 'Isolate the voice, remove background noise (ElevenLabs)', Icon: AudioWaveform, run: () => a.tool('el-isolate', it) },
      { title: it.task.starred ? 'Remove from favorites' : 'Add to favorites', Icon: Star, run: () => a.star(it.task) },
      { title: 'Reuse prompt and settings', Icon: RotateCcw, run: () => a.reuse(it.task) },
      { title: 'Save as…', Icon: Download, run: () => a.saveAs(it.file!) },
      { title: 'Move to Trash', Icon: Trash2, run: () => a.remove(it.task) },
    ].filter((x) => !!x)
  }
  const list = [
    { title: it.task.starred ? 'Remove from favorites' : 'Add to favorites', Icon: Star, run: () => a.star(it.task) },
    !video && { title: 'Animate into a video', Icon: Clapperboard, run: () => a.animate(it) },
    !video && { title: 'Ask about it in chat', Icon: MessageSquare, run: () => a.toChat(it) },
    !video && { title: 'Use as reference', Icon: ImagePlus, run: () => a.useAsRef(it) },
    { title: 'Reuse prompt and settings', Icon: RotateCcw, run: () => a.reuse(it.task) },
    video
      ? { title: `Upscale with Topaz (${priceLabel(estimate('video-upscale', { upscale_factor: '2', duration: it.task.input.duration }))})`, Icon: Maximize2, run: () => a.tool('video-upscale', it) }
      : { title: `Upscale with Topaz (${priceLabel(estimate('upscale', {}))})`, Icon: Maximize2, run: () => a.tool('upscale', it) },
    !video && { title: `Remove background (${priceLabel(estimate('remove-bg', {}))})`, Icon: Scissors, run: () => a.tool('remove-bg', it) },
    { title: 'Save as…', Icon: Download, run: () => a.saveAs(it.file!) },
    { title: 'Move to Trash', Icon: Trash2, run: () => a.remove(it.task) },
  ]
  return list.filter((x) => !!x)
}

export function Media({ file, alt, className, controls }: { file: string; alt: string; className: string; controls?: boolean }) {
  const src = mediaUrl({ kind: 'media', file })
  if (isAudio(file)) return <audio src={src} controls preload="metadata" aria-label={alt} className="w-full" />
  if (!isVideo(file)) return <img src={src} alt={alt} loading="lazy" className={className} />
  if (controls) return <video src={src} controls autoPlay loop playsInline className={className} />
  return (
    <video
      src={src}
      muted
      loop
      playsInline
      preload="metadata"
      aria-label={alt}
      className={className}
      onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
      onMouseLeave={(e) => e.currentTarget.pause()}
    />
  )
}

function Tile({ item, now, actions, onOpen }: { item: Item; now: number; actions: Actions; onOpen: () => void }) {
  const { task, file } = item
  if (task.state === 'fail')
    return (
      <div className="flex flex-col gap-2 rounded-2xl border border-line p-4 text-[13px]">
        <div className="flex items-center gap-2 font-medium">
          <TriangleAlert size={15} className="text-danger" /> {task.label} failed
        </div>
        <p className="line-clamp-4 text-muted">{task.error}</p>
        <p className="line-clamp-2 text-faint">{task.prompt}</p>
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={() => actions.retry(task)} className="h-8 rounded-full bg-inverse px-3.5 font-medium text-on-inverse">
            Try again
          </button>
          <button type="button" onClick={() => actions.remove(task)} className="h-8 rounded-full px-3 hover:bg-raised">
            Remove
          </button>
        </div>
      </div>
    )
  if (!file)
    return (
      <div style={{ aspectRatio: ratioOf(task) }} className="relative flex flex-col items-center justify-center gap-1.5 overflow-hidden rounded-2xl bg-raised text-[13px] text-muted">
        <div className="shimmer absolute inset-0" />
        <LoaderCircle size={20} className="mb-1 animate-spin" />
        <span>{task.label}</span>
        <span className="text-faint tabular-nums">
          {task.state === 'generating' ? 'Generating' : 'In queue'} · {elapsed(Math.max(0, now - task.createdAt))}
        </span>
      </div>
    )
  if (isAudio(file)) {
    const track = task.meta?.tracks?.find((t) => t.file === file)
    return (
      <div className="group relative flex flex-col overflow-hidden rounded-2xl bg-raised">
        <button type="button" onClick={onOpen} className="block w-full cursor-zoom-in" aria-label={`Open: ${track?.title || task.prompt}`}>
          {track?.cover ? (
            <img src={mediaUrl({ kind: 'media', file: track.cover })} alt="" loading="lazy" className="aspect-square w-full object-cover grayscale-[0.15]" />
          ) : (
            <div className="flex aspect-[2/1] w-full items-center justify-center text-muted">
              <Music size={28} />
            </div>
          )}
        </button>
        <div className="flex flex-col gap-2 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-medium">{track?.title || task.prompt || task.label}</span>
            <span className="shrink-0 text-xs text-faint">{task.label}</span>
          </div>
          <Media file={file} alt={track?.title || task.prompt} className="" />
          <div className="-ml-1 flex flex-wrap gap-0.5">
            {actionList(item, actions).map(({ title, Icon, run }) => (
              <IconButton key={title} title={title} className="size-7" onClick={run}>
                <Icon size={14} />
              </IconButton>
            ))}
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="group relative overflow-hidden rounded-2xl bg-raised">
      <button type="button" onClick={onOpen} className="block w-full cursor-zoom-in" aria-label={`Open: ${task.prompt}`}>
        <Media file={file} alt={task.prompt} className="block w-full" />
      </button>
      {task.starred && (
        <span className="pointer-events-none absolute top-2 right-2 inline-flex size-6 items-center justify-center rounded-full bg-black/55 text-white" aria-label="Favorite">
          <Star size={12} fill="currentColor" />
        </span>
      )}
      {isVideo(file) && (
        <span className="pointer-events-none absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] text-white tabular-nums">
          <Play size={10} fill="currentColor" /> {task.input.duration ? `${task.input.duration}s` : 'Video'}
        </span>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-2 bg-gradient-to-t from-black/80 via-black/35 to-transparent p-3 pt-12 text-white opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <p className="line-clamp-2 text-[13px] leading-snug">{task.prompt}</p>
        <div className="pointer-events-auto flex flex-wrap gap-0.5">
          {actionList(item, actions).map(({ title, Icon, run }) => (
            <button
              key={title}
              type="button"
              title={title}
              aria-label={title}
              onClick={run}
              className="inline-flex size-8 items-center justify-center rounded-lg text-white/85 hover:bg-white/15 hover:text-white"
            >
              <Icon size={15} />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function Lightbox({ item, actions, onClose }: { item: Item; actions: Actions; onClose: () => void }) {
  const { task, file } = item
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', h)
    return () => removeEventListener('keydown', h)
  }, [onClose])
  const model = MEDIA_MODELS.find((m) => m.id === task.modelId)
  const fieldOf = (k: string) => model?.[task.variant]?.fields.find((f) => f.name === k) ?? ({ name: k, type: 'string', description: '' } as Field)
  const settings = Object.entries(task.input).filter(([, val]) => val !== null && typeof val !== 'object')
  const refs = Object.values(task.input).flatMap((val) => (Array.isArray(val) ? val.filter(isRef) : isRef(val) ? [val] : []))
  const took = task.completedAt ? Math.round((task.completedAt - task.createdAt) / 1000) : null

  return (
    <div className="absolute inset-0 z-40 flex bg-bg">
      <div className="drag absolute inset-x-0 top-0 h-12" />
      <div className="flex min-w-0 flex-1 items-center justify-center p-8 pt-14" onClick={onClose}>
        <div onClick={(e) => e.stopPropagation()} className={`flex max-h-full max-w-full ${isAudio(file) ? 'w-[min(520px,100%)] flex-col gap-4' : ''}`}>
          {isAudio(file) && task.meta?.tracks?.find((t) => t.file === file)?.cover && (
            <img src={mediaUrl({ kind: 'media', file: task.meta.tracks.find((t) => t.file === file)!.cover! })} alt="" className="aspect-square w-full rounded-xl object-cover shadow-2xl" />
          )}
          <Media file={file!} alt={task.prompt} controls className="max-h-[calc(100vh-7rem)] max-w-full rounded-xl object-contain shadow-2xl" />
        </div>
      </div>
      <aside className="relative flex w-80 shrink-0 flex-col gap-5 overflow-y-auto border-l border-line bg-side p-5 pt-14">
        <div className="flex items-center justify-between">
          <span className="font-medium">{task.label}</span>
          <IconButton title="Close (Esc)" onClick={onClose}>
            <X size={17} />
          </IconButton>
        </div>
        <p className="leading-relaxed select-text">{task.prompt || <span className="text-muted">No prompt</span>}</p>
        {refs.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {refs.map((r) => (
              <img key={r.file} src={mediaUrl(r)} alt="Reference" className="size-12 rounded-lg border border-line object-cover" />
            ))}
          </div>
        )}
        {settings.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {settings.map(([k, val]) => (
              <span key={k} className="rounded-full border border-line px-2.5 py-0.5 text-xs text-muted">
                {fieldOf(k).type === 'boolean' ? `${labelOf(fieldOf(k))}: ${val ? 'on' : 'off'}` : fmt(fieldOf(k), val)}
              </span>
            ))}
          </div>
        )}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
          <dt className="text-muted">Cost</dt>
          <dd className="tabular-nums">{task.credits != null ? `${fmtCredits(task.credits)} credits` : '—'}</dd>
          <dt className="text-muted">Took</dt>
          <dd className="tabular-nums">{took != null ? `${took} s` : '—'}</dd>
          <dt className="text-muted">Made</dt>
          <dd>{new Date(task.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</dd>
        </dl>
        <div className="flex flex-col gap-0.5">
          {actionList(item, actions).map(({ title, Icon, run }) => (
            <button key={title} type="button" onClick={run} className="flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-raised">
              <Icon size={15} className="shrink-0 text-muted" /> {title}
            </button>
          ))}
          <button type="button" onClick={() => api.reveal({ kind: 'media', file: file! })} className="flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-left hover:bg-raised">
            <Image size={15} className="text-muted" /> Show in Finder
          </button>
        </div>
      </aside>
    </div>
  )
}

function Empty({ kind, onPick }: { kind: MediaKind; onPick: (p: string) => void }) {
  return (
    <div className="flex w-full flex-col items-center gap-5 py-[14vh] text-center select-none">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-raised">
        {kind === 'video' ? <Clapperboard size={22} className="text-muted" /> : kind === 'audio' ? <Music size={22} className="text-muted" /> : <Image size={22} className="text-muted" />}
      </div>
      <div>
        <h2 className="text-lg font-semibold">{{ image: 'Make your first image', video: 'Make your first video', audio: 'Make your first song' }[kind]}</h2>
        <p className="mt-1 max-w-md text-muted">
          {kind === 'audio'
            ? 'Describe a song for Suno (2 versions per run), or pick an ElevenLabs voice to read your text aloud.'
            : kind === 'video'
            ? 'Describe a shot, or add a start frame. You can also press Animate on any image in the Image tab.'
            : 'Pick a model below, describe the shot and press Generate. Every result is saved on your Mac.'}
        </p>
      </div>
      <div className="flex max-w-2xl flex-wrap justify-center gap-2">
        {EXAMPLES[kind].map((e) => (
          <button key={e} type="button" onClick={() => onPick(e)} className="rounded-full border border-line px-3.5 py-1.5 text-[13px] text-muted hover:bg-raised hover:text-fg">
            {e}
          </button>
        ))}
      </div>
    </div>
  )
}
