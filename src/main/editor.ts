// The Edit section: editing projects, thumbnails for the timeline, and the ffmpeg export of a whole project.
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { DIP, MOVE, sizeOf, ZOOM_IN } from '../shared/timeline'
import type { EditProject, ProjectRender, Ref } from '../shared/types'
import { db, dirs } from './db'
import { taskInfo } from './kie'
import { generate } from './tasks'
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

// Movement inside a clip (and a zoom transition) with ffmpeg's zoompan, frame by frame, on a frame made 1.5x larger first
// so the slow move doesn't step. Matches motionAt() in shared/timeline, which the preview uses.
function moveFilter(motion: ProjectRender['main'][number]['motion'], zoomIn: boolean, seconds: number, W: number, H: number) {
  if (!motion && !zoomIn) return ''
  const F = Math.max(1, Math.round(seconds * 30))
  const p = `min(on/${F}\\,1)`
  const base = motion === 'push-in' ? `(1+${MOVE}*${p})` : motion === 'pull-out' ? `(1+${MOVE}*(1-${p}))` : motion ? `${1 + MOVE}` : '1'
  const frames = Math.round(ZOOM_IN.seconds * 30)
  const z = zoomIn ? `${base}*(1+${ZOOM_IN.scale}*max(0\\,1-on/${frames}))` : base
  const x = motion === 'pan-left' ? `(iw-iw/zoom)*(1-${p})` : motion === 'pan-right' ? `(iw-iw/zoom)*${p}` : 'iw/2-iw/zoom/2'
  return `,scale=${even(W * 1.5)}:${even(H * 1.5)},zoompan=z=${z}:x=${x}:y=ih/2-ih/zoom/2:d=1:s=${W}x${H}:fps=30`
}

