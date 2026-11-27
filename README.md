# locco

A personal AI app for the Mac. Chat, image and video generation, a video editor and an ad and series writer in one window, all paid per use from one [kie.ai](https://kie.ai) key, with no subscriptions.

Your chats, media and keys stay on your Mac. The models run in the cloud through kie.ai.

## What's in it

- **Chat**: talk to Claude, GPT, Gemini and other models, and switch models in the middle of a chat. Attach images and PDFs. Ask for an image or video and the assistant runs the right model and shows the result inline.
- **Create**: an image, video and audio studio with a model, shape, length and quality picker, plus a gallery of everything you've made. Animate, upscale or remix any result.
- **Edit**: a timeline editor with tracks for video, overlays, text and audio. It has trims, splits, speed and speed ramps, transitions, camera movement, reframing, colour, captions that light up word by word, extracting a clip's sound and lowering music under voices. Exports to MP4 at up to 1080p with ffmpeg.
- **Series and ads**: write a series episode by episode, or write ads from a product brief. Ads use a set of formats, plus a Viral mode with hook-led formats such as comic disaster, fake danger, mystery close-up, stranger reactions and countdown. Scripts are written for the video model you pick, then turned into shots, stills and clips.
- **Characters, elements and voices**: keep people, places and products consistent across shots, and give characters ElevenLabs voices.
- **Agent mode** and **projects** to group work.

## Requirements

- macOS on Apple silicon
- Node.js 22 or later
- A [kie.ai](https://kie.ai) API key. ElevenLabs and Anthropic keys are optional.

## Run it

```bash
npm install
npm run dev
```

Add your keys in **Settings** inside the app. They're encrypted with the macOS keychain (Electron `safeStorage`) and saved in the app's data folder, never in this repo.

For development you can instead put your kie.ai key in a `.env` file at the project root. It's ignored by git.

```
KIE_API_KEY=your-key
```

## Build and install

```bash
npm run install-app
```

This builds `locco.app`, copies it to `/Applications` and opens it. The build isn't code-signed, so macOS may ask you to allow it the first time.

## Other scripts

| Command | What it does |
|---|---|
| `npm run typecheck` | Type-checks the whole project |
| `npm run check` | Runs the self-checks for prices, models and the timeline |
| `npm run sync-models` | Refreshes the model list and prices from kie.ai |
| `npm run build` | Builds without packaging |

## How it's built

Electron, React 19, TypeScript and Tailwind, bundled with electron-vite. ffmpeg comes from `ffmpeg-static`.

```
src/main/       Electron main process: kie.ai calls, chat, tasks, the editor export, series and ads, the database
src/preload/    The bridge the window uses to call the main process
src/renderer/   The React interface
src/shared/     Types, model list, prices, ad formats and timeline logic shared by both sides
scripts/        Model sync and self-checks
```

`PLAN.md` has the original design notes.

## License

[MIT](LICENSE)
