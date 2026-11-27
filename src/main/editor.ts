// The Edit section: editing projects, thumbnails for the timeline, and the ffmpeg export of a whole project.
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { atempo, DUCK, MOVE, sizeOf, upgrade, ZOOM_IN } from '../shared/timeline'
import type { EditProject, Key, Keys, Look, ProjectRender, Ref } from '../shared/types'
import { db, dirs } from './db'
import { taskInfo } from './kie'
import { generate } from './tasks'
import { pathOf } from './media'
import { ffmpeg, probe, run } from './series'

export const listProjects = () =>
  (db.prepare('SELECT data FROM edits ORDER BY updated_at DESC').all() as { data: string }[]).map((r) => upgrade(JSON.parse(r.data)))
export const saveProject = (p: EditProject) =>
  void db.prepare('INSERT INTO edits (id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
    .run(p.id, JSON.stringify(p), Date.now())
export const deleteProject = (id: string) => {
  db.prepare('DELETE FROM edits WHERE id = ?').run(id)
  db.prepare('DELETE FROM edit_versions WHERE edit_id = ?').run(id)
}

// Saved versions of an edit (one is kept each time it's exported, and when you save one): the newest 30 are kept.
export const listVersions = (editId: string) =>
  db.prepare('SELECT id, at, label FROM edit_versions WHERE edit_id = ? ORDER BY at DESC').all(editId) as { id: string; at: number; label: string }[]
export function getVersion(id: string) {
  const row = db.prepare('SELECT data FROM edit_versions WHERE id = ?').get(id) as { data: string } | undefined
  return row ? upgrade(JSON.parse(row.data)) : null
}
export function saveVersion(p: EditProject, label: string) {
  db.prepare('INSERT INTO edit_versions (id, edit_id, at, label, data) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), p.id, Date.now(), label, JSON.stringify(p))
  db.prepare('DELETE FROM edit_versions WHERE edit_id = ? AND id NOT IN (SELECT id FROM edit_versions WHERE edit_id = ? ORDER BY at DESC LIMIT 30)').run(p.id, p.id)
}

// A small frame from a video for the timeline, made once and kept next to the media.
export async function thumb(ref: Ref): Promise<Ref> {
  const file = `thumb-${ref.kind}-${ref.file.replace(/\.[^.]+$/, '')}.jpg`
  const out = join(dirs.media, file)
  if (!existsSync(out)) await run(ffmpeg(), ['-y', '-hide_banner', '-loglevel', 'error', '-ss', '0.5', '-i', pathOf(ref), '-frames:v', '1', '-vf', 'scale=240:-2', out])
  return { kind: 'media', file }
}

// The sound of the part of a clip in use, as its own audio file, played at the clip's speed so it lines up under it.
export async function extractSound(ref: Ref, from: number, to: number, speed = 1, reverse = false): Promise<{ ref: Ref; seconds: number }> {
  const src = pathOf(ref)
  if (!(await probe(src)).audio) throw new Error('This clip has no sound to extract.')
  const file = `sound-${ref.kind}-${ref.file.replace(/\.[^.]+$/, '')}-${f3(from)}-${f3(to)}-${speed}${reverse ? '-back' : ''}.m4a`
  const out = join(dirs.media, file)
  if (!existsSync(out))
    await run(ffmpeg(), ['-y', '-hide_banner', '-loglevel', 'error', '-ss', f3(from), '-t', f3(to - from), '-i', src, '-vn', '-af', `${reverse ? 'areverse,' : ''}${atempo(speed)}`, '-c:a', 'aac', '-b:a', '192k', out])
  return { ref: { kind: 'media', file }, seconds: +((to - from) / speed).toFixed(3) }
}

// An audio file's waveform as a picture for the timeline, made once and kept next to the media.
export async function waveform(ref: Ref): Promise<Ref> {
  const file = `wave-${ref.kind}-${ref.file.replace(/\.[^.]+$/, '')}.png`
  const out = join(dirs.media, file)
  if (!existsSync(out)) await run(ffmpeg(), ['-y', '-hide_banner', '-loglevel', 'error', '-i', pathOf(ref), '-filter_complex', 'aformat=channel_layouts=mono,showwavespic=s=1600x120:colors=#a1a1a8', '-frames:v', '1', out])
  return { kind: 'media', file }
}

// Built-in sound effects, synthesised by ffmpeg the first time they're used (free, no account): a whoosh of filtered
// noise, a pitch-dropping pop, a bell, a click, a camera shutter, a riser, a bass drop, a two-tone alert, typing.
export const SOUNDS: Record<string, { label: string; src: string }> = {
  whoosh: { label: 'Whoosh', src: "anoisesrc=d=0.7:c=pink:a=0.7,bandpass=f=1200:w=1800,afade=t=in:d=0.35:curve=exp,afade=t=out:st=0.35:d=0.35" },
  riser: { label: 'Riser', src: "aevalsrc='0.4*sin(2*PI*(300*t+700*t*t))':d=1.2,afade=t=in:d=1,afade=t=out:st=1.1:d=0.1" },
  pop: { label: 'Pop', src: "aevalsrc='0.8*sin(2*PI*(900-3000*t)*t)*exp(-35*t)':d=0.15" },
  ding: { label: 'Ding', src: "aevalsrc='0.45*(sin(2*PI*1320*t)+0.4*sin(2*PI*2640*t))*exp(-3*t)':d=1.4" },
  click: { label: 'Click', src: "aevalsrc='0.9*(random(0)*2-1)*exp(-400*t)':d=0.05" },
  shutter: { label: 'Camera shutter', src: "aevalsrc='0.8*(random(0)*2-1)*(exp(-250*t)+exp(-250*(t-0.09))*gte(t\,0.09))':d=0.25" },
  drop: { label: 'Bass drop', src: "aevalsrc='0.9*sin(2*PI*(110*t-35*t*t))*exp(-1.2*t)':d=1.5" },
  alert: { label: 'Notification', src: "aevalsrc='0.5*sin(2*PI*880*t)*exp(-6*t)*lt(t\,0.18)+0.5*sin(2*PI*1320*(t-0.18))*exp(-6*(t-0.18))*gte(t\,0.18)':d=0.7" },
  typing: { label: 'Typing', src: "aevalsrc='0.5*(random(0)*2-1)*exp(-500*mod(t\,0.11))':d=1.1" },
}
export async function sound(name: string): Promise<Ref> {
  const s = SOUNDS[name]
  if (!s) throw new Error('That sound isn’t in the list.')
  const file = `sfx-${name}.wav`
  const out = join(dirs.media, file)
  if (!existsSync(out)) await run(ffmpeg(), ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', s.src, '-ar', '48000', '-ac', '2', out])
  return { kind: 'media', file }
}

// A still from an exported video at time t, to use as the post's cover.
export async function cover(file: string, t: number): Promise<Ref> {
  const out = `cover-${file.replace(/\.[^.]+$/, '')}-${Math.round(t * 10)}.png`
  await run(ffmpeg(), ['-y', '-hide_banner', '-loglevel', 'error', '-ss', f3(Math.max(0, t)), '-i', join(dirs.media, file), '-frames:v', '1', join(dirs.media, out)])
  return { kind: 'media', file: out }
}

const even = (n: number) => Math.round(n / 2) * 2
const f3 = (n: number) => n.toFixed(3)

// A picture's colour: brightness, contrast and saturation with eq, warmth as a colour temperature (6500 K neutral).
function lookFilter(look?: Look) {
  if (!look) return ''
  const eq = [look.bright && `brightness=${f3(look.bright)}`, look.contrast && look.contrast !== 1 && `contrast=${f3(look.contrast)}`, look.sat !== undefined && look.sat !== 1 && `saturation=${f3(look.sat)}`].filter(Boolean)
  return (eq.length ? `,eq=${eq.join(':')}` : '') + (look.warm ? `,colortemperature=temperature=${Math.round(6500 - 2500 * look.warm)}` : '')
}
// Lowering music under speech: a volume that follows duckGain() in shared/timeline, as an ffmpeg expression in the
// item's own time.
function duckFilter(spans: [number, number][] | undefined, level: number) {
  if (!spans?.length) return ''
  const r = DUCK.ramp
  const term = ([a, b]: [number, number]) => `min(1\\,min(max(0\\,(t-${f3(a - r)})/${r})\\,max(0\\,(${f3(b + r)}-t)/${r})))`
  const g = spans.map(term).reduce((x, y) => `max(${x}\\,${y})`)
  return `,volume=1-${f3(1 - level)}*${g}:eval=frame`
}
// A keyframed setting as an ffmpeg expression of T (seconds from the item's start): straight lines between keys, held
// before the first and after the last, as valueAt() in shared/timeline. Without keys, the plain value.
function keyExpr(keys: Key[] | undefined, plain: number, T: string) {
  if (!keys?.length) return f3(plain)
  let e = f3(keys.at(-1)!.v)
  for (let i = keys.length - 1; i > 0; i--) {
    const [a, b] = [keys[i - 1], keys[i]]
    e = `if(lt(${T}\\,${f3(b.t)})\\,${f3(a.v)}+(${f3(b.v - a.v)})*(${T}-${f3(a.t)})/${f3(Math.max(0.001, b.t - a.t))}\\,${e})`
  }
  return `if(lt(${T}\\,${f3(keys[0].t)})\\,${f3(keys[0].v)}\\,${e})`
}
// A sound's level and place, in its own seconds: volume (keyframed or not), fades in and out over `len`, and its
// left-right balance.
function soundFilter(s: { volume: number; fadeIn: number; fadeOut: number; balance: number; keys?: Keys }, len: number, duck = '') {
  const fades = [s.fadeIn > 0 && `afade=t=in:d=${f3(s.fadeIn)}`, s.fadeOut > 0 && `afade=t=out:st=${f3(Math.max(0, len - s.fadeOut))}:d=${f3(s.fadeOut)}`].filter(Boolean)
  return `,volume=${keyExpr(s.keys?.volume, s.volume, 't')}${s.keys?.volume ? ':eval=frame' : ''}${duck}` + fades.map((f) => `,${f}`).join('') +
    // Balance turns the other side down (left at -1 is the left channel alone, at full level).
    (s.balance ? `,pan=stereo|c0=${f3(Math.min(1, 1 - s.balance))}*c0|c1=${f3(Math.min(1, 1 + s.balance))}*c1` : '')
}

// Movement inside a clip, a zoom transition and keyframed zoom, with ffmpeg's zoompan, frame by frame, on a frame made 1.5x
// larger first so the slow move doesn't step. Matches motionAt() in shared/timeline, which the preview uses. A zoomed
// frame is cropped where pan and tilt say.
function moveFilter(c: ProjectRender['main'][number], seconds: number, W: number, H: number, fps: number) {
  const zoomIn = c.transition?.type === 'zoom'
  const keyed = !!c.keys?.zoom?.length
  if (!c.motion && !zoomIn && !keyed) return ''
  const F = Math.max(1, Math.round(seconds * fps))
  const p = `min(on/${F}\\,1)`
  const motion = c.motion
  const base = motion === 'push-in' ? `(1+${MOVE}*${p})` : motion === 'pull-out' ? `(1+${MOVE}*(1-${p}))` : motion ? `${1 + MOVE}` : '1'
  const frames = Math.round((c.transition?.seconds ?? ZOOM_IN.seconds) * fps)
  const settle = zoomIn ? `*(1+${ZOOM_IN.scale}*max(0\\,1-on/${frames}))` : ''
  const z = `${base}${settle}${keyed ? `*(${keyExpr(c.keys!.zoom, 1, `(on/${fps})`)})` : ''}`
  const [px, py] = [f3((c.pan + 1) / 2), f3((c.tilt + 1) / 2)]
  const x = motion === 'pan-left' ? `(iw-iw/zoom)*(1-${p})` : motion === 'pan-right' ? `(iw-iw/zoom)*${p}` : `(iw-iw/zoom)*${px}`
  return `,scale=${even(W * 1.5)}:${even(H * 1.5)},zoompan=z=${z}:x=${x}:y=(ih-ih/zoom)*${py}:d=1:s=${W}x${H}:fps=${fps}`
}

// A video-track picture fitted to the W×H frame: cropped to fill it (reframed by pan and tilt), whole with bars in the
// background colour, or whole over a blurred copy of itself filling the frame. Zoom enlarges it first (a whole picture
// zoomed past the frame is cropped where pan and tilt say); flip mirrors it.
function framing(c: ProjectRender['main'][number], from: string, to: string, W: number, H: number, bg: string) {
  const zoom = c.keys?.zoom?.length ? 1 : c.zoom // keyframed zoom happens in moveFilter
  const [w, h] = [even(W * zoom), even(H * zoom)]
  const [px, py] = [f3((c.pan + 1) / 2), f3((c.tilt + 1) / 2)]
  const flip = c.flip ? 'hflip,' : ''
  const whole = `scale=${w}:${h}:force_original_aspect_ratio=decrease:force_divisible_by=2,crop=min(iw\\,${W}):min(ih\\,${H}):(iw-ow)*${px}:(ih-oh)*${py}`
  if (c.fit === 'fit') return `[${from}]${flip}${whole},pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${bg}[${to}]`
  if (c.fit === 'blur')
    return `[${from}]${flip}split=2[${to}a][${to}b];[${to}a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=${Math.round(W / 40)}:2[${to}c];` +
      `[${to}b]${whole}[${to}d];[${to}c][${to}d]overlay=(W-w)/2:(H-h)/2[${to}]`
  return `[${from}]${flip}scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${W}:${H}:(iw-${W})*${px}:(ih-${H})*${py}[${to}]`
}

// Text pictures are made fresh for each render and deleted after it; two renders at once can share one (they're stored by
// content), so a picture goes only when no render still uses it.
const textsInUse = new Map<string, number>()
export async function renderProject(req: ProjectRender): Promise<string> {
  const texts = [...new Set(req.texts.map((t) => pathOf(t.ref)))]
  texts.forEach((f) => textsInUse.set(f, (textsInUse.get(f) ?? 0) + 1))
  try {
    return await renderOnce(req)
  } finally {
    for (const f of texts) {
      const left = (textsInUse.get(f) ?? 1) - 1
      if (left > 0) textsInUse.set(f, left)
      else (textsInUse.delete(f), await unlink(f).catch(() => {}))
    }
  }
}

// The main track becomes one picture-and-sound stream: clips trimmed, reversed, sped, framed, moved, held; stills shown
// for their length; dips through black or white at cuts; crossfades where clips overlap. Overlays and texts are laid on
// top in their tracks' order, at their times and places (keyframed where they have keys); every sound is trimmed, sped,
// faded, balanced, placed and mixed, then evened out to -14 LUFS.
async function renderOnce(req: ProjectRender): Promise<string> {
  if (!req.main.length) throw new Error('Put at least one clip on the video track first.')
  const gone = [...req.main, ...req.overlays, ...req.audio].find((x) => !existsSync(pathOf(x.ref)))
  if (gone) throw new Error(`A file this edit uses is missing (${gone.ref.file}); it may have been moved to the Trash. Put it back, or delete the clip marked missing.`)
  const [W, H] = sizeOf(req.aspect, req.resolution)
  const fps = req.fps || 30
  const bg = /^#[0-9a-f]{6}$/i.test(req.background) ? req.background : '#000000'
  const args = ['-y', '-hide_banner', '-loglevel', 'error']
  const filters: string[] = []
  let n = 0
  const total = Math.max(...req.main.map((c) => c.start + c.length))
  const probeOf = (c: { media: string; ref: Ref }) => (c.media === 'video' ? probe(pathOf(c.ref)) : Promise.resolve({ seconds: 0, audio: false }))
  const info = await Promise.all(req.main.map(probeOf))
  const overlayInfo = await Promise.all(req.overlays.map(probeOf))
  const AF = 'aformat=sample_rates=48000:channel_layouts=stereo'
  req.main.forEach((c, i) => {
    const len = f3(c.length)
    if (c.media === 'image') args.push('-loop', '1', '-t', len, '-i', pathOf(c.ref))
    else args.push('-i', pathOf(c.ref))
    const playable = c.media === 'image' ? c.length : Math.min(c.length, (c.out - c.in) / c.speed)
    const frame = `fps=${fps},setsar=1` + lookFilter(c.look) + moveFilter(c, playable, W, H, fps) + ',format=yuv420p'
    // A dip through black or white: this clip fades in from it, and the clip before fades out to it.
    const dip = (t?: ProjectRender['main'][number]['transition']) => (t?.type === 'black' || t?.type === 'flash' ? t : undefined)
    const [into, next] = [dip(c.transition), dip(req.main[i + 1]?.transition)]
    const fades = [
      into && `fade=t=in:st=0:d=${f3(into.seconds)}${into.type === 'flash' ? ':color=white' : ''}`,
      next && `fade=t=out:st=${f3(Math.max(0, c.length - next.seconds))}:d=${f3(next.seconds)}${next.type === 'flash' ? ':color=white' : ''}`,
    ].filter(Boolean).map((f) => `,${f}`).join('')
    const back = c.reverse ? ',reverse' : ''
    if (c.media === 'image') filters.push(framing(c, `${n}:v`, `fr${i}`, W, H, bg), `[fr${i}]${frame},trim=duration=${len},setpts=PTS-STARTPTS${fades}[v${i}]`)
    else filters.push(`[${n}:v]trim=start=${f3(c.in)}:end=${f3(c.out)},setpts=PTS-STARTPTS${back},setpts=(PTS-STARTPTS)/${c.speed}[src${i}]`, framing(c, `src${i}`, `fr${i}`, W, H, bg),
      `[fr${i}]${frame},tpad=stop_mode=clone:stop_duration=${f3(c.length + 30)},trim=duration=${len},setpts=PTS-STARTPTS${fades}[v${i}]`)
    filters.push(c.media === 'video' && c.sound && info[i].audio
      ? `[${n}:a]atrim=start=${f3(c.in)}:end=${f3(c.out)},asetpts=PTS-STARTPTS${c.reverse ? ',areverse' : ''},${atempo(c.speed)},${AF}${soundFilter(c, playable)},apad,atrim=0:${len},asetpts=PTS-STARTPTS[a${i}]`
      : `anullsrc=r=48000:cl=stereo:d=${len}[a${i}]`)
    n++
  })
  // Joined in order: a crossfade where a clip overlaps the one before (offset is where the overlap starts), a cut elsewhere.
  let [video, sound] = ['v0', 'a0']
  req.main.slice(1).forEach((c, k) => {
    const i = k + 1
    const before = req.main[k]
    const d = before.start + before.length - c.start
    if (c.transition?.type === 'fade' && d > 0.01)
      filters.push(`[${video}][v${i}]xfade=transition=fade:duration=${f3(d)}:offset=${f3(c.start)}[xv${i}]`, `[${sound}][a${i}]acrossfade=d=${f3(d)}[xa${i}]`)
    else filters.push(`[${video}][${sound}][v${i}][a${i}]concat=n=2:v=1:a=1[xv${i}][xa${i}]`)
    ;[video, sound] = [`xv${i}`, `xa${i}`]
  })
  const abase = sound
  const mix: string[] = []
  // Overlays and texts, drawn in their tracks' order.
  type Layer = { layer: number; i: number; overlay?: ProjectRender['overlays'][number]; text?: ProjectRender['texts'][number] }
  const layers: Layer[] = [...req.overlays.map((o, i) => ({ layer: o.layer, overlay: o, i })), ...req.texts.map((t, i) => ({ layer: t.layer, text: t, i }))].sort((a, b) => a.layer - b.layer)
  for (const l of layers) {
    if (l.overlay) {
      const [o, i] = [l.overlay, l.i]
      const len = f3(o.length)
      if (o.media === 'image') args.push('-loop', '1', '-framerate', String(fps), '-t', len, '-i', pathOf(o.ref))
      else args.push('-i', pathOf(o.ref))
      // Cropped, mirrored and sized, then turned (the corners stay see-through) and faded; turn and fade can follow keys
      // (t is its own seconds here), its place too (t is the video's seconds there). A keyed turn gets a canvas wide enough
      // for any angle.
      const k = o.keys ?? {}
      const c = o.crop
      const crop = c ? `crop=iw*${f3(1 - c.l - c.r)}:ih*${f3(1 - c.t - c.b)}:iw*${f3(c.l)}:ih*${f3(c.t)},` : ''
      const size = `scale=${even(W * o.scale)}:-2`
      const deg = keyExpr(k.rotate, o.rotate, 't')
      // (c=none would leave the last frame's pixels around a turning picture: the corners are filled see-through instead.)
      const rad = f3((o.rotate * Math.PI) / 180)
      const turn = k.rotate?.length ? `,rotate=(${deg})*PI/180:c=black@0:ow=hypot(iw\\,ih):oh=ow` : o.rotate ? `,rotate=${rad}:c=black@0:ow=rotw(${rad}):oh=roth(${rad})` : ''
      const fade = k.opacity?.length ? `,geq=r=r(X\\,Y):g=g(X\\,Y):b=b(X\\,Y):a=alpha(X\\,Y)*(${keyExpr(k.opacity, o.opacity, 'T')})` : o.opacity < 1 ? `,colorchannelmixer=aa=${f3(o.opacity)}` : ''
      const look = `${crop}${o.flip ? 'hflip,' : ''}${size}${lookFilter(o.look)},format=rgba${fade}${turn}`
      const chain = o.media === 'image' ? look
        : `trim=start=${f3(o.in)}:end=${f3(o.out)},setpts=(PTS-STARTPTS)/${o.speed},fps=${fps},${look},tpad=stop_mode=clone:stop_duration=${f3(o.length + 30)},trim=duration=${len}`
      const T = `(t-${f3(o.start)})`
      filters.push(`[${n}:v]${chain},setpts=PTS-STARTPTS+${f3(o.start)}/TB[ol${i}]`,
        `[${video}][ol${i}]overlay=x=${W}*${keyExpr(k.x, o.x, T)}-overlay_w/2:y=${H}*${keyExpr(k.y, o.y, T)}-overlay_h/2:enable='between(t,${f3(o.start)},${f3(o.start + o.length)})':eof_action=pass[olv${i}]`)
      video = `olv${i}`
      if (o.media === 'video' && o.sound && overlayInfo[i].audio) {
        const ms = Math.max(0, Math.round(o.start * 1000))
        filters.push(`[${n}:a]atrim=start=${f3(o.in)}:end=${f3(o.out)},asetpts=PTS-STARTPTS,${atempo(o.speed)},${AF}${soundFilter(o, (o.out - o.in) / o.speed)},adelay=${ms}|${ms}[oa${i}]`)
        mix.push(`[oa${i}]`)
      }
      n++
    } else if (l.text) {
      // Each text's picture runs only for its own length, moved to its start (word-by-word captions make hundreds of
      // these; looping each one for the whole video made exports crawl).
      const [t, i] = [l.text, l.i]
      args.push('-loop', '1', '-framerate', String(fps), '-t', f3(t.length), '-i', pathOf(t.ref))
      const [a, b] = [f3(t.start), f3(t.start + t.length)]
      const fade = t.anim ? `,fade=t=in:st=0:d=0.25:alpha=1,fade=t=out:st=${f3(Math.max(0, t.length - 0.25))}:d=0.25:alpha=1` : ''
      const y = t.anim === 'slide' ? `'if(lt(t-${a},0.3),(1-(t-${a})/0.3)*${Math.round(H * 0.04)},0)'` : '0'
      filters.push(`[${n}:v]scale=${W}:${H},format=rgba${fade},setpts=PTS-STARTPTS+${a}/TB[tx${i}]`,
        `[${video}][tx${i}]overlay=x=0:y=${y}:enable='between(t,${a},${b})':eof_action=pass[ov${i}]`)
      video = `ov${i}`
      n++
    }
  }
  req.audio.forEach((a, i) => {
    args.push('-i', pathOf(a.ref))
    const len = Math.max(0.1, (a.out - a.in) / (a.speed || 1))
    const ms = Math.max(0, Math.round(a.start * 1000))
    filters.push(`[${n}:a]atrim=start=${f3(a.in)}:end=${f3(a.out)},asetpts=PTS-STARTPTS,${atempo(a.speed || 1)},${AF}${soundFilter(a, len, duckFilter(a.duck, a.duckTo))},adelay=${ms}|${ms}[au${i}]`)
    mix.push(`[au${i}]`)
    n++
  })
  // Evened out to -14 LUFS (with peaks kept under -1.5 dB), the loudness TikTok, Reels and YouTube play at.
  const level = req.normalize ? `,loudnorm=I=-14:TP=-1.5:LRA=11,${AF}` : ''
  filters.push(mix.length ? `[${abase}]${mix.join('')}amix=inputs=${mix.length + 1}:duration=first:normalize=0${level}[aout]` : `[${abase}]anull${level}[aout]`)
  const safe = req.name.replace(/[^a-z0-9-]+/gi, '-').slice(0, 60) || 'edit'
  const file = req.preview ? `preview-${safe}.mp4` : `${safe}-${Date.now()}.mp4`
  // A part: the output starts at its first second and stops at its last.
  const [from, to] = req.range ? [Math.max(0, req.range[0]), Math.min(total, req.range[1])] : [0, total]
  if (to - from < 0.2) throw new Error('The part to export is too short: choose at least a fifth of a second.')
  const high = req.quality === 'high'
  args.push('-filter_complex', filters.join(';'), '-map', `[${video}]`, '-map', '[aout]', ...(from > 0 ? ['-ss', f3(from)] : []), '-to', f3(to),
    '-c:v', 'libx264', '-preset', req.preview ? 'ultrafast' : high ? 'medium' : 'veryfast', '-crf', req.preview ? '28' : high ? '16' : '20',
    '-c:a', 'aac', '-b:a', high ? '256k' : '160k', '-movflags', '+faststart', join(dirs.media, file))
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