// The main track becomes one picture-and-sound stream (clips trimmed, sped, reframed, moved, held; stills shown for their
// length; dips through black or white at cuts); overlays are laid on top at their times and places, then the text PNGs
// (fading or sliding in when asked); every audio item, and the sound of overlay clips, is trimmed, faded, placed and mixed.
export async function renderProject(req: ProjectRender): Promise<string> {
  if (!req.main.length) throw new Error('Put at least one clip on the video track first.')
  const [W, H] = sizeOf(req.aspect, req.resolution)
  const args = ['-y', '-hide_banner', '-loglevel', 'error']
  const filters: string[] = []
  let n = 0
  const total = req.main.reduce((t, c) => t + c.length, 0)
  const probeOf = (c: { media: string; ref: Ref }) => (c.media === 'video' ? probe(pathOf(c.ref)) : Promise.resolve({ seconds: 0, audio: false }))
  const info = await Promise.all(req.main.map(probeOf))
  const overlayInfo = await Promise.all(req.overlays.map(probeOf))
  req.main.forEach((c, i) => {
    const len = f3(c.length)
    if (c.media === 'image') args.push('-loop', '1', '-t', len, '-i', pathOf(c.ref))
    else args.push('-i', pathOf(c.ref))
    const [w, h] = [even(W * c.zoom), even(H * c.zoom)]
    const playable = c.media === 'image' ? c.length : Math.min(c.length, (c.out - c.in) / c.speed)
    const frame = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${W}:${H}:(iw-${W})*${f3((c.pan + 1) / 2)}:(ih-${H})/2,fps=30,setsar=1` +
      moveFilter(c.motion, c.transition === 'zoom', playable, W, H) + ',format=yuv420p'
    // A dip through black or white: this clip fades in from it, and the clip before fades out to it.
    const dip = (t?: string) => (t === 'black' ? '' : ':color=white')
    const next = req.main[i + 1]?.transition
    const fades = [
      (c.transition === 'black' || c.transition === 'flash') && `fade=t=in:st=0:d=${DIP}${dip(c.transition)}`,
      (next === 'black' || next === 'flash') && `fade=t=out:st=${f3(Math.max(0, c.length - DIP))}:d=${DIP}${dip(next)}`,
    ].filter(Boolean).map((f) => `,${f}`).join('')
    filters.push(c.media === 'image'
      ? `[${n}:v]${frame},trim=duration=${len},setpts=PTS-STARTPTS${fades}[v${i}]`
      : `[${n}:v]trim=start=${f3(c.in)}:end=${f3(c.out)},setpts=(PTS-STARTPTS)/${c.speed},${frame},tpad=stop_mode=clone:stop_duration=${f3(c.length + 30)},trim=duration=${len},setpts=PTS-STARTPTS${fades}[v${i}]`)
    filters.push(c.media === 'video' && c.sound && info[i].audio
      ? `[${n}:a]atrim=start=${f3(c.in)}:end=${f3(c.out)},asetpts=PTS-STARTPTS,atempo=${c.speed},aformat=sample_rates=48000:channel_layouts=stereo,volume=${f3(c.volume)},apad,atrim=0:${len},asetpts=PTS-STARTPTS[a${i}]`
      : `anullsrc=r=48000:cl=stereo:d=${len}[a${i}]`)
    n++
  })
  filters.push(`${req.main.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${req.main.length}:v=1:a=1[base][abase]`)
  let video = 'base'
  const mix: string[] = []
  req.overlays.forEach((o, i) => {
    const len = f3(o.length)
    if (o.media === 'image') args.push('-loop', '1', '-t', len, '-i', pathOf(o.ref))
    else args.push('-i', pathOf(o.ref))
    const size = `scale=${even(W * o.scale)}:-2,format=rgba`
    const chain = o.media === 'image' ? size
      : `trim=start=${f3(o.in)}:end=${f3(o.out)},setpts=(PTS-STARTPTS)/${o.speed},fps=30,${size},tpad=stop_mode=clone:stop_duration=${f3(o.length + 30)},trim=duration=${len}`
    filters.push(`[${n}:v]${chain},setpts=PTS-STARTPTS+${f3(o.start)}/TB[ol${i}]`,
      `[${video}][ol${i}]overlay=x=${f3(W * o.x)}-overlay_w/2:y=${f3(H * o.y)}-overlay_h/2:enable='between(t,${f3(o.start)},${f3(o.start + o.length)})':eof_action=pass[olv${i}]`)
    video = `olv${i}`
    if (o.media === 'video' && o.sound && overlayInfo[i].audio) {
      const ms = Math.max(0, Math.round(o.start * 1000))
      filters.push(`[${n}:a]atrim=start=${f3(o.in)}:end=${f3(o.out)},asetpts=PTS-STARTPTS,atempo=${o.speed},aformat=sample_rates=48000:channel_layouts=stereo,volume=${f3(o.volume)},adelay=${ms}|${ms}[oa${i}]`)
      mix.push(`[oa${i}]`)
    }
    n++
  })
  req.texts.forEach((t, i) => {
    args.push('-loop', '1', '-t', f3(total), '-i', pathOf(t.ref))
    const [a, b] = [f3(t.start), f3(t.start + t.length)]
    const fade = t.anim ? `,fade=t=in:st=${a}:d=0.25:alpha=1,fade=t=out:st=${f3(Math.max(t.start, t.start + t.length - 0.25))}:d=0.25:alpha=1` : ''
    const y = t.anim === 'slide' ? `'if(lt(t-${a},0.3),(1-(t-${a})/0.3)*${Math.round(H * 0.04)},0)'` : '0'
    filters.push(`[${n}:v]scale=${W}:${H},format=rgba${fade}[tx${i}]`, `[${video}][tx${i}]overlay=x=0:y=${y}:enable='between(t,${a},${b})'[ov${i}]`)
    video = `ov${i}`
    n++
  })
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

// Words and their times in a stretch of a file (seconds from `from`), for word-by-word captions: the stretch is cut out as
// a small MP3 and transcribed on kie (Nemotron, with word timestamps). Its end times are close; its start times can be
// up to half a second early, so a word starts where the one before it ended (and at most 0.6 s before its own end).
export async function wordsIn(ref: Ref, from: number, to: number): Promise<{ text: string; start: number; end: number }[]> {
  const file = `words-${randomUUID()}.mp3`
  await run(ffmpeg(), ['-y', '-hide_banner', '-loglevel', 'error', '-ss', f3(from), '-t', f3(Math.max(0.3, to - from)), '-i', pathOf(ref), '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', join(dirs.media, file)])
  try {
    const [id] = await generate({ modelId: 'transcribe', variant: 'tool', prompt: '', input: { audio_url: { kind: 'media', file }, timestamps: true }, count: 1 })
    for (let i = 0; i < 160; i++) {
      await new Promise((r) => setTimeout(r, 1500))
      const info = await taskInfo(id)
      if (info.state === 'fail') throw new Error(info.failMsg || 'Transcription failed.')
      if (info.state !== 'success') continue
      const result = JSON.parse(info.resultJson || '{}').resultObject ?? {}
      if (!result.url) return []
      const words: any[] = (await (await fetch(result.url)).json()).words ?? []
      let last = 0
      return words.filter((w) => String(w.word ?? '').trim()).map((w) => {
        const end = +w.end
        const start = Math.min(end - 0.05, Math.max(+w.start, last, end - 0.6))
        last = end
        return { text: String(w.word).trim(), start, end }
      })
    }
    throw new Error('Transcription took too long. Try again.')
  } finally {
    await unlink(join(dirs.media, file)).catch(() => {})
  }
}
