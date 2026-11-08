import { app, BrowserWindow, dialog, globalShortcut, ipcMain, nativeTheme, protocol, safeStorage, session, shell, systemPreferences } from 'electron'
import { createReadStream } from 'node:fs'
import { copyFile, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { Readable } from 'node:stream'
import { chatModel } from '../shared/models'
import type { ChatEvent, GenerateRequest, MediaKind, Project, Ref, SendRequest, Settings } from '../shared/types'
import {
  cancelCall, deleteChat, deleteProject, enhancePrompt, exportMarkdown, getMessages, listChats, listProjects, moveChat, pinChat, regenerate,
  renameChat, runCall, saveProject, searchChats, send, stopChat,
} from './chat'
import { dirs, getSetting, openDb, setSetting, usage } from './db'
import { credits, setKey } from './kie'
import { mimeOf, pathOf, saveUpload } from './media'
import { generate, listTasks, removeTask, starTask, startPoller, transcribe } from './tasks'

let win: BrowserWindow | null = null
let keySource: Settings['keySource'] = null

// locco://media/<file> and locco://uploads/<file> serve local files to the window, and nothing outside those folders.
protocol.registerSchemesAsPrivileged([{ scheme: 'locco', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])

async function loadKey() {
  const saved = getSetting('apiKey')
  if (saved) {
    try {
      setKey((await safeStorage.decryptStringAsync(Buffer.from(saved, 'base64'))).result)
      keySource = 'saved'
      return
    } catch {} // Keychain refused: fall through and ask again in Settings.
  }
  if (!app.isPackaged) {
    try {
      process.loadEnvFile(join(app.getAppPath(), '.env'))
    } catch {}
  }
  if (process.env.KIE_API_KEY) {
    setKey(process.env.KIE_API_KEY)
    keySource = 'env'
  }
}

const settings = (): Settings => ({
  hasKey: keySource !== null,
  keySource,
  about: getSetting('about') ?? '',
  model: chatModel(getSetting('model')).id,
  agentBudget: Number(getSetting('agentBudget')) || 2,
})

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 760,
    minHeight: 520,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f0f10' : '#ffffff',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true },
  })
  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => (win = null))
  win.on('focus', () => win?.webContents.send('focus'))
  // Links open in your browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url === win?.webContents.getURL()) return
    e.preventDefault()
    if (/^https?:/.test(url)) void shell.openExternal(url)
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

const emit = (e: ChatEvent) => win?.webContents.send('chat:event', e)

