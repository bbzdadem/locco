import { ArrowLeft, Check, Film, LoaderCircle, Plus, Trash2, Undo2, X } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Character, Episode, Series } from '../../shared/types'
import { Avatar, CharacterBuilder, CharacterLibrary } from './Characters'
import { EpisodeView } from './Episode'
import { api, errMsg } from './lib'
import { getSnapshot, loadAll, ready, type Run, saveChar, subscribe, type Tasks, updateSeries, voiceName } from './seriesStore'
import { Header, IconButton, SelectChip } from './ui'

type HeaderProps = { collapsed: boolean; onExpand: () => void }
const field = 'w-full rounded-lg border border-line bg-bg px-2.5 py-1.5 text-[13px] leading-relaxed focus:border-fg'

export function SeriesView({ header, onChanged, onOpenEdit }: { header: HeaderProps; onChanged: () => void; onOpenEdit: (id: string) => void }) {
  const { series: list, characters, runs } = useSyncExternalStore(subscribe, getSnapshot)
  const [tab, setTab] = useState<'series' | 'characters'>('series')
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
  const builder = charId && (
    <CharacterBuilder id={charId} tasks={tasks} usedIn={list.filter((s) => s.cast.includes(charId)).map((s) => s.title)} onClose={() => setCharId(null)} />
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
        <span className="font-medium">Series</span>
        <div className="absolute left-1/2 flex -translate-x-1/2 gap-1 rounded-full bg-raised p-1 text-sm">
          {(['series', 'characters'] as const).map((k) => (
            <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}
              className={`h-9 rounded-full px-6 font-medium transition-colors ${tab === k ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg'}`}>
              {k === 'series' ? 'Series' : `Characters${characters.length ? ` · ${characters.length}` : ''}`}
            </button>
          ))}
        </div>
      </Header>
      <div className="flex-1 overflow-y-auto">
        {tab === 'series' ? (
          <SeriesHome list={list} characters={characters} tasks={tasks} justDeleted={justDeleted} onUndone={() => setJustDeleted(null)}
            onOpen={(id) => (setJustDeleted(null), setOpenId(id))} onCharacter={setCharId} />
        ) : (
          <CharacterLibrary characters={characters} series={list} tasks={tasks} onOpen={setCharId} />
        )}
      </div>
      {builder}
    </div>
  )
}

async function newCharacter(then: (id: string) => void) {
  const c: Character = { id: crypto.randomUUID(), name: '', look: '', personality: '', createdAt: Date.now() }
  await saveChar(c)
  then(c.id)
}

