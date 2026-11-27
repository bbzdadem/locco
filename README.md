# locco

A personal AI app for the Mac. Chat, image and video generation, a video editor, and a writer for short series and product ads, all in one window. Every model is paid per use from one [kie.ai](https://kie.ai) key, so there are no subscriptions.

Your chats, media and keys stay on your Mac. The models run in the cloud through kie.ai.

- [What's in it](#whats-in-it)
- [Getting started](#getting-started)
- [Keys and settings](#keys-and-settings)
- [Using locco](#using-locco)
- [Models](#models)
- [Where your data lives](#where-your-data-lives)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

## What's in it

| Section | What it does |
|---|---|
| **Chat** | Talk to Claude, GPT and Gemini, and switch models in the middle of a chat. Attach images and PDFs. Ask for a picture or a video and locco makes it in the chat. |
| **Agent mode** | A chat that works through a bigger request on its own, step by step, within a spending limit you set. |
| **Projects** | Folders for chats that share instructions and files. |
| **Create** | An image, video and audio studio with a gallery of everything you've made. |
| **Series** | Write a short series episode by episode, then take each one from script to finished video. |
| **Ads** | Write video ads from a product brief, including a Viral mode built around scroll-stopping hooks. |
| **Edit** | A timeline video editor with text, captions, sound and export to MP4. |

## Getting started

### Requirements

- A Mac with Apple silicon (M1 or later)
- [Node.js](https://nodejs.org) 22 or later
- A [kie.ai](https://kie.ai) account and API key, with some credits on it

### Run it from source

```bash
git clone https://github.com/bbzdadem/locco.git
cd locco
npm install
npm run dev
```

The app opens in a window. Go to **Settings** (bottom of the sidebar) and paste your kie.ai key.

### Install it as an app

```bash
npm run install-app
```

This builds `locco.app`, copies it into `/Applications` and opens it. The build isn't code-signed, so the first time macOS may say it can't check the app. Right-click it in Applications, choose **Open**, then confirm.

## Keys and settings

All keys are entered in **Settings** inside the app. They're encrypted with the macOS keychain (Electron `safeStorage`) and saved on your Mac, never in this repo.

| Setting | Needed? | What it's for |
|---|---|---|
| kie.ai API key | Yes | Every chat model and every image, video and music model |
| ElevenLabs API key | No | Your own ElevenLabs voices, sound effects, music and voice isolation, and character voices in Series |
| Claude API key | No | Sends every Claude call straight to Anthropic, billed to your Anthropic account, instead of through kie.ai. Ad scripts are reviewed by Claude Opus 5.5, and GPT 6 Sol steps in if that fails. |
| About you | No | A few lines every chat knows about you |
| Default chat model | No | The model a new chat starts with |
| Agent budget per run | No | The most one agent run may spend (default $2) |

Settings also shows what you've spent in the last 30 days, broken down by model. Your kie.ai credit balance is at the bottom of the sidebar and turns into a warning when it runs low.

For development you can put your kie.ai key in a `.env` file at the project root instead. That file is ignored by git.

```
KIE_API_KEY=your-key
```

## Using locco

### Chat

- Pick a model under the message box. You can switch at any time and the new model sees the whole conversation.
- Attach images and PDFs by dropping them in or with the paperclip.
- Ask for media in plain words ("make a 9:16 video of this photo"). The assistant picks a model, shows the price and runs it. The result appears in the chat and in the Create gallery.
- Text you've typed but not sent is kept when you go to another section.
- Chats can be renamed, deleted or moved into a project from the sidebar.

### Agent mode

Turn on agent mode in a chat for requests that need several steps, such as "make three product shots, then animate the best one". The agent makes something, looks at the result, and decides what to do next. It stops when the job is done, after a fixed number of steps, or when it reaches the agent budget from Settings.

### Projects

A project groups chats. Each project has **Instructions** that every chat in it follows (the goal, tone, brand colours, audience) and **Files** that every chat can read. The project page also shows everything made in its chats.

### Create

- Choose **Image**, **Video** or **Audio**, then a model. Each model shows the options it supports, such as shape, length, quality and reference images, along with an estimated price.
- Everything you make goes into a gallery, newest first. Jobs keep running in the background with live progress.
- From any result you can reuse its prompt and settings, use it as a reference, animate an image, upscale it with Topaz, copy a video's motion onto a character, ask about it in chat, show it in Finder or move it to the Trash.

### Series

1. Start a series with an idea. locco writes a series bible and a cast.
2. Characters, places and products (elements) have reference pictures, so they look the same in every shot. Characters can have an ElevenLabs voice.
3. Each episode goes through five steps: **Script → Scenes → Voices → Video → Cut**.
   - **Script**: written by one model and reviewed by another, so no model grades its own work. Revise it until you're happy.
   - **Scenes**: the script becomes shots, each with a still picture.
   - **Voices**: the lines are spoken by each character's voice, and the shots are timed to them.
   - **Video**: each still is animated with the video model you choose.
   - **Cut**: everything is put together in order, ready to open in Edit.
4. Episodes can be duplicated to try another version.

### Ads

1. Write a product brief: what it is, who it's for, the clip length, and which characters and elements appear. The character and element pickers show one row, and **See more** opens the full list.
2. Choose how many ads to write. locco picks a different format for each.
3. Choose the **video model** up front. Scripts are written to what that model does well and avoid what it gets wrong. If you switch models later at the Video step, locco offers to re-plan the shots for the new one.
4. Each ad then goes through the same five steps as a series episode. Ads can be duplicated.

**Formats**

| Standard | Viral (with **Viral** turned on) |
|---|---|
| Pet moment | Concept vs product |
| Compilation | Store reaction |
| Prank / skit | Then vs now |
| Reaction / gift | Comic disaster |
| Before / after | Fake danger |
| Problem → fix | Mystery close-up |
| Satisfying / ASMR | Stranger reactions |
| This vs that | Kid reaction |
| 3 ways to use it | Revenge / prank |
| Unboxing | Countdown / challenge |
| How to use | |
| POV | |

Viral mode puts the hook first. The very first frame has to be absurd, alarming or strange on its own. Viral ads use short hook lines on screen, a spectacular but believable payoff, and end with a "Comment WORD" call to action.

### Edit

A timeline editor for putting videos together, whether they come from a Series or Ads cut or are your own clips.

- **Tracks** for the main video, overlays (picture in picture), text and audio.
- **Clip options** are in tabs:
  - **Frame**: fill the frame (crop, bars or blurred background), reframe, zoom, mirror. For overlays, also size, position, rotation, opacity and crop.
  - **Motion**: push in, pull out or pan across a clip, and the transition into it (cut, crossfade, dip to black, flash, zoom).
  - **Timing**: speed, speed ramps, playing backwards, holding the last frame.
  - **Sound**: clip sound on or off, volume, fades, left and right balance, and **Extract sound** to move it to its own track.
  - **Colour**: brightness, contrast, saturation and warmth, with **Apply to all clips** so AI clips match.
- **Text and captions**: outline, title or box styles, fonts, colours, position and how they come in. Automatic captions light up each word as it's spoken.
- **Audio**: music can lower itself while someone speaks.
- **Keys** (◆) make a setting change over the length of a clip.
- Deleting a clip leaves its extracted sound and any text in place.
- Edits can be duplicated from the **Your edits** list.
- **Export** to MP4 at up to 1080p, the whole video or just a marked part.

**Keyboard shortcuts**

| Keys | Action |
|---|---|
| Space | Play / pause |
| J K L | Play backwards, pause, play (press again for 2×, 4×) |
| ← → | One frame back or forward (⇧ for one second) |
| ↑ ↓ | Previous or next cut |
| Home / End | Go to the start or end |
| S or ⌘B | Split at the playhead |
| F | Freeze the frame at the playhead for a second |
| ⌫ | Delete the selected items |
| ⇧ or ⌘ click | Select more than one |
| ⌘A | Select everything |
| ⌘C ⌘X ⌘V | Copy, cut, paste at the playhead |
| ⌘D | Duplicate |
| ⌥← ⌥→ | Nudge the selected text, sound or overlay by a frame (⇧ for a second) |
| I O | Mark the part to export (⌥X clears it) |
| M | Add or remove a marker |
| + − or pinch | Zoom the timeline |
| ⇧Z | Fit the whole video |
| ⇧⌘F | Full-screen preview |
| ⌘Z ⇧⌘Z | Undo / redo |

## Models

locco covers about 70 models through kie.ai. The list and prices are kept in `src/shared/media-models.json` and `src/shared/prices.ts`, and are refreshed with `npm run sync-models`.

- **Chat**: Claude Sonnet 5.5, Claude Opus 5.5, Claude Haiku 5.5, GPT 6 Sol, Gemini 3.8 Flash
- **Image**: Nano Banana Pro and 2, GPT Image 2, Seedream 5, Flux 2, Ideogram V3, Imagen 4, Qwen Image 3, Wan 2.7 Image, Grok Imagine and more, plus Topaz upscale and background removal
- **Video**: Kling 3.0 and 4.0, Veo 3.1, Seedance 2.0 and 2.5, Hailuo 2.3, Wan 3.0, PixVerse V6, MiniMax H3, Vidu Q4, Grok Imagine and more, plus avatars, lip sync, motion control and Topaz video upscale
- **Audio**: Suno V6 (with extend and vocal split), ElevenLabs speech, and transcription. With your own ElevenLabs key you also get your own voices, sound effects, music and voice isolation.

Prices shown in the app are estimates. kie.ai reports the real cost after each job.

## Where your data lives

Everything is stored in the app's data folder on your Mac:

```
~/Library/Application Support/locco/
```

That folder holds the database (`locco.db`, SQLite) with your chats, projects, series, edits and encrypted keys, along with a `media` folder of everything you've made and an `uploads` folder of files you've attached. Delete the folder to start fresh.

Nothing is sent anywhere except the requests to the services you use: kie.ai, and ElevenLabs or Anthropic if you've added those keys.

## Development

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Runs the app with hot reload |
| `npm run typecheck` | Type-checks the whole project |
| `npm run check` | Runs the self-checks: every model has a price, and the timeline logic works |
| `npm run sync-models` | Refreshes the model list and prices from kie.ai |
| `npm run build` | Builds without packaging |
| `npm run dist` | Builds `dist/mac-arm64/locco.app` |
| `npm run install-app` | Builds, installs into `/Applications` and opens it |

### Stack

Electron, React 19, TypeScript, Tailwind CSS 4, electron-vite, and Node's built-in SQLite. ffmpeg comes bundled through `ffmpeg-static`.

### Layout

```
src/main/       Electron main process
  index.ts        App start, window, settings, and the IPC handlers
  kie.ts          kie.ai calls: tasks, polling, uploads, credits
  chat.ts         Chat replies, streaming, tool calls, agent mode
  assistant.ts    The tool that lets chat make images and videos
  claude.ts       Direct Anthropic calls when a Claude key is set
  eleven.ts       ElevenLabs voices, speech, sound effects, music
  tasks.ts        Generation jobs and the gallery
  media.ts        Downloading and storing media files
  series.ts       Series and ad writing, scenes, voice timing, the cut
  editor.ts       Edit projects, thumbnails, the ffmpeg export
  db.ts           The SQLite database
src/preload/    The bridge the window uses to call the main process
src/renderer/   The React interface (one file per section: Chat, Create, Series, Episode, Studio for Edit, Settings…)
src/shared/     Code both sides use: types, models, prices, ad formats, timeline logic
scripts/        Model sync and self-checks
design/         The app icon and logo sources
```

`PLAN.md` has the original design notes.

## Contributing

Pull requests are welcome.

1. Fork the repo and create a branch.
2. Make your change and run `npm run typecheck` and `npm run check`.
3. Open a pull request saying what it changes and why.

Never commit API keys, `.env` files or anything from your app data folder.

## License

[MIT](LICENSE)
