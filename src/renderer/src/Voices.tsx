import { LoaderCircle, Plus, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { setElevenVoices } from '../../shared/models'
import { api, errMsg } from './lib'
import { IconButton } from './ui'

// Refresh the ElevenLabs voice list (after adding voices on elevenlabs.io), or use a voice by its ID or a link containing it.
// onChange runs with the new list, and with the voice id when one was just added, so the caller can select it.
export function VoiceTools({ onChange }: { onChange: (addedId?: string) => void }) {
  const [busy, setBusy] = useState<'refresh' | 'add' | null>(null)
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const [note, setNote] = useState('')

  async function refresh() {
    setBusy('refresh')
    setNote('')
    try {
      const list = await api.refreshVoices()
      setElevenVoices(list)
      onChange()
      setNote(`${list.length} voices`)
    } catch (e) {
      setNote(errMsg(e))
    } finally {
      setBusy(null)
    }
  }
  async function add() {
    if (!text.trim()) return
    setBusy('add')
    setNote('')
    try {
      const { voice, list } = await api.addVoice(text)
      setElevenVoices(list)
      onChange(voice.id)
      setAdding(false)
      setText('')
      setNote(`Added ${voice.name}`)
    } catch (e) {
      setNote(errMsg(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <IconButton title="Refresh voices from your ElevenLabs account" className="size-8" disabled={!!busy} onClick={refresh}>
        {busy === 'refresh' ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}
      </IconButton>
      {adding ? (
        <span className="inline-flex items-center gap-1">
          <input
            autoFocus
            aria-label="Voice ID or link"
            value={text}
            onChange={(e) => setText(e.target.value)}
            // Not a <form>: this sits inside the Settings form, and forms can't nest.
            onKeyDown={(e) => (e.key === 'Escape' ? setAdding(false) : e.key === 'Enter' && (e.preventDefault(), add()))}
            placeholder="Voice ID or Voice Library link"
            className="h-8 w-60 rounded-full border border-line bg-transparent px-3 text-[13px] focus:border-fg"
          />
          <button type="button" onClick={add} disabled={!text.trim() || !!busy} className="h-8 rounded-full bg-inverse px-3 text-[13px] font-medium text-on-inverse disabled:opacity-40">
            {busy === 'add' ? 'Checking…' : 'Use'}
          </button>
        </span>
      ) : (
        <IconButton title="Use a voice by its ID or a Voice Library link" className="size-8" disabled={!!busy} onClick={() => (setAdding(true), setNote(''))}>
          <Plus size={14} />
        </IconButton>
      )}
      {note && <span className="text-xs text-muted">{note}</span>}
    </span>
  )
}
