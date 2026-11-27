// Claude on the user's own Anthropic key. When a key is saved, every Claude call goes here instead of through kie:
// billed to the Anthropic account, no kie outages, and Claude can see images and PDFs.
import Anthropic from '@anthropic-ai/sdk'
import { nativeImage } from 'electron'
import { readFile } from 'node:fs/promises'
import type { Attachment } from '../shared/types'
import { pathOf } from './media'

let client: Anthropic | null = null
export const setClaudeKey = (k: string) => (client = k.trim() ? new Anthropic({ apiKey: k.trim() }) : null)
export const hasClaudeKey = () => !!client

// Throws a readable error if Anthropic refuses the key, before it's saved.
export async function checkClaudeKey(k: string) {
  try {
    await new Anthropic({ apiKey: k.trim() }).models.retrieve('claude-haiku-5-5')
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('Anthropic refused that Claude key. Check it and paste it again.')
    throw new Error(`Anthropic: ${(e as Error).message}`)
  }
}

// The body built for kie's Claude proxy, turned into a direct request: kie's thinkingFlag becomes adaptive thinking
// with readable summaries and high effort; without it, low effort (thinking can't be fully turned off on 5.5 models).
// Sonnet and Opus fall back to another model when a safety filter declines (Haiku has no fallback).
export async function* claudeStream(body: any, signal: AbortSignal): AsyncGenerator<any> {
  if (!client) throw new Error('Add your Claude key in Settings.')
  const { thinkingFlag, ...rest } = body
  const fallback = !/haiku/.test(rest.model)
  const events = await client.beta.messages.create(
    {
      ...rest,
      stream: true,
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: thinkingFlag ? 'high' : 'low' },
      ...(fallback && { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }),
    } as any,
    { signal },
  )
  yield* events as unknown as AsyncIterable<any>
}

// A message's files as content blocks Claude can read: images and PDFs (others are left to their names in the text).
export async function claudeBlocks(files: Attachment[]) {
  const blocks: object[] = []
  for (const a of files) {
    const kind = /^image\/(png|jpeg|webp|gif)$/.test(a.mime) ? 'image' : a.mime === 'application/pdf' ? 'document' : null
    if (!kind) continue
    const bytes = await readFile(pathOf(a))
    // Anthropic takes images up to 5 MB and sees no more than ~1568 px on the long side: bigger ones go as a smaller JPEG.
    const img = kind === 'image' ? nativeImage.createFromBuffer(bytes) : null
    const { width = 0, height = 0 } = img?.getSize() ?? {}
    if (img && !img.isEmpty() && (bytes.length > 3_500_000 || Math.max(width, height) > 1568)) {
      const small = width >= height ? img.resize({ width: Math.min(width, 1568) }) : img.resize({ height: Math.min(height, 1568) })
      blocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: small.toJPEG(85).toString('base64') } })
    } else blocks.push({ type: kind, source: { type: 'base64', media_type: a.mime, data: bytes.toString('base64') } })
  }
  return blocks
}
