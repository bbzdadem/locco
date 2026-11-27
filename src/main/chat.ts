import { randomUUID } from 'node:crypto'
import { chatModel, type ChatModel } from '../shared/models'
import { estimate, USD_PER_CREDIT } from '../shared/prices'
import type { Attachment, Chat, ChatEvent, ChatHit, MediaKind, Message, Project, SendRequest, ToolCall } from '../shared/types'
import { claudeBlocks, claudeStream } from './claude'
import { claudeTool, openaiTool, planCall, responsesTool, systemAddon, TOOL } from './assistant'
import { db, getSetting, spend } from './db'
import { stream } from './kie'
import { kieUrlFor } from './media'
import { generate, getTask } from './tasks'

type Emit = (e: ChatEvent) => void
const running = new Map<string, AbortController>()
// Agent replies still running, so Run and Cancel on their cards reach the live reply (it's saved when the run ends).
const live = new Map<string, { msg: Message; emit: Emit; projectId?: string }>()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const isImage = (f: string) => /\.(png|jpe?g|webp)$/i.test(f)

const toMessage = (r: any): Message => ({
  id: r.id, chatId: r.chat_id, role: r.role, text: r.text ?? '', thinking: r.thinking || undefined,
  attachments: JSON.parse(r.attachments || '[]'), model: r.model ?? undefined, credits: r.credits ?? undefined,
  error: r.error ?? undefined, calls: JSON.parse(r.calls || 'null') ?? undefined, agent: JSON.parse(r.agent || 'null') ?? undefined,
  createdAt: r.created_at,
})
const toChat = (r: any): Chat => ({
  id: r.id, title: r.title, model: r.model, updatedAt: r.updated_at, pinned: !!r.pinned, projectId: r.project_id ?? undefined,
  summaryUpto: r.summary_upto ?? undefined,
})

export const listChats = () =>
  db.prepare('SELECT id, title, model, updated_at, pinned, project_id, summary_upto FROM chats ORDER BY COALESCE(pinned, 0) DESC, updated_at DESC').all().map(toChat) // unpinned (0) and never pinned (NULL) sort alike
export const getMessages = (chatId: string) =>
  db.prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at, rowid').all(chatId).map(toMessage)
// Finds chats by title or by anything said in them, newest first.
export function searchChats(query: string): ChatHit[] {
  const q = query.trim()
  if (!q) return []
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  const rows = db.prepare(`
    SELECT c.id, c.title, c.model, c.updated_at AS updatedAt,
      (SELECT m.text FROM messages m WHERE m.chat_id = c.id AND m.text LIKE ? ESCAPE '\\' ORDER BY m.created_at DESC LIMIT 1) AS hit
    FROM chats c
    WHERE c.title LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM messages m WHERE m.chat_id = c.id AND m.text LIKE ? ESCAPE '\\')
    ORDER BY c.updated_at DESC LIMIT 50`).all(like, like, like) as unknown as (Chat & { hit: string | null })[]
  return rows.map(({ hit, ...chat }) => {
    if (!hit) return chat
    const flat = hit.replace(/\s+/g, ' ')
    const at = flat.toLowerCase().indexOf(q.toLowerCase())
    const start = Math.max(0, at - 40)
    return { ...chat, snippet: (start > 0 ? '…' : '') + flat.slice(start, at + q.length + 60) + (at + q.length + 60 < flat.length ? '…' : '') }
  })
}
export const renameChat = (id: string, title: string) => db.prepare('UPDATE chats SET title = ? WHERE id = ?').run(title.trim() || 'Untitled', id)
export const deleteChat = (id: string) => (running.get(id)?.abort(), db.prepare('DELETE FROM chats WHERE id = ?').run(id))
export const stopChat = (id: string) => running.get(id)?.abort()
export const pinChat = (id: string, on: boolean) => db.prepare('UPDATE chats SET pinned = ? WHERE id = ?').run(on ? 1 : 0, id)
export const moveChat = (id: string, projectId: string | null) => db.prepare('UPDATE chats SET project_id = ? WHERE id = ?').run(projectId, id)

// --- Projects: chats that share instructions and files ---