function SeriesHome({ list, characters, tasks, justDeleted, onUndone, onOpen, onCharacter }: {
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [deleted, setDeleted] = useState<{ series: Series; deletedAt: number }[]>([])
  useEffect(() => void api.deletedSeries().then(setDeleted), [list])
  const restore = (id: string) => api.restoreSeries(id).then(loadAll).then(onUndone)
  async function write() {
    if (!idea.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const { series } = await api.writeSeries(idea.trim(), Number(episodes), Number(seconds), cast)
      await api.saveSeries(series)
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
      <div className="flex flex-col gap-3 rounded-3xl border border-line bg-surface p-4 shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
        <textarea id="series-idea" rows={3} value={idea} onChange={(e) => setIdea(e.target.value)}
          placeholder="Your series idea: who it's about, the world, the tone. Two baristas in Baku and an espresso machine that grants wishes, deadpan comedy."
          className="resize-none bg-transparent px-1 text-[15px] leading-relaxed placeholder:text-faint" />
        <div className="flex flex-col gap-1.5 px-1">
          <span className="text-xs text-muted">Cast from your Characters (optional; anyone else the story needs is created and saved to Characters)</span>
          <div className="flex flex-wrap gap-1.5">
            {characters.map((c) => {
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
      {list.length > 0 && (
        <div className="flex flex-col gap-1">
          <h2 className="mb-1 font-medium">Your series</h2>
          {list.map((s) => (
            <button key={s.id} type="button" onClick={() => onOpen(s.id)} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-raised">
              <span className="flex -space-x-2">{s.cast.slice(0, 4).map((id) => <Avatar key={id} c={characters.find((c) => c.id === id)} t={tasks} size="size-8" />)}</span>
              <span className="flex min-w-0 flex-col">
                <span className="font-medium">{s.title}</span>
                <span className="line-clamp-1 text-[13px] text-muted">{s.logline}</span>
                <span className="text-xs text-faint">{s.episodes.filter((e) => e.cut).length} of {s.episodes.length} episodes finished</span>
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
  const others = characters.filter((c) => !s.cast.includes(c.id))
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
          <input id="series-title" aria-label="Series title" value={s.title} onChange={(e) => set((x) => void (x.title = e.target.value))} className="bg-transparent text-xl font-semibold tracking-tight" />

          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted">Cast</span>
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
                <IconButton title="Remove from this series" className="hidden size-7 group-hover:inline-flex" onClick={() => set((x) => void (x.cast = x.cast.filter((id) => id !== c.id)))}><X size={13} /></IconButton>
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
                <Plus size={13} /> New character
              </button>
            </div>
          </div>

          <details open={!s.episodes.some((e) => e.scenes.length)}>
            <summary className="cursor-pointer text-xs text-muted select-none">Story bible</summary>
            <div className="mt-2 flex flex-col gap-3">
              <label className="flex flex-col gap-1"><span className="text-xs text-muted">Logline</span>
                <textarea rows={2} value={s.logline} onChange={(e) => set((x) => void (x.logline = e.target.value))} className={`${field} resize-none`} /></label>
              <label className="flex flex-col gap-1"><span className="text-xs text-muted">Look of every scene</span>
                <textarea rows={3} value={s.style} onChange={(e) => set((x) => void (x.style = e.target.value))} className={`${field} resize-none`} /></label>
              <label className="flex flex-col gap-1"><span className="text-xs text-muted">Continuity: what every episode must respect (updated after each finished episode)</span>
                <textarea rows={5} value={s.continuity} onChange={(e) => set((x) => void (x.continuity = e.target.value))} className={`${field} resize-none`} /></label>
            </div>
          </details>

          <div className="flex flex-col gap-0.5">
            <span className="mb-1 text-xs text-muted">Episodes</span>
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
                  {!running(e) && <IconButton title="Remove episode" className="hidden size-7 group-hover:inline-flex" onClick={() => removeEpisode(e)}><X size={14} /></IconButton>}
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
            <button type="button" onClick={() => set((x) => void x.episodes.push({ id: crypto.randomUUID(), title: `Episode ${x.episodes.length + 1}`, summary: '', step: 'script', scenes: [], music: true }))}
              className="inline-flex h-8 w-fit items-center gap-1.5 rounded-full px-2.5 text-[13px] text-muted hover:bg-raised hover:text-fg">
              <Plus size={14} /> Episode
            </button>
          </div>

          <div className="mt-auto flex items-center gap-2 border-t border-line pt-3 text-[13px]">
            {confirmDelete ? (
              <>
                <span>Delete this series? You can restore it from Series for 30 days. Characters stay saved.</span>
                <button type="button" onClick={() => api.deleteSeries(s.id).then(loadAll).then(onDeleted)} className="h-8 shrink-0 rounded-full bg-inverse px-3 font-medium text-on-inverse">Delete</button>
                <button type="button" onClick={() => setConfirmDelete(false)} className="h-8 shrink-0 rounded-full px-3 hover:bg-raised">Keep</button>
              </>
            ) : (
              <IconButton title="Delete series" onClick={() => setConfirmDelete(true)}><Trash2 size={15} /></IconButton>
            )}
          </div>
        </aside>
        {ep ? (
          <EpisodeView key={ep.id} s={s} ep={ep} index={s.episodes.indexOf(ep)} tasks={tasks} cast={cast} run={runs[`${s.id}:${ep.id}`]} onCharacter={onCharacter} onOpenEdit={onOpenEdit} />
        ) : (
          <div className="flex-1" />
        )}
      </div>
    </div>
  )
}
