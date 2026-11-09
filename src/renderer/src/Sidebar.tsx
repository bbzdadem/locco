import { Check, Film, Folder, Megaphone, Scissors, FolderInput, FolderPlus, Image, PanelLeftClose, Pencil, Pin, PinOff, Search, Settings, SquarePen, Trash2, TriangleAlert, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { Chat, ChatHit, Project } from '../../shared/types'
import { api, fmtCredits } from './lib'
import { IconButton } from './ui'

const DAY = 86_400_000
function groupLabel(t: number) {
  const today = new Date().setHours(0, 0, 0, 0)
  if (t >= today) return 'Today'
  if (t >= today - DAY) return 'Yesterday'
  if (t >= today - 7 * DAY) return 'Previous 7 days'
  if (t >= today - 30 * DAY) return 'Previous 30 days'
  return 'Older'
}

export function Sidebar(props: {
  chats: Chat[]
  projects: Project[]
  activeId: string | null
  activeProjectId: string | null
  createActive: boolean
  seriesActive: boolean
  onSeries: () => void
  adsActive: boolean
  onAds: () => void
  editActive: boolean
  onEdit: () => void
  credits: number | null
  lowBalance: number
  onSelect: (id: string) => void
  onProject: (id: string) => void
  onNewProject: () => void
  onUsage: () => void
  onNew: () => void
  onCreate: () => void
  onCollapse: () => void
  onSettings: () => void
  onChanged: () => void
}) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ChatHit[] | null>(null)
  // Search looks inside every message, not just titles.
  useEffect(() => {
    const q = query.trim()
    if (!q) return setHits(null)
    const t = setTimeout(() => void api.searchChats(q).then(setHits), 150)
    return () => clearTimeout(t)
  }, [query, props.chats])
  const groups = useMemo(() => {
    const out: { label: string; chats: Chat[] }[] = []
    for (const c of props.chats) {
      const label = c.pinned ? 'Pinned' : groupLabel(c.updatedAt)
      if (out.at(-1)?.label !== label) out.push({ label, chats: [] })
      out.at(-1)!.chats.push(c)
    }
    return out
  }, [props.chats])

  const low = props.credits !== null && props.credits < props.lowBalance
  const navItem = (active: boolean) =>
    `flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left transition-colors ${active ? 'bg-raised text-fg' : 'text-fg hover:bg-raised'}`

  return (
    <aside className="flex w-[260px] shrink-0 flex-col border-r border-line bg-side select-none">
      <div className="drag flex h-14 shrink-0 items-center justify-end px-2">
        <IconButton title="Hide sidebar" onClick={props.onCollapse}>
          <PanelLeftClose size={17} />
        </IconButton>
      </div>

      <div className="flex flex-col gap-0.5 px-2">
        <button type="button" className={navItem(false)} onClick={props.onNew} title="New chat (⌘N)">
          <SquarePen size={16} /> New chat
        </button>
        <button type="button" className={navItem(props.createActive)} onClick={props.onCreate}>
          <Image size={16} /> Create
        </button>
        <button type="button" className={navItem(props.seriesActive)} onClick={props.onSeries}>
          <Film size={16} /> Series
        </button>
        <button type="button" className={navItem(props.adsActive)} onClick={props.onAds}>
          <Megaphone size={16} /> Ads
        </button>
        <button type="button" className={navItem(props.editActive)} onClick={props.onEdit}>
          <Scissors size={16} /> Edit
        </button>
        <label className="mt-1 flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-muted focus-within:bg-raised">
          <Search size={16} />
          <input
            id="chat-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            className="min-w-0 flex-1 bg-transparent text-fg placeholder:text-muted"
          />
        </label>
      </div>

      <nav className="mt-3 flex-1 overflow-y-auto px-2 pb-3">
        {!hits && (
          <div className="mb-3">
            <div className="group flex items-center justify-between px-2.5 pb-1">
              <span className="text-xs font-medium text-faint">Projects</span>
              <IconButton title="New project" className="size-6" onClick={props.onNewProject}>
                <FolderPlus size={14} />
              </IconButton>
            </div>
            {props.projects.map((p) => (
              <button key={p.id} type="button" onClick={() => props.onProject(p.id)} className={navItem(p.id === props.activeProjectId)}>
                <Folder size={15} className="shrink-0 text-muted" /> <span className="truncate">{p.name}</span>
              </button>
            ))}
            {!props.projects.length && <p className="px-2.5 text-[13px] text-faint">Group chats with shared instructions and files.</p>}
          </div>
        )}
        {hits && (
          <div className="flex flex-col gap-0.5">
            {hits.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => props.onSelect(h.id)}
                className={`flex flex-col rounded-lg px-2.5 py-1.5 text-left ${h.id === props.activeId ? 'bg-raised' : 'hover:bg-raised'}`}
              >
                <span className="truncate">{h.title}</span>
                {h.snippet && <Snippet text={h.snippet} query={query.trim()} />}
              </button>
            ))}
            {!hits.length && <p className="px-2.5 py-2 text-[13px] text-faint">No chats mention “{query.trim()}”.</p>}
          </div>
        )}
        {!hits && groups.map((g) => (
          <div key={g.label} className="mb-3">
            <div className="px-2.5 pb-1 text-xs font-medium text-faint">{g.label}</div>
            {g.chats.map((c) => (
              <ChatRow key={c.id} chat={c} projects={props.projects} active={c.id === props.activeId} onSelect={() => props.onSelect(c.id)} onChanged={props.onChanged} />
            ))}
          </div>
        ))}
        {!props.chats.length && <p className="px-2.5 py-2 text-[13px] text-faint">Your chats will show up here.</p>}
      </nav>

      <div className="flex items-center justify-between border-t border-line px-3 py-2.5">
        <button
          type="button"
          onClick={props.onUsage}
          title={low ? `Under ${fmtCredits(props.lowBalance)} credits. Top up at kie.ai, or see spending.` : 'kie.ai credit balance. Click to see spending.'}
          className={`-ml-1.5 inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[13px] tabular-nums hover:bg-raised ${low ? 'text-danger' : 'text-muted'}`}
        >
          {low && <TriangleAlert size={14} />}
          {props.credits === null ? '—' : `${fmtCredits(props.credits)} credits`}
        </button>
        <IconButton title="Settings" onClick={props.onSettings}>
          <Settings size={17} />
        </IconButton>
      </div>
    </aside>
  )
}

