// The Edit section: editing projects, thumbnails for the timeline, and the ffmpeg export of a whole project.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { SIZE } from '../shared/timeline'
import type { EditProject, ProjectRender, Ref } from '../shared/types'
import { db, dirs } from './db'
import { pathOf } from './media'
import { ffmpeg, probe, run } from './series'

export const listProjects = () =>
  (db.prepare('SELECT data FROM edits ORDER BY updated_at DESC').all() as { data: string }[]).map((r) => JSON.parse(r.data) as EditProject)
export const saveProject = (p: EditProject) =>
  void db.prepare('INSERT INTO edits (id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
    .run(p.id, JSON.stringify(p), Date.now())
export const deleteProject = (id: string) => void db.prepare('DELETE FROM edits WHERE id = ?').run(id)

// A small frame from a video for the timeline, made once and kept next to the media.
export async function thumb(ref: Ref): Promise<Ref> {
  const file = `thumb-${ref.kind}-${ref.file.replace(/\.[^.]+$/, '')}.jpg`
  const out = join(dirs.media, file)
  if (!existsSync(out)) await run(ffmpeg(), ['-y', '-hide_banner', '-loglevel', 'error', '-ss', '0.5', '-i', pathOf(ref), '-frames:v', '1', '-vf', 'scale=240:-2', out])
  return { kind: 'media', file }
}

const even = (n: number) => Math.round(n / 2) * 2
const f3 = (n: number) => n.toFixed(3)

// The main track becomes one picture-and-sound stream (clips trimmed, sped, reframed, held; stills shown for their
// length); text PNGs are laid over it at their times; every audio item is trimmed, faded, placed and mixed in.
export async function renderProject(req: ProjectRender): Promise<string> {
  if (!req.main.length) throw new Error('Put at least one clip on the video track first.')
  const [W, H] = SIZE[req.aspect]
  const args = ['-y', '-hide_banner', '-loglevel', 'error']
  const filters: string[] = []
  let n = 0
  const total = req.main.reduce((t, c) => t + c.length, 0)
  const info = await Promise.all(req.main.map((c) => (c.media === 'video' ? probe(pathOf(c.ref)) : Promise.resolve({ seconds: 0, audio: false }))))
  req.main.forEach((c, i) => {
    const len = f3(c.length)
    if (c.media === 'image') args.push('-loop', '1', '-t', len, '-i', pathOf(c.ref))
    else args.push('-i', pathOf(c.ref))
    const [w, h] = [even(W * c.zoom), even(H * c.zoom)]
    const frame = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${W}:${H}:(iw-${W})*${f3((c.pan + 1) / 2)}:(ih-${H})/2,fps=30,setsar=1,format=yuv420p`
    filters.push(c.media === 'image'
      ? `[${n}:v]${frame},trim=duration=${len},setpts=PTS-STARTPTS[v${i}]`
      : `[${n}:v]trim=start=${f3(c.in)}:end=${f3(c.out)},setpts=(PTS-STARTPTS)/${c.speed},${frame},tpad=stop_mode=clone:stop_duration=${f3(c.length + 30)},trim=duration=${len},setpts=PTS-STARTPTS[v${i}]`)
    filters.push(c.media === 'video' && c.sound && info[i].audio
      ? `[${n}:a]atrim=start=${f3(c.in)}:end=${f3(c.out)},asetpts=PTS-STARTPTS,atempo=${c.speed},aformat=sample_rates=48000:channel_layouts=stereo,volume=${f3(c.volume)},apad,atrim=0:${len},asetpts=PTS-STARTPTS[a${i}]`
      : `anullsrc=r=48000:cl=stereo:d=${len}[a${i}]`)
    n++
  })
  filters.push(`${req.main.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${req.main.length}:v=1:a=1[base][abase]`)
  let video = 'base'
  req.texts.forEach((t, i) => {
    args.push('-loop', '1', '-t', f3(total), '-i', pathOf(t.ref))
    filters.push(`[${n}:v]scale=${W}:${H},format=rgba[tx${i}]`, `[${video}][tx${i}]overlay=0:0:enable='between(t,${f3(t.start)},${f3(t.start + t.length)})'[ov${i}]`)
    video = `ov${i}`
    n++
  })
  const mix: string[] = []
  req.audio.forEach((a, i) => {
    args.push('-i', pathOf(a.ref))
    const len = Math.max(0.1, a.out - a.in)
    const ms = Math.max(0, Math.round(a.start * 1000))
    const fades = [a.fadeIn > 0 && `afade=t=in:d=${f3(a.fadeIn)}`, a.fadeOut > 0 && `afade=t=out:st=${f3(Math.max(0, len - a.fadeOut))}:d=${f3(a.fadeOut)}`].filter(Boolean).join(',')
    filters.push(`[${n}:a]atrim=start=${f3(a.in)}:end=${f3(a.out)},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,volume=${f3(a.volume)}${fades ? `,${fades}` : ''},adelay=${ms}|${ms}[au${i}]`)
    mix.push(`[au${i}]`)
    n++
  })
  filters.push(mix.length ? `[abase]${mix.join('')}amix=inputs=${mix.length + 1}:duration=first:normalize=0[aout]` : '[abase]anull[aout]')
  const safe = req.name.replace(/[^a-z0-9-]+/gi, '-').slice(0, 60) || 'edit'
  const file = req.preview ? `preview-${safe}.mp4` : `${safe}-${Date.now()}.mp4`
  args.push('-filter_complex', filters.join(';'), '-map', `[${video}]`, '-map', '[aout]', '-t', f3(total), '-c:v', 'libx264', '-preset', req.preview ? 'ultrafast' : 'veryfast',
    '-crf', req.preview ? '28' : '20', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', join(dirs.media, file))
  await run(ffmpeg(), args, { maxBuffer: 16 * 1024 * 1024 }).catch((e) => {
    throw new Error(`Export failed: ${String(e.stderr || e.message).trim().split('\n').at(-1)}`)
  })
  return file
}
