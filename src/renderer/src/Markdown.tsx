import { Check, Copy } from 'lucide-react'
import { memo, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'

export function useCopy() {
  const [copied, setCopied] = useState(false)
  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    })
  }
  return { copied, copy }
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null)
  const { copied, copy } = useCopy()
  const child = children as { props?: { className?: string } } | undefined
  const lang = /language-(\S+)/.exec(child?.props?.className ?? '')?.[1]
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-side">
      <div className="flex h-9 items-center justify-between border-b border-line pr-1.5 pl-4 text-xs text-muted select-none">
        <span className="font-mono">{lang ?? 'code'}</span>
        <button
          type="button"
          onClick={() => copy(ref.current?.innerText ?? '')}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-raised hover:text-fg"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre ref={ref} className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed">
        {children}
      </pre>
    </div>
  )
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
      components={{
        pre: CodeBlock,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  )
})
