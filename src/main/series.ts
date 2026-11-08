// Short series: the character library, the writers (bible, script, revisions, recaps) and the voice-timed cut.
// The renderer owns the documents (it's the only writer); this file stores them and does the work it can't.
import { app } from 'electron'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { ELEVEN_VOICES } from '../shared/models'
import { clipLength } from '../shared/timing'
import type { Character, Episode, Ref, RenderRequest, Scene, Series } from '../shared/types'
import { complete } from './chat'
import { db, dirs } from './db'
import { pathOf } from './media'

export const run = promisify(execFile)
const WRITER = 'gpt-6-sol'
const DAY = 86_400_000

// --- Characters ---

export const listCharacters = () =>
  (db.prepare('SELECT data FROM characters ORDER BY updated_at DESC').all() as { data: string }[]).map((r) => JSON.parse(r.data) as Character)
export const saveCharacter = (c: Character) =>
  void db.prepare('INSERT INTO characters (id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
    .run(c.id, JSON.stringify(c), Date.now())
export const deleteCharacter = (id: string) => void db.prepare('DELETE FROM characters WHERE id = ?').run(id)
const charactersById = (ids: string[]) => listCharacters().filter((c) => ids.includes(c.id))

// --- Series ---

// Series made before the redesign kept their characters inside and had "shots": move the characters to the library
// and turn shots into finished, approved scenes.
function migrate(raw: any): Series {
  if (!raw.characters && raw.cast) return raw
  for (const c of raw.characters ?? []) if (!listCharacters().some((x) => x.id === c.id)) saveCharacter({ ...c, createdAt: raw.createdAt ?? Date.now() })
  const s: Series = {
    ...raw, cast: (raw.characters ?? []).map((c: Character) => c.id), continuity: raw.continuity ?? '',
    episodes: raw.episodes.map((e: any): Episode => ({
      id: e.id, title: e.title, summary: e.summary, cut: e.cut, musicTask: e.musicTask, music: true,
      step: e.cut ? 'cut' : e.shots?.length ? 'scenes' : 'script',
      scenes: (e.shots ?? []).map((sh: any): Scene => ({
        id: sh.id, place: '', action: sh.description, camera: sh.camera, approved: !!sh.frameTask,
        cast: (raw.characters ?? []).filter((c: Character) => sh.speaker === c.name || sh.description.includes(c.name)).map((c: Character) => c.name),
        lines: sh.line ? [{ speaker: sh.speaker, text: sh.line, voiceTask: sh.voiceTask }] : [], frameTask: sh.frameTask, videoTask: sh.videoTask,
      })),
    })),
  }
  delete (s as any).characters
  saveSeries(s)
  return s
}
export const listSeries = () =>
  (db.prepare('SELECT data FROM series WHERE deleted_at IS NULL ORDER BY updated_at DESC').all() as { data: string }[]).map((r) => migrate(JSON.parse(r.data)))
// Saving never brings a deleted series back (an episode still being made keeps saving into it).
export const saveSeries = (s: Series) =>
  void db.prepare('INSERT INTO series (id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
    .run(s.id, JSON.stringify(s), Date.now())
// Deleted series stay restorable for 30 days, then they're removed for good.
export const deleteSeries = (id: string) => void db.prepare('UPDATE series SET deleted_at = ? WHERE id = ?').run(Date.now(), id)
export const restoreSeries = (id: string) => void db.prepare('UPDATE series SET deleted_at = NULL WHERE id = ?').run(id)
export function deletedSeries() {
  db.prepare('DELETE FROM series WHERE deleted_at < ?').run(Date.now() - 30 * DAY)
  return (db.prepare('SELECT data, deleted_at FROM series WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC').all() as { data: string; deleted_at: number }[])
    .map((r) => ({ series: migrate(JSON.parse(r.data)), deletedAt: r.deleted_at }))
}

// --- Writers (GPT 6 Sol, JSON replies) ---

// Models wrap JSON in prose or code fences now and then; take the outermost object.
function json<T>(text: string): T {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('The writer didn’t send back a usable answer. Try again.')
  return JSON.parse(text.slice(start, end + 1))
}
const voiceId = (name?: string) => ELEVEN_VOICES.find((v) => v.name.toLowerCase() === String(name ?? '').trim().toLowerCase())?.id
const voiceList = () => ELEVEN_VOICES.slice(0, 60).map((v) => (v.about ? `${v.name} (${v.about})` : v.name)).join('; ') || 'none (leave voice empty)'
const castText = (cast: Character[]) => cast.map((c) => `${c.name}: ${c.personality}. Looks: ${c.look}`).join('\n') || 'none yet'
// About 4 seconds a scene, never more than 15 scenes an episode.
export const sceneTarget = (seconds: number) => Math.max(4, Math.min(15, Math.round(seconds / 4)))

const SCENE_JSON = [
  '{"scenes": [{"place": "where and when, e.g. Lighthouse kitchen, night", "action": "what we see: who does what, by name; one clear moment",',
  ' "camera": "framing and movement", "cast": ["names of the characters on screen"],',
  ' "lines": [{"speaker": "a character name or Narrator", "text": "at most 14 words"}]}]}',
].join('\n')
function scenesFrom(out: { scenes?: any[] }): Scene[] {
  return (out.scenes ?? []).slice(0, 15).map((x) => ({
    id: randomUUID(), place: String(x.place ?? ''), action: String(x.action ?? ''), camera: String(x.camera ?? ''),
    cast: Array.isArray(x.cast) ? x.cast.map(String) : [],
    lines: (Array.isArray(x.lines) ? x.lines : []).slice(0, 2).map((l: any) => ({ speaker: String(l.speaker ?? ''), text: String(l.text ?? '') })).filter((l: any) => l.text.trim()),
  }))
}

// The series bible: title, look, episode outlines, and any characters the story needs beyond the chosen cast
// (those are saved to the library too, so every character built is kept).
export async function writeSeries(idea: string, episodes: number, seconds: number, castIds: string[]): Promise<{ series: Series; created: Character[] }> {
  const cast = charactersById(castIds)
  const out = json<any>(await complete(WRITER, [
    `You are the showrunner of a vertical short-form series (9:16, about ${seconds}-second episodes, for TikTok and Reels).`,
    'From the idea, write the series bible. Reply with JSON only:',
    '{"title": "...", "logline": "one sentence", "style": "the visual style every scene shares: palette, light, lens, film look (1-2 sentences)",',
    ' "continuity": "the ground rules of this world and its characters that every episode must respect (short bullet lines)",',
    ' "new_characters": [{"name": "...", "look": "precise visual description an image model can repeat: age, face, skin, hair, build, clothes",',
    '   "personality": "...", "voice": "one voice name from the list"}],',
    ` "episodes": [{"title": "...", "summary": "2-3 sentences: a hook in the first seconds, a clear turn, a punchline or cliffhanger; episodes build on each other"}]}`,
    `Write exactly ${episodes} episodes. The cast below is fixed; add new_characters only if the story truly needs them (0 to 3).`,
    `Cast:\n${castText(cast)}`,
    `Voices to choose from (name only): ${voiceList()}.`,
    "Write in the language of the user's idea.",
  ].join('\n'), idea))
  const created: Character[] = (out.new_characters ?? []).map((c: any) => ({
    id: randomUUID(), name: String(c.name ?? ''), look: String(c.look ?? ''), personality: String(c.personality ?? ''), voice: voiceId(c.voice), createdAt: Date.now(),
  }))
  created.forEach(saveCharacter)
  return {
    created,
    series: {
      id: randomUUID(), title: String(out.title ?? 'Untitled series'), idea, logline: String(out.logline ?? ''), style: String(out.style ?? ''),
      seconds, imageModel: 'gpt-image-2', videoModel: 'kling-3', videoSound: false,
      cast: [...cast, ...created].map((c) => c.id), continuity: String(out.continuity ?? ''),
      episodes: (out.episodes ?? []).map((e: any) => ({ id: randomUUID(), title: String(e.title ?? ''), summary: String(e.summary ?? ''), step: 'script', scenes: [], music: true })),
      createdAt: Date.now(),
    },
  }
}

const storySoFar = (s: Series, index: number) =>
  [
    `Series "${s.title}": ${s.logline}`,
    `Look of every scene: ${s.style}`,
    `Cast:\n${castText(charactersById(s.cast))}`,
    `Continuity notes (must be respected):\n${s.continuity || 'none yet'}`,
    `Earlier episodes:\n${s.episodes.slice(0, index).map((e, i) => `${i + 1}. ${e.title}: ${e.recap || e.summary}`).join('\n') || 'none'}`,
  ].join('\n\n')

// The script of one episode, as scenes with their dialogue.
export async function writeScript(s: Series, index: number): Promise<Scene[]> {
  const ep = s.episodes[index]
  const n = sceneTarget(s.seconds)
  return scenesFrom(json(await complete(WRITER, [
    'You write scripts for a vertical short series. Each scene becomes one image, then a short silent clip, with the dialogue voiced over it.',
    storySoFar(s, index),
    `Write episode ${index + 1} in about ${n} scenes (never more than 15). Reply with JSON only:`,
    SCENE_JSON,
    'Scene 1 hooks instantly. Each scene is one visual moment with at most 2 lines. Use only the cast (new walk-on people only if essential, unnamed).',
    'Stay consistent with the continuity notes and earlier episodes: names, looks, places, what happened. Write in the language of the series.',
  ].join('\n\n'), `Episode ${index + 1}: ${ep.title}. ${ep.summary}`)))
}

// A change you asked for ("make Lala the one who breaks the machine"), applied to the whole script.
export async function reviseScript(s: Series, index: number, scenes: Scene[], change: string): Promise<Scene[]> {
  const current = scenes.map(({ place, action, camera, cast, lines }) => ({ place, action, camera, cast, lines: lines.map(({ speaker, text }) => ({ speaker, text })) }))
  return scenesFrom(json(await complete(WRITER, [
    'You revise the script of one episode of a vertical short series. Apply the requested change and keep everything else as it is.',
    storySoFar(s, index),
    `Current script of episode ${index + 1}:\n${JSON.stringify({ scenes: current })}`,
    'Reply with the full revised script, JSON only, same shape:',
    SCENE_JSON,
    'Never more than 15 scenes, at most 2 lines per scene. Write in the language of the series.',
  ].join('\n\n'), change)))
}

// After an episode is cut: a short recap for the next scripts, and the continuity notes brought up to date.
export async function writeRecap(s: Series, index: number): Promise<{ recap: string; continuity: string }> {
  const ep = s.episodes[index]
  const script = ep.scenes.map((sc, i) => `${i + 1}. ${sc.place}: ${sc.action} ${sc.lines.map((l) => `${l.speaker}: "${l.text}"`).join(' ')}`).join('\n')
  const out = json<{ recap?: string; continuity?: string }>(await complete(WRITER, [
    'You keep the story bible of a vertical short series.',
    `Continuity notes so far:\n${s.continuity || 'none'}`,
    'Reply with JSON only: {"recap": "2-3 sentences on what happened in this episode", "continuity": "the full, updated continuity notes as short bullet lines: facts later episodes must respect (who knows what, what changed, where things are)"}',
    'Write in the language of the series.',
  ].join('\n\n'), `Episode ${index + 1}: ${ep.title}\n${script}`))
  return { recap: String(out.recap ?? ''), continuity: String(out.continuity ?? s.continuity) }
}

// --- The cut ---

export const ffmpeg = () => (app.isPackaged ? join(process.resourcesPath, 'ffmpeg') : join(app.getAppPath(), 'node_modules/ffmpeg-static/ffmpeg'))

// ffmpeg prints a file's details to stderr (and exits with an error when given no output); read length and audio from that.
export async function probe(path: string) {
  const err: string = await run(ffmpeg(), ['-hide_banner', '-i', path]).then(() => '', (e) => String(e.stderr ?? ''))
  const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(err)
  return { seconds: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0, audio: /Stream #\S+.*Audio:/.test(err) }
}
// Length of a file in locco's media folder (a name) or of any stored file (a Ref: your uploads included).
export const mediaSeconds = async (file: string | Ref) => (await probe(typeof file === 'string' ? join(dirs.media, file) : pathOf(file))).seconds

// Renders an edit: each clip trimmed (in/out), sped up or down, reframed (pan/zoom inside the 9:16 crop) and held on its
// last frame for `hold` seconds; its own sound kept only if `sound`; voices placed from the clip's start; music underneath.
// A preview renders fast to one reused file per episode; a final render gets its own file.
export async function render(req: RenderRequest): Promise<string> {
  if (!req.clips.length) throw new Error('There are no clips to render.')
  const media = (f: string) => join(dirs.media, f)
  const info = await Promise.all(req.clips.map((c) => probe(media(c.video))))
  const even = (n: number) => Math.round(n / 2) * 2
  const args = ['-y', '-hide_banner', '-loglevel', 'error']
  const filters: string[] = []
  req.clips.forEach((c) => args.push('-i', media(c.video)))
  let input = req.clips.length
  let start = 0
  const mix: string[] = []
  req.clips.forEach((c, i) => {
    const len = clipLength(c).toFixed(3)
    const [w, h] = [even(720 * c.zoom), even(1280 * c.zoom)]
    const x = ((c.pan + 1) / 2).toFixed(3)
    filters.push(
      `[${i}:v]trim=start=${c.in}:end=${c.out},setpts=(PTS-STARTPTS)/${c.speed},scale=${w}:${h}:force_original_aspect_ratio=increase,` +
        `crop=720:1280:(iw-720)*${x}:(ih-1280)/2,fps=30,setsar=1,format=yuv420p,tpad=stop_mode=clone:stop_duration=${(c.hold + 30).toFixed(2)},` +
        `trim=duration=${len},setpts=PTS-STARTPTS[v${i}]`,
    )
    filters.push(c.sound && info[i].audio
      ? `[${i}:a]atrim=start=${c.in}:end=${c.out},asetpts=PTS-STARTPTS,atempo=${c.speed},aformat=sample_rates=48000:channel_layouts=stereo,` +
        `volume=${c.voices.length ? 0.35 : 1},apad,atrim=0:${len},asetpts=PTS-STARTPTS[a${i}]`
      : `anullsrc=r=48000:cl=stereo:d=${len}[a${i}]`)
    c.voices.forEach((v, j) => {
      args.push('-i', media(v.file))
      const ms = Math.max(0, Math.round((start + v.at) * 1000))
      filters.push(`[${input}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${ms}|${ms}[vo${i}_${j}]`)
      mix.push(`[vo${i}_${j}]`)
      input++
    })
    start += clipLength(c)
  })
  filters.push(`${req.clips.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${req.clips.length}:v=1:a=1[v][base]`)
  if (req.music) {
    args.push('-i', media(req.music.file))
    filters.push(`[${input}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${req.music.volume.toFixed(2)},afade=t=out:st=${Math.max(0, start - 1.5).toFixed(2)}:d=1.5[music]`)
    mix.push('[music]')
  }
  filters.push(mix.length ? `[base]${mix.join('')}amix=inputs=${mix.length + 1}:duration=first:normalize=0[aout]` : '[base]anull[aout]')
  const safe = req.name.replace(/[^a-z0-9-]+/gi, '-').slice(0, 60)
  const file = req.preview ? `preview-${safe}.mp4` : `${safe}-${Date.now()}.mp4`
  args.push('-filter_complex', filters.join(';'), '-map', '[v]', '-map', '[aout]', '-c:v', 'libx264', '-preset', req.preview ? 'ultrafast' : 'veryfast',
    '-crf', req.preview ? '28' : '20', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', media(file))
  await run(ffmpeg(), args, { maxBuffer: 16 * 1024 * 1024 }).catch((e) => {
    throw new Error(`Rendering failed: ${String(e.stderr || e.message).trim().split('\n').at(-1)}`)
  })
  return file
}
