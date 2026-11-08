import { ChevronDown, PanelLeft } from 'lucide-react'
import type { ReactNode } from 'react'

// The top bar of each screen doubles as the window's drag area. Leaves room for the traffic lights when the sidebar is hidden.
export function Header({ collapsed, onExpand, children }: { collapsed: boolean; onExpand: () => void; children?: ReactNode }) {
  return (
    <div className="drag relative flex h-14 shrink-0 items-center gap-2 pr-4 select-none" style={{ paddingLeft: collapsed ? 84 : 20 }}>
      {collapsed && (
        <IconButton title="Show sidebar" onClick={onExpand}>
          <PanelLeft size={17} />
        </IconButton>
      )}
      {children}
    </div>
  )
}

export function IconButton({ title, onClick, children, className = '', disabled }: {
  title: string
  onClick?: () => void
  children: ReactNode
  className?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent ${className}`}
    >
      {children}
    </button>
  )
}

// A pill that shows the current choice and opens the native macOS menu.
export function SelectChip({ label, value, options, onChange, title, muted }: {
  label: ReactNode
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
  title: string
  muted?: boolean
}) {
  return (
    <label
      title={title}
      className={`relative inline-flex h-8 cursor-pointer items-center gap-1 rounded-full border border-line px-3 text-[13px] whitespace-nowrap transition-colors hover:bg-raised ${muted ? 'text-muted' : 'text-fg'}`}
    >
      {label}
      <ChevronDown size={13} className="text-faint" />
      <select aria-label={title} value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}