const toProject = (r: any): Project => ({ id: r.id, name: r.name, instructions: r.instructions ?? '', files: JSON.parse(r.files || '[]'), createdAt: r.created_at })
export const listProjects = () => db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all().map(toProject)
function getProject(id?: string | null) {
  const r = id ? db.prepare('SELECT * FROM projects WHERE id = ?').get(id) : undefined
  return r ? toProject(r) : undefined
}
export function saveProject(p: Partial<Project>) {
  const id = p.id ?? randomUUID()
  const cur = getProject(id)
  db.prepare('INSERT OR REPLACE INTO projects (id, name, instructions, files, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id, p.name?.trim() || cur?.name || 'New project', p.instructions ?? cur?.instructions ?? '', JSON.stringify(p.files ?? cur?.files ?? []),
    cur?.createdAt ?? Date.now())
  return getProject(id)!
}
// Deleting a project keeps its chats and results; they just leave the project.
export function deleteProject(id: string) {
  db.prepare('UPDATE chats SET project_id = NULL WHERE project_id = ?').run(id)
  db.prepare('UPDATE tasks SET project_id = NULL WHERE project_id = ?').run(id)
  db.prepare('DELETE FROM projects WHERE id = ?').run(id)
}

function insert(m: Message) {
  db.prepare(
    'INSERT INTO messages (id, chat_id, role, text, thinking, attachments, model, credits, error, calls, agent, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
  ).run(m.id, m.chatId, m.role, m.text, m.thinking ?? null, JSON.stringify(m.attachments), m.model ?? null, m.credits ?? null,
    m.error ?? null, m.calls ? JSON.stringify(m.calls) : null, m.agent ? JSON.stringify(m.agent) : null, m.createdAt)
}

export function send(req: SendRequest, emit: Emit) {
  if (running.has(req.chatId)) throw new Error('This chat is still answering.')
  const title = req.text.replace(/\s+/g, ' ').trim().slice(0, 60) || req.attachments[0]?.name || 'New chat'
  db.prepare('INSERT OR IGNORE INTO chats (id, title, model, updated_at, project_id) VALUES (?, ?, ?, ?, ?)').run(
    req.chatId, title, req.model, Date.now(), req.projectId ?? null)
  if (req.editOf) {
    const from = db.prepare('SELECT created_at FROM messages WHERE id = ?').get(req.editOf) as { created_at: number } | undefined
    if (from) {
      db.prepare('DELETE FROM messages WHERE chat_id = ? AND created_at >= ?').run(req.chatId, from.created_at)
      // Editing a message the summary already covers makes the summary wrong: drop it, it's rebuilt when needed.
      db.prepare('UPDATE chats SET summary = NULL, summary_upto = NULL WHERE id = ? AND summary_upto >= ?').run(req.chatId, from.created_at)
    }
  }
  insert({ id: randomUUID(), chatId: req.chatId, role: 'user', text: req.text, attachments: req.attachments, createdAt: Date.now() })
  void run(req.chatId, req.model, req.thinking, !!req.agent, emit)
}

export function regenerate(chatId: string, model: string, thinking: boolean, agent: boolean, emit: Emit) {
  if (running.has(chatId)) return
  const last = getMessages(chatId).at(-1)
  if (last?.role === 'assistant') db.prepare('DELETE FROM messages WHERE id = ?').run(last.id)
  void run(chatId, model, thinking, agent, emit)
}

export function exportMarkdown(chatId: string) {
  const title = (db.prepare('SELECT title FROM chats WHERE id = ?').get(chatId) as { title: string } | undefined)?.title ?? 'Chat'
  const parts = [`# ${title}`]
  for (const m of getMessages(chatId)) {
    parts.push(`## ${m.role === 'user' ? 'You' : chatModel(m.model).label}`, textOf(m) || '_(no text)_')
    if (m.error) parts.push(`> ${m.error}`)
  }
  return { title, markdown: parts.join('\n\n') + '\n' }
}

// --- Images and videos the assistant asked for ---

async function start(c: ToolCall, projectId?: string) {
  try {
    c.taskIds = await generate({ modelId: c.modelId, variant: c.variant, prompt: c.prompt, input: c.input, count: 1, projectId })
    c.status = 'started'
  } catch (e) {
    c.status = 'error'
    c.error = (e as Error).message
  }
}