function ChatRow({ chat, projects, active, onSelect, onChanged }: { chat: Chat; projects: Project[]; active: boolean; onSelect: () => void; onChanged: () => void }) {
  const [mode, setMode] = useState<'idle' | 'rename' | 'delete'>('idle')
  const [title, setTitle] = useState(chat.title)

  if (mode === 'rename')
    return (
      <form
        className="flex h-9 items-center rounded-lg bg-raised px-2.5"
        onSubmit={(e) => {
          e.preventDefault()
          api.renameChat(chat.id, title).then(onChanged)
          setMode('idle')
        }}
      >
        <input
          id={`rename-${chat.id}`}
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => setMode('idle')}
          onKeyDown={(e) => e.key === 'Escape' && setMode('idle')}
          className="min-w-0 flex-1 bg-transparent"
        />
      </form>
    )

  return (
    <div className={`group flex h-9 items-center rounded-lg pr-1 ${active ? 'bg-raised' : 'hover:bg-raised'}`}>
      <button type="button" onClick={onSelect} className="h-full min-w-0 flex-1 truncate pl-2.5 text-left">
        {mode === 'delete' ? <span className="text-danger">Delete this chat?</span> : chat.title}
      </button>
      {mode === 'delete' ? (
        <>
          <IconButton title="Delete" className="size-7 text-danger" onClick={() => api.deleteChat(chat.id).then(onChanged)}>
            <Check size={15} />
          </IconButton>
          <IconButton title="Keep" className="size-7" onClick={() => setMode('idle')}>
            <X size={15} />
          </IconButton>
        </>
      ) : (
        <div className={active ? 'flex' : 'hidden group-hover:flex'}>
          <IconButton title={chat.pinned ? 'Unpin' : 'Pin to top'} className="size-7" onClick={() => api.pinChat(chat.id, !chat.pinned).then(onChanged)}>
            {chat.pinned ? <PinOff size={14} /> : <Pin size={14} />}
          </IconButton>
          {projects.length > 0 && (
            <label title="Move to project" className="relative inline-flex size-7 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-raised hover:text-fg">
              <FolderInput size={14} />
              <select
                aria-label="Move to project"
                value={chat.projectId ?? ''}
                onChange={(e) => api.moveChat(chat.id, e.target.value || null).then(onChanged)}
                className="absolute inset-0 cursor-pointer opacity-0"
              >
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <IconButton title="Rename" className="size-7" onClick={() => (setTitle(chat.title), setMode('rename'))}>
            <Pencil size={14} />
          </IconButton>
          <IconButton title="Delete" className="size-7" onClick={() => setMode('delete')}>
            <Trash2 size={14} />
          </IconButton>
        </div>
      )}
    </div>
  )
}

function Snippet({ text, query }: { text: string; query: string }) {
  const at = text.toLowerCase().indexOf(query.toLowerCase())
  if (at < 0) return <span className="line-clamp-2 text-xs text-muted">{text}</span>
  return (
    <span className="line-clamp-2 text-xs text-muted">
      {text.slice(0, at)}
      <mark className="rounded-sm bg-line px-0.5 text-fg">{text.slice(at, at + query.length)}</mark>
      {text.slice(at + query.length)}
    </span>
  )
}
