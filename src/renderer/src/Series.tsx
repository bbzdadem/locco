import { ArrowLeft, Check, Film, ImagePlus, LoaderCircle, Megaphone, Plus, Trash2, Undo2, X } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Attachment, Character, Episode, Series } from '../../shared/types'
import { Avatar, CharacterBuilder, CharacterLibrary } from './Characters'
import { EpisodeView } from './Episode'
import { ACCEPT_IMAGES, api, errMsg, mediaUrl, toAttachments } from './lib'
import { fileOf, getSnapshot, loadAll, ready, type Run, saveChar, STYLE_PRESETS, subscribe, type Tasks, updateSeries, voiceName } from './seriesStore'
import { Header, IconButton, SelectChip } from './ui'

type HeaderProps = { collapsed: boolean; onExpand: () => void }
const field = 'w-full rounded-lg border border-line bg-bg px-2.5 py-1.5 text-[13px] leading-relaxed focus:border-fg'

// Series and Ads share this screen: ads are series of kind 'ad' (a product, its brief, and its ads as episodes).
export function SeriesView({ header, onChanged, onOpenEdit, ads = false }: { header: HeaderProps; onChanged: () => void; onOpenEdit: (id: string) => void; ads?: boolean }) {
  const { series: all, characters, runs } = useSyncExternalStore(subscribe, getSnapshot)
  const list = all.filter((s) => (s.kind === 'ad') === ads)
  const [tab, setTab] = useState<'series' | 'characters' | 'elements'>('series')
  const [openId, setOpenId] = useState<string | null>(null)
  const [charId, setCharId] = useState<string | null>(null)
  const [justDeleted, setJustDeleted] = useState<Series | null>(null)
  const [tasks, setTasks] = useState<Tasks>({})
  useEffect(() => {
    void loadAll()
    const refresh = () => void api.tasks().then((all) => setTasks(Object.fromEntries(all.map((t) => [t.id, t]))))
    refresh()
    return api.onTasks(() => (refresh(), onChanged()))
  }, [onChanged])
  const open = list.find((s) => s.id === openId)
  const people = characters.filter((c) => !c.kind)
  const things = characters.filter((c) => c.kind === 'element')
  const builder = charId && (
    <CharacterBuilder id={charId} tasks={tasks} usedIn={all.filter((s) => s.cast.includes(charId) || s.elements?.includes(charId)).map((s) => s.title)} onClose={() => setCharId(null)} />
  )

  if (open)
    return (
      <>
        <SeriesEditor header={header} s={open} characters={characters} tasks={tasks} runs={runs} onBack={() => setOpenId(null)}
          onDeleted={() => (setJustDeleted(open), setOpenId(null))} onCharacter={setCharId} onOpenEdit={onOpenEdit} />
        {builder}
      </>
    )
  return (
    <div className="flex h-full flex-col">
      <Header {...header}>
        <span className="font-medium">{ads ? 'Ads' : 'Series'}</span>
        <div className="absolute left-1/2 flex -translate-x-1/2 gap-1 rounded-full bg-raised p-1 text-sm">
          {(['series', 'characters', 'elements'] as const).map((k) => (
            <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}
              className={`h-9 rounded-full px-6 font-medium transition-colors ${tab === k ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg'}`}>
              {k === 'series' ? (ads ? 'Products' : 'Series') : k === 'characters' ? `Characters${people.length ? ` · ${people.length}` : ''}` : `Elements${things.length ? ` · ${things.length}` : ''}`}
            </button>
          ))}
        </div>
      </Header>
      <div className="flex-1 overflow-y-auto">
        {tab === 'series' ? (
          <SeriesHome ads={ads} list={list} characters={characters} tasks={tasks} justDeleted={justDeleted} onUndone={() => setJustDeleted(null)}
            onOpen={(id) => (setJustDeleted(null), setOpenId(id))} onCharacter={setCharId} />
        ) : tab === 'characters' ? (
          <CharacterLibrary characters={people} series={all} tasks={tasks} onOpen={setCharId} />
        ) : (
          <CharacterLibrary elements characters={things} series={all} tasks={tasks} onOpen={setCharId} />
        )}
      </div>
      {builder}
    </div>
  )
}

async function newCharacter(then: (id: string) => void, element = false) {
  const c: Character = { id: crypto.randomUUID(), name: '', look: '', personality: '', createdAt: Date.now(), ...(element && { kind: 'element' as const, category: 'place' as const }) }
  await saveChar(c)
  then(c.id)
}

