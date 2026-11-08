# locco: plan

## What you mean (my read)

One personal app on your Mac that replaces **Claude Pro + ChatGPT Plus + Higgsfield** with **one kie.ai key and one credit balance** (pay per use, no subscriptions).

It has three surfaces in one window:

1. **Chat** (Claude/ChatGPT layout): sidebar with history, a centered thread, a composer with a model picker. Talk to Claude Opus/Sonnet, Gemini and others, and switch models mid-chat. Attach images and PDFs.
2. **Create** (Higgsfield layout): an Image / Video / Audio studio. A prompt bar with model, aspect, duration and resolution chips sits over a gallery grid. Results tiles have hover actions such as Animate, Upscale and Remix.
3. **Assistant glue:** in chat you say "make a 9:16 video of this photo". The assistant picks the model and runs it. The result shows up inline, like ChatGPT image gen, and also lands in the Create gallery.

**"Local"** means it runs on localhost and your chats, media and key stay on your disk. The models run in the cloud through kie. There are no offline LLMs (see Q2).

```
┌─ Sidebar ──────┐┌─ Chat ───────────────────────────────────────┐
│ + New chat     ││                                              │
│ ⌕ Search       ││   user: animate this ↓ [img]                 │
│ ✦ Create       ││   assistant: Running Kling 3.0, 9:16, 5s…    │
│ ▣ Library      ││   ┌──────────────┐                           │
│ ── Today ──    ││   │ ▶ video card │ (live progress → player)  │
│ Trip ideas     ││   └──────────────┘                           │
│ Logo v2        ││ ┌──────────────────────────────────────────┐ │
│ ── Yesterday ─ ││ │ Message…                    📎 🎙  ▲    │ │
│                ││ │ [Claude Sonnet 5.5 ▾] [Thinking ◦]       │ │
│ 429.5 credits  ││ └──────────────────────────────────────────┘ │
│ ⚙ Settings     │└──────────────────────────────────────────────┘
└────────────────┘
┌─ Create ─────────────────────────────────────────────────────────┐
│ [Image] [Video] [Audio]                                          │
│ ┌────┐┌──────┐┌────┐┌────┐   masonry gallery, newest first,      │
│ │    ││ ⏳62% ││    ││ ▶  │   hover: ⬇ ↻ remix · use as ref ·    │
│ └────┘└──────┘└────┘└────┘   animate · upscale                   │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │ [+ref][+ref]  Describe your shot…                    Generate │ │
│ │ [Nano Banana Pro ▾] [16:9 ▾] [2K ▾] [×2]        ~8 credits    │ │
│ └──────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

It copies the layout patterns, not those products' logos or branding. The look is dark-first.

---

## kie.ai API: what matters (checked against your account: key works, 429.5 credits)

**Basics.** The base URL is `https://api.kie.ai` and every request sends `Authorization: Bearer KEY`. Errors come back as **HTTP 200 with a non-200 `code` in the body**, so every call has to check `code`. The rate limit is 20 new jobs per 10 s, with 100+ running at once.

**Three API shapes. This is the whole integration surface.**

| Shape | Used by | Call |
|---|---|---|
| **Anthropic Messages** (sync, SSE stream, custom tools) | All Claude models (Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5, 4.x) | `POST /claude/v1/messages`, model in body; list with `GET /anthropic/v1/models` ✅ verified |
| **OpenAI chat completions** (per-model URL, SSE, final chunk carries `credits_consumed`) | Gemini `*-openai`, GPT 5.2, DeepSeek, Kimi | `POST /<model-slug>/v1/chat/completions` ✅ verified (Gemini). Docs say Gemini is "chat only, not adapted for agents", so **the tool-calling brain is Claude** |
| **OpenAI Responses** | GPT 5.5 / 5.6 / 6 / 6.1, Grok 4.x, Codex | path not verified, so it goes in a later phase |
| **Async task, standard** (~90% of media models) | Image, video, audio, avatar | `POST /api/v1/jobs/createTask {model, input}` → `taskId`; poll `GET /api/v1/jobs/recordInfo?taskId=`; state `waiting/queuing/generating/success/fail`; `resultJson` is a JSON *string* → `resultUrls[]` ✅ verified |
| **Async task, custom** | Veo 3.1 (`/api/v1/veo/generate` + `/veo/record-info`, `successFlag`), Suno (`/api/v1/generate` + `/generate/record-info`), Flux Kontext (`/api/v1/flux/kontext/generate`) | each needs a small adapter |

