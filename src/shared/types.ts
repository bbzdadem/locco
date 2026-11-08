export type Ref = { kind: 'uploads' | 'media'; file: string }
export type Attachment = Ref & { name: string; mime: string }

// summaryUpto: messages up to this time are condensed into a summary for the model (long chats).
export type Chat = { id: string; title: string; model: string; updatedAt: number; pinned?: boolean; projectId?: string; summaryUpto?: number }
// A project groups chats and gives them shared instructions and files.
export type Project = { id: string; name: string; instructions: string; files: Attachment[]; createdAt: number }
// A search hit: the chat plus the bit of a message that matched (none when only the title matched).
export type ChatHit = Chat & { snippet?: string }
export type Message = {
  id: string
  chatId: string
  role: 'user' | 'assistant'
  text: string
  thinking?: string
  attachments: Attachment[]
  model?: string
  credits?: number
  error?: string
  calls?: ToolCall[]
  // Agent replies: what each step said and which calls it made. budget is in credits.
  agent?: { steps: { text: string; calls: string[] }[]; budget: number }
  createdAt: number
}
// One image or video the assistant asked for. Images start right away; videos wait for you to press Run.
export type ToolCall = {
  id: string
  modelId: string
  label: string
  kind: MediaKind
  variant: Variant
  prompt: string
  input: Record<string, unknown>
  cost: string
  status: 'pending' | 'started' | 'cancelled' | 'error'
  taskIds?: string[]
  error?: string
  notes?: string[]
}
export type ChatEvent =
  | { type: 'start'; chatId: string; message: Message }
  | { type: 'delta'; chatId: string; text?: string; thinking?: string }
  | { type: 'update'; chatId: string; message: Message }
  | { type: 'done'; chatId: string; message: Message }
export type SendRequest = {
  chatId: string; text: string; attachments: Attachment[]; model: string; thinking: boolean; agent?: boolean; editOf?: string; projectId?: string
}

export type Variant = 'text' | 'image' | 'tool'
export type Field = {
  name: string
  label?: string
  type: string
  enum?: (string | number)[]
  enumLabels?: Record<string, string>
  default?: unknown
  media?: boolean
  accept?: 'image' | 'video' | 'audio'
  maxItems?: number
  min?: number
  max?: number
  required?: boolean
  description: string
}
export type ModelSpec = { path: string; slug: string; deprecated: boolean; fields: Field[]; fixed?: Record<string, unknown>; tags?: string[] }
export type MediaKind = 'image' | 'video' | 'audio'
export type MediaModel = {
  id: string
  kind: MediaKind
  label: string
  hidden?: boolean
  text?: ModelSpec
  image?: ModelSpec
  tool?: ModelSpec
  // Rows from kie's price list: description, credits, unit (per item / per second / other).
  prices?: { d: string; c: number; u: 'item' | 'second' | 'other' }[]
}

export type TaskState = 'waiting' | 'queuing' | 'generating' | 'success' | 'fail'
export type Task = {
  id: string
  modelId: string
  variant: Variant
  label: string
  prompt: string
  input: Record<string, unknown>
  state: TaskState
  files: string[]
  // Suno track ids and covers (for Extend and Split vocals), or a transcript.
  meta?: { tracks?: { file: string; id: string; title?: string; cover?: string }[]; text?: string }
  credits?: number
  error?: string
  starred?: boolean
  projectId?: string
  createdAt: number
  completedAt?: number
}
export type GenerateRequest = { modelId: string; variant: Variant; prompt: string; input: Record<string, unknown>; count: number; projectId?: string }

// agentBudget: the most one agent run may spend, in dollars.
// elevenVoices: how many voices the saved ElevenLabs key can use (0 when there is no key).
export type Settings = { hasKey: boolean; keySource: 'saved' | 'env' | null; about: string; model: string; agentBudget: number; hasEleven: boolean; elevenVoices: number }
// Credits spent per day and model. extra = prompt improvements and chat summaries.
export type UsageRow = { day: string; source: 'chat' | 'media' | 'extra'; model: string; credits: number }

// --- Series ---
// A saved character, castable in any series. The portrait is picked from a few options; the reference sheet is made from it.
export type Character = {
  id: string
  name: string
  look: string
  personality: string
  voice?: string
  photo?: Attachment
  options?: string[]
  portraitTask?: string
  sheetTask?: string
  createdAt: number
}
// A spoken line. seconds is measured once the voice is made; it decides how long the scene runs.
export type Line = { speaker: string; text: string; voiceTask?: string; seconds?: number }
export type Scene = {
  id: string
  place: string
  action: string
  camera: string
  cast: string[]
  lines: Line[]
  frameTask?: string
  versions?: string[]
  approved?: boolean
  videoTask?: string
}
// Episodes move through the steps in order; script and scenes wait for your approval.
export type Step = 'script' | 'scenes' | 'voices' | 'video' | 'cut'
export type Episode = { id: string; title: string; summary: string; step: Step; scenes: Scene[]; recap?: string; music?: boolean; musicTask?: string; cut?: string }
// continuity: running notes on what has happened, kept up to date after every finished episode.
export type Series = {
  id: string
  title: string
  idea: string
  logline: string
  style: string
  seconds: number
  imageModel: string
  videoModel: string
  videoSound?: boolean
  cast: string[]
  continuity: string
  episodes: Episode[]
  createdAt: number
}
// One cut: scene videos trimmed to `seconds`, voices placed `at` seconds into their scene, music underneath.
export type CutRequest = { name: string; scenes: { video: string; seconds: number; voices: { file: string; at: number }[] }[]; music?: string; videoSound?: boolean }