async function updateCall(messageId: string, callId: string, change: (c: ToolCall, projectId?: string) => Promise<void> | void) {
  const l = live.get(messageId)
  if (l) {
    const c = l.msg.calls?.find((x) => x.id === callId)
    if (c?.status !== 'pending') return
    await change(c, l.projectId)
    return l.emit({ type: 'update', chatId: l.msg.chatId, message: l.msg })
  }
  const row = db.prepare('SELECT m.calls, c.project_id FROM messages m JOIN chats c ON c.id = m.chat_id WHERE m.id = ?').get(messageId) as
    { calls: string | null; project_id: string | null } | undefined
  const calls: ToolCall[] = JSON.parse(row?.calls || '[]')
  const c = calls.find((x) => x.id === callId)
  if (!c || c.status !== 'pending') return
  await change(c, row?.project_id ?? undefined)
  db.prepare('UPDATE messages SET calls = ? WHERE id = ?').run(JSON.stringify(calls), messageId)
}
export const runCall = (messageId: string, callId: string) => updateCall(messageId, callId, start)
export const cancelCall = (messageId: string, callId: string) => updateCall(messageId, callId, (c) => void (c.status = 'cancelled'))

const resultFiles = (c: ToolCall) => (c.taskIds ?? []).flatMap((id) => getTask(id)?.files ?? [])
const asImage = (file: string): Attachment => ({ kind: 'media', file, name: file, mime: 'image/png' })

// Every image in the chat the assistant can point at: your attachments and finished results.
function chatFiles(history: Message[]): Attachment[] {
  return history.flatMap((m) => [
    ...m.attachments.filter((a) => a.mime.startsWith('image/')),
    ...(m.calls ?? []).flatMap((c) => resultFiles(c).filter(isImage).map(asImage)),
  ])
}

// How a past result reads to the model, so it can refer back to it ("make it darker", "animate that").
function describeCall(c: ToolCall) {
  const task = c.taskIds?.length ? getTask(c.taskIds[0]) : undefined
  const what = `${c.kind} with ${c.label} (prompt: "${c.prompt.slice(0, 200)}")`
  if (c.status === 'pending') return `[Prepared a ${what}; waiting for the user to press Run.]`
  if (c.status === 'cancelled') return `[The user cancelled a ${what}.]`
  if (c.status === 'error') return `[Couldn't make a ${what}: ${c.error}]`
  if (task?.state === 'success') return `[Made a ${what}. Result id: ${task.files.join(', ')}]`
  if (task?.state === 'fail') return `[A ${what} failed: ${task.error}]`
  return `[Started a ${what}; still generating.]`
}

// Text each turn shows the model: what was said, which files were attached (with ids) and what was made.
const textOf = (m: Message) =>
  [
    m.text,
    m.attachments.length ? `[Attached: ${m.attachments.map((a) => `${a.name} (id: ${a.file})`).join(', ')}]` : '',
    ...(m.calls ?? []).map(describeCall),
  ].filter(Boolean).join('\n\n')

type Ctx = { summary?: string; project?: Project; agent?: { step: number; budget: number } }
const MAX_STEPS = 8
const agentBudget = () => Number(getSetting('agentBudget')) || 2 // dollars

function systemPrompt(ctx: Ctx) {
  const about = getSetting('about')?.trim()
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const p = ctx.project
  return [
    `You are locco, a personal AI assistant running on the user's Mac. Today is ${today}.`,
    about && `About the user:\n${about}`,
    p && [
      `This chat is part of the user's project "${p.name}".`,
      p.instructions.trim() && `Project instructions:\n${p.instructions.trim()}`,
      p.files.length && `Project files (attached to the first message, ids usable in generate_media): ${p.files.map((a) => `${a.name} (id: ${a.file})`).join(', ')}`,
    ].filter(Boolean).join('\n\n'),
    systemAddon(),
    ctx.agent && [
      'Agent mode is on: work through the request step by step on your own. After each generate_media call, locco sends you the results in an automatic message (images attached).',
      'Look at them critically: misspelled or garbled text, wrong style, framing or count, anatomy errors. Fix problems with another call, then move on to the next part of the request.',
      "Don't ask the user for permission between steps; video and audio still wait for their go on their own. Make several images in one step when you want options.",
      `When the whole request is done, reply with a short final message and no tool call. Limits: ${MAX_STEPS} steps and about $${agentBudget()} per run. This is step ${ctx.agent.step}.`,
    ].join(' '),
    ctx.summary && `Summary of the earlier part of this conversation (older messages were condensed to save space; ids in it still work):\n${ctx.summary}`,
  ].filter(Boolean).join('\n\n')
}

