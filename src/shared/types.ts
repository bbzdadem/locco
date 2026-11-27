export type Ref = { kind: 'uploads' | 'media'; file: string }
export type Attachment = Ref & { name: string; mime: string }

// summaryUpto: messages up to this time are condensed into a summary for the model (long chats).
export type Chat = { id: string; title: string; model: string; updatedAt: number; pinned?: boolean; projectId?: string; summaryUpto?: number }
// A project groups chats and gives them shared instructions and files.
export type Project = { id: string; name: string; instructions: string; files: Attachment[]; createdAt: number }
// A search hit: the chat plus the bit of a message that matched (none when only the title matched).
export type ChatHit = Chat & { snippet?: string }
export type Message = {
  id: string
  chatId: string
  role: 'user' | 'assistant'
  text: string
  thinking?: string
  attachments: Attachment[]
  model?: string
  credits?: number
  error?: string
  calls?: ToolCall[]
  // Agent replies: what each step said and which calls it made. budget is in credits.
  agent?: { steps: { text: string; calls: string[] }[]; budget: number }
  createdAt: number
}
// One image or video the assistant asked for. Images start right away; videos wait for you to press Run.
export type ToolCall = {
  id: string
  modelId: string
  label: string
  kind: MediaKind
  variant: Variant
  prompt: string
  input: Record<string, unknown>
  cost: string
  status: 'pending' | 'started' | 'cancelled' | 'error'
  taskIds?: string[]
  error?: string
  notes?: string[]
}
export type ChatEvent =
  | { type: 'start'; chatId: string; message: Message }
  | { type: 'delta'; chatId: string; text?: string; thinking?: string }
  | { type: 'update'; chatId: string; message: Message }
  | { type: 'done'; chatId: string; message: Message }
export type SendRequest = {
  chatId: string; text: string; attachments: Attachment[]; model: string; thinking: boolean; agent?: boolean; editOf?: string; projectId?: string
}

export type Variant = 'text' | 'image' | 'tool'
export type Field = {
  name: string
  label?: string
  type: string
  enum?: (string | number)[]
  enumLabels?: Record<string, string>
  default?: unknown
  media?: boolean
  accept?: 'image' | 'video' | 'audio'
  maxItems?: number
  min?: number
  max?: number
  required?: boolean
  description: string
}
export type ModelSpec = { path: string; slug: string; deprecated: boolean; fields: Field[]; fixed?: Record<string, unknown>; tags?: string[] }
export type MediaKind = 'image' | 'video' | 'audio'
export type MediaModel = {
  id: string
  kind: MediaKind
  label: string
  hidden?: boolean
  text?: ModelSpec
  image?: ModelSpec
  tool?: ModelSpec
  // Rows from kie's price list: description, credits, unit (per item / per second / other).
  prices?: { d: string; c: number; u: 'item' | 'second' | 'other' }[]
}

export type TaskState = 'waiting' | 'queuing' | 'generating' | 'success' | 'fail'
export type Task = {
  id: string
  modelId: string
  variant: Variant
  label: string
  prompt: string
  input: Record<string, unknown>
  state: TaskState
  files: string[]
  // Suno track ids and covers (for Extend and Split vocals), or a transcript.
  meta?: { tracks?: { file: string; id: string; title?: string; cover?: string }[]; text?: string }
  credits?: number
  error?: string
  starred?: boolean
  projectId?: string
  createdAt: number
  completedAt?: number
}
export type GenerateRequest = { modelId: string; variant: Variant; prompt: string; input: Record<string, unknown>; count: number; projectId?: string }

// agentBudget: the most one agent run may spend, in dollars.
// elevenVoices: how many voices the saved ElevenLabs key can use (0 when there is no key).
export type Settings = { hasKey: boolean; keySource: 'saved' | 'env' | null; about: string; model: string; agentBudget: number; hasEleven: boolean; elevenVoices: number; hasClaude: boolean }
// Credits spent per day and model. extra = prompt improvements and chat summaries.
export type UsageRow = { day: string; source: 'chat' | 'media' | 'extra'; model: string; credits: number }