function SeriesHome({ ads, list, characters, tasks, justDeleted, onUndone, onOpen, onCharacter }: {
  ads: boolean
  list: Series[]
  characters: Character[]
  tasks: Tasks
  justDeleted: Series | null
  onUndone: () => void
  onOpen: (id: string) => void
  onCharacter: (id: string) => void
}) {
  const [idea, setIdea] = useState('')
  const [episodes, setEpisodes] = useState('3')
  const [seconds, setSeconds] = useState('45')
  const [cast, setCast] = useState<string[]>([])
  const [elementIds, setElementIds] = useState<string[]>([])
  const [preset, setPreset] = useState<string>()
  const [styleRefs, setStyleRefs] = useState<Attachment[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [deleted, setDeleted] = useState<{ series: Series; deletedAt: number }[]>([])
  useEffect(() => void api.deletedSeries().then((d) => setDeleted(d.filter((x) => (x.series.kind === 'ad') === ads))), [list, ads])
  const restore = (id: string) => api.restoreSeries(id).then(loadAll).then(onUndone)
  async function write() {
    if (!idea.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const { series } = await api.writeSeries(idea.trim(), Number(episodes), Number(seconds), cast, { text: STYLE_PRESETS.find((x) => x.id === preset)?.text, refs: styleRefs }, elementIds)
      await api.saveSeries({ ...series, stylePreset: preset })
      await loadAll()
      onOpen(series.id)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 pt-6 pb-16">
      {justDeleted && (
        <div className="flex items-center gap-3 rounded-xl bg-raised px-4 py-2.5 text-[13px]">
          <span className="min-w-0 flex-1 truncate">Deleted “{justDeleted.title}”.</span>
          <button type="button" onClick={() => restore(justDeleted.id)} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-inverse px-3.5 font-medium text-on-inverse"><Undo2 size={14} /> Undo</button>
          <IconButton title="Dismiss" className="size-7" onClick={onUndone}><X size={14} /></IconButton>
        </div>
      )}
      {ads ? <AdsForm characters={characters} tasks={tasks} onOpen={onOpen} onCharacter={onCharacter} /> : (
      <div className="flex flex-col gap-3 rounded-3xl border border-line bg-surface p-4 shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
        <textarea id="series-idea" rows={3} value={idea} onChange={(e) => setIdea(e.target.value)}
          placeholder="Your series idea: who it's about, the world, the tone. Two baristas in Baku and an espresso machine that grants wishes, deadpan comedy."
          className="resize-none bg-transparent px-1 text-[15px] leading-relaxed placeholder:text-faint" />
        <div className="flex flex-col gap-1.5 px-1">
          <span className="text-xs text-muted">Cast from your Characters (optional; anyone else the story needs is created and saved to Characters)</span>
          <div className="flex flex-wrap gap-1.5">
            {characters.filter((c) => !c.kind).map((c) => {
              const on = cast.includes(c.id)
              return (
                <button key={c.id} type="button" aria-pressed={on} onClick={() => setCast(on ? cast.filter((x) => x !== c.id) : [...cast, c.id])}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-full border pr-3 pl-1 text-[13px] ${on ? 'border-fg bg-raised' : 'border-line text-muted hover:bg-raised'}`}>
                  <Avatar c={c} t={tasks} size="size-6" /> {c.name || 'Unnamed'} {on && <Check size={12} />}
                </button>
              )
            })}
            <button type="button" onClick={() => newCharacter((id) => (setCast((x) => [...x, id]), onCharacter(id)))}
              className="inline-flex h-8 items-center gap-1 rounded-full border border-dashed border-line px-3 text-[13px] text-muted hover:text-fg">
              <Plus size={13} /> New character
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-1.5 px-1">
          <span className="text-xs text-muted">Elements: recurring places and things (optional; the writer adds up to 3 the story needs, saved to Elements)</span>
          <div className="flex flex-wrap gap-1.5">
            {characters.filter((c) => c.kind === 'element').map((c) => {
              const on = elementIds.includes(c.id)
              return (
                <button key={c.id} type="button" aria-pressed={on} onClick={() => setElementIds(on ? elementIds.filter((x) => x !== c.id) : [...elementIds, c.id])}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-full border pr-3 pl-1 text-[13px] ${on ? 'border-fg bg-raised' : 'border-line text-muted hover:bg-raised'}`}>
                  <Avatar c={c} t={tasks} size="size-6" /> {c.name || 'Unnamed'} {on && <Check size={12} />}
                </button>
              )
            })}
            <button type="button" onClick={() => newCharacter((id) => (setElementIds((x) => [...x, id]), onCharacter(id)), true)}
              className="inline-flex h-8 items-center gap-1 rounded-full border border-dashed border-line px-3 text-[13px] text-muted hover:text-fg">
              <Plus size={13} /> New element
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-1.5 px-1">
          <span className="text-xs text-muted">Style (optional): pick a look, add up to 3 images to match, or both</span>
          <StylePicker preset={preset} refs={styleRefs} onPreset={setPreset} onRefs={setStyleRefs} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <SelectChip title="Episodes" label={`${episodes} episodes`} value={episodes} onChange={setEpisodes} options={['3', '5', '8', '10'].map((n) => ({ value: n, label: `${n} episodes` }))} />
          <SelectChip title="Episode length" label={`${seconds} s each`} value={seconds} onChange={setSeconds} options={['30', '45', '60'].map((n) => ({ value: n, label: `${n} seconds` }))} />
          <span className="text-xs text-faint">9:16 vertical</span>
          <button type="button" disabled={!idea.trim() || busy} onClick={write} className="ml-auto inline-flex h-9 items-center gap-2 rounded-full bg-inverse px-4 font-medium text-on-inverse disabled:opacity-35">
            {busy ? <LoaderCircle size={15} className="animate-spin" /> : <Film size={15} />} {busy ? 'Writing…' : 'Write the story bible'}
          </button>
        </div>
        <p className="px-1 text-xs text-faint">GPT 6 Sol writes the premise, the look, the rules of the world and the episode list (a few cents). Each episode then goes step by step, and you approve the script and the scenes before any video is made.</p>
        {error && <p className="px-1 text-[13px] text-danger">{error}</p>}
      </div>
      )}
      {list.length > 0 && (
        <div className="flex flex-col gap-1">
          <h2 className="mb-1 font-medium">{ads ? 'Your products' : 'Your series'}</h2>
          {list.map((s) => (
            <button key={s.id} type="button" onClick={() => onOpen(s.id)} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-raised">
              <span className="flex -space-x-2">{(ads ? [s.product ?? ''] : s.cast.slice(0, 4)).map((id) => <Avatar key={id} c={characters.find((c) => c.id === id)} t={tasks} size="size-8" />)}</span>
              <span className="flex min-w-0 flex-col">
                <span className="font-medium">{s.title}</span>
                <span className="line-clamp-1 text-[13px] text-muted">{s.logline}</span>
                <span className="text-xs text-faint">{s.episodes.filter((e) => e.cut).length} of {s.episodes.length} {ads ? 'ads' : 'episodes'} finished</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {deleted.length > 0 && (
        <div className="flex flex-col gap-1">
          <h2 className="mb-1 font-medium text-muted">Recently deleted</h2>
          {deleted.map(({ series: d, deletedAt }) => (
            <div key={d.id} className="flex items-center gap-3 rounded-xl px-3 py-2">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-muted">{d.title}</span>
                <span className="text-xs text-faint">
                  Deleted {new Date(deletedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · removed for good after {Math.max(1, 30 - Math.floor((Date.now() - deletedAt) / 86_400_000))} days
                </span>
              </div>
              <button type="button" onClick={() => restore(d.id)} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-line px-3 text-[13px] hover:bg-raised"><Undo2 size={14} /> Restore</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// A product's ads start here: its photo and what it is. The writer turns that into the product (an element made from the
// photo), the brief, the people and places the ads need, and the ads to make; then the product opens so you can check it.
function AdsForm({ characters, tasks, onOpen, onCharacter }: { characters: Character[]; tasks: Tasks; onOpen: (id: string) => void; onCharacter: (id: string) => void }) {
  const [description, setDescription] = useState('')
  const [photos, setPhotos] = useState<Attachment[]>([])
  const [ads, setAds] = useState('3')
  const [seconds, setSeconds] = useState('15')
  const [cast, setCast] = useState<string[]>([])
  const [elementIds, setElementIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const picker = useRef<HTMLInputElement>(null)
  // Up to 4 photos: the first is the main one; the others show the back, the label, the box.
  const addPhotos = async (files: FileList | File[]) => {
    const added = await toAttachments(files, ACCEPT_IMAGES)
    const all = [...photos, ...added.filter((a) => !photos.some((p) => p.file === a.file))]
    setError(!added.length ? 'Product photos must be PNG, JPG or WebP.' : all.length > 4 ? 'Up to 4 photos; the first 4 are kept.' : '')
    setPhotos(all.slice(0, 4))
  }
  async function write() {
    if (!description.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const { series } = await api.writeAds({ description: description.trim(), photos }, Number(ads), Number(seconds), cast, elementIds)
      await api.saveSeries(series)
      await loadAll()
      onOpen(series.id)
      if (series.product) onCharacter(series.product)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }
  const chips = (kind: 'people' | 'places', on: string[], setOn: (ids: string[]) => void) => (
    <div className="flex flex-wrap gap-1.5">
      {characters.filter((c) => (kind === 'people' ? !c.kind : c.kind === 'element' && c.category !== 'product')).map((c) => {
        const picked = on.includes(c.id)
        return (
          <button key={c.id} type="button" aria-pressed={picked} onClick={() => setOn(picked ? on.filter((x) => x !== c.id) : [...on, c.id])}
            className={`inline-flex h-8 items-center gap-1.5 rounded-full border pr-3 pl-1 text-[13px] ${picked ? 'border-fg bg-raised' : 'border-line text-muted hover:bg-raised'}`}>
            <Avatar c={c} t={tasks} size="size-6" /> {c.name || 'Unnamed'} {picked && <Check size={12} />}
          </button>
        )
      })}
      <button type="button" onClick={() => newCharacter((id) => (setOn([...on, id]), onCharacter(id)), kind === 'places')}
        className="inline-flex h-8 items-center gap-1 rounded-full border border-dashed border-line px-3 text-[13px] text-muted hover:text-fg">
        <Plus size={13} /> {kind === 'people' ? 'New person' : 'New place'}
      </button>
    </div>
  )
  return (
    <div className="flex flex-col gap-3 rounded-3xl border border-line bg-surface p-4 shadow-[0_2px_12px_rgba(0,0,0,0.04)]"
      onDragOver={(e) => e.preventDefault()} onDrop={(e) => (e.preventDefault(), void addPhotos(e.dataTransfer.files))}>
      <div className="flex gap-3">
        <div className="flex w-28 shrink-0 flex-col items-center gap-1">
          <button type="button" onClick={() => picker.current?.click()} title="Product photos (up to 4): every shot is drawn from them"
            className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl border border-dashed border-line text-muted hover:border-fg hover:text-fg">
            {photos[0] ? <img src={mediaUrl(photos[0])} alt="Main product photo" className="size-full object-cover" /> : <ImagePlus size={20} />}
          </button>
          {photos.length > 0 && (
            <div className="flex flex-wrap justify-center gap-1">
              {photos.slice(1).map((p, i) => (
                <button key={p.file} type="button" title="Remove this photo" onClick={() => setPhotos(photos.filter((x) => x.file !== p.file))}
                  className="group relative size-7 overflow-hidden rounded-md border border-line">
                  <img src={mediaUrl(p)} alt={`Product photo ${i + 2}`} className="size-full object-cover" />
                  <span className="absolute inset-0 hidden items-center justify-center bg-black/50 text-white group-hover:flex"><X size={11} /></span>
                </button>
              ))}
              {photos.length < 4 && (
                <button type="button" title="Add another photo: the back, the label, the box" onClick={() => picker.current?.click()}
                  className="flex size-7 items-center justify-center rounded-md border border-dashed border-line text-muted hover:border-fg hover:text-fg"><Plus size={12} /></button>
              )}
            </div>
          )}
          <span className="text-center text-[11px] text-faint">
            {photos.length ? <button type="button" className="underline" onClick={() => setPhotos(photos.slice(1))}>Remove main</button> : 'Product photos (up to 4)'}
          </span>
          <input ref={picker} type="file" multiple accept={ACCEPT_IMAGES} hidden onChange={(e) => (e.target.files && void addPhotos(e.target.files), (e.target.value = ''))} />
        </div>
        <textarea id="ads-product" rows={5} value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="The product: what it is, what it does, who it's for, the price or offer. A rechargeable mini blender, blends a smoothie in 30 seconds, fits a bag, $29 with free shipping. For gym-goers and busy parents."
          className="min-w-0 flex-1 resize-none bg-transparent px-1 text-[15px] leading-relaxed placeholder:text-faint" />
      </div>
      <div className="flex flex-col gap-1.5 px-1">
        <span className="text-xs text-muted">People from your Characters (optional; the writer adds a presenter or someone reacting if the ads need one)</span>
        {chips('people', cast, setCast)}
      </div>
      <div className="flex flex-col gap-1.5 px-1">
        <span className="text-xs text-muted">Places and props from your Elements (optional: the kitchen, the car)</span>
        {chips('places', elementIds, setElementIds)}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <SelectChip title="Ads" label={`${ads} ads`} value={ads} onChange={setAds} options={['3', '5', '8'].map((n) => ({ value: n, label: `${n} ads` }))} />
        <SelectChip title="Ad length" label={`${seconds} s each`} value={seconds} onChange={setSeconds} options={['15', '20', '30'].map((n) => ({ value: n, label: `${n} seconds` }))} />
        <span className="text-xs text-faint">9:16 · 3 hooks per ad</span>
        <button type="button" disabled={!description.trim() || busy} onClick={write} className="ml-auto inline-flex h-9 items-center gap-2 rounded-full bg-inverse px-4 font-medium text-on-inverse disabled:opacity-35">
          {busy ? <LoaderCircle size={15} className="animate-spin" /> : <Megaphone size={15} />} {busy ? 'Writing…' : 'Write the product brief'}
        </button>
      </div>
      <p className="px-1 text-xs text-faint">
        GPT 6 Sol reads the photo and the description and writes the brief (buyer, problem, the moment it works, what not to claim) and a plan of ads, each in a
        different format: problem → fix, unboxing, before / after, reaction, satisfying and more. Each ad gets three hooks and is made as one video per hook, so you can see which one holds viewers.
      </p>
      {error && <p className="px-1 text-[13px] text-danger">{error}</p>}
    </div>
  )
}

function SeriesEditor({ header, s, characters, tasks, runs, onBack, onDeleted, onCharacter, onOpenEdit }: {
  header: HeaderProps
  s: Series
  characters: Character[]
  tasks: Tasks
  runs: Record<string, Run>
  onBack: () => void
  onDeleted: () => void
  onCharacter: (id: string) => void
  onOpenEdit: (id: string) => void
}) {
  const [epId, setEpId] = useState(s.episodes[0]?.id)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmEp, setConfirmEp] = useState<string | null>(null)
  const [removed, setRemoved] = useState<{ episode: Episode; index: number } | null>(null)
  const ep = s.episodes.find((e) => e.id === epId) ?? s.episodes[0]
  const cast = s.cast.map((id) => characters.find((c) => c.id === id)).filter((c): c is Character => !!c)
  const others = characters.filter((c) => !c.kind && !s.cast.includes(c.id))
  const ad = s.kind === 'ad'
  // things: every element of the series (an ad set's product included; scenes draw from them). elements: the ones listed.
  const things = (s.elements ?? []).map((id) => characters.find((c) => c.id === id)).filter((c): c is Character => !!c)
  const elements = things.filter((c) => c.id !== s.product)
  const product = things.find((c) => c.id === s.product)
  const otherElements = characters.filter((c) => c.kind === 'element' && !(s.elements ?? []).includes(c.id))
  const word = ad ? 'ad' : 'episode'
  const set = (fn: (x: Series) => void) => void updateSeries(s.id, fn)
  const running = (e: Episode) => !!runs[`${s.id}:${e.id}`]?.step

  // An episode with scenes asks first; an empty one goes straight away. Either way Undo brings it back.
  function removeEpisode(e: Episode) {
    if (e.scenes.length && confirmEp !== e.id) return setConfirmEp(e.id)
    const index = s.episodes.findIndex((x) => x.id === e.id)
    setConfirmEp(null)
    setRemoved({ episode: e, index })
    if (e.id === ep?.id) setEpId(s.episodes[index + 1]?.id ?? s.episodes[index - 1]?.id)
    set((x) => void (x.episodes = x.episodes.filter((y) => y.id !== e.id)))
  }

  return (
    <div className="flex h-full flex-col">
      <Header {...header}>
        <IconButton title="All series" onClick={onBack}><ArrowLeft size={16} /></IconButton>
        <span className="truncate font-medium">{s.title}</span>
      </Header>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-80 shrink-0 flex-col gap-5 overflow-y-auto border-r border-line px-4 pt-1 pb-8">
          <input id="series-title" aria-label={ad ? 'Product name' : 'Series title'} value={s.title} onChange={(e) => set((x) => void (x.title = e.target.value))} className="bg-transparent text-xl font-semibold tracking-tight" />

          {product && (
            <div className="flex flex-col gap-2">
              <span className="text-xs text-muted">Product</span>
              <button type="button" onClick={() => onCharacter(product.id)} className="flex items-center gap-2.5 rounded-lg py-0.5 pr-2 text-left hover:bg-raised">
                <Avatar c={product} t={tasks} size="size-12" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[13px] font-medium">{product.name}</span>
                  <span className={`text-xs ${ready(tasks, product) ? 'text-muted' : 'text-danger'}`}>
                    {fileOf(tasks, product.sheetTask) ? 'Image and angles ready' : fileOf(tasks, product.portraitTask) ? 'Add more angles for steadier shots'
                      : product.photo ? 'Drawn from your photo; a clean image and angles keep it steadier' : 'Pick an image'}
                  </span>
                </span>
              </button>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted">{ad ? 'People' : 'Cast'}</span>
            {cast.map((c) => (
              <div key={c.id} className="group flex items-center gap-1">
                <button type="button" onClick={() => onCharacter(c.id)} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-0.5 pr-2 text-left hover:bg-raised">
                  <Avatar c={c} t={tasks} size="size-9" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px] font-medium">{c.name || 'Unnamed'}</span>
                    <span className={`truncate text-xs ${ready(tasks, c) ? 'text-muted' : 'text-danger'}`}>
                      {ready(tasks, c) ? (voiceName(c.voice) ? `Voice: ${voiceName(c.voice)}` : 'No voice yet') : 'Pick a portrait'}
                    </span>
                  </span>
                </button>
                <IconButton title={`Remove from ${ad ? 'these ads' : 'this series'}`} className="hidden size-7 group-hover:inline-flex" onClick={() => set((x) => void (x.cast = x.cast.filter((id) => id !== c.id)))}><X size={13} /></IconButton>
              </div>
            ))}
            <div className="flex flex-wrap gap-1.5">
              {others.length > 0 && (
                <SelectChip title="Add from Characters" label={<><Plus size={13} /> From Characters</>} value="" muted
                  onChange={(id) => id && set((x) => void x.cast.push(id))}
                  options={[{ value: '', label: 'Add a saved character' }, ...others.map((c) => ({ value: c.id, label: c.name || 'Unnamed' }))]} />
              )}
              <button type="button" onClick={() => newCharacter((id) => (set((x) => void x.cast.push(id)), onCharacter(id)))}
                className="inline-flex h-8 items-center gap-1 rounded-full border border-dashed border-line px-3 text-[13px] text-muted hover:text-fg">
                <Plus size={13} /> {ad ? 'New person' : 'New character'}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted">{ad ? 'Places and props' : 'Elements'}</span>
            {elements.map((c) => (
              <div key={c.id} className="group flex items-center gap-1">
                <button type="button" onClick={() => onCharacter(c.id)} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-0.5 pr-2 text-left hover:bg-raised">
                  <Avatar c={c} t={tasks} size="size-9" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px] font-medium">{c.name || 'Unnamed'}</span>
                    <span className={`truncate text-xs ${ready(tasks, c) ? 'text-muted' : 'text-danger'}`}>{ready(tasks, c) ? (c.category ?? 'other').replace(/^./, (x) => x.toUpperCase()) : 'Pick an image'}</span>
                  </span>
                </button>
                <IconButton title={`Remove from ${ad ? 'these ads' : 'this series'}`} className="hidden size-7 group-hover:inline-flex" onClick={() => set((x) => void (x.elements = (x.elements ?? []).filter((id) => id !== c.id)))}><X size={13} /></IconButton>
              </div>
            ))}
            <div className="flex flex-wrap gap-1.5">
              {otherElements.length > 0 && (
                <SelectChip title="Add from Elements" label={<><Plus size={13} /> From Elements</>} value="" muted
                  onChange={(id) => id && set((x) => void (x.elements = [...(x.elements ?? []), id]))}
                  options={[{ value: '', label: 'Add a saved element' }, ...otherElements.map((c) => ({ value: c.id, label: c.name || 'Unnamed' }))]} />
              )}
              <button type="button" onClick={() => newCharacter((id) => (set((x) => void (x.elements = [...(x.elements ?? []), id])), onCharacter(id)), true)}
                className="inline-flex h-8 items-center gap-1 rounded-full border border-dashed border-line px-3 text-[13px] text-muted hover:text-fg">
                <Plus size={13} /> New element
              </button>
            </div>
            {!elements.length && <span className="text-xs text-faint">Places and things that should look the same in every {ad ? 'shot' : 'scene'} that names them.</span>}
          </div>

          <details open={!s.episodes.some((e) => e.scenes.length)}>
            <summary className="cursor-pointer text-xs text-muted select-none">{ad ? 'Product brief' : 'Story bible'}</summary>
            {ad ? (
              <div className="mt-2 flex flex-col gap-3">
                <label className="flex flex-col gap-1"><span className="text-xs text-muted">Angle: who it's for and what it does for them</span>
                  <textarea rows={2} value={s.logline} onChange={(e) => set((x) => void (x.logline = e.target.value))} className={`${field} resize-none`} /></label>
                <label className="flex flex-col gap-1"><span className="text-xs text-muted">Brief: the facts every ad respects (buyer, problem, what we show, what we never claim)</span>
                  <textarea rows={8} value={s.continuity} onChange={(e) => set((x) => void (x.continuity = e.target.value))} className={`${field} resize-y`} /></label>
                <label className="flex flex-col gap-1"><span className="text-xs text-muted">Look of every shot</span>
                  <textarea rows={3} value={s.style} onChange={(e) => set((x) => void (x.style = e.target.value))} className={`${field} resize-none`} /></label>
              </div>
            ) : (
            <div className="mt-2 flex flex-col gap-3">
              <label className="flex flex-col gap-1"><span className="text-xs text-muted">Logline</span>
                <textarea rows={2} value={s.logline} onChange={(e) => set((x) => void (x.logline = e.target.value))} className={`${field} resize-none`} /></label>
              <div className="flex flex-col gap-1.5"><span className="text-xs text-muted">Style (applies to scenes drawn from now on)</span>
                <StylePicker preset={s.stylePreset} refs={s.styleRefs ?? []} compact
                  onPreset={(id) => set((x) => {
                    x.stylePreset = id
                    const p = STYLE_PRESETS.find((y) => y.id === id)
                    if (p) x.style = p.text
                  })}
                  onRefs={(r) => set((x) => void (x.styleRefs = r))} />
              </div>
              <label className="flex flex-col gap-1"><span className="text-xs text-muted">Look of every scene</span>
                <textarea rows={3} value={s.style} onChange={(e) => set((x) => void (x.style = e.target.value))} className={`${field} resize-none`} /></label>
              <label className="flex flex-col gap-1"><span className="text-xs text-muted">Continuity: what every episode must respect (updated after each finished episode)</span>
                <textarea rows={5} value={s.continuity} onChange={(e) => set((x) => void (x.continuity = e.target.value))} className={`${field} resize-none`} /></label>
            </div>
            )}
          </details>

          <div className="flex flex-col gap-0.5">
            <span className="mb-1 text-xs text-muted">{ad ? 'Ads' : 'Episodes'}</span>
            {s.episodes.map((e, i) =>
              confirmEp === e.id ? (
                <div key={e.id} className="flex items-center gap-2 rounded-lg bg-raised px-2.5 py-1.5 text-[13px]">
                  <span className="min-w-0 flex-1">Remove “{e.title || 'Untitled'}”? Its images and videos stay in Create.</span>
                  <button type="button" onClick={() => removeEpisode(e)} className="h-7 shrink-0 rounded-full bg-inverse px-3 font-medium text-on-inverse">Remove</button>
                  <IconButton title="Keep" className="size-7" onClick={() => setConfirmEp(null)}><X size={14} /></IconButton>
                </div>
              ) : (
                <div key={e.id} className={`group flex items-center rounded-lg pr-1 ${e.id === ep?.id ? 'bg-raised' : 'hover:bg-raised'}`}>
                  <button type="button" onClick={() => setEpId(e.id)} className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-left text-[13px]">
                    <span className="text-faint tabular-nums">{i + 1}</span>
                    <span className="truncate">{e.title || 'Untitled'}</span>
                    <span className="ml-auto shrink-0 text-[11px] text-faint">
                      {running(e) ? <LoaderCircle size={13} className="animate-spin" /> : e.cut ? <Film size={13} /> : e.step !== 'script' ? e.step : ''}
                    </span>
                  </button>
                  {!running(e) && <IconButton title={`Remove ${word}`} className="hidden size-7 group-hover:inline-flex" onClick={() => removeEpisode(e)}><X size={14} /></IconButton>}
                </div>
              ),
            )}
            {removed && (
              <div className="flex items-center gap-2 px-2.5 py-1 text-[13px] text-muted">
                <span className="min-w-0 flex-1 truncate">Removed “{removed.episode.title || 'Untitled'}”.</span>
                <button type="button" className="shrink-0 font-medium text-fg underline underline-offset-2"
                  onClick={() => (set((x) => void x.episodes.splice(Math.min(removed.index, x.episodes.length), 0, removed.episode)), setEpId(removed.episode.id), setRemoved(null))}>
                  Undo
                </button>
              </div>
            )}
            <button type="button" onClick={() => set((x) => void x.episodes.push({ id: crypto.randomUUID(), title: `${ad ? 'Ad' : 'Episode'} ${x.episodes.length + 1}`, summary: '', step: 'script', scenes: [], music: !ad }))}
              className="inline-flex h-8 w-fit items-center gap-1.5 rounded-full px-2.5 text-[13px] text-muted hover:bg-raised hover:text-fg">
              <Plus size={14} /> {ad ? 'Ad' : 'Episode'}
            </button>
          </div>

          <div className="mt-auto flex items-center gap-2 border-t border-line pt-3 text-[13px]">
            {confirmDelete ? (
              <>
                <span>{ad ? 'Delete these ads? You can restore them from Ads for 30 days. The product, people and places stay saved.' : 'Delete this series? You can restore it from Series for 30 days. Characters stay saved.'}</span>
                <button type="button" onClick={() => api.deleteSeries(s.id).then(loadAll).then(onDeleted)} className="h-8 shrink-0 rounded-full bg-inverse px-3 font-medium text-on-inverse">Delete</button>
                <button type="button" onClick={() => setConfirmDelete(false)} className="h-8 shrink-0 rounded-full px-3 hover:bg-raised">Keep</button>
              </>
            ) : (
              <IconButton title={ad ? 'Delete these ads' : 'Delete series'} onClick={() => setConfirmDelete(true)}><Trash2 size={15} /></IconButton>
            )}
          </div>
        </aside>
        {ep ? (
          <EpisodeView key={ep.id} s={s} ep={ep} index={s.episodes.indexOf(ep)} tasks={tasks} cast={cast} things={things} run={runs[`${s.id}:${ep.id}`]} onCharacter={onCharacter} onOpenEdit={onOpenEdit} />
        ) : (
          <div className="flex-1" />
        )}
      </div>
    </div>
  )
}

// A look to start from and up to 3 style images (click to add, or drop them here). Scenes are drawn to match both.
function StylePicker({ preset, refs, onPreset, onRefs, compact }: {
  preset?: string
  refs: Attachment[]
  onPreset: (id?: string) => void
  onRefs: (r: Attachment[]) => void
  compact?: boolean
}) {
  const picker = useRef<HTMLInputElement>(null)
  const [note, setNote] = useState('')
  async function add(files: FileList | File[]) {
    const added = await toAttachments(files, ACCEPT_IMAGES)
    if (!added.length) return setNote('Style images must be PNG, JPG or WebP.')
    const next = [...refs, ...added.filter((a) => !refs.some((r) => r.file === a.file))]
    setNote(next.length > 3 ? 'Up to 3 style images; the first 3 are kept.' : '')
    onRefs(next.slice(0, 3))
  }
  const chip = (on: boolean) => `h-7 rounded-full border px-2.5 text-xs ${on ? 'border-fg bg-raised text-fg' : 'border-line text-muted hover:bg-raised hover:text-fg'}`
  return (
    <div className="flex flex-col gap-2" onDragOver={(e) => e.preventDefault()} onDrop={(e) => (e.preventDefault(), void add(e.dataTransfer.files))}>
      <div className="flex flex-wrap gap-1">
        {STYLE_PRESETS.map((p) => (
          <button key={p.id} type="button" title={p.text} aria-pressed={preset === p.id} onClick={() => onPreset(preset === p.id ? undefined : p.id)} className={chip(preset === p.id)}>
            {p.name}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        {refs.map((r) => (
          <div key={r.file} className="group relative">
            <img src={mediaUrl(r)} alt="Style reference" className={`${compact ? 'size-12' : 'size-14'} rounded-lg border border-line object-cover`} />
            <button type="button" aria-label="Remove style image" onClick={() => onRefs(refs.filter((x) => x.file !== r.file))}
              className="absolute -top-1.5 -right-1.5 hidden size-5 items-center justify-center rounded-full bg-inverse text-on-inverse group-hover:flex">
              <X size={11} />
            </button>
          </div>
        ))}
        {refs.length < 3 && (
          <button type="button" onClick={() => picker.current?.click()} title="Add style images (up to 3), or drop them here"
            className={`${compact ? 'size-12' : 'size-14'} flex shrink-0 items-center justify-center rounded-lg border border-dashed border-line text-muted hover:border-fg hover:text-fg`}>
            <ImagePlus size={16} />
          </button>
        )}
        <span className="text-xs text-faint">{note || (refs.length ? `${refs.length} of 3 style images. Every scene matches their look.` : 'Style images: up to 3, every scene matches their look.')}</span>
        <input ref={picker} type="file" multiple accept={ACCEPT_IMAGES} hidden onChange={(e) => (e.target.files && void add(e.target.files), (e.target.value = ''))} />
      </div>
    </div>
  )
}