**Common endpoints**
- `GET /api/v1/chat/credit` returns the credit balance ✅
- `POST /api/v1/common/download-url` returns a temporary link, valid for 20 min
- Upload (free): `file-url-upload`, `file-base64-upload`, `file-stream-upload`. Uploads are deleted after **24 h**. ⚠ The docs show the host as `kieai.redpandaai.co`, not `api.kie.ai`; to be verified in Phase 0.
- Callbacks (`callBackUrl`) need a public URL, so a local app uses **polling** instead.
- Generated media is deleted after **14 days**, so we download each result to disk the moment it finishes. **The local library is the source of truth.**
- Cost: `creditsConsumed` per task and `credits_consumed` per chat call, reported **after** the fact. There is no pricing API.

**A key finding:** every model's docs page (`docs.kie.ai/market/<path>.md`) contains a full **OpenAPI schema for its `input`**: enums, defaults, `maxItems`, `deprecated: true`. That means:
- A script turns a list of model slugs into `models.json` automatically.
- The Higgsfield-style prompt bar is **generated from the schema**. An enum becomes a chip dropdown, an array of URIs becomes reference-image slots, a boolean becomes a toggle.
- **Adding a model means adding one slug and re-running the sync. No UI code.** Dead models (Gemini 3.5 is already deprecated) hide themselves.

### Full model inventory (from docs index)

**Chat:** Claude Opus 4.5–5.5, Sonnet 4.5–5.5, Haiku 4.5/5.5, Fable 5 · GPT 5.2 (chat completions), GPT 5.5 / 5.6 Luna·Sol·Terra / 6 Astra·Luna·Sol / 6.1 Sol·Terra, Codex (Responses) · Gemini 2.5 Pro, 3 Pro, 3.1 Pro, 3.6/3.7/3.8 Flash, 4 Argon (+ `-openai` variants) · Grok 4.3–4.7 · DeepSeek V4.1 Flash · Kimi K3, K3.1 Pro

**Image gen/edit:** Nano Banana / Edit / Pro / 2 / 2.1 / 2 Lite · Imagen 4 / Fast / Ultra · GPT Image 1.5, 2, 2.5 Flare·Sunburst, 2.6 Flare·Sunburst·Economy · 4o Image · Seedream 3, 4, 4.5, 5 Lite / Pro / Flash (+ layer decomposition) · Flux-2 Pro / Flex, FLUX 3 Klein, Flux Kontext · Ideogram V3 (+ Edit/Remix/Character) · Qwen, Qwen2, 2.1, 3, 3 Pro · Wan 2.7 Image / Pro · Grok Imagine (+ Image 2.0, Segment Edit/Map) · Z-Image

**Image tools:** Topaz upscale · Recraft remove-background, Crisp upscale

**Video:** Veo 3.1 (fast/lite, 1080p/4K, extend) · Kling 2.1, 2.5 Turbo, 2.6, 3.0, 3.0 Omni, V3 Turbo, 4.0 Reference/Keyframe (+ Flash), Motion Control · Seedance 2.0 / Fast / Mini, 2.5 / Draft, Bytedance V1 Pro/Lite · Hailuo 02, 2.3 · Wan 2.2 / 2.5 / 2.6 / 2.7 / 3.0 (+ Animate, V2V, edit) · Runway (+ Aleph) · Grok Imagine video (+ upscale/extend) · PixVerse V6 / Max · MiniMax H3 · HappyHorse 1 / 1.1 · Gemini Omni Video · Vidu Q4 · Topaz video upscale

**Avatar / lip-sync:** Kling AI Avatar · OmniHuman 1.5 / 2.0 · Infinitalk · Volcengine lip-sync · Wan Speech-to-Video · Gemini Omni Character / Audio

**Music (Suno V4–V5.5):** generate, extend, cover, upload+cover/extend, add vocals/instrumental, replace section, lyrics, timestamped lyrics, stems, MIDI, WAV, music video, mashup, persona, sounds, custom voice

**Speech:** ElevenLabs TTS (Multilingual V2, Turbo 2.5), Text-to-Dialogue V3, Audio Isolation · Gemini TTS · Nemotron 3.5 Transcribe (STT, timestamps and speakers)

