import { FolderOpen, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { CHAT_MODELS, chatModel, withBest } from '../../shared/models'
import { USD_PER_CREDIT } from '../../shared/prices'
import type { Settings, UsageRow } from '../../shared/types'
import { api, errMsg, fmtCredits } from './lib'

export function SettingsDialog({ settings, onClose, onSaved }: { settings: Settings; onClose: () => void; onSaved: (s: Settings) => void }) {
  const welcome = !settings.hasKey
  const [key, setKey] = useState('')
  const [about, setAbout] = useState(settings.about)
  const [model, setModel] = useState(settings.model)
  const [budget, setBudget] = useState(String(settings.agentBudget))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (welcome && !key.trim()) return setError('Paste your kie.ai API key to continue.')
    setBusy(true)
    setError('')
    try {
      onSaved(await api.saveSettings({ ...(key.trim() && { apiKey: key }), about, model, agentBudget: Number(budget) || settings.agentBudget }))
      onClose()
    } catch (err) {
      setError(errMsg(err).includes('401') || /access|auth/i.test(errMsg(err)) ? 'kie rejected that key. Check it and paste it again.' : errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  const keyStatus =
    settings.keySource === 'saved' ? 'A key is saved, encrypted on this Mac.'
    : settings.keySource === 'env' ? 'Using the development key from .env. Paste a key to save it in the app.'
    : 'No key yet.'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6 backdrop-blur-sm" onMouseDown={() => !welcome && onClose()}>
      <form
        onSubmit={submit}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-[520px] flex-col gap-6 overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">{welcome ? 'Welcome to locco' : 'Settings'}</h2>
            {welcome && <p className="mt-1 text-muted">locco runs every model through your kie.ai account. Paste your API key to start.</p>}
          </div>
          {!welcome && (
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-raised hover:text-fg">
              <X size={18} />
            </button>
          )}
        </div>

        <label className="flex flex-col gap-2">
          <span className="font-medium">kie.ai API key</span>
          <input
            id="api-key"
            type="password"
            autoFocus={welcome}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={settings.hasKey ? 'Paste a new key to replace it' : 'Paste your key'}
            className="h-10 rounded-xl border border-line bg-bg px-3 font-mono text-[13px] focus:border-fg"
          />
          <span className="text-xs text-muted">
            {keyStatus} Get a key at{' '}
            <a href="https://kie.ai/api-key" target="_blank" rel="noreferrer" className="underline underline-offset-2">
              kie.ai/api-key
            </a>
            .
          </span>
        </label>

        <label className="flex flex-col gap-2">
          <span className="font-medium">About you</span>
          <textarea
            id="about"
            rows={4}
            value={about}
            onChange={(e) => setAbout(e.target.value)}
            placeholder="What locco should always know: your name, work, how you like answers."
            className="resize-none rounded-xl border border-line bg-bg px-3 py-2.5 leading-relaxed focus:border-fg"
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="font-medium">Default chat model</span>
          <select id="default-model" value={model} onChange={(e) => setModel(e.target.value)} className="h-10 rounded-xl border border-line bg-bg px-3">
            {CHAT_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {withBest(m.label, m.id)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-2">
          <span className="font-medium">Agent budget per run</span>
          <div className="flex items-center gap-2">
            <span className="text-muted">$</span>
            <input
              id="agent-budget"
              type="number"
              min="0.1"
              step="0.5"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              className="h-10 w-28 rounded-xl border border-line bg-bg px-3 tabular-nums focus:border-fg"
            />
          </div>
          <span className="text-xs text-muted">In agent mode a reply can take up to 8 steps. It stops before anything that would cost more than this.</span>
        </label>

        {error && <p className="rounded-xl bg-raised px-3 py-2 text-danger">{error}</p>}

        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={() => api.openData()} className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-muted hover:bg-raised hover:text-fg">
            <FolderOpen size={15} /> Open data folder
          </button>
          <div className="flex gap-2">
            {!welcome && (
              <button type="button" onClick={onClose} className="h-9 rounded-full px-4 hover:bg-raised">
                Cancel
              </button>
            )}
            <button type="submit" disabled={busy} className="h-9 rounded-full bg-inverse px-5 font-medium text-on-inverse disabled:opacity-50">
              {busy ? 'Checking key…' : welcome ? 'Start' : 'Save'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

const usd = (credits: number) => `$${(credits * USD_PER_CREDIT).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Spending over the last 30 days: chat replies, generations and the small extras (prompt improvements, chat summaries).
export function UsageDialog({ credits, lowBalance, onLowBalance, onClose }: {
  credits: number | null
  lowBalance: number
  onLowBalance: (n: number) => void
  onClose: () => void
}) {
  const [rows, setRows] = useState<UsageRow[] | null>(null)
  useEffect(() => void api.usage().then(setRows), [])
  const { days, totals, models } = useMemo(() => {
    const byDay = new Map<string, number>()
    const byModel = new Map<string, number>()
    for (const r of rows ?? []) {
      byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.credits)
      const name = r.source === 'media' ? r.model : chatModel(r.model).id === r.model ? chatModel(r.model).label : r.model
      const label = r.source === 'extra' ? `${name} (prompt help, summaries)` : name
      byModel.set(label, (byModel.get(label) ?? 0) + r.credits)
    }
    const days = Array.from({ length: 30 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - 29 + i)
      return { key: dayKey(d), label: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), credits: byDay.get(dayKey(d)) ?? 0 }
    })
    const sum = (n: number) => days.slice(-n).reduce((a, d) => a + d.credits, 0)
    return {
      days,
      totals: [['Today', sum(1)], ['Last 7 days', sum(7)], ['Last 30 days', sum(30)]] as const,
      models: [...byModel].sort((a, b) => b[1] - a[1]).slice(0, 8),
    }
  }, [rows])
  const peak = Math.max(...days.map((d) => d.credits), 1)

  return (
    <Dialog title="Spending" onClose={onClose}>
      <div className="grid grid-cols-3 gap-3">
        {totals.map(([label, c]) => (
          <div key={label} className="rounded-xl bg-raised px-3 py-2.5">
            <div className="text-xs text-muted">{label}</div>
            <div className="text-lg font-semibold tabular-nums">{usd(c)}</div>
            <div className="text-xs text-faint tabular-nums">{fmtCredits(Math.round(c))} credits</div>
          </div>
        ))}
      </div>
      <div className="flex h-28 items-end gap-[3px]" aria-label="Credits spent per day, last 30 days">
        {days.map((d) => (
          <div key={d.key} title={`${d.label}: ${usd(d.credits)} · ${fmtCredits(Math.round(d.credits))} credits`} className="flex h-full flex-1 items-end">
            <div
              className="w-full rounded-sm bg-muted hover:bg-fg"
              style={{ height: d.credits ? `${Math.max(4, (d.credits / peak) * 100)}%` : '2px', opacity: d.credits ? 1 : 0.3 }}
            />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-1">
        <span className="font-medium">By model, last 30 days</span>
        {models.map(([name, c]) => (
          <div key={name} className="flex items-center justify-between gap-3 text-[13px]">
            <span className="truncate">{name}</span>
            <span className="shrink-0 text-muted tabular-nums">{usd(c)}</span>
          </div>
        ))}
        {rows && !models.length && <p className="text-[13px] text-muted">Nothing spent in the last 30 days.</p>}
      </div>
      <label className="flex items-center justify-between gap-3 border-t border-line pt-4 text-[13px]">
        <span>
          Warn me when the balance drops below{credits !== null && <span className="text-muted"> (now {fmtCredits(credits)})</span>}
        </span>
        <span className="flex items-center gap-2">
          <input
            id="low-balance"
            type="number"
            min="0"
            step="50"
            value={lowBalance}
            onChange={(e) => onLowBalance(Math.max(0, Number(e.target.value) || 0))}
            className="h-8 w-24 rounded-lg border border-line bg-bg px-2 tabular-nums focus:border-fg"
          />
          credits
        </span>
      </label>
      <a href="https://kie.ai/billing" target="_blank" rel="noreferrer" className="text-[13px] underline underline-offset-2">
        Top up on kie.ai
      </a>
    </Dialog>
  )
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', h)
    return () => removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-[520px] flex-col gap-5 overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-raised hover:text-fg">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
