// ElevenLabs on the user's own key: speech, sound effects, music and voice isolation.
// Each call answers with the audio itself (no queue), so results are saved as soon as they arrive.
import { readFile } from 'node:fs/promises'
import type { Ref } from '../shared/types'
import { getSetting, setSetting } from './db'
import { mimeOf, pathOf } from './media'

const API = 'https://api.elevenlabs.io'
let key = ''
export const setElevenKey = (k: string) => (key = k.trim())
export const hasElevenKey = () => !!key

async function call(path: string, init: RequestInit = {}, apiKey = key) {
  if (!apiKey) throw new Error('Add your ElevenLabs API key in Settings.')
  const res = await fetch(API + path, { ...init, headers: { 'xi-api-key': apiKey, ...(init.headers as Record<string, string>) } })
  if (res.ok) return res
  const text = await res.text()
  let msg = text.slice(0, 200)
  try {
    const d = JSON.parse(text).detail
    msg = typeof d === 'string' ? d : Array.isArray(d) ? d.map((x) => x.msg).join('; ') : (d?.message ?? msg)
  } catch {}
  if (res.status === 401) throw new Error(`ElevenLabs refused the key: ${msg}`)
  throw new Error(`ElevenLabs: ${msg} (HTTP ${res.status})`)
}
const post = (body: object): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export type Voice = { id: string; name: string; about: string; premade: boolean }
// "female, young, american, calm": short labels only (descriptions can run to a paragraph).
const labels = (l: any) =>
  [l.gender, l.age, l.accent, l.descriptive ?? (String(l.description ?? '').length < 30 ? l.description : ''), l.use_case].filter(Boolean).join(', ').replace(/_/g, ' ')
// Every voice the key can use, including ElevenLabs' default voices (page 0 adds them on top of page_size).
export async function voices(apiKey = key): Promise<Voice[]> {
  const out: Voice[] = []
  let token = ''
  for (let page = 0; page < 10; page++) {
    const q = new URLSearchParams({ page_size: '100', ...(token && { next_page_token: token }) })
    const body = await (await call(`/v2/voices?${q}`, {}, apiKey)).json()
    for (const v of body.voices ?? []) {
      const l = v.labels ?? {}
      out.push({ id: v.voice_id, name: v.name, about: labels(l), premade: v.category === 'premade' })
    }
    if (!body.has_more || !body.next_page_token) break
    token = body.next_page_token
  }
  return out
}

// Voices added by ID or link (e.g. from the Voice Library), kept on this Mac and listed after the account's own.
const pasted = (): Voice[] => JSON.parse(getSetting('elevenPasted') || '[]')
export async function allVoices(apiKey = key): Promise<Voice[]> {
  const own = await voices(apiKey)
  return [...own, ...pasted().filter((p) => !own.some((v) => v.id === p.id))]
}

// Takes a voice ID or any text containing one (a Voice Library link, say); ElevenLabs voice IDs are 20 letters and digits.
// Voices in the account are looked up directly; others are found in the Voice Library and spoken with directly
// (no need to add them to My Voices on a paid plan, tested 8 Nov 2026).
export async function addVoice(text: string): Promise<Voice> {
  const id = [...text.matchAll(/(?:^|[^A-Za-z0-9])([A-Za-z0-9]{20})(?![A-Za-z0-9])/g)].at(-1)?.[1]
  if (!id) throw new Error('That doesn’t contain an ElevenLabs voice ID (20 letters and digits).')
  const notFound = (e: unknown) => (/HTTP 40[04]/.test((e as Error).message) ? null : Promise.reject(e))
  const own = await call(`/v1/voices/${id}`).then((r) => r.json(), notFound)
  const shared = own ? null : await call(`/v1/shared-voices?${new URLSearchParams({ search: id, page_size: '20' })}`)
    .then((r) => r.json(), notFound)
    .then((b) => b?.voices?.find((v: any) => v.voice_id === id) ?? null)
  const v = own ?? shared
  if (!v) throw new Error('ElevenLabs doesn’t know that voice. Check the ID, or add the voice to My Voices on elevenlabs.io and press Refresh.')
  const voice: Voice = { id, name: v.name ?? id, about: labels({ ...v, ...v.labels }), premade: false }
  setSetting('elevenPasted', JSON.stringify([...pasted().filter((p) => p.id !== id), voice]))
  return voice
}

async function audio(res: Response) {
  const type = res.headers.get('content-type') ?? ''
  if (type.includes('json')) throw new Error(`ElevenLabs sent no audio: ${(await res.text()).slice(0, 200)}`)
  return { bytes: new Uint8Array(await res.arrayBuffer()), ext: type.includes('wav') ? '.wav' : '.mp3' }
}

export async function runEleven(modelId: string, prompt: string, input: Record<string, unknown>) {
  const mp3 = 'output_format=mp3_44100_128'
  switch (modelId) {
    case 'el-tts':
      if (!input.voice) throw new Error('Pick a voice. Your ElevenLabs voices load once the key is saved in Settings.')
      return audio(await call(`/v1/text-to-speech/${encodeURIComponent(String(input.voice))}?${mp3}`, post({ text: prompt, model_id: input.model_id })))
    case 'el-sfx': {
      const d = Number(input.duration_seconds)
      return audio(await call(`/v1/sound-generation?${mp3}`, post({ text: prompt, loop: input.loop === true, ...(d > 0 && { duration_seconds: d }) })))
    }
    case 'el-music':
      return audio(await call(`/v1/music?${mp3}`, post({ prompt, music_length_ms: (Number(input.length) || 60) * 1000, force_instrumental: input.force_instrumental === true })))
    case 'el-isolate': {
      const ref = input.audio as Ref
      if (!ref?.file) throw new Error('Pick a sound to clean up.')
      const form = new FormData()
      form.append('audio', new Blob([new Uint8Array(await readFile(pathOf(ref)))], { type: mimeOf(ref.file) }), ref.file)
      return audio(await call('/v1/audio-isolation', { method: 'POST', body: form }))
    }
  }
  throw new Error('That ElevenLabs feature is not available.')
}