async function request(model: ChatModel, history: Message[], thinking: boolean, ctx: Ctx) {
  // Failed replies are skipped, which can leave two user turns in a row. Merge them into one turn.
  const turns: { role: Message['role']; text: string; attachments: Attachment[] }[] = []
  for (const m of history.filter((m) => !m.error && (m.text.trim() || m.attachments.length || m.calls?.length))) {
    const prev = turns.at(-1)
    if (prev?.role === m.role) (prev.text = [prev.text, textOf(m)].join('\n\n')), prev.attachments.push(...m.attachments)
    else turns.push({ role: m.role, text: textOf(m), attachments: [...m.attachments] })
  }
  // Project files ride along with the first message, so models that can read files see them.
  if (ctx.project?.files.length && turns[0]?.role === 'user') turns[0].attachments.unshift(...ctx.project.files)
  const system = systemPrompt(ctx)
  if (model.api === 'claude') {
    // Claude runs on your own Anthropic key (Settings); images and PDFs go in as they are.
    const messages = await Promise.all(turns.map(async (t) => {
      const files = t.role === 'user' ? await claudeBlocks(t.attachments) : []
      return { role: t.role, content: files.length ? [...files, { type: 'text', text: t.text || ' ' }] : t.text }
    }))
    return { path: '', body: { model: model.id, system, max_tokens: 16000, tools: [claudeTool()], messages, ...(thinking && { thinkingFlag: true }) } }
  }
  if (model.api === 'responses') {
    // GPT 6 (OpenAI Responses format): files go in as hosted URLs, which GPT can actually read.
    const input = await Promise.all(
      turns.map(async (t) => {
        if (t.role === 'assistant') return { role: 'assistant', content: t.text }
        const files = await Promise.all(
          t.attachments.map(async (a) => {
            const url = await kieUrlFor(a)
            return a.mime === 'application/pdf' ? { type: 'input_file', file_url: url } : { type: 'input_image', image_url: url }
          }),
        )
        return { role: 'user', content: [{ type: 'input_text', text: t.text || ' ' }, ...files] }
      }),
    )
    return {
      path: '/codex/v1/responses',
      body: {
        model: model.id, tools: [responsesTool()], reasoning: { effort: thinking ? 'high' : 'low' },
        input: [{ role: 'developer', content: [{ type: 'input_text', text: system }] }, ...input],
      },
    }
  }
  // OpenAI-style models take files as hosted URLs, uploaded to kie on demand.
  const messages = await Promise.all(
    turns.map(async (t) => {
      if (t.role === 'assistant' || !t.attachments.length) return { role: t.role, content: t.text }
      const urls = await Promise.all(t.attachments.map(kieUrlFor))
      return { role: t.role, content: [{ type: 'text', text: t.text || ' ' }, ...urls.map((url) => ({ type: 'image_url', image_url: { url } }))] }
    }),
  )
  return {
    path: `/${model.id}/v1/chat/completions`,
    body: {
      messages: [{ role: 'system', content: system }, ...messages], tools: [openaiTool()],
      ...(thinking ? { include_thoughts: true, reasoning_effort: 'high' } : { reasoning_effort: 'low' }),
    },
  }
}

type ToolBuf = Map<number, { name?: string; json: string }>
// Pulls text, thinking, cost and tool-call pieces out of one stream event, for either format.
function read(model: ChatModel, e: any, tools: ToolBuf): { text?: string; thinking?: string; credits?: number; textIfNone?: string } {
  if (model.api === 'claude') {
    if (e.type === 'content_block_start' && e.content_block?.type === 'tool_use') {
      const preset = e.content_block.input && Object.keys(e.content_block.input).length ? JSON.stringify(e.content_block.input) : ''
      tools.set(e.index, { name: e.content_block.name, json: preset })
    }
    if (e.type === 'content_block_delta' && e.delta?.type === 'input_json_delta') {
      const t = tools.get(e.index)
      if (t) t.json += e.delta.partial_json ?? ''
    }
    if (e.type === 'content_block_delta') return { text: e.delta?.text, thinking: e.delta?.thinking }
    return { credits: e.credits_consumed ?? e.message?.credits_consumed }
  }
  if (model.api === 'responses') {
    if (e.type === 'response.output_text.delta') return { text: e.delta }
    if (/^response\.reasoning(_summary)?_text\.delta$/.test(e.type)) return { thinking: e.delta }
    if (e.type === 'response.output_item.added' && e.item?.type === 'function_call')
      tools.set(e.output_index ?? tools.size, { name: e.item.name, json: e.item.arguments ?? '' })
    if (e.type === 'response.function_call_arguments.delta') {
      const t = tools.get(e.output_index ?? [...tools.keys()].at(-1) ?? 0)
      if (t) t.json += e.delta ?? ''
    }
    if (e.type === 'response.failed' || e.type === 'response.incomplete')
      throw new Error(e.response?.error?.message ?? e.response?.incomplete_details?.reason ?? 'GPT stopped before finishing.')
    return { credits: e.type === 'response.completed' ? (e.credits_consumed ?? e.response?.credits_consumed) : undefined }
  }
  const d = e.choices?.[0]?.delta ?? {}
  if (d.tool_calls?.length) {
    for (const tc of d.tool_calls) {
      const t = tools.get(tc.index ?? 0) ?? { json: '' }
      if (tc.function?.name) t.name = tc.function.name
      t.json += tc.function?.arguments ?? ''
      tools.set(tc.index ?? 0, t)
    }
    // kie's Gemini repeats the whole answer text in the chunk that carries the tool call. Use it only if nothing came before.
    return { credits: e.credits_consumed, textIfNone: d.content || undefined }
  }
  return { text: d.content || undefined, thinking: d.reasoning_content || d.reasoning || undefined, credits: e.credits_consumed }
}

