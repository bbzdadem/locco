import { ArrowUp, Brain, Check, ChevronDown, Clapperboard, Copy, Download, FileDown, FileText, Folder, FolderOpen, Image, LoaderCircle, Mic, Music, Paperclip, Pause, Pencil, RotateCcw, Route, Square, TriangleAlert, Volume2, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { bestFor, CHAT_MODELS, chatModel, withBest } from '../../shared/models'
import { estimate, priceLabel, USD_PER_CREDIT } from '../../shared/prices'
import type { Attachment, Chat, Message, Project, Task, ToolCall } from '../../shared/types'
import { ACCEPT_CHAT, api, errMsg, fmtCredits, load, mediaUrl, save, toAttachments } from './lib'
import { Markdown, useCopy } from './Markdown'
import { elapsed, isVideo, Media, ratioOf, useNow } from './Create'
import { Header, IconButton, SelectChip } from './ui'

type HeaderProps = { collapsed: boolean; onExpand: () => void }

function greeting() {
  const h = new Date().getHours()
  return h < 5 ? 'Up late?' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export function ChatView({ chatId, chat, project, draft, defaultModel, header, onOpenProject, onChanged }: {
  chatId: string
  chat?: Chat
  project?: Project
  draft?: Attachment[]
  onOpenProject: (id: string) => void
  defaultModel: string
  header: HeaderProps
  onChanged: () => void
}) {
  const [messages, setMessages] = useState<Message[]>([])
  const [live, setLive] = useState<Message | null>(null)
  const [model, setModel] = useState(chat?.model ?? defaultModel)
  const [thinking, setThinking] = useState(() => load('thinking', false))
  const [agent, setAgent] = useState(() => load('agent', false))
  const [error, setError] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const buf = useRef({ text: '', thinking: '' })
  const raf = useRef(0)
  const changed = useRef(onChanged)
  changed.current = onChanged

  useEffect(() => void api.messages(chatId).then(setMessages), [chatId])

  // Live state of the images and videos the assistant started in this chat.
  const [tasks, setTasks] = useState<Record<string, Task>>({})
  const hasCalls = messages.some((m) => m.calls?.length) || !!live?.calls?.length
  useEffect(() => {
    if (!hasCalls) return
    const load = () => void api.tasks().then((all) => setTasks(Object.fromEntries(all.map((t) => [t.id, t]))))
    load()
    return api.onTasks(load)
  }, [hasCalls])
  const callAction = (p: Promise<void>) => void p.then(() => (api.messages(chatId).then(setMessages), changed.current()), (e) => setError(errMsg(e)))

  // Stream deltas are batched to one render per frame.
  useEffect(() => {
    const flush = () => {
      raf.current = 0
      const b = buf.current
      buf.current = { text: '', thinking: '' }
      setLive((l) => {
        const base = l ?? { id: 'live', chatId, role: 'assistant' as const, text: '', attachments: [], createdAt: Date.now() }
        const steps = base.agent?.steps
        const last = steps?.at(-1)
        return {
          ...base,
          text: base.text + b.text,
          thinking: (base.thinking ?? '') + b.thinking,
          ...(base.agent && last && b.text && { agent: { ...base.agent, steps: [...steps!.slice(0, -1), { ...last, text: last.text + b.text }] } }),
        }
      })
    }
    const off = api.onChat((e) => {
      if (e.chatId !== chatId) return
      if (e.type === 'start' || e.type === 'update') {
        // A snapshot from the main process already holds every delta sent before it.
        cancelAnimationFrame(raf.current)
        raf.current = 0
        buf.current = { text: '', thinking: '' }
        setLive(e.message)
      } else if (e.type === 'delta') {
        buf.current.text += e.text ?? ''
        buf.current.thinking += e.thinking ?? ''
        raf.current ||= requestAnimationFrame(flush)
      } else {
        cancelAnimationFrame(raf.current)
        raf.current = 0
        buf.current = { text: '', thinking: '' }
        setLive(null)
        api.messages(chatId).then(setMessages)
        changed.current()
      }
    })
    return () => (off(), cancelAnimationFrame(raf.current))
  }, [chatId])

  useLayoutEffect(() => {
    const el = scroller.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [messages, live])
  // Images and cards finish loading after render; stay at the bottom while they grow.
  useEffect(() => {
    const el = scroller.current
    if (!el?.firstElementChild) return
    const ro = new ResizeObserver(() => pinned.current && (el.scrollTop = el.scrollHeight))
    ro.observe(el.firstElementChild)
    return () => ro.disconnect()
  }, [messages.length > 0 || live !== null])

  const busy = live !== null
  const setThink = (v: boolean) => (setThinking(v), save('thinking', v))
  const setAgentMode = (v: boolean) => (setAgent(v), save('agent', v))

  async function send(text: string, attachments: Attachment[], editOf?: Message) {
    setError('')
    pinned.current = true
    const optimistic: Message = { id: `tmp-${Date.now()}`, chatId, role: 'user', text, attachments, createdAt: Date.now() }
    setMessages((m) => [...(editOf ? m.slice(0, m.indexOf(editOf)) : m), optimistic])
    try {
      await api.send({ chatId, text, attachments, model, thinking, agent, editOf: editOf?.id, projectId: project?.id })
      onChanged()
    } catch (e) {
      setError(errMsg(e))
      api.messages(chatId).then(setMessages)
    }
  }

  function regenerate() {
    setError('')
    setMessages((m) => (m.at(-1)?.role === 'assistant' ? m.slice(0, -1) : m))
    api.regenerate(chatId, model, thinking, agent)
  }

  const composer = (
    <Composer
      busy={busy}
      autoFocus
      initialFiles={draft}
      model={model}
      onModel={setModel}
      thinking={thinking}
      onThinking={setThink}
      agent={agent}
      onAgent={setAgentMode}
      onSend={(t, a) => send(t, a)}
      onStop={() => api.stop(chatId)}
    />
  )

  const projectLink = project && (
    <button type="button" onClick={() => onOpenProject(project.id)} className="no-drag inline-flex shrink-0 items-center gap-1.5 text-muted hover:text-fg">
      <Folder size={14} /> {project.name}
    </button>
  )
  if (!messages.length && !live)
    return (
      <div className="flex h-full flex-col">
        <Header {...header}>{projectLink}</Header>
        <div className="flex flex-1 flex-col items-center justify-center px-6 pb-[14vh]">
          <h1 className="mb-8 text-center text-[28px] font-semibold tracking-tight">{greeting()}</h1>
          <div className="w-full max-w-3xl">{composer}</div>
          {error && <p className="mt-3 text-danger">{error}</p>}
        </div>
      </div>
    )

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
  return (
    <div className="flex h-full flex-col">
      <Header {...header}>
        {projectLink}
        {projectLink && <span className="text-faint">/</span>}
        <span className="truncate font-medium select-none">{chat?.title ?? 'New chat'}</span>
        {chat && (
          <IconButton title="Export as Markdown" className="no-drag ml-auto" onClick={() => api.exportChat(chatId).catch((e) => setError(errMsg(e)))}>
            <FileDown size={16} />
          </IconButton>
        )}
      </Header>
      <div
        ref={scroller}
        className="flex-1 overflow-y-auto"
        onScroll={(e) => {
          const el = e.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-7 px-6 pt-4 pb-10">
          {messages.map((m, i) => [
            chat?.summaryUpto && m.createdAt > chat.summaryUpto && (messages[i - 1]?.createdAt ?? 0) <= chat.summaryUpto && (
              <div key="summary" className="flex items-center gap-3 text-xs text-faint select-none" title="The model gets a summary of everything above instead of the full text. It keeps long chats fast and cheap.">
                <span className="h-px flex-1 bg-line" /> Earlier messages are summarized for the model <span className="h-px flex-1 bg-line" />
              </div>
            ),
            m.role === 'user' ? (
              <UserMessage key={m.id} message={m} disabled={busy} onEdit={(text) => send(text, m.attachments, m)} />
            ) : (
              <AssistantMessage
                key={m.id}
                message={m}
                isLast={m === lastAssistant && !busy}
                onRegenerate={regenerate}
                tasks={tasks}
                onRun={(c) => callAction(api.runCall(m.id, c.id))}
                onCancel={(c) => callAction(api.cancelCall(m.id, c.id))}
              />
            ),
          ])}
          {live && (
            <AssistantMessage
              message={live}
              streaming
              tasks={tasks}
              onRun={(c) => callAction(api.runCall(live.id, c.id))}
              onCancel={(c) => callAction(api.cancelCall(live.id, c.id))}
            />
          )}
          {error && (
            <p className="flex items-center gap-2 text-danger">
              <TriangleAlert size={15} /> {error}
            </p>
          )}
        </div>
      </div>
      <div className="px-6 pb-4">
        <div className="mx-auto max-w-3xl">{composer}</div>
        <p className="mt-2 text-center text-xs text-faint select-none">locco can make mistakes. Check important answers.</p>
      </div>
    </div>
  )
}

function Attachments({ items, onRemove }: { items: Attachment[]; onRemove?: (a: Attachment) => void }) {
  if (!items.length) return null
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((a) => (
        <div key={a.file} className="group relative">
          {a.mime.startsWith('image/') ? (
            <img src={mediaUrl(a)} alt={a.name} className="size-16 rounded-xl border border-line object-cover" />
          ) : (
            <div className="flex h-16 max-w-48 items-center gap-2 rounded-xl border border-line bg-raised px-3">
              <FileText size={18} className="shrink-0 text-muted" />
              <span className="truncate text-[13px]">{a.name}</span>
            </div>
          )}
          {onRemove && (
            <button
              type="button"
              aria-label={`Remove ${a.name}`}
              onClick={() => onRemove(a)}
              className="absolute -top-1.5 -right-1.5 hidden size-5 items-center justify-center rounded-full bg-inverse text-on-inverse group-hover:flex"
            >
              <X size={12} />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

function UserMessage({ message, disabled, onEdit }: { message: Message; disabled: boolean; onEdit: (text: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.text)
  const { copied, copy } = useCopy()

  if (editing)
    return (
      <div className="flex flex-col gap-2 self-stretch rounded-3xl bg-raised p-3">
        <textarea
          id={`edit-${message.id}`}
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={Math.min(10, draft.split('\n').length + 1)}
          className="resize-none bg-transparent px-1 leading-relaxed"
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setEditing(false)} className="h-8 rounded-full px-3.5 hover:bg-line">
            Cancel
          </button>
          <button
            type="button"
            disabled={!draft.trim()}
            onClick={() => (setEditing(false), onEdit(draft.trim()))}
            className="h-8 rounded-full bg-inverse px-3.5 font-medium text-on-inverse disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    )

  return (
    <div className="group flex flex-col items-end gap-1.5">
      <Attachments items={message.attachments} />
      {message.text && (
        <div className="max-w-[85%] rounded-3xl bg-raised px-4 py-2.5 text-[15px] leading-relaxed break-words whitespace-pre-wrap select-text">
          {message.text}
        </div>
      )}
      <div className="flex opacity-0 transition-opacity group-hover:opacity-100">
        <IconButton title={copied ? 'Copied' : 'Copy'} className="size-7" onClick={() => copy(message.text)}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </IconButton>
        <IconButton title="Edit" className="size-7" disabled={disabled} onClick={() => (setDraft(message.text), setEditing(true))}>
          <Pencil size={14} />
        </IconButton>
      </div>
    </div>
  )
}

// Read aloud: speak a reply with ElevenLabs Turbo in the voice you last picked in Create › Audio.
const plain = (md: string) =>
  md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`#*_>|~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 5000)
const spoken = new Map<string, string>() // message id → audio file, so a reply is only paid for once
let nowPlaying: HTMLAudioElement | null = null

function ReadAloud({ message }: { message: Message }) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle')
  const [err, setErr] = useState('')
  const text = plain(message.text)
  async function toggle() {
    if (state === 'playing') return nowPlaying?.pause(), setState('idle')
    if (state === 'loading' || !text) return
    setErr('')
    try {
      let file = spoken.get(message.id)
      if (!file) {
        setState('loading')
        const voice = load<Record<string, Record<string, unknown>>>('create.values', {})['tts-turbo']?.voice
        const [id] = await api.generate({ modelId: 'tts-turbo', variant: 'text', prompt: text, input: voice ? { voice } : {}, count: 1 })
        for (let i = 0; i < 120 && !file; i++) {
          await new Promise((r) => setTimeout(r, 1500))
          const t = (await api.tasks()).find((x) => x.id === id)
          if (t?.state === 'fail') throw new Error(t.error || 'The voice couldn’t be made.')
          if (t?.state === 'success') file = t.files[0]
        }
        if (!file) throw new Error('The voice took too long.')
        spoken.set(message.id, file)
      }
      nowPlaying?.pause()
      const audio = new Audio(mediaUrl({ kind: 'media', file }))
      nowPlaying = audio
      audio.onended = audio.onpause = () => setState('idle')
      await audio.play()
      setState('playing')
    } catch (e) {
      setState('idle')
      setErr(errMsg(e))
    }
  }
  const price = spoken.has(message.id) ? 'already made' : priceLabel(estimate('tts-turbo', {}, text.length))
  return (
    <>
      <IconButton title={state === 'playing' ? 'Stop reading' : `Read aloud (${price})`} className="size-7" onClick={toggle} disabled={!text}>
        {state === 'loading' ? <LoaderCircle size={14} className="animate-spin" /> : state === 'playing' ? <Pause size={14} /> : <Volume2 size={14} />}
      </IconButton>
      {err && <span className="text-danger">{err}</span>}
    </>
  )
}

function AssistantMessage({ message, streaming, isLast, onRegenerate, tasks = {}, onRun, onCancel }: {
  message: Message
  streaming?: boolean
  isLast?: boolean
  onRegenerate?: () => void
  tasks?: Record<string, Task>
  onRun?: (c: ToolCall) => void
  onCancel?: (c: ToolCall) => void
}) {
  const { copied, copy } = useCopy()
  const waiting = streaming && !message.text && !message.thinking && !message.agent
  const cards = (calls?: ToolCall[]) =>
    calls?.map((c) => <CallCard key={c.id} call={c} tasks={tasks} onRun={() => onRun?.(c)} onCancel={() => onCancel?.(c)} />)
  return (
    <div className="flex flex-col gap-2">
      {message.agent && <AgentBar message={message} tasks={tasks} streaming={streaming} />}
      {message.thinking && (
        <details open={streaming && !message.text} className="group/think">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 text-[13px] text-muted select-none hover:text-fg">
            <Brain size={14} /> {streaming && !message.text ? 'Thinking…' : 'Thought process'}
            <ChevronDown size={13} className="transition-transform group-open/think:rotate-180" />
          </summary>
          <div className="mt-2 border-l-2 border-line pl-4 text-[13px] leading-relaxed whitespace-pre-wrap text-muted select-text">{message.thinking}</div>
        </details>
      )}
      {waiting && <span className="cursor text-muted" aria-label="Waiting for the answer" />}
      {message.agent
        ? message.agent.steps.map((step, i) => {
            const isLast = i === message.agent!.steps.length - 1
            return (
              <div key={i} className="flex flex-col gap-2">
                {step.text && (
                  <div className="md">
                    <Markdown text={step.text} />
                    {streaming && isLast && <span className="cursor" />}
                  </div>
                )}
                {streaming && isLast && !step.text && !step.calls.length && <span className="cursor text-muted" aria-label="Working on the next step" />}
                {cards(message.calls?.filter((c) => step.calls.includes(c.id)))}
              </div>
            )
          })
        : message.text && (
            <div className="md">
              <Markdown text={message.text} />
              {streaming && <span className="cursor" />}
            </div>
          )}
      {!message.agent && cards(message.calls)}
      {message.error && (
        <div className="flex items-start gap-2 rounded-xl border border-line px-3 py-2.5 text-[13px]">
          <TriangleAlert size={15} className="mt-0.5 shrink-0 text-danger" />
          <span className="flex-1">{message.error}</span>
          {isLast && (
            <button type="button" onClick={onRegenerate} className="font-medium underline underline-offset-2">
              Try again
            </button>
          )}
        </div>
      )}
      {!streaming && (
        <div className="-ml-1.5 flex items-center gap-0.5 text-xs text-faint select-none">
          {message.text && (
            <IconButton title={copied ? 'Copied' : 'Copy'} className="size-7" onClick={() => copy(message.text)}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </IconButton>
          )}
          {message.text && <ReadAloud message={message} />}
          {isLast && !message.error && (
            <IconButton title="Regenerate" className="size-7" onClick={onRegenerate}>
              <RotateCcw size={14} />
            </IconButton>
          )}
          <span className="ml-1.5">
            {chatModel(message.model).label}
            {message.credits != null && ` · ${fmtCredits(message.credits)} credits`}
          </span>
        </div>
      )}
    </div>
  )
}

function Composer({ busy, autoFocus, initialFiles, model, onModel, thinking, onThinking, agent, onAgent, onSend, onStop }: {
  busy: boolean
  autoFocus?: boolean
  initialFiles?: Attachment[]
  model: string
  onModel: (m: string) => void
  thinking: boolean
  onThinking: (v: boolean) => void
  agent: boolean
  onAgent: (v: boolean) => void
  onSend: (text: string, attachments: Attachment[]) => void
  onStop: () => void
}) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<Attachment[]>(initialFiles ?? [])
  const [dragging, setDragging] = useState(false)
  const [note, setNote] = useState('')
  const area = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)

  // Dictation: record, transcribe on kie (about $0.0015 a minute), add the words to the box.
  const [rec, setRec] = useState<'idle' | 'recording' | 'transcribing'>('idle')
  const [recStart, setRecStart] = useState(0)
  const recorder = useRef<MediaRecorder | null>(null)
  const [, tick] = useState(0)
  useEffect(() => {
    if (rec !== 'recording') return
    const t = setInterval(() => tick((n) => n + 1), 500)
    return () => clearInterval(t)
  }, [rec])
  async function toggleMic() {
    if (rec === 'recording') return recorder.current?.stop()
    if (rec === 'transcribing') return
    setNote('')
    if (!(await api.micAccess())) return setNote('Allow the microphone for locco in System Settings › Privacy & Security › Microphone.')
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true })
      const type = ['audio/mp4', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported(t))
      const r = new MediaRecorder(media, type ? { mimeType: type } : undefined)
      const chunks: Blob[] = []
      r.ondataavailable = (e) => chunks.push(e.data)
      r.onstop = async () => {
        media.getTracks().forEach((t) => t.stop())
        setRec('transcribing')
        try {
          const mime = r.mimeType.split(';')[0]
          const bytes = new Uint8Array(await new Blob(chunks, { type: mime }).arrayBuffer())
          const said = await api.transcribe(await api.saveFile(`dictation.${mime.includes('mp4') ? 'm4a' : 'webm'}`, mime, bytes))
          if (said) setText((t) => (t.trim() ? `${t.trimEnd()} ` : '') + said)
          else setNote('No speech heard.')
          area.current?.focus()
        } catch (e) {
          setNote(errMsg(e))
        } finally {
          setRec('idle')
        }
      }
      recorder.current = r
      r.start()
      setRecStart(Date.now())
      setRec('recording')
    } catch (e) {
      setNote(errMsg(e))
    }
  }
  const recSecs = Math.floor((Date.now() - recStart) / 1000)

  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [text])

  async function add(list: FileList | File[]) {
    const added = await toAttachments(list, ACCEPT_CHAT)
    setNote(added.length < list.length ? 'Only images and PDFs can be attached.' : '')
    setFiles((f) => [...f, ...added.filter((a) => !f.some((x) => x.file === a.file))])
  }

  function submit() {
    if (busy || (!text.trim() && !files.length)) return
    onSend(text.trim(), files)
    setText('')
    setFiles([])
    setNote('')
  }

  const canSend = !!text.trim() || !!files.length
  return (
    <div
      onDragOver={(e) => (e.preventDefault(), setDragging(true))}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => (e.preventDefault(), setDragging(false), add(e.dataTransfer.files))}
      className={`flex flex-col gap-2 rounded-3xl border bg-surface p-3 shadow-[0_2px_12px_rgba(0,0,0,0.04)] transition-colors ${dragging ? 'border-fg' : 'border-line focus-within:border-faint'}`}
    >
      {files.length > 0 && (
        <div className="px-1 pt-1">
          <Attachments items={files} onRemove={(a) => setFiles((f) => f.filter((x) => x !== a))} />
        </div>
      )}
      <textarea
        id="composer"
        ref={area}
        rows={1}
        autoFocus={autoFocus}
        value={text}
        placeholder="Message locco"
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => e.clipboardData.files.length && (e.preventDefault(), add(e.clipboardData.files))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) (e.preventDefault(), submit())
        }}
        className="max-h-60 resize-none bg-transparent px-2 text-[15px] leading-relaxed placeholder:text-faint"
      />
      <div className="flex items-center gap-1.5">
        <IconButton title="Attach images or PDFs" onClick={() => picker.current?.click()}>
          <Paperclip size={17} />
        </IconButton>
        <button
          type="button"
          onClick={toggleMic}
          title={rec === 'recording' ? 'Stop and transcribe' : rec === 'transcribing' ? 'Transcribing…' : 'Dictate'}
          aria-label={rec === 'recording' ? 'Stop recording' : 'Dictate'}
          className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full text-[13px] transition-colors ${
            rec === 'recording' ? 'bg-inverse px-3 text-on-inverse' : 'w-8 justify-center text-muted hover:bg-raised hover:text-fg'
          }`}
        >
          {rec === 'transcribing' ? <LoaderCircle size={16} className="animate-spin" /> : <Mic size={16} />}
          {rec === 'recording' && (
            <span className="tabular-nums">
              {Math.floor(recSecs / 60)}:{String(recSecs % 60).padStart(2, '0')} · Stop
            </span>
          )}
        </button>
        <input
          ref={picker}
          type="file"
          multiple
          accept={ACCEPT_CHAT}
          hidden
          onChange={(e) => (e.target.files && add(e.target.files), (e.target.value = ''))}
        />
        <SelectChip
          title={`Model: ${bestFor(model)}`}
          label={chatModel(model).label}
          value={model}
          onChange={onModel}
          options={CHAT_MODELS.map((m) => ({ value: m.id, label: withBest(m.label, m.id) }))}
        />
        <button
          type="button"
          aria-pressed={thinking}
          title="Let the model think before answering"
          onClick={() => onThinking(!thinking)}
          className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors ${thinking ? 'border-fg bg-raised text-fg' : 'border-line text-muted hover:bg-raised'}`}
        >
          <Brain size={14} /> Thinking
        </button>
        <button
          type="button"
          aria-pressed={agent}
          title="Agent mode: works step by step, looks at what it made and fixes it, within your budget"
          onClick={() => onAgent(!agent)}
          className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors ${agent ? 'border-fg bg-raised text-fg' : 'border-line text-muted hover:bg-raised'}`}
        >
          <Route size={14} /> Agent
        </button>
        {note && <span className="truncate text-xs text-muted">{note}</span>}
        {!note && agent && chatModel(model).api === 'claude' && (
          <span className="truncate text-xs text-muted">
            Claude can't see images on kie, so it can't check its results.{' '}
            <button type="button" onClick={() => onModel('gpt-6-sol')} className="font-medium text-fg underline underline-offset-2">
              Use GPT 6 Sol
            </button>
          </span>
        )}
        {!note && !agent && files.length > 0 && chatModel(model).api === 'claude' && (
          <span className="truncate text-xs text-muted">
            Claude can't see files on kie yet, but can still edit or animate them.{' '}
            <button type="button" onClick={() => onModel('gpt-6-sol')} className="font-medium text-fg underline underline-offset-2">
              Ask GPT 6 Sol instead
            </button>
          </span>
        )}
        <div className="ml-auto" />
        {busy ? (
          <button type="button" title="Stop" aria-label="Stop" onClick={onStop} className="flex size-8 items-center justify-center rounded-full bg-inverse text-on-inverse">
            <Square size={12} fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            title="Send (Enter)"
            aria-label="Send"
            disabled={!canSend}
            onClick={submit}
            className="flex size-8 items-center justify-center rounded-full bg-inverse text-on-inverse transition-opacity disabled:opacity-30"
          >
            <ArrowUp size={17} strokeWidth={2.4} />
          </button>
        )}
      </div>
    </div>
  )
}

// An image or video the assistant asked for: waiting for Run, generating, done or failed.
function CallCard({ call, tasks, onRun, onCancel }: { call: ToolCall; tasks: Record<string, Task>; onRun: () => void; onCancel: () => void }) {
  const task = call.taskIds?.map((id) => tasks[id]).find(Boolean)
  const generating = call.status === 'started' && (!task || (task.state !== 'success' && task.state !== 'fail'))
  const now = useNow(generating)
  const [busy, setBusy] = useState(false)
  const settings = Object.entries(call.input)
    .filter(([, v]) => v !== null && typeof v !== 'object' && typeof v !== 'boolean')
    .map(([k, v]) => (k === 'duration' ? `${v}s` : String(v)))
  const Icon = call.kind === 'video' ? Clapperboard : call.kind === 'audio' ? Music : Image
  const click = (fn: () => void) => () => (setBusy(true), fn())
  const isAtt = (v: unknown): v is Attachment => !!v && typeof v === 'object' && 'file' in v
  const refs = Object.values(call.input).flatMap((v) => (Array.isArray(v) ? v.filter(isAtt) : isAtt(v) ? [v] : []))
  return (
    <div className="flex max-w-xl flex-col gap-3 rounded-2xl border border-line bg-surface p-3">
      <div className="flex items-center gap-2 text-[13px]">
        <Icon size={15} className="shrink-0 text-muted" />
        <span className="shrink-0 font-medium">{call.label}</span>
        <span className="truncate text-muted">{settings.join(' · ')}</span>
        <span className="ml-auto shrink-0 text-faint tabular-nums">
          {task?.credits != null ? `${fmtCredits(task.credits)} credits` : call.cost}
        </span>
      </div>

      {refs.length > 0 && task?.state !== 'success' && (
        <div className="flex gap-1.5">
          {refs.map((r) => (
            <img key={r.file} src={mediaUrl(r)} alt="Input image" className="size-14 rounded-lg border border-line object-cover" />
          ))}
        </div>
      )}
      {call.status === 'pending' && (
        <div className="flex items-center gap-2">
          <button type="button" disabled={busy} onClick={click(onRun)} className="inline-flex h-9 items-center gap-2 rounded-full bg-inverse px-4 font-medium text-on-inverse disabled:opacity-40">
            {busy ? <LoaderCircle size={15} className="animate-spin" /> : <Clapperboard size={15} />} Run
          </button>
          <button type="button" disabled={busy} onClick={click(onCancel)} className="h-9 rounded-full px-4 hover:bg-raised">
            Cancel
          </button>
          <span className="text-xs text-faint">{call.kind === 'audio' ? 'Music and voice' : 'Videos'} wait for your go because they cost more.</span>
        </div>
      )}
      {call.status === 'cancelled' && <p className="text-[13px] text-muted">Cancelled. Nothing was charged.</p>}
      {call.status === 'error' && (
        <p className="flex items-start gap-2 text-[13px]">
          <TriangleAlert size={15} className="mt-0.5 shrink-0 text-danger" /> {call.error}
        </p>
      )}
      {generating && (
        <div style={{ aspectRatio: ratioOf({ input: call.input, modelId: call.modelId }) }} className="relative flex max-h-96 flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl bg-raised text-[13px] text-muted">
          <div className="shimmer absolute inset-0" />
          <LoaderCircle size={20} className="animate-spin" />
          <span className="tabular-nums">
            {task?.state === 'generating' ? 'Generating' : 'In queue'} · {elapsed(Math.max(0, now - (task?.createdAt ?? now)))}
          </span>
        </div>
      )}
      {task?.state === 'fail' && (
        <p className="flex items-start gap-2 text-[13px]">
          <TriangleAlert size={15} className="mt-0.5 shrink-0 text-danger" /> {task.error}
        </p>
      )}
      {task?.state === 'success' &&
        task.files.map((file) => (
          <div key={file} className="flex flex-col gap-1.5">
            <Media file={file} alt={call.prompt} controls={isVideo(file)} className="max-h-[420px] w-fit max-w-full rounded-xl object-contain" />
            <div className="-ml-1.5 flex">
              <IconButton title="Save as…" className="size-7" onClick={() => api.saveAs({ kind: 'media', file })}>
                <Download size={14} />
              </IconButton>
              <IconButton title="Show in Finder" className="size-7" onClick={() => api.reveal({ kind: 'media', file })}>
                <FolderOpen size={14} />
              </IconButton>
            </div>
          </div>
        ))}

      <p className="line-clamp-3 text-[13px] leading-relaxed text-muted select-text">{call.prompt}</p>
      {call.notes?.map((n) => (
        <p key={n} className="text-xs text-faint">
          {n}
        </p>
      ))}
    </div>
  )
}

// Top line of an agent reply: which step it's on and what it has spent against the run's budget.
function AgentBar({ message, tasks, streaming }: { message: Message; tasks: Record<string, Task>; streaming?: boolean }) {
  const a = message.agent!
  const media = (message.calls ?? [])
    .filter((c) => c.status === 'started')
    .reduce((n, c) => n + (c.taskIds ?? []).reduce((m, id) => m + (tasks[id]?.credits ?? estimate(c.modelId, c.input, c.prompt.length)?.hi ?? 0), 0), 0)
  const spent = (message.credits ?? 0) + media
  const usd = (credits: number) => `$${(credits * USD_PER_CREDIT).toFixed(2)}`
  const waiting = message.calls?.some((c) => c.status === 'pending')
  return (
    <div className="flex items-center gap-2 text-[13px] text-muted select-none">
      <Route size={14} />
      <span className="font-medium text-fg">Agent</span>
      <span>· step {a.steps.length} of 8{!streaming && ' · done'}</span>
      {streaming && waiting && <span>· waiting for you</span>}
      <span className="ml-auto rounded-full border border-line px-2.5 py-0.5 text-xs tabular-nums" title="Chat turns plus generations, against this run's budget (Settings)">
        {usd(spent)} of {usd(a.budget)}
      </span>
    </div>
  )
}
