import { contextBridge, ipcRenderer } from 'electron'
import type { Attachment, Chat, ChatEvent, ChatHit, CutRequest, GenerateRequest, MediaKind, Message, Project, Ref, SendRequest, Series, Settings, Shot, Task, UsageRow } from '../shared/types'

const on = <T>(channel: string) => (cb: (v: T) => void) => {
  const handler = (_e: unknown, v: T) => cb(v)
  ipcRenderer.on(channel, handler)
  return () => void ipcRenderer.removeListener(channel, handler)
}

const api = {
  settings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (s: { apiKey?: string; about?: string; model?: string; agentBudget?: number }): Promise<Settings> => ipcRenderer.invoke('settings:set', s),
  credits: (): Promise<number> => ipcRenderer.invoke('credits'),
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
  writeSeries: (idea: string, episodes: number, seconds: number): Promise<Series> => ipcRenderer.invoke('series:write', idea, episodes, seconds),
  writeEpisode: (s: Series, index: number, shotSeconds: number): Promise<Shot[]> => ipcRenderer.invoke('series:episode', s, index, shotSeconds),
  reviewFrames: (portraits: { name: string; file: string }[], frames: { n: number; description: string; file: string }[]): Promise<{ shot: number; fix: string }[]> =>
    ipcRenderer.invoke('series:review', portraits, frames),
  cut: (req: CutRequest): Promise<string> => ipcRenderer.invoke('series:cut', req),
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
