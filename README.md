<p align="center">
  <img src="assets/logo.svg" width="160" alt="ClipPulse logo — a pulse line cutting through a 9:16 clip frame, resolving into a play triangle">
</p>

<h1 align="center">ClipPulse</h1>

<p align="center">
  Turn a long YouTube video into 30-second 9:16 Shorts — find the best moment, cut it, caption it, render it.<br>
  Locally, free, on your own machine.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node-20%2B-339933?logo=node.js&logoColor=white" alt="Node 20+">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" alt="React 19">
  <img src="https://img.shields.io/badge/ffmpeg-8.x-007808?logo=ffmpeg&logoColor=white" alt="ffmpeg">
  <img src="https://img.shields.io/badge/yt--dlp-required-FFD800?logo=youtube&logoColor=black" alt="yt-dlp">
  <img src="https://img.shields.io/badge/License-MIT-C6F135" alt="MIT License">
</p>

---

## What it makes

A vertical Short, cut from the strongest moment of a long video — not a random slice, not a re-upload.

![Demo clip — hook title, then word-by-word captions below the picture](assets/demo-clip.gif)

Watch the full sample: **[examples/raj-clip-doac-spec.mp4](examples/raj-clip-doac-spec.mp4)** — 30 seconds from Raj Shamani's podcast with ex-Navy SEAL Robert J. O'Neill, the "super secret mission" moment (window 800–830s).

Every clip follows the same production standard:

- **Framing** — 16:9 source centre-cropped to 4:5, with the same frame scaled up and blurred behind it as top/bottom bars. Wide two-shots fall back to a 16:9 letterbox so no face is ever half-cut.
- **Hook title** — a big yellow title for the first 2.8 seconds, stating the payoff before the story starts.
- **Captions** — word-by-word karaoke, ALL CAPS, current word yellow / rest white, placed **below the picture** on the bottom bar — never over a face.
- **Voice** — cleaned and levelled to −14 LUFS, natural pauses kept.
- **No music. No sound effects.** The professional look comes from framing, the title and the captions — not from decoration.

One honest line: ClipPulse finds the strongest moments it can *measure*. It cannot guarantee views — no tool can.

## How it works

![How ClipPulse works: paste a link or fetch trends → smart analyze → 4 clips scored → DOAC render and download](assets/flow.svg)

1. **Paste a link, or fetch trends** — any YouTube link (watch, youtu.be, Shorts, live, embed, or a bare video ID), or the trending long videos of 10 default creators, re-sorted by real view count.
2. **Smart analyze** — the full video is transcribed with real Whisper speech-to-text, and a real audio-energy profile is measured. A sliding window scores every 30-second moment on hook strength, payoff, emotion and audio peaks.
3. **4 clips, scored** — the top 4 non-overlapping moments, each with a suggested title and hook. Preview each one in the page.
4. **Render & download** — local MP4 via ffmpeg in 720p, 1080p or 4K, with the DOAC edit style and burned-in captions.

## Features

- **Smart analyze** — full-video Groq Whisper transcription + real audio-energy profile + sliding-window virality scoring (no preset transcripts, no fake scores)
- **DOAC edit style** — the production standard above, measured from a Diary of a CEO Short and locked in by the owner
- **Hormozi-style captions** — Anton, ALL CAPS, word-pop karaoke engine, also available for non-DOAC renders
- **Trending fetch** — 10 default creators (MrBeast, IShowSpeed, Kai Cenat, Raj Shamani, Joe Rogan, PewDiePie, Markiplier, Airrack, Dude Perfect, Dream), 1-hour cache
- **Paste-a-link** — validated YouTube URLs only; anything else is rejected, not guessed at
- **Scene-aware editing** — PySceneDetect cuts, smooth face tracking, per-scene framing decisions
- **720p / 1080p / 4K** — 4K renders take ~10 minutes per clip on a modest machine; 720p takes about a minute
- **Voice polish** — high-pass, presence EQ, de-esser and loudness normalisation on every render

## Quickstart

**Prerequisites:** Node.js 20+, `ffmpeg`, `yt-dlp`. The setup script installs the last two for you on Linux/macOS.

```bash
git clone https://github.com/Manik51/Clippulse.git
cd Clippulse

# One-time setup: copies .env.example → .env, installs deps, ffmpeg & yt-dlp
bash scripts/setup-local.sh

# Add your free API keys to .env (see below), then:
npm run prod
```

Open **http://localhost:3000**.

### API keys (`.env`)

| Variable | Required? | Free source | What it unlocks |
|---|---|---|---|
| `GEMINI_API_KEY` | Recommended | [Google AI Studio](https://aistudio.google.com/apikey) | AI hook scoring & titles |
| `GROQ_API_KEY` | Recommended | [Groq Console](https://console.groq.com/keys) | Fast Whisper transcription & GPT-OSS-120B scoring |
| `YOUTUBE_API_KEY` | Not required | — | ClipPulse uses `yt-dlp` zero-key search when this is omitted |

Keys live only in your local `.env` — never committed, never sent anywhere except the provider APIs above.

### Tests

```bash
npm test   # 34 tests, virality scoring + subtitle + layout logic
npm run lint
```

## The DOAC production standard

The clip style was not guessed. It was measured, frame by frame, from a Diary of a CEO Short ("A Soviet Grocery Store Had Only 77 Items"), then built as one sample, checked shot by shot, and approved before it became the standard.

| Element | Spec |
|---|---|
| Format | 9:16, 720×1280, 30 fps |
| Framing | 16:9 → 4:5 centre crop, blurred-fill bars; wide two-shots → 16:9 letterbox |
| Cuts | Hard cuts only, from the source's own cameras — no transitions, no zoom inside a shot |
| Hook title | Big yellow title, first ~2.8 s, payoff first |
| Captions | Word-by-word, ALL CAPS, below the picture on the bottom bar; current word yellow, rest white |
| Voice | Clean, natural, pauses kept, levelled to −14 LUFS |
| Music / SFX | None |

## Security

ClipPulse is a **local-only tool with no authentication**. Run it on your own machine and keep it there — do not expose port 3000 to the internet, and do not put it behind a public tunnel. Pasted URLs are validated (only real youtube.com / youtu.be links are accepted). API keys stay in your local `.env` (chmod 600); `.env` is git-ignored and the repo ships only `.env.example` with placeholders.

## Project structure

```
clippulse/
├── server.ts               # Express API: analyze, render, trending, jobs
├── src/
│   ├── lib/virality.ts     # Scoring, captions (DOAC + Hormozi), DOAC layout
│   └── components/         # TrendingClipsPanel, ExportModal, TopBar
├── scripts/                # PySceneDetect, YuNet face detection, thumbnails
├── assets/                 # Logo (SVG + PNG), flow diagram, demo GIF
├── examples/               # The approved DOAC sample clip
├── renders/                # Your rendered clips (git-ignored)
└── PRODUCTION-READY.md     # Full build history, v1 → v8.3
```

## Roadmap

- **Next:** faster-whisper word timestamps, run locally on the chosen 30-second clip only — real word timings for the karaoke captions, no cloud quota
- **Later:** silence-trimmed leading cuts, pop SFX on word hits (optional, off by default in DOAC style)

## License

MIT — see [LICENSE](LICENSE).
