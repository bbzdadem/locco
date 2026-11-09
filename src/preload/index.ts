import { contextBridge, ipcRenderer } from 'electron'
import type { Attachment, Character, Chat, ChatEvent, ChatHit, EditProject, GenerateRequest, MediaKind, Message, Project, ProjectRender, Ref, RenderRequest, Scene, SendRequest, Series, ShotPlan, Settings, Task, UsageRow } from '../shared/types'

type Voice = { id: string; name: string; about: string; premade?: boolean }

const on = <T>(channel: string) => (cb: (v: T) => void) => {
  const handler = (_e: unknown, v: T) => cb(v)
  ipcRenderer.on(channel, handler)
  return () => void ipcRenderer.removeListener(channel, handler)
}

const api = {
  settings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (s: { apiKey?: string; elevenKey?: string; about?: string; model?: string; agentBudget?: number }): Promise<Settings> => ipcRenderer.invoke('settings:set', s),
  elevenVoices: (): Promise<Voice[]> => ipcRenderer.invoke('eleven:voices'),
  refreshVoices: (): Promise<Voice[]> => ipcRenderer.invoke('eleven:refresh'),
  addVoice: (text: string): Promise<{ voice: Voice; list: Voice[] }> => ipcRenderer.invoke('eleven:add', text),
  credits: (): Promise<number> => ipcRenderer.invoke('credits'),
  copy: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write', text),
  usage: (): Promise<UsageRow[]> => ipcRenderer.invoke('usage'),

  chats: (): Promise<Chat[]> => ipcRenderer.invoke('chats:list'),
  searchChats: (q: string): Promise<ChatHit[]> => ipcRenderer.invoke('chats:search', q),
  messages: (chatId: string): Promise<Message[]> => ipcRenderer.invoke('chats:messages', chatId),
  renameChat: (id: string, title: string): Promise<void> => ipcRenderer.invoke('chats:rename', id, title),
  deleteChat: (id: string): Promise<void> => ipcRenderer.invoke('chats:delete', id),
  pinChat: (id: string, on: boolean): Promise<void> => ipcRenderer.invoke('chats:pin', id, on),
  moveChat: (id: string, projectId: string | null): Promise<void> => ipcRenderer.invoke('chats:move', id, projectId),
  exportChat: (id: string): Promise<void> => ipcRenderer.invoke('chats:export', id),
  projects: (): Promise<Project[]> => ipcRenderer.invoke('projects:list'),
  saveProject: (p: Partial<Project>): Promise<Project> => ipcRenderer.invoke('projects:save', p),
  deleteProject: (id: string): Promise<void> => ipcRenderer.invoke('projects:delete', id),
  series: (): Promise<Series[]> => ipcRenderer.invoke('series:list'),
  saveSeries: (s: Series): Promise<void> => ipcRenderer.invoke('series:save', s),
  deleteSeries: (id: string): Promise<void> => ipcRenderer.invoke('series:delete', id),
  deletedSeries: (): Promise<{ series: Series; deletedAt: number }[]> => ipcRenderer.invoke('series:deleted'),
  restoreSeries: (id: string): Promise<void> => ipcRenderer.invoke('series:restore', id),
  writeSeries: (idea: string, episodes: number, seconds: number, cast: string[], style?: { text?: string; refs?: Attachment[] }, elements?: string[]): Promise<{ series: Series; created: Character[] }> =>
    ipcRenderer.invoke('series:write', idea, episodes, seconds, cast, style, elements),
  writeScript: (s: Series, index: number): Promise<{ beats: string; scenes: Scene[]; by: string }> => ipcRenderer.invoke('series:script', s, index),
  directScript: (s: Series, index: number, scenes: Scene[]): Promise<{ plans: (ShotPlan | undefined)[]; by: string }> => ipcRenderer.invoke('series:direct', s, index, scenes),
  improveScene: (s: Series, index: number, scenes: Scene[], at: number, note = ''): Promise<{ scene: Scene; by: string }> => ipcRenderer.invoke('series:improveScene', s, index, scenes, at, note),
  reviseScript: (s: Series, index: number, scenes: Scene[], change: string): Promise<Scene[]> => ipcRenderer.invoke('series:revise', s, index, scenes, change),
  writeRecap: (s: Series, index: number): Promise<{ recap: string; continuity: string }> => ipcRenderer.invoke('series:recap', s, index),
  improveSummary: (s: Series, index: number, text: string): Promise<string> => ipcRenderer.invoke('series:improve', s, index, text),
  render: (req: RenderRequest): Promise<string> => ipcRenderer.invoke('series:render', req),
  characters: (): Promise<Character[]> => ipcRenderer.invoke('characters:list'),
  saveCharacter: (c: Character): Promise<void> => ipcRenderer.invoke('characters:save', c),
  deleteCharacter: (id: string): Promise<void> => ipcRenderer.invoke('characters:delete', id),
  mediaSeconds: (file: string | Ref): Promise<number> => ipcRenderer.invoke('media:seconds', file),
  thumb: (ref: Ref): Promise<Ref> => ipcRenderer.invoke('media:thumb', ref),
  edits: (): Promise<EditProject[]> => ipcRenderer.invoke('edits:list'),
  saveEdit: (p: EditProject): Promise<void> => ipcRenderer.invoke('edits:save', p),
  deleteEdit: (id: string): Promise<void> => ipcRenderer.invoke('edits:delete', id),
  renderEdit: (req: ProjectRender): Promise<string> => ipcRenderer.invoke('edits:render', req),
  send: (req: SendRequest): Promise<void> => ipcRenderer.invoke('chat:send', req),
  regenerate: (chatId: string, model: string, thinking: boolean, agent: boolean): Promise<void> =>
    ipcRenderer.invoke('chat:regenerate', chatId, model, thinking, agent),
  stop: (chatId: string): Promise<void> => ipcRenderer.invoke('chat:stop', chatId),
  runCall: (messageId: string, callId: string): Promise<void> => ipcRenderer.invoke('chat:runCall', messageId, callId),
  cancelCall: (messageId: string, callId: string): Promise<void> => ipcRenderer.invoke('chat:cancelCall', messageId, callId),

  saveFile: (name: string, mime: string, bytes: Uint8Array): Promise<Attachment> => ipcRenderer.invoke('files:save', name, mime, bytes),
  reveal: (ref: Ref): Promise<void> => ipcRenderer.invoke('files:reveal', ref),
  saveAs: (ref: Ref): Promise<void> => ipcRenderer.invoke('files:saveAs', ref),
  openData: (): Promise<void> => ipcRenderer.invoke('files:openData'),

  tasks: (): Promise<Task[]> => ipcRenderer.invoke('tasks:list'),
  generate: (req: GenerateRequest): Promise<string[]> => ipcRenderer.invoke('tasks:generate', req),
  starTask: (id: string, on: boolean): Promise<void> => ipcRenderer.invoke('tasks:star', id, on),
  enhance: (prompt: string, kind: MediaKind, modelLabel: string): Promise<string> => ipcRenderer.invoke('create:enhance', prompt, kind, modelLabel),
  transcribe: (recording: Ref): Promise<string> => ipcRenderer.invoke('audio:transcribe', recording),
  micAccess: (): Promise<boolean> => ipcRenderer.invoke('audio:micAccess'),
  removeTask: (id: string): Promise<void> => ipcRenderer.invoke('tasks:remove', id),

  onChat: on<ChatEvent>('chat:event'),
  onTasks: on<void>('tasks:changed'),
  onFocus: on<void>('focus'),
  onQuick: on<void>('quick'),
}

contextBridge.exposeInMainWorld('locco', api)
export type Api = typeof api