// --- Series ---
// A saved character, castable in any series. The portrait is picked from a few options; the reference sheet is made from it.
// Elements (recurring places, props, creatures, and the products ads sell) are kept the same way, with kind 'element' and no voice.
// A product's photo is its truth: it goes with every shot, next to the image and angles made from it.
export type Character = {
  id: string
  kind?: 'element'
  category?: 'place' | 'prop' | 'creature' | 'product' | 'other'
  name: string
  look: string
  personality: string
  voice?: string
  photo?: Attachment
  // A product's other photos (its back, the label, the box), next to the main one in photo.
  photos?: Attachment[]
  options?: string[]
  // The image model its pictures and angles are made with (GPT Image 2 unless you pick another).
  imageModel?: string
  portraitTask?: string
  sheetTask?: string
  createdAt: number
}
// A spoken line. seconds is measured once the voice is made; it decides how long the scene runs.
export type Line = { speaker: string; text: string; voiceTask?: string; seconds?: number }
// The director's plan for one shot. Filled by the director pass; every field is plain text you can edit.
export type ShotPlan = {
  shot: string
  beats: string
  performance: string
  move: string
  environment: string
  sound: string
  text?: string
  transition?: string
}
// Ads: a shot with a hook letter is one of the alternative openings (A, B, C); each version of the ad is one hook plus
// the shots without one. seconds: how long a shot without dialogue runs (3 s if not set).
// skip: left out of the video (kept, with its pictures, until it's brought back).
export type Scene = {
  id: string
  hook?: string
  skip?: boolean
  seconds?: number
  plan?: ShotPlan
  place: string
  action: string
  camera: string
  cast: string[]
  lines: Line[]
  frameTask?: string
  versions?: string[]
  approved?: boolean
  videoTask?: string
  // The clip with its mouths moved to the voices; syncKey says which video and voices it was made from.
  syncTask?: string
  syncKey?: string
}
// Episodes move through the steps in order; script and scenes wait for your approval.
export type Step = 'script' | 'scenes' | 'voices' | 'video' | 'cut'
// cuts: earlier renders, oldest first (the Edit section's exports land here too).
// The reviewer's read of a script, before anything is drawn: a verdict, how it flows, and what to fix. Each issue names
// its shots (scene ids once saved; the reviewer answers with shot labels) and is either inside one shot or about the
// whole script. key fingerprints the script it read, so an edited script shows the review is out of date.
export type ReviewIssue = { shots: string[]; scope: 'shot' | 'script'; problem: string; fix: string; done?: boolean }
export type Review = { verdict: 'ready' | 'fix'; summary: string; issues: ReviewIssue[]; by: string; at: number; key: string }
// format and adCuts are for ads: the ad's format (see AD_FORMATS) and one finished video per hook.
// One posted version of an ad and its numbers after about 48 hours (asks: "where do I buy" comments).
export type AdResult = { id: string; at: number; platform: 'TikTok' | 'Instagram' | 'Facebook' | 'YouTube'; version: string; views: number; asks: number }
export type Episode = {
  // The video model the script and shot plans were written for; switching models offers to re-plan them.
  writtenFor?: string
  beats?: string
  review?: Review
  format?: string
  adCuts?: string[]
  // Extra one-line text hooks to test over the same video (each export is one more post), and how posts did.
  textHooks?: string[]
  results?: AdResult[]
  id: string; title: string; summary: string; step: Step; scenes: Scene[]; recap?: string; music?: boolean; musicTask?: string; cut?: string; cuts?: string[]
}
// A clip on the editor's timeline. in/out are seconds in the scene's video; hold freezes the last frame; pan -1…1 moves
// the 9:16 crop left/right; voices are the scene's lines (by index) and when they start, in seconds from the clip's start.
export type EditClip = {
  id: string; sceneId: string; in: number; out: number; speed: number; pan: number; zoom: number; hold: number; sound: boolean
  voices: { line: number; at: number }[]
}
export type Edit = { clips: EditClip[]; music: boolean; volume: number }
// continuity: running notes on what has happened, kept up to date after every finished episode.
// kind 'ad': a product's ads. The episodes are ads, cast are the people in them, product is the product's element id,
// logline the angle, continuity the product brief, idea what you wrote about the product.
export type Series = {
  id: string
  kind?: 'ad'
  product?: string
  // Ads: plan with the viral formats and playbook (see formatsFor).
  viral?: boolean
  title: string
  idea: string
  logline: string
  style: string
  seconds: number
  imageModel: string
  videoModel: string
  videoSound?: boolean
  // Video quality as a picture height (720, 1080, 2160); each model uses its closest option at or below it. 1080 if unset.
  videoQuality?: number
  // Who writes the scripts: a chat model id (Claude Sonnet 5.5 unless chosen otherwise).
  writer?: string
  // A chosen look (preset id) and up to 3 images whose style every scene should match.
  stylePreset?: string
  styleRefs?: Attachment[]
  cast: string[]
  elements?: string[]
  continuity: string
  episodes: Episode[]
  createdAt: number
}
// What ffmpeg renders: clips in order (files resolved), voices placed from each clip's start, music underneath.
export type RenderClip = Omit<EditClip, 'id' | 'sceneId' | 'voices'> & { video: string; voices: { file: string; at: number }[] }
export type RenderRequest = { name: string; clips: RenderClip[]; music?: { file: string; volume: number }; preview?: boolean }