// One model call: streams pieces to onDelta and tool calls into `tools`, returns the credits kie reported.
// kie's models now and then fail with "Internal error" within a second, before generating anything. Those failures are
// free, so retry quietly.
const TRANSIENT = /internal|interal|exception|try again|fetch failed|code 52\d/i
async function turn(model: ChatModel, path: string, body: object, signal: AbortSignal, tools: ToolBuf, onDelta: (text?: string, thinking?: string) => void) {
  for (let attempt = 0; ; attempt++) {
    let got = false
    let gotText = false
    let credits: number | undefined
    try {
      for await (const e of model.api === 'claude' ? claudeStream(body, signal) : stream(path, body, signal)) {
        const d = read(model, e, tools)
        if (d.textIfNone && !gotText) d.text = d.textIfNone
        if (d.credits != null) credits = d.credits
        if (d.text) gotText = true
        if (d.text || d.thinking) (got = true), onDelta(d.text, d.thinking)
      }
      return credits
    } catch (e) {
      if (signal.aborted || attempt >= 7 || got || tools.size || !TRANSIENT.test(String((e as Error).message))) throw e
      await sleep(600 + attempt * 400)
    }
  }
}

// A single answer with no tools and no chat: improving a prompt, summarizing a long chat.
// `images` are shown to the model too (GPT 6 Sol, and Claude on your own key).
// deep: think hard first (writing, directing); off for quick jobs.
export async function complete(modelId: string, system: string, user: string, signal = new AbortController().signal, images: Attachment[] = [], deep = false) {
  const model = chatModel(modelId)
  const pictures = model.api === 'responses' ? await Promise.all(images.map(async (a) => ({ type: 'input_image', image_url: await kieUrlFor(a) }))) : []
  const claudeFiles = model.api === 'claude' ? await claudeBlocks(images) : []
  const effort = deep ? 'high' : 'low'
  const { path, body } = model.api === 'claude'
    ? { path: '', body: { model: model.id, system, max_tokens: 16000, messages: [{ role: 'user', content: claudeFiles.length ? [...claudeFiles, { type: 'text', text: user }] : user }], ...(deep && { thinkingFlag: true }) } }
    : model.api === 'responses'
    ? { path: '/codex/v1/responses', body: { model: model.id, reasoning: { effort }, input: [
        { role: 'developer', content: [{ type: 'input_text', text: system }] }, { role: 'user', content: [{ type: 'input_text', text: user }, ...pictures] }] } }
    : { path: `/${model.id}/v1/chat/completions`, body: { messages: [{ role: 'system', content: system }, { role: 'user', content: user }], reasoning_effort: effort }}
  // kie now and then ends a reply before any text arrives (unbilled); ask again, up to three times in all.
  for (let attempt = 0; ; attempt++) {
    let text = ''
    const credits = await turn(model, path, body, signal, new Map(), (t) => (text += t ?? ''))
    spend(model.id, credits ?? 0)
    if (text.trim()) return text.trim()
    if (attempt >= 2 || signal.aborted) throw new Error(`${model.label} sent back nothing.`)
  }
}