Not on kie: Sora, Midjourney.

---

## Architecture (kept as small as it can be)

```
locco/
  app/            Next.js App Router: / (chat), /c/[id], /create, /library
  app/api/        chat (SSE) · generate · tasks · upload · credits · media/[file]
  lib/kie.ts      one fetch wrapper: auth, throw on code≠200, createTask/recordInfo/upload/credit
  lib/db.ts       node:sqlite (built into Node 24, no dependency)
  lib/poller.ts   every 5 s: sweep pending tasks → recordInfo → download results → update row
  lib/models.json generated registry (slug, kind, envelope, input schema)
  scripts/sync-models.ts   docs .md → OpenAPI YAML → models.json
  data/           locco.db + media/   (gitignored, your library)
```

- **Stack:** Next.js + TypeScript + Tailwind, run as one process on `localhost:3000`.
- **Chat:** Vercel AI SDK (`ai`) for streaming, the tool loop and the `useChat` UI state, using the Anthropic provider and an OpenAI-compatible provider pointed at kie. Phase 0 proves that kie's quirks (`x-api-key: Bearer …`, `thinkingFlag`, `credits_consumed` in the stream) work with it. If they don't, we fall back to raw fetch plus SSE parsing.
- **Tables:**
  - `chats`
  - `messages`: content JSON plus credits
  - `tasks`: taskId stored **the moment** createTask returns, because credits are already billed by then; also state, input, local file paths, credits, and an optional chat link
  - `uploads`: sha256 → kie URL, re-uploaded after 20 h
- **Restart-safe:** on boot, the poller picks up every task that is not finished.
- **Spend guard:** image tool calls from the assistant run automatically. Video and music show a **Run** card that you click to approve. This needs no pricing table.

## Phases

| # | Ships | Done when |
|---|---|---|
| **0** | Spike: scaffold, `.env.local` key, prove the credit balance, a Claude stream, a Gemini stream, one nano-banana-pro task polled and downloaded, one upload (find the right host) | All 5 calls work from the app's server |
| **1** | **Chat**: sidebar and history, streaming markdown and code, model picker (Claude Opus/Sonnet/Haiku 5.5, Gemini 3.8 Flash), thinking toggle, stop / regenerate / edit, image and PDF attach, custom instructions ("about me"), credits badge and cost per message | It's your daily-driver chat |
| **2** | **Create → Image**: sync script, schema-driven prompt bar, task engine, gallery with live tiles, Library. Models: Nano Banana Pro / 2, GPT Image 2, Seedream 5 Pro, Flux-2 Pro, Ideogram V3, plus Topaz upscale and Recraft remove-bg | A shot goes from prompt to file on disk to gallery |
| **3** | **Create → Video**: Kling 3.0/4.0, Veo 3.1 (adapter), Seedance 2.x, Hailuo 2.3, Wan 2.7, Grok Imagine; first and last frame slots; **Animate** on any image; Topaz video upscale | Image → Animate → video in 2 clicks |
| **4** | **Assistant glue**: a `generate` tool for Claude (catalog in the system prompt, server-side schema validation so it can fix its own mistakes), inline live media cards, Run approval for video and music, "send to chat" from the gallery | "Make this a 9:16 video" works in chat |
| **5** | **Audio**: Suno (adapter: generate / extend / lyrics / stems), ElevenLabs TTS ("read aloud" on messages), mic → Nemotron STT in the composer | Speak, hear, make songs |
| later | Only if you want them: GPT/Grok through the Responses adapter · Projects (system prompt and files per project) · avatars and lip-sync · Mac app wrapper (Tauri) · prompt enhancer | |

**Skipped on purpose:** accounts and auth (single user), webhooks (they need a public URL), a pricing table (kie reports cost after each job), all ~150 models in v1 (we curate ~20; the sync script makes adding more free).

## Open questions (my default in **bold**)

1. **Browser tab at localhost** or a real Mac app with a dock icon? → **Browser first.** A Tauri wrapper later is a thin shell around the same app.
2. "Local" also means **offline models** (Ollama), or **everything through kie, data on my disk**? → **kie only.**
3. Default brain for chat and the assistant? → **Claude Sonnet 5.5** (cheap, can use tools), with Opus 5.5 one click away.
