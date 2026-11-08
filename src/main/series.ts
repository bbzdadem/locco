// Short series: GPT 6 Sol writes the bible and the shot lists, checks the frames, and ffmpeg cuts the finished episode.
// The renderer owns the series document (it's the only writer); this file stores it and does the work it can't.
import { app } from 'electron'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { MEDIA_MODELS } from '../shared/models'
import type { Attachment, CutRequest, Series } from '../shared/types'
import { complete } from './chat'
import { db, dirs } from './db'

const run = promisify(execFile)
const WRITER = 'gpt-6-sol'

export const listSeries = () =>
  (db.prepare('SELECT data FROM series ORDER BY updated_at DESC').all() as { data: string }[]).map((r) => JSON.parse(r.data) as Series)
export const saveSeries = (s: Series) => void db.prepare('INSERT OR REPLACE INTO series (id, data, updated_at) VALUES (?, ?, ?)').run(s.id, JSON.stringify(s), Date.now())
export const deleteSeries = (id: string) => void db.prepare('DELETE FROM series WHERE id = ?').run(id)

// Models wrap JSON in prose or code fences now and then; take the outermost object.
function json<T>(text: string): T {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('The writer didn’t send back a usable plan. Try again.')
  return JSON.parse(text.slice(start, end + 1))
}

const voices = () => MEDIA_MODELS.find((m) => m.id === 'tts-turbo')!.text!.fields.find((f) => f.name === 'voice')!.enumLabels ?? {}
const voiceId = (name?: string) => Object.entries(voices()).find(([, n]) => n.toLowerCase() === String(name ?? '').toLowerCase())?.[0]

export async function writeSeries(idea: string, episodes: number, seconds: number): Promise<Series> {
  const names = [...new Set(Object.values(voices()))].slice(0, 40).join(', ')
  const out = json<any>(await complete(WRITER, [
    `You are the showrunner of a vertical short-form series (9:16, about ${seconds}-second episodes, for TikTok and Reels).`,
    'From the idea, write the series bible. Reply with JSON only:',
    '{"title": "...", "logline": "one sentence", "style": "the visual style every shot shares: palette, light, lens, film look (1-2 sentences)",',
    ' "characters": [{"name": "...", "look": "precise visual description an image model can repeat exactly: age, face, skin, hair, build, clothes",',
    '   "personality": "...", "voice": "one voice name from the list"}],',
    ` "episodes": [{"title": "...", "summary": "2-3 sentences: a hook in the first seconds, a clear turn, and a punchline or cliffhanger"}]}`,
    `Write exactly ${episodes} episodes and 1 to 4 characters. Voice names to choose from: ${names}.`,
    "Write in the language of the user's idea.",
  ].join('\n'), idea))
  return {
    id: randomUUID(),
    title: String(out.title ?? 'Untitled series'),
    idea,
    logline: String(out.logline ?? ''),
    style: String(out.style ?? ''),
    seconds,
    imageModel: 'gpt-image-2',
    videoModel: 'grok-imagine',
    characters: (out.characters ?? []).map((c: any) => ({
      id: randomUUID(), name: String(c.name ?? ''), look: String(c.look ?? ''), personality: String(c.personality ?? ''), voice: voiceId(c.voice),
    })),
    episodes: (out.episodes ?? []).map((e: any) => ({ id: randomUUID(), title: String(e.title ?? ''), summary: String(e.summary ?? ''), shots: [] })),
    createdAt: Date.now(),
  }
}

// The shot list for one episode. shotSeconds is the length the video model makes per shot.
export async function writeEpisode(s: Series, index: number, shotSeconds: number) {
  const ep = s.episodes[index]
  const count = Math.max(3, Math.min(12, Math.round(s.seconds / shotSeconds)))
  const out = json<{ shots: any[] }>(await complete(WRITER, [
    `You write shot lists for the vertical short series "${s.title}": ${s.logline}`,
    `Visual style: ${s.style}`,
    `Characters: ${s.characters.map((c) => `${c.name} (${c.personality}; looks: ${c.look})`).join(' | ')}`,
    `Earlier episodes: ${s.episodes.slice(0, index).map((e, i) => `${i + 1}. ${e.title}: ${e.summary}`).join(' ') || 'none'}`,
    `Write episode ${index + 1} as exactly ${count} shots of about ${shotSeconds} seconds. Reply with JSON only:`,
    '{"shots": [{"description": "what we see: who is where doing what, by name, and the setting", "camera": "framing and movement",',
    ' "speaker": "a character name, Narrator, or empty", "line": "what they say, at most 12 words, or empty"}]}',
    'The first shot hooks instantly. Use only the characters listed. Keep lines short enough to say in one shot.',
    "Write in the language of the series.",
  ].join('\n'), `Episode ${index + 1}: ${ep.title}. ${ep.summary}`))
  return (out.shots ?? []).slice(0, 12).map((x) => ({
    id: randomUUID(), description: String(x.description ?? ''), camera: String(x.camera ?? ''), speaker: String(x.speaker ?? ''), line: String(x.line ?? ''),
  }))
}