async function orGpt(first: string, system: string, user: string) {
  try {
    return await complete(first, system, user)
  } catch {
    return complete('gpt-6-sol', system, user)
  }
}
// Claude Sonnet improves the prompt; GPT 6 Sol does if Claude can't (no Claude key).
export const enhancePrompt = (prompt: string, kind: MediaKind, modelLabel: string) =>
  orGpt('claude-sonnet-5-5', [
    `Rewrite the user's idea as one strong prompt for ${modelLabel}, a ${kind === 'audio' ? 'music' : kind} generation model.`,
    'Keep their intent, subject, language and any text they want shown. Keep references like @img1 exactly as written.',
    kind === 'image' ? 'Add specifics: subject details, setting, composition, lighting, colour, style or medium, lens.'
    : kind === 'video' ? 'Add specifics: subject, action and motion, camera movement, setting, lighting, mood, pacing.'
    : 'Add specifics: genre, mood, tempo, instruments, vocals, structure.',
    'Reply with the prompt only: no quotes, no preamble, under 120 words.',
  ].join(' '), prompt)

// --- Long chats ---
// Past ~120k characters (about 30k tokens) the older messages are condensed into a summary by Gemini Flash, and only the
// last ones go to the model word for word. The summary is saved, so it's made once and extended as the chat grows.
const KEEP = 10
const LIMIT = 120_000
const SUMMARY_MODEL = 'gemini-3-8-flash-openai'
const weight = (ms: Message[]) => ms.reduce((n, m) => n + textOf(m).length + m.attachments.length * 3000, 0)

