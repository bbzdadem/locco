import { FileText, MessageSquare, Paperclip, SquarePen, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Chat, Project, Task } from '../../shared/types'
import { isAudio, Media } from './Create'
import { ACCEPT_CHAT, api, errMsg, mediaUrl, toAttachments } from './lib'
import { Header, IconButton } from './ui'

// A project: its name, instructions and files (sent with every chat in it), its chats, and what those chats made.
export function ProjectView({ project, chats, header, onNewChat, onOpenChat, onChanged, onDeleted }: {
  project: Project
  chats: Chat[]
  header: { collapsed: boolean; onExpand: () => void }
  onNewChat: () => void
  onOpenChat: (id: string) => void
  onChanged: () => void
  onDeleted: () => void
}) {
  const [name, setName] = useState(project.name)
  const [instructions, setInstructions] = useState(project.instructions)
  const [tasks, setTasks] = useState<Task[]>([])
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState('')
  const picker = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const load = () => void api.tasks().then((all) => setTasks(all.filter((t) => t.projectId === project.id && t.state === 'success')))
    load()
    return api.onTasks(load)
  }, [project.id])

  const saveField = (p: Partial<Project>) => void api.saveProject({ id: project.id, ...p }).then(onChanged, (e) => setError(errMsg(e)))
  // Saves half a second after you stop typing (and on blur), so nothing typed is lost.
  useEffect(() => {
    if (name.trim() === project.name && instructions === project.instructions) return
    const t = setTimeout(() => saveField({ name, instructions }), 500)
    return () => clearTimeout(t)
  }, [name, instructions])
  async function addFiles(list: FileList) {
    const added = await toAttachments(list, ACCEPT_CHAT)
    setError(added.length < list.length ? 'Only images and PDFs can be added.' : '')
    saveField({ files: [...project.files, ...added.filter((a) => !project.files.some((f) => f.file === a.file))] })
  }
  const results = tasks.flatMap((t) => t.files.filter((f) => !isAudio(f)).map((file) => ({ t, file })))

  return (
    <div className="flex h-full flex-col">
      <Header {...header}>
        <span className="text-muted">Project</span>
      </Header>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 pt-2 pb-16">
          <div className="flex items-center gap-3">
            <input
              id="project-name"
              value={name}
              autoFocus={project.name === 'New project'}
              onFocus={(e) => project.name === 'New project' && e.currentTarget.select()}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => name.trim() !== project.name && saveField({ name })}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              aria-label="Project name"
              className="min-w-0 flex-1 bg-transparent text-[26px] font-semibold tracking-tight"
            />
            <button type="button" onClick={onNewChat} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full bg-inverse px-4 font-medium text-on-inverse">
              <SquarePen size={15} /> New chat
            </button>
          </div>

          <section className="flex flex-col gap-2">
            <h2 className="font-medium">Instructions</h2>
            <textarea
              id="project-instructions"
              rows={5}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              onBlur={() => instructions !== project.instructions && saveField({ instructions })}
              placeholder="What every chat in this project should know: the goal, tone, brand colours, who it's for."
              className="resize-none rounded-xl border border-line bg-bg px-3 py-2.5 leading-relaxed focus:border-fg"
            />
          </section>

          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">Files</h2>
              <button type="button" onClick={() => picker.current?.click()} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-[13px] hover:bg-raised">
                <Paperclip size={14} /> Add images or PDFs
              </button>
              <input ref={picker} type="file" multiple accept={ACCEPT_CHAT} hidden onChange={(e) => (e.target.files && addFiles(e.target.files), (e.target.value = ''))} />
            </div>
            {project.files.length ? (
              <div className="flex flex-wrap gap-2">
                {project.files.map((a) => (
                  <div key={a.file} className="group relative">
                    {a.mime.startsWith('image/') ? (
                      <img src={mediaUrl(a)} alt={a.name} className="size-20 rounded-xl border border-line object-cover" />
                    ) : (
                      <div className="flex h-20 max-w-52 items-center gap-2 rounded-xl border border-line bg-raised px-3">
                        <FileText size={18} className="shrink-0 text-muted" />
                        <span className="truncate text-[13px]">{a.name}</span>
                      </div>
                    )}
                    <button
                      type="button"
                      aria-label={`Remove ${a.name}`}
                      onClick={() => saveField({ files: project.files.filter((f) => f.file !== a.file) })}
                      className="absolute -top-1.5 -right-1.5 hidden size-5 items-center justify-center rounded-full bg-inverse text-on-inverse group-hover:flex"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-muted">Logos, references, briefs. Every chat here can see them and use images as references.</p>
            )}
          </section>

          <section className="flex flex-col gap-1">
            <h2 className="mb-1 font-medium">Chats</h2>
            {chats.map((c) => (
              <button key={c.id} type="button" onClick={() => onOpenChat(c.id)} className="flex h-10 items-center gap-2.5 rounded-lg px-2.5 text-left hover:bg-raised">
                <MessageSquare size={15} className="shrink-0 text-muted" />
                <span className="truncate">{c.title}</span>
                <span className="ml-auto shrink-0 text-xs text-faint">{new Date(c.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
              </button>
            ))}
            {!chats.length && <p className="text-[13px] text-muted">No chats yet. Start one, or move a chat here from the sidebar.</p>}
          </section>

          {results.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="font-medium">Made in this project</h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
                {results.map(({ t, file }) => (
                  <button key={file} type="button" title={t.prompt} onClick={() => api.reveal({ kind: 'media', file })} className="overflow-hidden rounded-xl bg-raised">
                    <Media file={file} alt={t.prompt} className="aspect-square w-full object-cover" />
                  </button>
                ))}
              </div>
            </section>
          )}

          {error && <p className="text-danger">{error}</p>}
          <div className="flex items-center gap-2 border-t border-line pt-4 text-[13px]">
            {confirm ? (
              <>
                <span>Delete this project? Its chats and results stay.</span>
                <button type="button" onClick={() => api.deleteProject(project.id).then(onDeleted)} className="h-8 rounded-full bg-inverse px-3.5 font-medium text-on-inverse">
                  Delete
                </button>
                <button type="button" onClick={() => setConfirm(false)} className="h-8 rounded-full px-3 hover:bg-raised">
                  Keep
                </button>
              </>
            ) : (
              <IconButton title="Delete project" onClick={() => setConfirm(true)}>
                <Trash2 size={15} />
              </IconButton>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