// GPT 6 Sol looks at the frames next to the character portraits and names the ones worth redoing.
export async function reviewFrames(portraits: { name: string; file: string }[], frames: { n: number; description: string; file: string }[]) {
  const img = (file: string): Attachment => ({ kind: 'media', file, name: file, mime: 'image/png' })
  const out = json<{ redo?: { shot: number; fix: string }[] }>(await complete(WRITER, [
    'You check storyboard frames for a short series before they are animated.',
    `The first ${portraits.length} images are character references: ${portraits.map((p, i) => `image ${i + 1} = ${p.name}`).join(', ') || 'none'}.`,
    `The next ${frames.length} images are the frames, in shot order.`,
    'Flag only clear problems: a character who looks different from their reference, missing or extra people, garbled text,',
    'broken anatomy, or a frame that does not show its description. Reply with JSON only: {"redo": [{"shot": 1, "fix": "what to change, one sentence"}]}',
    'Return {"redo": []} when the frames are fine.',
  ].join('\n'), frames.map((f) => `Shot ${f.n}: ${f.description}`).join('\n'), undefined, [...portraits.map((p) => img(p.file)), ...frames.map((f) => img(f.file))]))
  return (out.redo ?? []).filter((r) => frames.some((f) => f.n === r.shot))
}

// --- The cut ---

const ffmpeg = () => (app.isPackaged ? join(process.resourcesPath, 'ffmpeg') : join(app.getAppPath(), 'node_modules/ffmpeg-static/ffmpeg'))

// ffmpeg prints a file's details to stderr (and exits with an error when given no output); read length and audio from that.
async function probe(path: string) {
  const err: string = await run(ffmpeg(), ['-hide_banner', '-i', path]).then(() => '', (e) => String(e.stderr ?? ''))
  const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(err)
  return { seconds: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 5, audio: /Stream #\S+.*Audio:/.test(err) }
}

// Shots are scaled to 720×1280 and joined; each voice line starts with its shot; music sits underneath.
export async function cut(req: CutRequest): Promise<string> {
  if (!req.shots.length) throw new Error('There are no shot videos to cut.')
  const media = (f: string) => join(dirs.media, f)
  const info = await Promise.all(req.shots.map((s) => probe(media(s.video))))
  const args = ['-y', '-hide_banner', '-loglevel', 'error']
  const filters: string[] = []
  req.shots.forEach((s) => args.push('-i', media(s.video)))
  let input = req.shots.length
  let start = 0
  const mix: string[] = []
  req.shots.forEach((s, i) => {
    const d = info[i].seconds.toFixed(3)
    filters.push(`[${i}:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,fps=30,setsar=1,format=yuv420p[v${i}]`)
    // Shots without sound get silence, so every shot has an audio track of its own length.
    filters.push(info[i].audio
      ? `[${i}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${s.voice ? 0.45 : 1},apad,atrim=0:${d}[a${i}]`
      : `anullsrc=r=48000:cl=stereo:d=${d}[a${i}]`)
    if (s.voice) {
      args.push('-i', media(s.voice))
      const ms = Math.round(start * 1000) + 150
      filters.push(`[${input}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${ms}|${ms}[vo${i}]`)
      mix.push(`[vo${i}]`)
      input++
    }
    start += info[i].seconds
  })
  filters.push(`${req.shots.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${req.shots.length}:v=1:a=1[v][base]`)
  if (req.music) {
    args.push('-i', media(req.music))
    filters.push(`[${input}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=0.18,afade=t=out:st=${Math.max(0, start - 1.5).toFixed(2)}:d=1.5[music]`)
    mix.push('[music]')
  }
  filters.push(mix.length ? `[base]${mix.join('')}amix=inputs=${mix.length + 1}:duration=first:normalize=0[aout]` : '[base]anull[aout]')
  const file = `${req.name.replace(/[^a-z0-9-]+/gi, '-').slice(0, 60)}-${Date.now()}.mp4`
  args.push('-filter_complex', filters.join(';'), '-map', '[v]', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', media(file))
  await run(ffmpeg(), args, { maxBuffer: 16 * 1024 * 1024 }).catch((e) => {
    throw new Error(`The cut failed: ${String(e.stderr || e.message).trim().split('\n').at(-1)}`)
  })
  return file
}