async function compact(chatId: string, history: Message[], signal: AbortSignal) {
  const row = db.prepare('SELECT summary, summary_upto FROM chats WHERE id = ?').get(chatId) as { summary: string | null; summary_upto: number | null } | undefined
  let summary = row?.summary ?? undefined
  const recent = history.filter((m) => m.createdAt > (row?.summary_upto ?? 0))
  if (recent.length <= KEEP || weight(recent) + (summary?.length ?? 0) < LIMIT) return { recent, summary }
  let cut = recent.length - KEEP
  while (cut > 0 && recent[cut].role !== 'user') cut-- // keep whole exchanges: the kept part starts with your message
  if (cut <= 0) return { recent, summary }
  const old = recent.slice(0, cut)
  try {
    const transcript = old.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${textOf(m)}`).join('\n\n').slice(-600_000)
    summary = await complete(SUMMARY_MODEL, [
      'You condense a conversation between a user and an AI assistant so the assistant can continue it without the full transcript.',
      "Write short bullet points in the conversation's language: the user's goals, facts and preferences they shared, decisions made,",
      'answers already given, open questions, and every file or result id mentioned with what it is (copy ids exactly). No preamble.',
    ].join(' '), (summary ? `Summary so far:\n${summary}\n\nWhat was said after that:\n\n` : '') + transcript, signal)
    db.prepare('UPDATE chats SET summary = ?, summary_upto = ? WHERE id = ?').run(summary, old.at(-1)!.createdAt, chatId)
    return { recent: recent.slice(cut), summary }
  } catch {
    // ponytail: a failed summary sends the full history this time and tries again on the next message.
    return { recent, summary: row?.summary ?? undefined }
  }
}

// --- One reply: a single answer, or in agent mode up to MAX_STEPS answers that see their own results ---

const costOf = (c: ToolCall) => estimate(c.modelId, c.input, c.prompt.length)?.hi ?? 0
// Credits a reply has used so far: its chat turns plus what its generations cost (or are expected to).
const spent = (msg: Message) =>
  (msg.credits ?? 0) +
  (msg.calls ?? []).filter((c) => c.status === 'started').reduce((n, c) => n + (c.taskIds ?? []).reduce((m, id) => m + (getTask(id)?.credits ?? costOf(c)), 0), 0)

// Waits until every call in a step is finished, failed, cancelled or still waiting after 30 minutes.
async function settle(calls: ToolCall[], signal: AbortSignal) {
  const until = Date.now() + 30 * 60_000
  const busy = (c: ToolCall) =>
    c.status === 'pending' || (c.status === 'started' && (c.taskIds ?? []).some((id) => !['success', 'fail'].includes(getTask(id)?.state ?? '')))
  while (!signal.aborted && Date.now() < until && calls.some(busy)) await sleep(1500)
}

async function run(chatId: string, modelId: string, thinking: boolean, agent: boolean, emit: Emit) {
  const model = chatModel(modelId)
  const msg: Message = { id: randomUUID(), chatId, role: 'assistant', text: '', thinking: '', attachments: [], model: model.id, createdAt: Date.now() }
  const ctrl = new AbortController()
  running.set(chatId, ctrl)
  emit({ type: 'start', chatId, message: msg })
  const history = getMessages(chatId)
  const project = getProject((db.prepare('SELECT project_id FROM chats WHERE id = ?').get(chatId) as { project_id: string | null } | undefined)?.project_id)
  const budget = agentBudget() / USD_PER_CREDIT
  const steps: { text: string; calls: string[] }[] = []
  const extra: Message[] = [] // earlier agent steps and their results, shown to the model on the next step
  live.set(msg.id, { msg, emit, projectId: project?.id })
  try {
    const { recent, summary } = await compact(chatId, history, ctrl.signal)
    for (let n = 1; n <= (agent ? MAX_STEPS : 1); n++) {
      const step = { text: '', calls: [] as string[] }
      steps.push(step)
      if (agent) (msg.agent = { steps, budget }), emit({ type: 'update', chatId, message: msg })
      const { path, body } = await request(model, [...recent, ...extra], thinking, { summary, project, agent: agent ? { step: n, budget } : undefined })
      const tools: ToolBuf = new Map()
      const credits = await turn(model, path, body, ctrl.signal, tools, (text, think) => {
        if (text) (step.text += text), (msg.text = steps.map((s) => s.text.trim()).filter(Boolean).join('\n\n'))
        if (think) msg.thinking += think
        emit({ type: 'delta', chatId, text, thinking: think })
      })
      if (credits != null) msg.credits = (msg.credits ?? 0) + credits

      // Turn finished tool calls into images (started now) and videos (waiting for Run).
      const files = [...(project?.files ?? []).filter((a) => a.mime.startsWith('image/')), ...chatFiles([...history, ...extra])]
      const calls: ToolCall[] = []
      for (const t of tools.values()) {
        if (t.name !== TOOL) continue
        try {
          calls.push(planCall(JSON.parse(t.json || '{}'), files))
        } catch {} // a cut-off call (you pressed Stop) is dropped
      }
      let over = false
      for (const c of calls) {
        if (agent && c.status !== 'error' && spent(msg) + costOf(c) > budget) {
          c.status = 'error'
          c.error = `Skipped: it would take this run over its $${agentBudget()} budget (Settings › Agent budget).`
          over = true
        } else if (c.status === 'started') await start(c, project?.id)
      }
      if (calls.length) msg.calls = [...(msg.calls ?? []), ...calls]
      step.calls = calls.map((c) => c.id)
      if (!agent || !calls.length || over || n === MAX_STEPS) break

      emit({ type: 'update', chatId, message: msg })
      await settle(calls, ctrl.signal)
      if (ctrl.signal.aborted) break
      const made = calls.flatMap((c) => (c.status === 'started' ? resultFiles(c).filter(isImage) : [])).map(asImage)
      extra.push(
        { id: randomUUID(), chatId, role: 'assistant', text: step.text, attachments: [], calls, createdAt: Date.now() },
        {
          id: randomUUID(), chatId, role: 'user', attachments: made, createdAt: Date.now(),
          text: [
            `[Automatic message from locco with the results of step ${n}; the user didn't type this.]`,
            made.length ? `The images you made are attached, in order: ${made.map((a) => a.file).join(', ')}.` : 'There are no new images to look at; the notes above say what happened.',
            "Check them against the user's request. Fix anything wrong, or continue with the next part. If everything is done, reply with a short final message and no tool call.",
            `Steps left: ${MAX_STEPS - n}. Budget left: about ${Math.max(0, Math.round(budget - spent(msg)))} credits.`,
          ].join('\n'),
        },
      )
    }
  } catch (e) {
    if (!ctrl.signal.aborted) msg.error = (e as Error).message
  } finally {
    running.delete(chatId)
    live.delete(msg.id)
  }
  if (!db.prepare('SELECT 1 FROM chats WHERE id = ?').get(chatId)) return // chat deleted mid-answer
  if (!msg.thinking) msg.thinking = undefined
  insert(msg)
  db.prepare('UPDATE chats SET updated_at = ?, model = ? WHERE id = ?').run(Date.now(), model.id, chatId)
  emit({ type: 'done', chatId, message: msg })
}