app.whenReady().then(async () => {
  openDb(app.getPath('userData'))
  await loadKey()

  protocol.handle('locco', async (req) => {
    const { host, pathname } = new URL(req.url)
    if (host !== 'media' && host !== 'uploads') return new Response('Not found', { status: 404 })
    const path = join(dirs[host], basename(decodeURIComponent(pathname)))
    const size = await stat(path).then((s) => s.size, () => -1)
    if (size < 0) return new Response('Not found', { status: 404 })
    const headers = { 'Content-Type': mimeOf(path), 'Accept-Ranges': 'bytes' }
    // Video players ask for byte ranges to seek; answer them with 206 Partial Content.
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') ?? '')
    if (!range || (!range[1] && !range[2]))
      return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, { headers: { ...headers, 'Content-Length': String(size) } })
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
    if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    return new Response(Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream, {
      status: 206,
      headers: { ...headers, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}` },
    })
  })

  ipcMain.handle('settings:get', settings)
  ipcMain.handle('settings:set', async (_e, s: { apiKey?: string; about?: string; model?: string; agentBudget?: number }) => {
    if (s.apiKey !== undefined) {
      const k = s.apiKey.trim()
      setKey(k)
      await credits() // throws a readable error if the key is wrong, before anything is saved
      setSetting('apiKey', (await safeStorage.encryptStringAsync(k)).toString('base64'))
      keySource = 'saved'
    }
    if (s.about !== undefined) setSetting('about', s.about)
    if (s.model !== undefined) setSetting('model', s.model)
    if (s.agentBudget !== undefined && s.agentBudget > 0) setSetting('agentBudget', String(s.agentBudget))
    return settings()
  })
  ipcMain.handle('credits', () => credits())
  ipcMain.handle('usage', () => usage())

  ipcMain.handle('chats:list', listChats)
  ipcMain.handle('chats:search', (_e, q: string) => searchChats(q))
  ipcMain.handle('chats:messages', (_e, id: string) => getMessages(id))
  ipcMain.handle('chats:rename', (_e, id: string, title: string) => void renameChat(id, title))
  ipcMain.handle('chats:delete', (_e, id: string) => void deleteChat(id))
  ipcMain.handle('chats:pin', (_e, id: string, on: boolean) => void pinChat(id, on))
  ipcMain.handle('chats:move', (_e, id: string, projectId: string | null) => void moveChat(id, projectId))
  ipcMain.handle('chats:export', async (_e, id: string) => {
    if (!win) return
    const { title, markdown } = exportMarkdown(id)
    const name = title.replace(/[/\\:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'Chat'
    const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: join(app.getPath('downloads'), `${name}.md`) })
    if (!canceled && filePath) await writeFile(filePath, markdown)
  })
  ipcMain.handle('projects:list', listProjects)
  ipcMain.handle('projects:save', (_e, p: Partial<Project>) => saveProject(p))
  ipcMain.handle('projects:delete', (_e, id: string) => deleteProject(id))
  ipcMain.handle('chat:send', (_e, req: SendRequest) => send(req, emit))
  ipcMain.handle('chat:regenerate', (_e, id: string, model: string, thinking: boolean, agent: boolean) => regenerate(id, model, thinking, agent, emit))
  ipcMain.handle('chat:stop', (_e, id: string) => void stopChat(id))
  ipcMain.handle('chat:runCall', (_e, messageId: string, callId: string) => runCall(messageId, callId))
  ipcMain.handle('chat:cancelCall', (_e, messageId: string, callId: string) => cancelCall(messageId, callId))

  ipcMain.handle('files:save', (_e, name: string, mime: string, bytes: Uint8Array) => saveUpload(name, mime, bytes))
  ipcMain.handle('files:reveal', (_e, ref: Ref) => shell.showItemInFolder(pathOf(ref)))
  ipcMain.handle('files:saveAs', async (_e, ref: Ref) => {
    if (!win) return
    const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: join(app.getPath('downloads'), ref.file) })
    if (!canceled && filePath) await copyFile(pathOf(ref), filePath)
  })
  ipcMain.handle('files:openData', () => shell.openPath(dirs.root))

  ipcMain.handle('tasks:list', listTasks)
  ipcMain.handle('tasks:generate', (_e, req: GenerateRequest) => generate(req))
  ipcMain.handle('tasks:star', (_e, id: string, on: boolean) => starTask(id, on))
  ipcMain.handle('create:enhance', (_e, prompt: string, kind: MediaKind, modelLabel: string) => enhancePrompt(prompt, kind, modelLabel))
  ipcMain.handle('audio:transcribe', (_e, recording: Ref) => transcribe(recording))
  // The microphone is only used while you hold dictation open; macOS asks once.
  ipcMain.handle('audio:micAccess', () => (process.platform === 'darwin' ? systemPreferences.askForMediaAccess('microphone') : true))
  const audioOnly = (types?: string[]) => !!types?.length && types.every((t) => t === 'audio')
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb, details) =>
    cb(permission === 'media' && audioOnly((details as { mediaTypes?: string[] }).mediaTypes)))
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media')
  ipcMain.handle('tasks:remove', (_e, id: string) => removeTask(id))

  createWindow()
  // ⌥Space from anywhere: bring locco up with a fresh chat, or hide it again.
  // ponytail: fails quietly if another app (ChatGPT, Raycast) owns ⌥Space; make it a setting if that bites.
  globalShortcut.register('Alt+Space', () => {
    if (win?.isFocused()) return app.hide()
    if (!win) return createWindow()
    win.show()
    win.focus()
    win.webContents.send('quick')
  })
  startPoller(() => win?.webContents.send('tasks:changed'))
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})

app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit())
