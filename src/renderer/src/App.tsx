import { useCallback, useEffect, useState } from 'react'
import { setElevenVoices } from '../../shared/models'
import type { Attachment, Chat, Project, Settings } from '../../shared/types'
import { ChatView } from './Chat'
import { Create } from './Create'
import { api, load, save } from './lib'
import { ProjectView } from './Project'
import { SeriesView } from './Series'
import { SettingsDialog, UsageDialog } from './Settings'
import { Sidebar } from './Sidebar'

type View = { kind: 'chat'; id: string; draft?: Attachment[]; projectId?: string } | { kind: 'create' } | { kind: 'series' } | { kind: 'project'; id: string }

export default function App() {
  const [view, setView] = useState<View>(() => ({ kind: 'chat', id: crypto.randomUUID() }))
  const [chats, setChats] = useState<Chat[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [credits, setCredits] = useState<number | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [usageOpen, setUsageOpen] = useState(false)
  const [lowBalance, setLowBalance] = useState(() => load('lowBalance', 100))
  const [collapsed, setCollapsed] = useState(() => load('sidebarCollapsed', false))

  const refreshChats = useCallback(() => void api.chats().then(setChats), [])
  const refreshProjects = useCallback(() => void api.projects().then(setProjects), [])
  const refreshCredits = useCallback(() => void api.credits().then(setCredits, () => setCredits(null)), [])
  // ElevenLabs voices fill the voice menus; `voices` re-renders the screens once they arrive.
  const [, setVoices] = useState(0)
  const refreshVoices = useCallback(() => void api.elevenVoices().then((list) => (setElevenVoices(list), setVoices(list.length))), [])
  const newChat = useCallback((projectId?: string) => setView({ kind: 'chat', id: crypto.randomUUID(), projectId }), [])

  useEffect(() => {
    refreshChats()
    refreshProjects()
    refreshVoices()
    setTimeout(refreshVoices, 4000) // the main process loads them in the background at launch
    api.settings().then((s) => {
      setSettings(s)
      if (s.hasKey) refreshCredits()
      else setSettingsOpen(true)
    })
    const offFocus = api.onFocus(refreshCredits)
    const offQuick = api.onQuick(() => newChat())
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === 'n') (e.preventDefault(), newChat())
      if (e.metaKey && e.key === ',') (e.preventDefault(), setSettingsOpen(true))
    }
    addEventListener('keydown', onKey)
    return () => (offFocus(), offQuick(), removeEventListener('keydown', onKey))
  }, [refreshChats, refreshProjects, refreshCredits, refreshVoices, newChat])

  const setSidebar = (v: boolean) => (setCollapsed(v), save('sidebarCollapsed', v))
  if (!settings) return null

  const header = { collapsed, onExpand: () => setSidebar(false) }
  const openChat = view.kind === 'chat' ? chats.find((c) => c.id === view.id) : undefined
  const projectOf = (id?: string) => projects.find((p) => p.id === id)
  return (
    <div className="flex h-full">
      {!collapsed && (
        <Sidebar
          chats={chats}
          projects={projects}
          activeId={view.kind === 'chat' ? view.id : null}
          activeProjectId={view.kind === 'project' ? view.id : null}
          createActive={view.kind === 'create'}
          seriesActive={view.kind === 'series'}
          onSeries={() => setView({ kind: 'series' })}
          credits={credits}
          lowBalance={lowBalance}
          onSelect={(id) => setView({ kind: 'chat', id })}
          onProject={(id) => setView({ kind: 'project', id })}
          onNewProject={() => api.saveProject({ name: 'New project' }).then((p) => (refreshProjects(), setView({ kind: 'project', id: p.id })))}
          onNew={() => newChat()}
          onCreate={() => setView({ kind: 'create' })}
          onCollapse={() => setSidebar(true)}
          onSettings={() => setSettingsOpen(true)}
          onUsage={() => setUsageOpen(true)}
          onChanged={refreshChats}
        />
      )}
      <main className="relative flex min-w-0 flex-1 flex-col">
        {view.kind === 'chat' ? (
          <ChatView
            key={view.id}
            chatId={view.id}
            chat={openChat}
            project={projectOf(openChat?.projectId ?? view.projectId)}
            draft={view.draft}
            defaultModel={settings.model}
            header={header}
            onOpenProject={(id) => setView({ kind: 'project', id })}
            onChanged={() => (refreshChats(), refreshCredits())}
          />
        ) : view.kind === 'series' ? (
          <SeriesView header={header} onChanged={refreshCredits} />
        ) : view.kind === 'project' && projectOf(view.id) ? (
          <ProjectView
            key={view.id}
            project={projectOf(view.id)!}
            chats={chats.filter((c) => c.projectId === view.id)}
            header={header}
            onNewChat={() => newChat(view.id)}
            onOpenChat={(id) => setView({ kind: 'chat', id })}
            onChanged={refreshProjects}
            onDeleted={() => (refreshProjects(), refreshChats(), newChat())}
          />
        ) : (
          <Create header={header} onChanged={refreshCredits} onSendToChat={(a) => setView({ kind: 'chat', id: crypto.randomUUID(), draft: [a] })} />
        )}
      </main>
      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onSaved={(s) => (setSettings(s), refreshCredits(), refreshVoices())}
        />
      )}
      {usageOpen && (
        <UsageDialog
          credits={credits}
          lowBalance={lowBalance}
          onLowBalance={(n) => (setLowBalance(n), save('lowBalance', n))}
          onClose={() => setUsageOpen(false)}
        />
      )}
    </div>
  )
}