// --- Video editor (the Edit section) ---
// One main video track (clips back to back), text tracks and audio tracks (items placed freely in time).
export type TrackKind = 'video' | 'text' | 'audio'
// Tracks are drawn in list order: the video track first, each one below it in the list on top of the ones before.
// muted and solo are for sound (solo: only soloed tracks are heard); volume scales every sound on it; hidden leaves a
// picture or text track out of the preview and the export; locked keeps its items from being selected or moved.
export type Track = { id: string; kind: TrackKind; name: string; muted?: boolean; solo?: boolean; volume?: number; hidden?: boolean; locked?: boolean }
// A setting that changes over an item: its value at seconds from the item's start, straight lines in between, held
// before the first and after the last.
export type Key = { t: number; v: number }
export type KeyProp = 'volume' | 'zoom' | 'x' | 'y' | 'opacity' | 'rotate'
export type Keys = Partial<Record<KeyProp, Key[]>>
// Timeline items, one kind each: a video clip, a picture, a sound or a text. start is the time on the timeline (worked out
// for the main track, set freely on the others). link is the id of a video-track clip the item belongs to (its extracted
// sound, a voice line, the shot's text): it moves when that clip moves, is cut with it and goes when it's deleted. keys
// are its keyframed settings.
type ItemBase = { id: string; track: string; start: number; label: string; link?: string; keys?: Keys }
// How a video-track picture starts after the one before: a crossfade (the two overlap for its length, so the video gets
// that much shorter), a dip through black or white (that long on each side of the cut), or a zoom settling in.
export type Transition = { type: 'fade' | 'black' | 'flash' | 'zoom'; seconds: number }
// Pictures (clips and stills). On the video track: fit is how a picture of another shape fills the frame (cropped to fill
// it, whole with bars in the project's background colour, or whole over a blurred copy of itself); pan and tilt reframe
// it (-1…1: left to right, top to bottom) and zoom enlarges it; motion is movement over the clip. On an overlay track:
// scale is its width (0-1 of the frame), x and y place its centre, rotate turns it (degrees), opacity fades it, crop
// trims its edges (0-1 of the picture from each side). flip mirrors either. Colour: brightness -0.3…0.3, contrast and
// saturation around 1, warmth -1 (cool) … 1 (warm).
export type Fit = 'fill' | 'fit' | 'blur'
export type Crop = { l: number; t: number; r: number; b: number }
type PictureFields = {
  fit?: Fit; pan?: number; tilt?: number; zoom?: number; motion?: Motion; transition?: Transition
  scale?: number; x?: number; y?: number; rotate?: number; opacity?: number; crop?: Crop; flip?: boolean
  bright?: number; contrast?: number; sat?: number; warm?: number
}
// Sound settings: balance is left (-1) to right (1); fades are seconds at either end.
type SoundFields = { volume?: number; fadeIn?: number; fadeOut?: number; balance?: number }
// in and out are seconds in the source file; source is the file's length. reverse plays it backwards.
type VideoFields = ItemBase & PictureFields & SoundFields & { media: 'video'; ref: Ref; source?: number; in: number; out: number; speed: number; hold?: number; sound?: boolean; reverse?: boolean }
type ImageFields = ItemBase & PictureFields & { media: 'image'; ref: Ref; duration: number }
// duck lowers it while someone speaks (music does by default), to duckTo of its volume (0.3 unless set). speed keeps the
// pitch.
type AudioFields = ItemBase & SoundFields & { media: 'audio'; ref: Ref; source?: number; in: number; out: number; speed?: number; duck?: boolean; duckTo?: number }
// A word of a word-by-word caption: seconds from the caption's own start.
export type Word = { text: string; start: number; end: number }
export type Font = 'sans' | 'rounded' | 'serif' | 'mono' | 'impact'
// 'box' draws it on a coloured box; color is the text's colour (the box's, for 'box'); size scales it; x and y place its
// centre (0-1 of the frame) instead of position; anim is how it comes and goes; words make it a word-by-word caption (the
// word being said lights up, in hlColor). width is the most a line can take (0-1 of the frame); outline scales the
// outline's thickness (0 for none); boxAlpha is the box's opacity.
type TextFields = ItemBase & {
  text: string; duration: number; style?: 'caption' | 'title' | 'box'; position?: 'top' | 'middle' | 'bottom'; color?: string; size?: number
  x?: number; y?: number; anim?: 'fade' | 'slide'; words?: Word[]
  font?: Font; align?: 'left' | 'center' | 'right'; width?: number; outline?: number; shadow?: boolean; boxAlpha?: number; hlColor?: string
}
// Each kind has only its own fields: reading another kind's field gives undefined, setting one doesn't compile.
type AnyItem = VideoFields | ImageFields | AudioFields | TextFields
type KeysOf<T> = T extends unknown ? keyof T : never
type AnyKey = KeysOf<AnyItem>
type Only<T> = T & { [K in Exclude<AnyKey, keyof T>]?: never }
export type VideoItem = Only<VideoFields>
export type ImageItem = Only<ImageFields>
export type AudioItem = Only<AudioFields>
export type TextItem = Only<TextFields>
export type Item = VideoItem | ImageItem | AudioItem | TextItem
export type Motion = 'push-in' | 'pull-out' | 'pan-left' | 'pan-right'
export type Look = { bright?: number; contrast?: number; sat?: number; warm?: number }
export type Aspect = '9:16' | '4:5' | '1:1' | '16:9'
// An export: its file, when, and how it was made.
export type ExportRecord = { file: string; at: number; what?: 'video' | 'part' | 'hook' | 'text'; quality?: 'standard' | 'high'; resolution?: Resolution; fps?: number; range?: [number, number] }
export type EditProject = {
  id: string
  // The shape of the saved project; upgrade() in shared/timeline brings older ones up to date when they load.
  version: number
  title: string
  aspect: Aspect
  // Frames a second: the playhead, cuts, trims and moves land on whole frames, and the export runs at this rate.
  fps: number
  tracks: Track[]
  items: Item[]
  imports: Attachment[]
  exports: ExportRecord[]
  // The export's size: 1080p unless set otherwise.
  resolution?: Resolution
  // The colour behind pictures that don't fill the frame (fit with bars); black unless set.
  background?: string
  // The export's sound is evened out to -14 LUFS (what TikTok, Reels and YouTube play at) unless this is false.
  normalize?: boolean
  // The part marked for export (I and O), and markers on the timeline (M), in seconds.
  range?: [number, number]
  markers?: number[]
  episode?: { series: string; episode: string }
  createdAt: number
}
export type Resolution = '720p' | '1080p' | '2160p'
// What ffmpeg renders for a project: everything resolved to files and seconds. Text arrives as full-frame PNGs. Overlays
// and texts carry their track's place in the list (layer), and are drawn in that order. Keys are in each item's seconds.
type SoundOut = { volume: number; fadeIn: number; fadeOut: number; balance: number; keys?: Keys }
export type ProjectRender = {
  name: string
  aspect: Aspect
  fps: number
  preview?: boolean
  resolution?: Resolution
  // Behind pictures with bars; normalize evens the sound out to -14 LUFS.
  background: string
  normalize: boolean
  // 'high' is a larger, sharper file; range exports only that part (seconds of the timeline).
  quality?: 'standard' | 'high'
  range?: [number, number]
  main: (SoundOut & { ref: Ref; media: 'video' | 'image'; start: number; in: number; out: number; length: number; speed: number; reverse: boolean; fit: Fit; pan: number; tilt: number; zoom: number; flip: boolean; sound: boolean; motion?: Motion; transition?: Transition; look?: Look })[]
  // Pictures and clips laid over the main track (picture in picture, logos, screen recordings).
  overlays: (SoundOut & { layer: number; ref: Ref; media: 'video' | 'image'; start: number; in: number; out: number; length: number; speed: number; x: number; y: number; scale: number; rotate: number; opacity: number; crop?: Crop; flip: boolean; sound: boolean; look?: Look })[]
  texts: { layer: number; ref: Ref; start: number; length: number; anim?: Item['anim'] }[]
  // duck: the times (in the item's own seconds) when it's lowered under speech, and how low it goes.
  audio: (SoundOut & { ref: Ref; start: number; in: number; out: number; speed: number; duck?: [number, number][]; duckTo: number })[]
}
