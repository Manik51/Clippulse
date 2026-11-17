# ClipPulse — Production Ready (verified 2026-11-15, 23:30 IST)

Location: `~/workspace/clippulse` — server running in production mode on this VM.

## Run
```bash
cd ~/workspace/clippulse
npm run prod        # build + NODE_ENV=production, http://localhost:3000
# dev alternative:
npm run dev         # Vite dev mode, same port
```
Server stays up only while this VM runs; a VM restart stops it — rerun `npm run prod`.

## Verified 2026-11-15
- `npm install` clean, `npm run lint` (tsc --noEmit) clean
- `npm test` — 9/9 pass
- `npm run build` clean — dist/index.html + 338 kB JS / 46 kB CSS
- `GET /api/health` → `{"ok":true,"service":"clippulse-api"}`
- `GET /api/local-capabilities` → yt-dlp true, ffmpeg true, canRenderLocally true, all keys false
- `POST /api/analyze-hooks` (no key) → local deterministic scorer fallback, 200
- `POST /api/render-local-mp4` (preset) → 200, real MP4 720x1280, 12s, h264+aac, 796 KB
- `POST /api/gta6-track` (no key) → Google News RSS fallback, live headlines returned

## Fixes made (zip as-shipped would NOT run clean)
1. `esbuild ^0.25.0` conflicted with Vite 8 (needs ^0.27/0.28) — bumped to `^0.28.0`, `npm install` now succeeds.
2. Gemini model `gemini-4-hydrogen` does not exist (3 places in server.ts) — changed to `gemini-2.5-flash`.
3. `.env.example` placeholders were literal `<redacted>` strings, which the server treated as real keys — server now rejects `<redacted>` / `MY_*` placeholders; created real `.env` with empty keys.
4. `npm test` failed under plain Node ESM (extensionless import) — test script now uses `tsx --test`.
5. Vite config `__dirname` warning — switched alias to `import.meta.dirname`.
6. Removed 3.1 MB `.aistudio/` temp-media junk from the extract.
7. Added `npm run prod` (build + production server) and renamed package `react-example` → `clippulse`.

## API keys — NOT needed to run; needed only for AI features
| Key | Needed for | Without it |
|---|---|---|
| `GEMINI_API_KEY` | AI hook scoring, GTA 6 search grounding, upload transcription | Local scorer + News RSS fallback work |
| `GROQ_API_KEY` | Fast Llama hook-scoring failover | Gemini/local fallback works |
| `YOUTUBE_API_KEY` | YouTube Data API search | yt-dlp zero-key search works |

All three are free-tier. When Manik gives a key, paste it into `~/workspace/clippulse/.env` and restart (`npm run prod`); never send keys in chat.

## v2 logic upgrade — 2026-11-16 ~00:05 IST (Manik: "logic aro next level korte hobe")
The first real gaming clip exposed three fake signals in v1. All fixed, all verified live.

### What was fake in v1
1. **Window picking used preset (synthetic) transcripts.** `buildSlidingWindows` scored the preset's made-up transcript, so the "top" Apex window (00:25–01:25) was the character-select lobby, not the clutch moment.
2. **gaming-split assumed facecam is always top-left** (`crop=iw*0.26:ih*0.28:0:0`). This stream has no cam there — the box showed overlay graphics.
3. **Audio energy was pseudo-random** for custom sources (`52 + ((i*19)%28)`), and `resolveYtDlpBinary()` missed `~/.local/bin/yt-dlp`, so a server restarted without that PATH silently lost yt-dlp.

### What v2 does (real signals only)
- **`POST /api/smart-analyze`** — downloads the real audio, measures its REAL energy profile, transcribes the FULL video with Groq Whisper (`whisper-large-v3-turbo`, 600s chunks, timestamped segments), then scores sliding windows on real transcript + real audio. Verified on the 58-min Apex video: transcript 44,045 chars; top window 38:10–38:40 (score 79.3, hook 86 — live gameplay reactions, "Look out! Damn it!"), vs v1's lobby window.
- **Real facecam detection** — `scripts/detect_facecam.py` (OpenCV 5 YuNet `face_detection_yunet_2023mar.onnx`, installed via pip). Samples 3 frames, only counts human-scale faces (8–35% of frame width) persistent in the same corner across ≥2 frames. Render uses the detected corner's crop origin; with no facecam it falls back to face-track instead of a bogus split box. Verified: cricket clip → no cam (distant faces too small); Apex lobby clip → no cam (game portraits, not a webcam).
- **Groq Whisper transcription** — Gemini audio transcription is ~3x realtime on this key, so it cannot cover a long video; Whisper is the primary path, Gemini (first 180s) is the fallback.
- **yt-dlp resolution fixed** — `~/.local/bin/yt-dlp` added to candidates.
- **`buildFfmpegCommand` now takes `facecamCropOrigin`** — new test asserts the detected corner (e.g. bottom-right `iw*0.74:ih*0.72`) replaces the top-left default.
- Tests 10/10 pass (was 9/9), lint + build clean. Server restarted with v2 code; `local-capabilities` shows yt-dlp true, Groq + Gemini keys true.

### v2 demo clips
- `demo/real-gaming-clip.mp4` — v1 clip (lobby window, wrong split box) — superseded.
- `demo/real-gaming-clip-v2.mp4` — v2 clip, smart window 38:10–38:40, facecam-aware framing.

## v3 — OpenShorts-style growth, still free + local — 2026-11-16 ~13:25–13:58 IST

Manik's direction (13:25 IST, picked "ClipPulse-kei OpenShorts-er moto boro koro"): grow ClipPulse like OpenShorts — same architecture, same skill, same logic — but it must stay **FREE to run locally and easy to run on this computer**. So v3 adds NO Docker, NO GPU, NO new paid service (no fal.ai / ElevenLabs / Upload-Post / S3, no heavy model downloads). Same single `npm run prod`; only his existing free-tier Groq/Gemini keys, ffmpeg, YuNet and PIL.

OpenShorts analysis that drove v3: `~/workspace/research/openshorts-analysis.md` (repo cloned to `~/workspace/research/openshorts`).

### What v3 adds
- **`POST /api/package-clip`** — OpenShorts-style 2-pass detail pass. Takes the smart-analyze window + real transcript, returns title (≤60 chars, verified number/name/timecode from the transcript, never invented), spoken hook (≤10 words), description + CTA question, hashtags. Groq (`openai/gpt-oss-120b`) first, Gemini fallback, local fallback. Two prompt bugs caught live and fixed: (1) the first run INVERTED winner/loser on messy commentary — prompt now says the winner is the name announced at the END of the transcript, never swap; (2) the second run leaked the internal score into the title ("74.4 Score Highlight") — `totalScore` is no longer sent to the model.
- **`POST /api/thumbnail` + `GET /api/thumbnail/:jobId`** — OpenShorts-style YouTube Studio thumbnail. Picks the frame at the clip's measured audio-energy peak second, then `scripts/make_thumbnail.py` (PIL, DejaVu Bold) lays the packaged title on it: bottom gradient scrim, red subtitle bar, white title with black stroke, max 3 lines, 1280x720.
- **Scene-aware face-track render** — OpenShorts-style per-scene reframing. `detectScenes()` runs ffmpeg `select='gt(scene,0.3)',showinfo` on the section, `mergeSceneBoundaries()` (in `src/lib/virality.ts`, tested) merges sub-2s scenes and caps at 8, `scripts/scene_faces.py` (YuNet, one model load) finds the largest face per scene middle frame, and the render builds a segmented filtergraph — each scene trimmed + cropped around its OWN face, audio trimmed + `apad`-padded per scene, concat, loudnorm inside the graph. Response carries `sceneAware` + `scenes: [{startSec, endSec, faceX, layout}]`.
- **Helpers** — `probeDuration()` (ffprobe), `runProcessCapture()` gained an optional `captureStderr` flag (showinfo writes to stderr — the first v3 render silently fell back because of this).

### Bugs found while verifying v3 (all fixed, all re-verified)
1. **Scene detection read stdout; showinfo writes stderr** → no cuts found → silent fallback. Fixed with `captureStderr`.
2. **Threshold 0.4 too strict** for gameplay: the raw Apex section has no cuts above 0.4; the two real cuts score 0.3–0.35. Lowered to 0.3.
3. **Uploads have no `rawClip`** — the scene block probed a nonexistent file. Fixed: detect on `sourceVideoPath` for uploads, with scene times shifted into input-relative time (upload inputs start at `safeStart`).
4. **Empty filter after `[vc]`** — `visualTransform` starts with a comma; `[vc],eq=...` is "No such filter: ''". Fixed by stripping the leading comma in the concat chain.
5. **`-af` cannot combine with `-filter_complex` on the same stream** — loudnorm must live inside the graph on `[ac]`. Fixed; the later `-af` push is skipped when `sceneAware`.
6. **yt-dlp section downloads sometimes carry truncated audio** (9s audio in a 30s section) — without padding, `-shortest` truncated the output to 19.75s. Fixed with `apad=whole_dur=<scene length>` per audio segment; verified standalone: 29.2s out.
7. **In-memory maps don't survive restarts** — uploads and rendered clips vanish on restart (one thumbnail call failed on a stale jobId). Render/upload again after a restart; nothing persisted to fix.

### v3 verification (all live)
- Tests 11/11 pass, lint + build clean, server running at http://localhost:3000.
- **Scene-aware Apex v3** — `demo/real-gaming-clip-v3.mp4` (29.2s, 19MB): `sceneAware: true`, scenes `[0–9.98s faceX 13.8 track]`, `[9.98–30s faceX 13.7 track]`. Frames verified: the facecam the v2 corner-check missed (streamer in a pink box, middle-left — not a corner) is now tracked through both scenes, with minimap + squad list in frame. Render 52s.
- **Boxing v3** — `demo/real-boxing-clip-v3.mp4` (29.2s, 35MB): sports-blur, Smart Analyze window 03:45–04:15 (score 74.4, audio 89.1). Frames verified: ring exchange → Bazinyan standing after the stoppage.
- **Package** — `demo/boxing-package-v3.json`: title "Erik Bazinyan vs Ronald Ellis: KO at 225s", hook "The fight is hometown, watch this knockout!", description with CTA, 7 hashtags. Winner verified correct.
- **Thumbnail** — `demo/boxing-thumbnail-v3.jpg` (1280x720): peak-second frame (27s, Bazinyan close-up + referee's raised glove) + title + "KNOCKOUT • 03:45". Visually checked.

### Not in v3 (deliberately)
- Publishing/scheduling (needs Upload-Post key or YouTube OAuth + Manik's sign-in), AI voice dubbing (ElevenLabs key), AI UGC actors (fal.ai, paid per video), autopilot, MCP server. All need keys/money or sign-in Manik hasn't given — v3 stays free. Punch-in on audio beats and a persistent job queue are the natural v3.1 next steps.

## v4 — OpusClip Gameplay layout (facecam top 30% + gameplay below 70%) — 2026-11-16 ~14:05–14:09 IST

Manik's correction (14:05 IST): the v3 gaming clip shows the streamer's face but the gameplay is barely visible — "ei type video hole kono din e viral hoyna". He asked whether I had actually seen how OpusClip frames a video when given a YT link. He was right: v3's scene-aware face-track optimised for the FACE and cropped the game away.

### What OpusClip (and Eklipse/StreamClipping) actually do — researched 14:05 IST
- **OpusClip "Gameplay" layout: speaker on top 30%, game below 70%** — it detects the facecam AND the gameplay separately and arranges them top-and-bottom, "instead of making you choose between them" (opus.pro gaming page + 2026 clipping-tool roundups). It never crops to the face alone.
- "The action is not the speaker — a transcript-only clipper misses a clutch play" — ClipAnything analyses frames for objects, scenes, actions, sounds and emotions as well as speech.
- "Keep the action centered and put your facecam or reaction up top. A light zoom on the action zone beats a dumb crop." (streamclipping.ai). "A 9:16 export fails when a scoreboard, crosshair, chat message or facecam covers the decisive action."
- Eklipse's name for the same thing: "Facecam Separation — it intelligently crops out your webcam box and places it cleanly above your gameplay."

### What v4 does
- **`scripts/detect_cambox.py`** (new) — finds the actual facecam BOX anywhere in the frame, not just in a corner. YuNet finds the face, then Canny edges + contours find the rectangular border containing the face centre (2–20% of frame, aspect 0.9–2.2); fallback expands the face rect (box ≈ 2.4x face width, ~4:3, centred on the face). A box only counts if it persists at nearly the same place in >=2 of 3 sampled frames. Calibrated on the Apex stream: detector returned `[0.034, 0.383, 0.172, 0.232]` vs visual-grounding measurement `[0.031, 0.38, 0.178, 0.239]` — within 0.007 on every edge, method "contour", 3s runtime.
- **Gameplay layout in the render route** (`buildGameplayFilter` in `src/lib/virality.ts`, tested) — cam box cropped + scaled to 720x384 (30%), gameplay centre-cropped to the action zone + scaled to 720x896 (70%), `vstack`. The game crop is centred, so the left-side cam box and minimap fall outside it while the crosshair/compass/weapon stay in frame. Falls back to the old corner split, then face-track, when no cam box is found. Response now carries `layout: 'gameplay'` + `camBox`.
- Tests 12/12 pass, lint + build clean, server running v4 at http://localhost:3000.

### v4 verification (live)
- **Apex v4** — `demo/real-gaming-clip-v4.mp4` (29.2s, 28MB), same smart window 38:10–38:40, `layout: 'gameplay'`, camBox `[0.034, 0.383, 0.172, 0.232]`. Frames verified at 3s/12s/27s: top 30% = streamer + "Masianboy" banner, bottom 70% = real gameplay (map movement + compass, dark corridor with crosshair + weapon, road + Loba ability + "Loba: Reloading"). This is the OpusClip layout, not a face crop.
- v3 file kept as `demo/real-gaming-clip-v3.mp4` for comparison (face-only crop — the mistake v4 fixes).

## v5 — 4K output + trending creators (MrBeast, IShowSpeed, Raj Shamani…) — 2026-11-16 ~14:11–14:32 IST

Manik's asks (14:11 IST): higher quality — 4K; and include big creators (MrBeast, IShowSpeed, more) with automatic trend fetching. Then (14:13 IST): add Raj Shamani and other big creators whose clips "guarantee" views.

### 4K
- **`qualityDims()` in `src/lib/virality.ts`** (tested) — '4k' = 2160x3840, zoom 2290x4070, preset ultrafast, CRF 20, audio 192k, source cap 2160. 720p/1080p values unchanged. The yt-dlp download cap follows the quality (`height<=2160` for 4K, `<=1080` otherwise).
- **Honest native-vs-upscale**: the render response now reports `sourceHeight` + `isNative4k`. The Apex source tops out at 720p (verified via `yt-dlp -F`), so its 4K is a high-bitrate upscale — cleaner than 720p on a phone, not native. MrBeast uploads are 4K-native, so their 4K renders are native.
- **The 300s wall (found + fixed)**: 4K renders take 8-12 min here, but the client got an empty reply at exactly 300s — twice. Root cause was NOT Node's default timeout: both long routes had an explicit `res.setTimeout(300000)` (v2-era). Fixed to 30 min on both routes + `server.requestTimeout`/`headersTimeout` 30/31 min. First fix attempt (server-level only) did NOT lift the wall — the per-response setting overrode it.
- **4K is slow on this box**: 1.5 shared CPUs; the Apex 4K encode ran ~10 min (veryfast CRF 18 first attempt) — switched to ultrafast CRF 20 for 4K, still visibly cleaner than 1080p on a phone. A VM restart mid-encode wiped /tmp and killed the first 4K attempt; the render was re-run after.
- Verified: `demo/real-gaming-clip-v4-4k.mp4` — 2160x3840, 29.2s, 139MB, Gameplay layout at 4K (facecam top 30% + gameplay below 70%), frame at 12s checked sharp.

### Trending creators — `GET /api/trending`
- YouTube has no public trending API. The endpoint reads each creator's channel page sorted by popularity (`sort=p`) via yt-dlp flat playlist and **re-sorts by real view count itself** — the page order is NOT view-sorted (verified: MrBeast's page listed 52M before 348M).
- Default 10 creators: MrBeast, IShowSpeed, Kai Cenat, Raj Shamani, Joe Rogan, PewDiePie, Markiplier, Airrack, Dude Perfect, Dream. `?creators=` overrides, `?limit=` caps per creator (default 3). Results cache 1h in memory, auto-refreshed on the next call after expiry.
- **Bug fixed live**: first version fetched only `--playlist-end <limit>` entries, so the real #1 often never appeared (MrBeast's 193M video was missing with limit=2). Now fetches 10 entries per creator, sorts by views, takes top `limit`.
- **Data limits (honest)**: Kai Cenat's view counts don't come through in flat mode (videos still list with titles + durations, views null). IShowSpeed has one recent video with views null for the same reason. No creator "guarantees" views — these are the biggest channels whose clips usually pull views; the moment still has to be right.
- Verified live: MrBeast top 3 = 348M "Eat Everything In A Grocery Store" (58 min), 193M "Lose 150 Lbs" (43 min), 147M "I Survived The Most Extreme Places On Earth" (23 min). Raj Shamani 588K, Joe Rogan 2.1M, Airrack 7.6M, Dude Perfect 4.4M, Dream 14M all live.
- Demo DELIVERED (2026-11-16 ~14:42 IST): trending → MrBeast "I Survived The Most Extreme Places On Earth" (gTKS8SAwUzE, 147M views) → smart-analyze top window 1200–1230 (20:00–20:30), score 85.3 → 4K render (NATIVE 4K: sourceHeight 2160, isNative4k true, sceneAware true, 8 scenes) + package "One Ice Club Surprise in Extreme Survival" (verified against transcript: "Ice clubs... Pedialyte") + thumbnail (peak 12s). Files: demo/mrbeast-clip-v5-4k.mp4 (119MB, 2160x3840, 29.2s), demo/mrbeast-package-v5.json, demo/mrbeast-thumbnail-v5.jpg. Frames verified at 3s/12s/27s: snow + Pedialyte cooler, laughing with bottle, MrBeast in jungle holding bottle. Script: `demo/run-mrbeast-demo.sh`, log `/tmp/mrbeast-demo.log`.

### Not in v5
- Frontend buttons for 4K/trending (API + verified demo only; UI wiring is a follow-up).
- Publishing/scheduling, ElevenLabs dubbing, fal.ai actors — still need keys/money.

## v6 — Simple UI: Fetch Trends → channel cards → 4 clips with subtitles → preview → download — 2026-11-16 ~14:50–15:50 IST

Manik's ask (14:50 IST): make the whole system very simple in the UI — click Fetch Trends, trending channels list with logo + name, pick one, its trending video gets clipped into 3–4 properly edited videos with subtitles, preview by playing them, then download directly.

### What was built
- **Trending logos** (`GET /api/trending`): per creator now returns `logoUrl` (square channel avatar, 900x900 — the wide thumbnails are the banner, not the logo), `channelId`, `followers` (channel_follower_count); per video `thumbnailUrl`. Verified live: Raj Shamani logo + 22.5M followers.
- **New panel `src/components/TrendingClipsPanel.tsx`** (~330 lines): state machine idle → loading → channels → analyzing → ready. [Fetch Trends] + Quality select (720p/1080p/4k, default 1080p) + Framing select (auto/face-track/gaming-split/sports-blur; auto = Dream → gaming-split else face-track; category = Dream → 'gaming' else 'podcast'). Channel grid: logo (rounded-full), name, followers, top-video views. Click a channel → its 3 videos (thumbnail, title, views, duration) each with [Make 4 clips]. Clip cards: `<video controls>` 9:16 preview, "Clip N • MM:SS–MM:SS • Score", hook line, native-4K badge, Download MP4 `<a download>`, Retry on failure. 4K shows an amber warning (~10 min/clip, ~40 min for 4). If `an.hasTranscript === false`, warns moments are audio-energy-only.
- **Wiring**: `WorkspaceTab` += 'trending'; TopBar "Trending Clips" button; App.tsx renders the panel; ExportModal rewritten to the same async pattern.
- **Smart-analyze response extended**: top-level `segments` (full timestamped transcript, so the UI builds karaoke ASS with the shared `generateAssSubtitle`) + per-window `transcriptText` + `suggestedHooks`.

### The three bugs found live during v6 verification (all fixed)
1. **/tmp is a 512MB tmpfs — it filled up.** The render route never cleaned its workDir (60–300MB each); two stale 4K workDirs (166MB + 147MB) filled it → smart-analyze failed with yt-dlp "Conversion failed!" + tee "No space left on device". Fix: `RENDERS_DIR = ~/workspace/clippulse/renders` + `UPLOADS_DIR = ~/workspace/clippulse/uploads` (home disk, 7.5GB); `persistRenderedClip()` — **copyFileSync** (renameSync across devices throws EXDEV) + rmSync workDir; called in BOTH success paths; render catch rmSyncs workDir; eviction deletes just the file. Verified: /tmp drops back to ~2–3% after renders.
2. **The 300s wall, part 2 — undici fetch kills requests at 300s with no headers.** The v5 `res.setTimeout(300000 → 30min)` fix was NOT enough: a client fetch (Node undici, and browsers/tunnels similarly) dies at ~5 min with HeadersTimeoutError while the server keeps rendering fine. Fix: **async jobs** — long routes answer IMMEDIATELY with a jobId; clients poll `GET /api/job-status/:jobId` (8s panel / 5s ExportModal, 30-min cap). Added `asyncJobs` Map + `finishAsyncJob(jobId, result)` + status endpoint (404 `{error:'Job not found or expired.'}`). Render route: validation stays synchronous (missing ffmpeg/yt-dlp, eviction); the 4 downstream res.json sites became finishAsyncJob. Smart-analyze: same pattern after jobId creation. The 30-min res.setTimeout stays as a backstop.
3. **Whisper fragility — one bad chunk killed the whole transcript.** `transcribeWithGroqWhisper` threw on the FIRST failed chunk → transcript = fallback single line → segments: 1 → only window 0–30, score 40.4. Fix: per-chunk retry (3 attempts, 5s/15s backoff, FormData rebuilt per attempt), skip a persistently-failing chunk with console.error and continue. Diagnosis: a direct Groq Whisper test (60s boxing audio) returned HTTP 200 with a real transcript — Groq works; the failure was a transient chunk blip.
4. **Subtitle timestamp leak (found by frame-checking, 15:36 IST).** Subtitles showed "[100:06]" / "[101:07]" mid-sentence. Root cause: `formatMmSs` emits 3-digit minutes for long videos (`[100:06]`), but the transcript parser regex in `parseCustomTranscriptToSource` only allowed `\d{1,2}` minutes — lines past 100:00 never matched, so the whole `[100:06] text` line became segment text. Fix: parser regex `\d{1,2}` → `\d{1,3}`; `extractWordsFromSegments` strips bracketed timestamps from tokens (both text path and pre-built-words path) as defense in depth. Tests: parser test with `[100:06]` lines + extractWords test — 15/15 pass.
5. **Only 3 clips instead of 4.** `sorted.slice(0, 6)` gave the greedy dedup too few distinct moments (top scores cluster around one moment). Fix: slice(0, 12). Verified: 4 distinct windows picked (see below).

### v6 verification (live, Raj Shamani — "Ex Navy SEAL Who Killed Osama Bin Laden" sRH-XlBE2cQ, 8.2M views, 109 min)
- **verify4** (old code, before fixes 4–5): analyze ok, segments 627, picked 3 windows 815–845 (84.4), 1195–1225 (78.3), 1310–1340 (78.1); all 3 rendered OK (720p, face-track, sceneAware). Frames: real podcast footage, O'Neill close-ups, F-16 B-roll, karaoke subtitles visible — but clips 2–3 carried the `[100:06]`/`[101:07]` subtitle leak.
- **verify5** (fixed code): analyze ok, segments 393, **windows returned: 12, PICKED_COUNT: 4** — 815–845 (84.4), 90–120 (73.0), 190–220 (69.2), 1175–1205 (69.2). **Timestamp tokens in transcriptText: 0, in ASS: 0.** Top clip re-rendered OK (jobId f2281590, face-track, 2 scenes).
- **Remaining 3 windows** rendered with the fixed ASS (script `render-remaining-v6.ts`, log /tmp/render-remaining.log) — 4 clean clips total in `renders/`.
- Tests 15/15, lint + build clean. Server running v6 code at http://localhost:3000.

### Tunnel — BLOCKED by the egress proxy (unresolved, 2026-11-16)
Manik is on his phone and needs a public URL. All attempts failed: localtunnel (named + random subdomain — client runs but prints NOTHING, opens NO sockets, subdomain 503s; the raw-TCP data connection is blocked by `https_proxy=http://hatch-runtime:...@hatch-egress-proxy:3128`), serveo (SSH connection reset by proxy), cloudflared quick tunnel (403 provisioning). NOTE: a loca.lt tunnel DID work from this VM on 2026-11-15 — retry later. **Lesson: never `pkill -f` with a pattern that appears in your own exec command line** (killed my own shell twice: "lt --port" and "verify-trending-ui") — kill by PID numbers from `ps`/`ss` only. Deliver honestly: UI is ready on the server; the public link is blocked by this computer's network right now. On Manik's own PC the same `npm run prod` opens the UI on localhost:3000 with no tunnel needed.

### Not in v6
- Publishing/scheduling, ElevenLabs dubbing, fal.ai actors — still need keys/money.
- The verify4 clips 2–3 (jobIds 5f8447b6, 42b94384) carry the old subtitle leak — superseded by the clean re-renders; do not deliver those two files.

## v7 — Pro edit: smooth face tracking, SFX, voice polish, hook punch, PySceneDetect — 2026-11-16 ~16:05–16:25 IST

Manik's ask (16:04 IST, with a screenshot of a "GTA 6 SOON..." post listing WhisperX / PySceneDetect / Auto-Editor / Remotion / FFmpeg): face tracking must be smoother, clip-2-style editing (sound effects, voice somewhat modified), hooks in Shorts, proper smooth face tracking, smooth transitions, Hormozi word-by-word subtitles — and use the image's tools to improve ClipPulse so the output looks highly professional. He said the video would then "100% viral hobei hobe" — told honestly: no tool can guarantee virality; the stack raises pro quality (retention is what the algorithm rewards), the moment + hook + topic still decide.

### Tool verdicts (researched by a subagent, verified live on this VM)
| Tool | Verdict | Why |
|---|---|---|
| **PySceneDetect** | ADOPT NOW | 159KB, 2.1s/30s clip measured, drop-in for the ffmpeg scene hack; AdaptiveDetector matches ffmpeg's cuts on podcast footage and catches cuts content mode misses. |
| **FFmpeg SFX + voice polish** | ADOPT NOW | Zero new deps; whoosh + voice chains verified live (~0.5s per clip). This is the "clip 2 style" edit. |
| **faster-whisper (word timestamps only)** | ADOPT LATER | Real word timing for karaoke, no torch (ctranslate2 43MB + tiny model 75MB); RAM is tight (~385MB free), so run as a separate short-lived process, never alongside a render. |
| **Auto-Editor** | ADOPT LATER | Silence-cutting is the right hook/pacing fix, but prefer zero-dependency ffmpeg `silenceremove` in the existing graph over a 41MB binary + extra re-encode. |
| **WhisperX (full, torch + diarization)** | SKIP | Needs ~2GB RAM + GPU; diarization needs an HF token + gated model licence. This VM cannot run it. |
| **Remotion** | SKIP | Real transitions/captions power, but needs headless Chrome (~1GB RAM) + a full render-pipeline rewrite; ffmpeg xfade + ASS covers the same ground here. |

RAM is the binding constraint on this VM (~385MB free at research time), not disk (87GB free).

### What was built
- **PySceneDetect** (`scripts/detect_scenes.py`, scenedetect 0.7.3 installed in user site-packages): `detectScenes()` in server.ts now calls it (AdaptiveDetector) first and falls back to the ffmpeg `select='gt(scene,0.3)'` path on any failure. Same `mergeSceneBoundaries(2, 8)` merge step applies to both. Verified: Raj clip cut at 6.92s (ffmpeg said 6.96s — same cut); gaming clip adaptive: cut at 9.7s in 5.2s total.
- **Smooth face tracking** (`buildFaceTrackCropX` in virality.ts): each scene's crop now GLIDES from the previous scene's face centre to the new one over 0.3s (segment-local `t`, reset by trim+setpts) instead of jumping instantly at the cut. First scene: static centre. This is the match-cut feel — the face stays in nearly the same screen position across the cut (Manik's own 8 Nov note: the reference's cuts feel smooth because consecutive frames are near-identical). Ease calibrated live: 0.6s left the face half out of frame at a big camera cut; 0.3s settles by ~0.35s.
- **Hook punch-in** (`buildHookPunchScale`): scene 0 starts 5% tighter and releases to the normal zoom over 1.2s. Copyright-safe path only (the plain scale path has no second crop to pin the output size). **Gotcha found live**: scale evaluates w/h once at init by default — per-frame `t` needs `:eval=frame` ("Expressions with frame variables 'n', 't', 'pos' are not valid in init eval_mode" killed the first v7 render, ffmpeg exit 234). Verified with a standalone ffmpeg repro before re-rendering.
- **SFX** (`ensureSfxAssets()` + scene-aware audio graph): whoosh.wav synthesised free with ffmpeg (pink noise + rising chirp, 1.2s, max -20.7 dB, stereo) into `assets/sfx/`, cached; mixed at the hook (t=0) + every scene cut via `adelay` + `amix` (~15–20 dB under the voice, `volume=0.5`). Render reports `sfxUsed`. If the asset is missing, the render proceeds without SFX. SFX input is input 1 — safe because the scene-aware branch only runs when audio exists (no anullsrc occupying slot 1).
- **Voice polish** (`VOICE_POLISH_FILTER`): `highpass=f=80,equalizer=f=3000:width_type=o:width=2:g=3,compand=...,deesser,loudnorm=I=-14:TP=-1.5:LRA=11` — rumble cut, presence lift, gentle compression, de-ess, loudness normalise to YouTube's -14 LUFS norm. Applies to EVERY render path now (scene-aware, single-filter `-af`, sports-blur + gaming-split audio legs); the pitch trick (`asetrate`/`atempo`) stays copyright-safe-only. Calibrated live: I=-16 measured ~2 dB quieter than v6 on the same window, so -14 (the old chain's target) keeps the voice as loud as before.
- **Subtitles unchanged**: Hormozi word-by-word karaoke (yellow current word, white rest, bold, black outline) was already in v6; the real upgrade (true word timings via faster-whisper on the 30s clip only) is v7b, not yet built.

### v7 verification (live, Raj 815–845, same window as v6 clip 1)
- **Render 1 (jobId ab1307f5) FAILED** — ffmpeg 234, scale `eval=frame` missing (see gotcha above). Fixed, standalone repro passed.
- **Render 2 (jobId f866940a) OK** — sceneAware true, scenes [0–6.92, faceX 74.5], [6.92–30.07, 56.3], sfxUsed true. Frames: 0.3s tighter than 1.5s (punch visible); 6.5s pre-cut vs 7.0s mid-glide vs 7.6s settled — the 0.6s ease left the face half-out at 7.0s, so ease shortened to 0.3s. Loudness: -16.24 LUFS (I=-16) — 2.6 dB quieter than v6, so loudnorm retargeted to -14.
- **Render 3 (jobId 497e9574) OK, final code** — 7.0s mid-glide, **7.3s face fully centred** (ease done at ~7.22s). Loudness **-14.36 LUFS, TP -1.40 dBTP** — on target. 18.7MB, 720x1280, 29.2s. Tests 18/18, lint + build clean. Server running v7 code at http://localhost:3000.
- Whoosh audibility: construction-verified (asset exists, sfxUsed:true, graph valid, asset max -20.7 dB). An HF-energy comparison vs v6 was inconclusive (deesser + the -16 target confounded it) — Manik judges by watching; the whoosh sits under the voice by design.
- **Subtitled v7 clip**: fresh smart-analyze (segments 1617, windows 12, picked 4: 1440–1470 (88.4), 815–845 (84.4), 1505–1535 (81.4), 4145–4175 (77.0); timestamp tokens 0) + render of the top window 1440–1470 (jobId 857718d3, sceneAware, scenes [0–14.85, faceX 57.1], [14.85–30.07, 27.5], sfxUsed true). Frame-checked: karaoke subtitles clean at 3s ("okay, there are six", current word yellow) and 15.2s post-cut (Raj centred, "guns. I'll figure it"). Delivered as `demo/raj-clip-1-v7.mp4` (15.4MB, 720x1280, 29.2s). Note: a VM restart mid-way killed the first attempt (analyze job b2b2990b died with the server, /tmp wiped) — server restarted, re-ran clean; renders/ + code + docs all survived on the home disk.

### Not in v7
- faster-whisper true word timings (v7b), Auto-Editor/silenceremove silence cuts (v7b), Remotion/WhisperX (skipped — see verdicts). No dissolve/xfade: pro Shorts use match cuts, not dissolves; the eased crop + accurate cuts + whoosh is the smooth-transition mechanism.

## v7.1 — Hormozi subtitles (Anton, ALL CAPS, word pop) + transcript overlap fix — 2026-11-16 ~16:37–16:55 IST

Manik's ask (16:36 IST): the subtitle is not Alex Hormozi style — make the subtitles bold and word-by-word POP.

### What was wrong
The old karaoke subs only changed colour (white → yellow) and never moved. Worse, the font was never what the code said: `generateAssSubtitle` asked for "Plus Jakarta Sans", which is NOT installed on this VM — libass silently fell back to DejaVu Sans. That is why the subs never looked Hormozi.

### What changed (`generateAssSubtitle`, karaoke style only)
- **Anton** (condensed extra-bold, OFL free, downloaded to `~/.fonts/Anton-Regular.ttf`, 170KB, verified with `fc-list` + fontTools) — 72pt, pure-black 5px outline, no soft shadow. Yellow current word (`&H0000D7FF`), white rest, bold.
- **ALL CAPS** words in karaoke mode.
- **Word pop**: every word gets `\t` transforms — 118% scale in its first ~90ms, settling back to 100% (`\fscx118\fscy118` → `\fscx100\fscy100`), times in ms relative to the event. 121 pop transforms in the verified ASS.

### Bug found live in the first Hormozi render (fixed before delivery)
The first render's ASS had **two subtitle lines at once at clip start** ("TURN. BE RIGHT. OFF." + "WHEN THEY WOULD SAY," both at clip 0.00s). Root cause: Whisper returns many short segments 0.2–1s apart, but `parseCustomTranscriptToSource` GUESSED each segment's duration (min 4s), so every segment overlapped the next 1–2 and their even-spread words interleaved. Fix: (1) parser now merges same-start duplicate segments and clamps each segment's end to the next segment's start, re-spreading its words; (2) `generateAssSubtitle` sorts words and drops any word overlapping the previous kept word (defense in depth). Tests 21/21 (2 new: parser clamp, ASS no-overlap).

### Verification (Raj 85–115, score 73.0 — top window varies run to run as the transcript varies)
- Re-render jobId 888a7a84, sceneAware, 3 scenes, sfxUsed true. ASS: Anton true, 121 pops, events sequential (0.06–1.21, 1.21–2.07, 2.07–2.93 — no overlaps). Words sequential: LEADER 0.06, OF 0.38, AL-QAEDA. 0.69, WHY 1.00.
- Frames: 0.11s — "LEADER OF AL-QAEDA. WHY", LEADER mid-pop, first letter yellow (karaoke sweep); 1.06s — WHY yellow + popping, rest white, ONE clean line. Delivered as `demo/raj-clip-hormozi-v7.mp4` (16.8MB, 720x1280, 29.2s).
- The karaoke fill is still a left-to-right sweep (`\kf`), not Hormozi's instant whole-word flip (`\k`) — at ~300ms/word it reads as a flip in motion; switch to `\k` only if Manik asks.

## v7.2 — Simple tool: Trending Clips is the landing + paste-a-link (2026-11-16 ~17:10 IST)

Manik asked for a simple tool: trending longs fetched automatically, OR paste a link, → 4 pro clips. The backend already did this; the change is the front door.

### What changed
- **Default landing = Trending Clips** (`App.tsx`: `useState<WorkspaceTab>('trending')`). Opening the app shows Fetch Trends + the link box first; Workbench/Blueprint are still one click away in the tab bar.
- **Paste-a-link card** in `TrendingClipsPanel`: input + "Make 4 clips" (Enter also submits). Any YouTube link goes through the exact same analyse → 4-clip flow as a trending video.
- **`extractYoutubeVideoId`** (`src/lib/virality.ts`, tested): watch `?v=`, youtu.be/, /shorts/, /live/, /embed/, or a bare 11-char id. Guards: only real youtube.comyoutu.be hosts (a `?v=` on another domain is rejected), and a negative lookahead `(?![A-Za-z0-9_-])` so a 12+-char id is rejected instead of truncated to its first 11 chars. (First test run caught both: `toolong-id-123` matched its first 11 chars; example.com `?v=` matched.)
- Pasted video runs as a synthetic channel (`handle: 'custom'` → podcast category → face-track framing) with thumbnail `https://i.ytimg.com/vi/{id}/hqdefault.jpg`. `customChannel` state keeps Retry working; `fetchTrends` and picking a trending channel clear it.

### Verification
- Tests 22/22 (1 new: URL parsing), lint + build clean. Server restarted, `/api/health` OK, root 200.
- Tunnel retry 2026-11-16 ~17:12 IST: localtunnel ran 100s, log stayed empty, no URL — egress proxy still blocks it; process killed (node PID 11179). No public link; PC path (`npm run prod` → localhost:3000) unchanged.

### Superseded by the 17:14 IST rejection
Manik said the clips look basic — no strong editing, no sound effect, no sign of best-moment finding. Audit of `demo/raj-clip-hormozi-v7.mp4` (frames + 0.25s RMS audio profile) confirmed it: the whoosh is completely inaudible (flat voice −14 to −21 dB, no burst at hook or cut) and the crop barely moves. `sfxUsed:true` proves the graph included the whoosh, NOT that it can be heard — verify SFX by measuring the final mix from now on. Rebuild waits on a reference clip picked by Manik (3 verified candidates sent 17:45 IST: Raj Shamani Clips rPcF1x8eOw0, Hormozi XvCcbm9kxuY, DOAC Ya4HidLomvI). Do NOT rebuild on guessed taste.

## v8 — DOAC spec sample (2026-11-16, reference picked by Manik)

Manik picked **Diary of a CEO** as the reference ("mota muti" — solid, not enthusiastic; the sample must prove it). The two-variant forced choice was cancelled. Reference Short downloaded and MEASURED end to end (not guessed): https://www.youtube.com/shorts/Ya4HidLomvI — "A Soviet Grocery Store Had Only 77 Items", Sarah Paine, 54s, 1080x1920 30fps, 4,206 views.

### The measured spec (one line per element)
- **Format:** 9:16, 720x1280, 30fps.
- **Framing:** 16:9 source centre-cropped to 4:5 (720x900 at 720p) in the middle of the 9:16 frame; top (~220px) and bottom (~160px) bars are the same frame scaled up and heavily blurred. NO face tracking, NO zoom/push-in inside a shot — framing is static within each shot.
- **Cuts:** 7 hard cuts in 54s (PySceneDetect: 8.93, 19.30, 20.93, 27.13, 38.90, 47.10, 53.43; scenes 8.9 / 10.4 / 1.6 / 6.2 / 11.8 / 8.2 / 6.3s; avg ~7.7s between cuts). All cuts come from the source's own cameras (incl. a listener reaction shot of Steven at 19.3–20.9s). No transitions, no effects at cuts.
- **Hook:** big yellow title from t=0 for ~2.8s — "A SOVIET GROCERY STORE HAD ONLY 77 ITEMS", 2 lines, bold extra-bold caps, yellow with black outline, NO box, top-centre on the top blur bar. States the payoff (verified number 77) before the story starts.
- **Captions:** word-by-word karaoke, ALL CAPS, bold extra-bold (wide, NOT condensed Anton), current word yellow, rest white, black outline, centred, 1 line (up to ~4 words), positioned BELOW the picture on the bottom blur bar. NO scale pop (highlight only). NO progress bar.
- **Voice:** clean natural voice, 147 wpm (132 timed words / 53.9s), long natural pauses kept (28 pauses >0.6s, up to 1.6s). No pitch change.
- **Music:** NONE — 0.25s RMS gaps fall to digital silence (-60 to -180 dB). No bed at all.
- **SFX:** NONE — no bursts anywhere (max bin -11.8 dB is just loud speech). No whoosh at cuts, no hits.
- **B-roll/graphics:** NONE — interview only, no photos, no inserts, no lower-thirds.
- **Closing/CTA:** NONE — ends mid-sentence, no end card, no subscribe text.
- **Irony worth remembering:** Manik rejected the v7.1 clip for "no SFX" — the reference he picked has NO SFX and NO music. What reads as "pro" here is framing + hook title + caption placement, not effects.

### Implementation (`editStyle: 'doac'`, production path untouched)
- `buildDoacBlurFill(targetW, targetH)` (virality.ts): `[0:v]scale+boxblur[bg];[0:v]crop=ih*4/5:ih:centre,scale=W:fgH[fg];[bg][fg]overlay` — fgH = targetW*5/4 (900 at 720p).
- `generateDoacSubtitle(segments, start, end)` (virality.ts): Archivo Black (OFL, ~/.fonts/ArchivoBlack-Regular.ttf, 91KB, verified via fc-list + fontTools), 80pt, MarginV 160 (PlayRes 1920), yellow current word / white rest, plain `\kf` highlight (no `\t` pop), no progress bar, no hook banner.
- `buildHookTitleDrawtext` now takes opts `{ fontfile, boxed, fontcolor }` (defaults = old Anton + box + white); DOAC uses Archivo Black, no box, `0xFFD800`, 2.8s.
- `generateAssSubtitle` gained a `popScale` param (default 118; 130 for the punchy variant — the cancelled build's helpers `pickPunchTimes`, `buildZoomPunchScale`, `buildPushInScale`, `buildHookTitleDrawtext` stay in the lib, tested, unrouted; 'punchy'/'fullframe' are NOT wired to the render route).
- Render route (server.ts): `editStyle === 'doac'` takes a dedicated branch — blur-fill video chain + drawtext title + DOAC ASS, audio = `VOICE_POLISH_FILTER` with NO pitch trick and NO SFX input; no scene detection, no face track. `usedScenes` hoisted to outer scope so the `-af` guard (`hasAudioStream && !sceneAware && !usedScenes`) skips the doac branch (its audio is already polished inside filter_complex). Result reports `editStyle`.
- Tests 30/30 (8 new v8 tests), lint + build clean. Server restarted with the new code.

### Sample — VERIFIED (2026-11-16, ~18:50 IST)
- `demo/raj-clip-doac-spec.mp4` — Raj sRH-XlBE2cQ, **window 800–830s, score 84.1**, 720p, 30.0s, 14.8MB, `editStyle: 'doac'`, `sfxUsed: false`, scenes `[{0–30, doac-blurfill}]`, render job 5a9aebcb.
- **DEVIATION — window is NOT 85–115s:** this run's smart-analyze returned 12 windows and NONE was near 85–115 (nearest start was 800; the other windows were 805–845, 1440–1470, 5145–5295). Per the brief, the closest window was used. It is still the same Osama/SEAL Team 6 story ("of SEAL Team 6 would come… the super secret mission"). Whisper segment counts vary run to run, so window lists vary too.
- **DEVIATION — hook title is NOT suggestedHooks[0]:** the window's suggested hook [0] is the mid-sentence fragment "of SEAL Team 6 would come" — garbled as a title. The sample uses the window's own verbatim curiosity line instead: **"THE SUPER SECRET MISSION"** (from the window transcript: "hey, the super secret mission, man, what is it?"). Finding for the analyzer: suggestedHooks[0] can be a fragment; hook quality needs a fix (prefer a complete clause).
- **Verification (one pass, frames + measured audio):**
  - Layout MEASURED (not eyeballed): fg sharp content spans y190–1090, top blur bar y0–190 (sharpness ~0), bottom blur bar y1090–1280; caption yellow at y1133–1160 — on the bottom blur bar, below the picture, exactly per spec. One clean caption line, no overlaps, no text over faces.
  - Audio 0.25s RMS: voice −14 to −21 dB, natural silence gaps (−74.5 dB at 9.5s, −59.8 dB at 24.75s), max −14.1 dB at 22.0s (loud speech) — NO bursts, NO music bed, matching the reference (which has no SFX/music either).
  - Wide two-shots (Raj + O'Neill) have both faces half-cut at the frame edges — inherent to the spec's 4:5 centre crop on a wide two-shot; the reference's shots are single-speaker close-ups, so it never shows this. Noted, not a bug.
- **v8.1 fix found during verification — title overflow (fixed + re-rendered, tests 32/32):** the first render's title "OF SEAL TEAM 6 WOULD COME" was a single drawtext line: measured 1089px wide at 63px on a 720px frame, yellow pixels spanned cols 0–719 — frame showed "EAL TEAM 6 WOULD C", clipped both sides. `buildHookTitleDrawtext` is now width-aware: measured per-char advance tables for Archivo Black (avg 0.753 em/char) + Anton (0.465) from fontTools, `measureTitleWidthEm` + `bestTwoLineSplit`; one line when it fits (unchanged output), else the best two-line split with the font shrunk until the wider line fits targetW−60px (the reference title itself renders as two 43px lines). Re-rendered title measured: line 1 "THE SUPER" cols 160–557 (398px), line 2 "SECRET MISSION" cols 60–656 (597px), rows 19–134 — inside the top bar with margins, viewed and confirmed.
- **v8.1 fix — yt-dlp 503 (fixed, tests unaffected):** the first verify run burned its whole 30-min poll on 404s because the smart-analyze POST had answered 503 "yt-dlp is not available" — `resolveYtDlpBinary` probed with a 2000ms spawnSync timeout, but yt-dlp is a Python entry point (~1.0–1.4s cold start) and this box shares 1.5 CPUs with concurrent work, so the probe timed out under load. Fix: cache the resolved path (module-level, it never changes per server) + 10s probe timeout. Verify scripts now fail fast on a POST without `ok`/`jobId` instead of polling a dead job.
- Server live with the v8.1 code; tests 32/32, lint + build clean. DOAC standard locks ONLY on Manik's approval of this sample — do not batch-produce from it before that.

## v8.2 — DOAC two-shot fix: per-shot picture aspect (2026-11-16)

The v8 sample's wide two-shots (Raj + O'Neill, ~4–18s) showed BOTH faces half-cut at the frame edges — the spec's 4:5 centre crop on a wide two-shot. The reference never shows this (its shots are single-speaker close-ups), so the first sample's "noted, not a bug" line was wrong: a sample must not ship half faces. Fixed and re-rendered.

### Mechanism (measured on the real source first)
- New `scripts/scene_faces_multi.py`: YuNet, all human-scale faces per mid-frame as `[centreX_pct, width_pct]` (score 0.9, width 3–60%). On the downloaded 800–830 section it found exactly the right thing: scene 0 single face [53.6, 13.4]; scene 1 two faces [26.2, 11.1] + [77.2, 11.1]; scene 2 single [55.6, 11.1]. Detection on the RENDERED clip finds nothing in two-shots (half faces are undetectable) — always detect on the source section.
- New pure helpers (`src/lib/virality.ts`, tested): `decideDoacShotLayout(faces, sourceAspect)` — the 4:5 crop covers (4/5)/aspect of the width (0.45 for 16:9); any face box outside that centred window (2-pt margin) → `'letterbox169'`, else `'crop45'`; no faces / bad aspect → crop45 fallback. `doacFgHeight` (900 vs 405 at 720p) + `buildDoacSceneChain` (per-scene trim → split → blurred bg + fg picture → centred overlay).
- Render route (server.ts, `editStyle === 'doac'` only): PySceneDetect scenes → mid-frame per scene → `detectSceneFacesMulti` → per-scene layout → per-scene video chains + apad audio chains → concat → voice polish (no pitch trick) → transform/title/ASS after concat (post-filter list built without a leading comma — a comma right after `[vc]` is an empty filter and ffmpeg rejects it). Falls back to the whole-clip 4:5 path when there is no audio, scene detection fails, or anything throws. `sceneInfo` now reports `doac-crop45` / `doac-letterbox` per scene.

### Verification (re-rendered window 800–830, score 84.1, hook "of SEAL Team 6 would come", 720p)
- Render result scenes: [0–4.51 crop45, faceX 54.1], [4.51–21.94 letterbox, faceX 26.2], [21.94–30.03 crop45, faceX 54.7]; `sfxUsed: false`, `editStyle: doac`. File overwritten: `demo/raj-clip-doac-spec.mp4`, 15,921,505 bytes.
- Frames viewed at 0/5/10/15/20/25s: 0s single 4:5 close-up, full face, title "OF SEAL TEAM / 6 WOULD COME" top; 5/10/15s two-shot letterbox — BOTH faces whole (Raj left, O'Neill right, laptop between), 16:9 picture centred between blur bars; 20/25s single 4:5 close-ups, full faces. One caption line everywhere, no overlaps, no text over faces, title gone after 2.8s. (The vertical seam in the two-shot is the source's own two-camera stitch.)
- Audio 0.25s RMS: voice −14 to −21 dB, natural silence gaps (−70.3 dB at 9.5s, −58.9 dB at 24.75s), max −14.5 dB — NO bursts, NO music, matching the DOAC spec.
- Tests 34/34 (2 new v8.2), lint + build clean. Server restarted with the v8.2 code and live.
- Render took ~6.5 min (vs ~3 min): a Whop-clipping ffmpeg from another chat was eating 91.7% CPU concurrently (load 10.16) — contention, not the filter. Renders stay sequential.
- A service restart mid-task killed the server + the first verify run and wiped /tmp (verify-doac + fix-doac dirs gone); server restarted, dirs recreated, RMS script rewritten, verify re-run clean. /tmp is tmpfs — never trust it across restarts.
- **Title fix (re-rendered same evening, no code change):** the v8.2 re-render passed `hookTitle: suggestedHooks[0]` = "of SEAL Team 6 would come" — a mid-sentence fragment, confirmed on frame 0s. The v8.1 script had the right value hardcoded. Fix: same window 800–830, 720p, editStyle 'doac', with `hookTitle: 'THE SUPER SECRET MISSION'` (the window's verbatim curiosity line). The render API already accepts `hookTitle` (server.ts) — no new parameter was needed. Found en route: the full smart-analyze had lost the 800–830 transcript (Groq Whisper 429 on chunk 1, 600s), so the main re-render script was killed before it could render caption-less; the fallback transcribed ONLY the 800–830 section directly via Groq (15 segments, first "parts of SEAL Team 6 would come."), 429 on attempts 1–4, success on attempt 5 after backoff; the abandoned server-side analyze job was stopped with a server restart so it stopped burning Groq quota. Verification: frame 0s + 2.0s read "THE SUPER / SECRET MISSION" (two lines, inside the top bar), gone at 3.0s; two-shot faces whole at 5/10/15s, singles full-face at 0/20/25s, one caption line everywhere; RMS voice-only, max −14.5 dB, 4 silence gaps, no bursts. File overwritten: `demo/raj-clip-doac-spec.mp4`, 15,883,962 bytes. Tests 34/34, lint + build clean. Note: faster-whisper installed via pip --user (the v7b path, local, no quota) — not used for this render, available as a transcription fallback.
- **DOAC STANDARD LOCKED (Manik, 2026-11-16 ~21:15 IST):** he said "valo legeche" — the DOAC-spec sample is APPROVED as the ClipPulse production standard for clips (4:5 crop + blur-fill bars, yellow hook title 2.8s, captions below the picture, clean voice, no SFX/music). `editStyle: 'doac'` is the standard for the normal 4-clip flow going forward.

## v8.3 — Security hardening before the public GitHub push (2026-11-16)

Manik ordered a full tool + security audit first, then a public repo push to his GitHub (Manik51) at "repo of the day" quality.

### Audit findings
- **Secret scan: CLEAN.** No API keys, tokens or private keys anywhere in the tree (full regex scan incl. PRODUCTION-READY.md). `.env` (chmod 600) is gitignored (`.env*` with `!.env.example`); `.env.example` holds only `MY_*` placeholders (verified: values differ from the real `.env`, start with `"MY_`, not AIza/gsk_ format). No token/secret files in the tree.
- **Process spawning: SAFE.** All child processes use `spawn`/`spawnSync` with arg arrays — no shell, no string interpolation into a command line. Uploads never use the client-supplied filename (`originalname` absent from server.ts) — no path-traversal vector there.
- **FOUND + FIXED — yt-dlp flag injection (real):** `/api/smart-analyze` and `/api/render-local-mp4` passed the raw user-supplied `youtubeUrl` as a bare positional arg to yt-dlp. A value starting with `--` (e.g. `--exec=touch /tmp/pwned`) would be parsed by yt-dlp as its own flag — `--exec` runs commands. Fix (server.ts): `isValidYoutubeVideoUrl()` reusing the tested `extractYoutubeVideoId` (real YouTube host + valid 11-char id only), enforced at both routes (400 / `invalid_youtube_url`), PLUS `'--'` before the URL at all three yt-dlp call sites (`getYoutubeMeta`, smart-analyze download, render download) as defence in depth. Live-verified after restart: `--exec=...` and a non-YouTube URL both rejected (400 / invalid_youtube_url), no file created; `yt-dlp ... -- <real URL>` still fetches metadata fine. Tests 34/34, lint + build clean, server live with the fix.
- **Known exposure (documented, not fixed):** the server binds `0.0.0.0:3000` with no auth — it is a LOCAL tool. README carries a security note: run on your own machine, never expose it publicly.

### Repo prep done in this pass
- `package.json`: v1.0.0, description, MIT license, repository `github.com/Manik51/clippulse`, author Manik Shil, keywords; `"private": true` removed.
- `.gitignore`: added `renders/`, `uploads/`, `demo/`, `verify-*/`, `.aistudio/` (binaries + intermediates never enter git).
- `LICENSE`: MIT, Manik Shil 2026.
- `scripts/setup-local.sh`: now downloads the YuNet face model (`face_detection_yunet_2023mar.onnx`, 232KB) from the official OpenCV model zoo when missing (URL verified 302 → live), so the repo needs no binary model file.
- Push plan: GitHub MCP is connected as Manik51. `push_files` is UTF-8-text only (max 16 MiB / 2,000 files, no binaries) — the text snapshot (code + README + SVG logo + docs) goes via the MCP; binaries (logo PNG, sample mp4, GIFs) go via the GitHub web upload afterwards (Manik signs in himself per his sign-in rule). Repo dressing (logo, README, GIFs, examples/) delegated to a subagent; push only after its output is reviewed file by file.

## v8.4 — Seven caption styles + showcase + four render bugs fixed (2026-11-16)

Manik ordered 5–7 more showcase videos, each with a different subtitle design, plus screenshots of the tool and visuals of how to use it — and then, in the same chat, that every clip also exist as an auto-playing looping GIF so a repo visitor sees the motion without pressing play. (A background memory note briefly misread his 21:43 IST "baad dao" in the main chat as cancelling the GIFs — the main-chat transcript proves it was about BUYING SUBSCRIBERS: he asked if bought subs would monetize, was told no, and said drop that idea. The GIF order stands.)

### Seven caption styles (`CAPTION_STYLE_PRESETS`, virality.ts)
- `doac` — the locked production standard (separate `generateDoacSubtitle`).
- `karaoke` — Hormozi (Anton 72pt, yellow, pop 118). `lime` — same but lime `#C6F135` highlight, pop 130.
- `minimal` — Montserrat ExtraBold 54pt, small white, no pop. (Fixed a real defect: the old preset named DM Sans, which was never installed — libass silently rendered it in DejaVu Sans. `bold` still names Plus Jakarta Sans, also never installed; left as-is for backward compatibility.)
- `sentence` — Noto Sans 46pt, one full sentence at a time on a semi-transparent black box (BorderStyle 3).
- `top` — Anton 72pt yellow karaoke pinned to the top of the frame.
- `flash` — Bebas Neue 120pt, one huge word at a time, centre frame, pop 125.
- Fonts: Anton + Archivo Black + Bebas Neue + Montserrat ExtraBold are OFL free; `scripts/setup-local.sh` now downloads all four into `~/.fonts` when missing (URLs verified live). The workbench UI picker (`ReelPreviewPanel.tsx`) offers all seven styles and its in-page preview mirrors each one's colours/position.
- Tests 35/35 (1 new v8.3 style test), lint + build clean.

### Showcase (local only until the push)
- `examples/styles/<style>/` — 7 clips, 720p ~30s each, every one verified by viewing frames at 0/5/15/25s + a 0.25s RMS audio profile (voice present, 0 bursts): doac (Raj 800–830s, reused approved sample), karaoke (Raj 85–115s, reused Hormozi v7), minimal (Boxing 225–255s), lime (Apex 2290–2320s), sentence (MrBeast 1200–1230s), top (Raj 1440–1470s), flash (Raj 85–115s — same moment as karaoke, so the style difference is easy to compare). Each folder holds `clip.mp4` + `clip.gif` (480px, 10 fps, 6–7s looping excerpt from the start) + `thumb.jpg` (frame ~5s).
- `assets/screenshots/` — real UI shots: `ui-trending.png` (10 creator cards), `ui-video.png` (trending videos + Make 4 clips), `ui-clips.png` (real clips view — honest caveat: Groq 429s forced an audio-energy-only fallback that picked 2 windows, not 4; the README says so). `assets/how-to-use.png` — 4-step visual guide built from the real screenshots.
- README gained a "Caption styles" gallery (GIFs embedded, they autoplay; full mp4 linked under each) and a "Screenshots / How to use" section.

### Four bugs found by the showcase audit — all fixed in this pass
1. **`-af` + `-filter_complex` collision (ffmpeg 234):** the `sports-blur` and `gaming-split` branches polish audio inside `-filter_complex` (`[aout]`) but never set the flag the `-af` guard reads — the guard added `-af` too and ffmpeg rejected the combination. Fix: both branches now set `usedScenes = true` (the flag's real meaning is "a filter_complex branch already handled audio"; the guard comment was corrected too).
2. **Concat SAR mismatch → ffmpeg −22 "no packets":** the scene-aware face-track chains end in `concat`, but scene 0's hook punch-in scale (`eval=frame`, fractional w/h) produces a different SAR than the other scenes' plain scale — `concat` rejects mismatched SARs. It hit EVERY 720p-source face-track render (Boxing, MrBeast, Apex all failed this way); 1080p Raj sources happened to reduce to matching SARs, which is why they worked. Fix: `setsar=1` on every per-scene video chain (server.ts face-track branch) and on the DOAC per-scene overlay output (`buildDoacSceneChain`). Proven with a local repro of the server's own filter graph: without `setsar=1` → −22, with it → exit 0.
3. **`top` preset `marginV: 560 → 150`:** captions landed ~29% down the frame, across faces.
4. **`sentence` preset `Outline: 0 → 2`:** libass draws NO box with BorderStyle=3 + Outline=0 (proven with a minimal ASS test).
- The showcase clips themselves were rendered with workarounds before these fixes, so they are already correct; the fixes make the SERVER path produce them directly. Regression renders via the API (Boxing minimal, MrBeast sentence, Raj top) verify the fixes live — results recorded below.
- **Regression proof (all 3 pass, live server API only, 2026-11-16 ~23:05 IST):** (1) Boxing 225–255s `minimal`, job e9e1869a — sports-blur, single `-filter_complex` with the voice-polish leg inside and NO separate `-af`; small white Montserrat captions bottom-centre, RMS median −17.9 dB, 0 bursts. (2) MrBeast 1200–1230s `sentence`, job effe9a81 — face-track, scene-aware, concat completed; white text on a clearly visible opaque black box; RMS median −18.8 dB, 0 bursts. (3) Raj 1440–1470s `top`, job 037aed19 — face-track, 2 scenes; captions at the top (~150px zone), clear of faces on every viewed frame, yellow karaoke highlight on the active words; RMS median −17.3 dB, 0 bursts. Proof mp4s in `/tmp/regression-v84/` (tmpfs — gone on restart); driver `regression-v84.ts` kept in the repo root as a scratch script, NOT pushed. One non-bug noted: the regression script's hook picker sliced a hook mid-word ("…LOOK AS THOUGH RO") — the server rendered exactly what it was given; the showcase clips used hand-picked hooks and are unaffected.

### VM restart mid-job
- The VM restarted at ~22:23 IST, wiping `/tmp` (the showcase scripts, the push manifest, the render logs). All workspace files survived. The server was restarted and is live; the manifest must be regenerated before the push.

## v8.5 — One-command install (2026-11-17)

Manik asked for ClipPulse to install with a single command, and for simple install guides for AI code agents (Claude Code, Antigravity, Codex, opencode and others — the guides live outside this repo, in his files).

### `scripts/install.sh` (new)
- One line installs everything (Mac, Linux, or Git Bash on Windows):
  `curl -fsSL https://raw.githubusercontent.com/Manik51/Clippulse/main/scripts/install.sh | bash`
- It checks for Git + Node.js first (clear error + download link if missing), clones the repo to `~/Clippulse` (or pulls latest if already there), runs `scripts/setup-local.sh`, then starts `npm run prod` in the foreground. `CLIPPULSE_DIR` overrides the folder; `--no-start` installs without starting (used for testing).
- README Quickstart now leads with this one-liner; the manual 4-step install stays as a fallback.
- `setup-local.sh` fixes in this pass: final message corrected (`npm run dev` → `npm run prod`), and the optional pip step now passes `--break-system-packages` (Debian/Ubuntu pip refuses `--user` installs without it, PEP 668 — the packages are optional, failure was already tolerated).

### Verification (fresh clone, this VM)
- First test run failed for a test-setup reason, not a script bug: the clone went to `/tmp` (512MB tmpfs, 80% full) and `npm install` died with ENOSPC. Lesson recorded: never test-install into `/tmp`; the home disk has 109GB free.
- Re-run with `CLIPPULSE_DIR=~/workspace/clippulse-install-test`: clone + `.env` + 229MB `node_modules` + YuNet model download all completed; script printed "Install done (--no-start)". The fresh clone then served `/api/health` OK on PORT=3100 (main server holds :3000). Main server was briefly stopped by a mistaken kill during the test and restarted immediately — health OK after.
- Tests 35/35, lint + build clean. Pushed as commit 2be6c91 (README + install.sh + setup-local.sh).

## v8.6 — Clip lengths: 30s / 45s / 60s / custom (2026-11-17)

Manik asked why clips are 30 seconds, then ordered every size mentioned added. The 30s length was never a rule — it was the default the scoring window was built around (short clips finish, completion helps the algorithm). Now the length is a choice, not a fixed value.

### What changed
- One shared rule in `src/lib/virality.ts`: `normalizeClipLengthSec(value)` + `CLIP_LENGTH_PRESETS = [30, 45, 60]`, min 10s, max 180s, default 30s. Missing/invalid → 30s fallback; out-of-range numbers are clamped (5 → 10, 300 → 180), not rejected; whole seconds only.
- `/api/smart-analyze` accepts `clipLengthSec` (legacy `windowSec` still works as an alias) and scores windows of that length; the response echoes `clipLengthSec` + `windowSec`. `/api/render-local-mp4` accepts `clipLengthSec` to override the end-derived length. Bug found on the way: `clipDuration = Math.min(60, …)` silently cut any 90s/180s clip to 60s — cap raised to 180.
- UI: a "Clip length" picker in the Trending Clips header card, next to Quality/Framing — preset buttons 30s / 45s / 60s + a Custom seconds box (10–180). Analyze and render both use the picked length.
- Tests 39/39 (4 new: fallback, clamp, 45s windows, 60s windows). Lint + build clean.

### Verification (live server API)
- Smart-analyze, 45s: Boxing 8HKI1fGaQ8M (279s), job b86d0afc — top windows all exactly 45s (160–205s score 75.3, 155–200 73.6, 140–185 73.0).
- Render, 45s at 720p: job 48c7bbba, karaoke captions, sports-blur — ffprobe: 720×1280, duration exactly 45.000000s.
- Pushed as commit 20a409b (virality.ts, server.ts, TrendingClipsPanel.tsx, virality.test.ts). Repo now 18 commits.

## v8.7 — Eight distinct animated caption styles (2026-11-17)

Manik's complaint, after seeing the v8.4 showcase: all the subtitles look the same — and he was right. A frame check showed karaoke, lime, top and flash all reading as big yellow/white bold caps (doac similar), only minimal and sentence clearly different. He shared an OpusClip-style gallery as the reference: every style with its own font, its own highlight and its own motion — and every one animated, none still.

### The green flash frame: source content, not a bug
The flash clip's 5s frame is a solid-looking green screen with red "SHEIKH" text. Verified against YouTube's own storyboard sprites for Raj sRH-XlBE2cQ: the ~90s tile is the identical shot — green-graded archival footage of Khalid Sheikh Mohammed with red titles burned into the source. The 85–115s window is a documentary segment. A render bug would be a flat field; these frames have full photographic detail. No code fix needed. Flash's showcase moved to the bright Raj talking-head moment 1440–1470s (same moment as `top`, so the two compare on identical footage).

### Preset rebuild (`CAPTION_STYLE_PRESETS`, virality.ts)
`doac` untouched (locked standard); `karaoke` unchanged (Hormozi identity). Every other style rebuilt with its own font + highlight + position + motion:

| Style | Font | Highlight / position | Motion |
|---|---|---|---|
| minimal | Montserrat ExtraBold 40 | white/light-grey, **bottom-left** | fade-in per word |
| bold (new) | Alfa Slab One 64 | black text on solid **yellow box that follows the spoken word** (new `wordbox` mode) | pop-in 115 |
| lime | Poppins ExtraBold 66 | lime with **neon glow** | glow pulse (blur 4→1 decay) |
| sentence | Noto Sans 46 | black box, full sentences | **typewriter** reveal (unrevealed words grey) |
| top | Lilita One 56 | yellow/white, **top-centre** | flip-in (`\fry` 80→0) |
| flash | Bebas Neue 130 | **white with thick red outline**, centre | bounce (150→90→100) |

Preset interface gained `secondaryColour` (the `\kf` sweep's start colour) and `motion` (`pop|fade|pulse|flip|bounce|sweep|wordbox|typewriter`); a `motionTag()` builder emits the per-word `\t` transforms. New free OFL fonts in `~/.fonts`, wired into `scripts/setup-local.sh`: Poppins ExtraBold, Alfa Slab One, Lilita One.

### Real bug found: libass draws the BorderStyle-3 box from OutlineColour, not BackColour
The first bold render came out a BLACK box with near-invisible dark-grey text. Proven with an isolated 2-line ASS test: the opaque box colour comes from `OutlineColour`. Fix: bold's `outlineColour` is yellow too (both fields set). Documented in the preset-interface comment; covered by a test asserting the three colour fields. Sentence/HookBanner unaffected (their outline and back colours are both dark).

### Verification (live server API, driver regression-v87.ts — scratch, not pushed)
- Tests 40/40 (39 existing + 1 new distinctness test: all 8 fonts pairwise distinct, all 8 motions pairwise distinct, per-style ASS tags asserted). v8.6 clip-length tests pass unchanged. Lint + build clean.
- Six renders at 720p, all frame-checked at 0/5/15/25s + RMS clean: Raj top (1440–1470s), Apex lime (2290–2320s), Boxing minimal (225–255s), Boxing bold (225–255s, re-rendered after the box fix), MrBeast sentence (1200–1230s), Raj flash (1440–1470s, new moment).
- Motion pairs (frames ~0.15s apart inside one spoken word, mean-abs-diff + visual check) — ALL confirmed: top flip (edge-on sliver → full-size), lime pulse (heavy blur → settled glow), minimal fade (grey → bright white), bold wordbox (box follows word), sentence typewriter (grey → white), flash bounce (huge → settling). No style is static.
- Showcase files replaced locally for the 6 changed styles (clip.mp4 + thumb.jpg + clip.gif, all ≤25MB): `examples/styles/{minimal,bold,lime,sentence,top,flash}/` — `bold/` is a new folder. `karaoke` and `doac` untouched.
- Pushed as commit f4f3a75 (virality.ts, virality.test.ts, ReelPreviewPanel.tsx, setup-local.sh) + docs commit. Repo now 20 commits.
- Pre-existing, not fixed here: the raj-top/flash hook pick is a mid-sentence fragment ("six children, and six men…") — the known open hook-selection follow-up; the hook banner + top caption stack at the top for the first 2.8s (same as v8.4).

## v8.8 — Exact-reference rebuild: 18 styles, gallery picker, doac removed (2026-11-17)

Manik's order, after the v8.7 recolour was cancelled mid-work: "Ami tomake jei refference image ta dilam, exact otar moto koro" — make it exactly like the reference image he shared (an OpusClip/Captions.ai-style "Choose Style" gallery: named preset cards showing "WATCH THIS NOW", Font Size 20–72px, Font Color swatch + hex, Caption Position 0–100%). Then two more orders: doac is NOT needed ("doac ta lagbe na, rakhtei hobe emon kono bepar nei, na rakhleo hobe" — 01:19 IST, the locked standard is released), and 18 styles means 18 DIFFERENT animations and 18 DIFFERENT colours — no two styles may share either.

### Preset rebuild (`CAPTION_STYLE_PRESETS`, virality.ts)
The v8.7 set (8 styles) is replaced by the 18 reference styles, each with its own font + accent colour + highlight + motion. Full table in `examples/styles/README.md`. Deviations from the reference, forced by the distinctness rule: 2026-C teal text (reference: white); MrBeast orange (reference: yellow); Red Line rose box (reference red = Hormozi V1's red); Cardone-A dark-maroon outline; Hollywood Fill dark-blue outline; YELLOW BURST pale-yellow text on near-black box. Box styles keep `outlineColour == backColour` (v8.7 libass lesson). Three presets had ASS colours written un-reversed (CSS hex with `&H00` prefix instead of `&H00BBGGRR`) and were fixed (Hormozi V1 red, Red Line box, Streamline purple); undercut corrected to true #FFD800.

**DOAC removal:** no `doac` in presets/picker/defaults/tests except the intentional assertion `!('doac' in CAPTION_STYLE_PRESETS)` and a history note in the preset comment. Default render style is now `hormozi-v1` everywhere (presets, `App.tsx`, `TrendingClipsPanel.tsx`, `generateAssSubtitle`). Dead doac-only render code removed where cleanly separable (`generateDoacSubtitle`, `buildDoacSceneChain`, `decideDoacShotLayout`, `doacFgHeight`, `buildHookTitleDrawtext`, `buildDoacBlurFill` and call sites). The DOAC sample clip (`demo/`, `examples/raj-clip-doac-spec.mp4`) and the `examples/styles/doac/` showcase folder stay as history. The v8.7b recolour partial edits (top cyan, lime green, bold orange) were superseded by this rebuild.

**Bug found + fixed in the same pass:** `server.ts` lines 396–417 held a broken remnant (`>>> {` + the body of deleted `detectSceneFacesMulti`, no signature) — a `tsc`-caught syntax error; the old server had been running pre-surgery code. 11 dead tsc-breaking scratch drivers deleted from the repo root (`rerender-doac-v81.ts` and `verify-v7.ts` kept, clean).

### Picker UI (`ReelPreviewPanel.tsx`)
"Choose Style" gallery: grid of 18 NAMED cards, each a live mini-preview (real font/colours/highlight on "WATCH THIS NOW"); selected card violet ring + check; header shows the chosen style name. Bottom controls: Font Size slider 20–72 (shows px), Font Color picker (swatch + hex input), Caption Position slider 0–100% (shows %). **Override wiring is real, not decoration:** controls feed `CaptionOverrides` (`fontSize?`, `fontColour?`, `positionPct?` — new in `src/lib/types.ts`) into `generateAssSubtitle` (9th param) and the render request, so the picked size/colour/position is what actually renders. Selecting a new style resets overrides; "Reset style overrides" link. Motion now actually reaches renders: sentence and wordbox branches call `motionTag` (previously wordbox hardcoded `popTag`, sentence hardcoded plain `\kf`).

### Fonts (free OFL)
Playfair Display Italic + Montserrat Variable added (`~/.fonts/`, wired into `scripts/setup-local.sh`; Archivo Black download block removed). 8 TTFs copied to `public/fonts/` (2.0 MB) with 8 `@font-face` rules in `src/index.css` (verified present in `dist/`). Fonts are downloaded by `setup-local.sh` at install time, so `public/fonts/` is NOT shipped in the repo.

### Verification (live server API, drivers `regression-v88.ts` / `render-missing-v88.ts` / `render-upload-v88.ts` — scratch, not pushed)
- Tests 38/38 (`npm test`), lint (`npx tsc --noEmit`) clean, `npm run build` clean. Tests rewritten: preset set exactly the 18 names/displayNames, no doac; all 18 motions pairwise distinct AND each renders its own ASS tag; all 18 accents pairwise distinct AND each accent's BBGGRR appears in its own generated ASS Style line; per-style spot checks; wordbox outline==back; override plumbing (fontSize 50 → `Anton,50,`; fontColour #00FF00 → `&H0000FF00`; positionPct 80 → MarginV 180; invalid colour falls back); hex↔ASS round-trip for all 18 accents; every preset font installed in `~/.fonts`. v8.6 clip-length work intact.
- **19/19 renders through the real server API** (output `~/workspace/regression-v88/`, 648 MB — not `/tmp`, which is a 512 MB tmpfs that wipes on restart; two VM restarts during the run SIGTERM'd the waiter and wiped /tmp once, losing 7 early renders + logs; work resumed from the persistent dir). 14 from real YouTube (Boxing 8HKI1fGaQ8M 225–255s, Apex V3_75JK_IzQ 2290–2320s), mean volume −17.8 dB. 5 via the server's real `/api/upload-video` path on a locally generated 30s 720×1280 synthetic test-pattern backdrop, silent (−91 dB, as designed) — see bot-check note below.
- Frame grids (parent-verified): `grid-main.jpg` — every style's colour/font/highlight/position matches its preset; `grid-motion-proof.jpg` — caption-band crops at a real word boundary (+0.02s vs +0.17s): motion clearly visible in the pair for 14/18 (pop, pop-big, wordbox-flip, wordbox-zoom, sweep, pulse, pulse-glow, slide-up, fade, spin — blue word visibly rotated, bounce, flip, typewriter — empty box → "If", rise). Subtle in stills for 4/18 — wordbox (Red Line), wordbox-slide (Streamline), bounce-soft (SARA), slide-down (Iman-A): distinct ASS tags proven by tests, effects are 90–260 ms scale/alpha moves that read as a small grow/fade; Red Line's word-change (HIM→OUT between the 5.00/5.15s pairs) proves its box follows the spoken word. No style is static.
- Override proof: `boxing-hormozi-v1-override.mp4` (50px + position 80%) vs default Hormozi V1 — frames show visibly SMALLER red/white text positioned HIGHER in the frame.
- Caveats: `apex-2026-b.mp4` came out 19.78s, not 30s (truncated source download; style still verified in the frames it has). The 5 upload renders have a synthetic colour-bar backdrop and no audio — the caption layer is the server's real render pipeline burning the real generated ASS, but they must be labelled as such, not as real-video renders. Cosmetic: the grids' header titles overlap their column labels slightly.
- **YouTube bot-check on the server IP (operational, not a code bug):** after 2 Apex download stalls and intermittent "Sign in to confirm you're not a bot" failures, the server returns explicit `youtube_bot_check` (server.ts:1874): "YouTube blocked media download from this Cloud server IP (bot check). To edit & download real 60s Reels right now: (1) Upload any .MP4/.MOV video file in the Upload Video button above, OR (2) Run locally on your Linux PC…" — the 5 missing styles were rendered through the real `/api/upload-video` path instead. A retry after a cooldown may clear the IP block for real-video renders later. **Manik was told this on 2026-11-17.**
- **Pushed as commit 2ecffde** (code + docs, 12 files: virality.ts, virality.test.ts, types.ts, ReelPreviewPanel.tsx, TrendingClipsPanel.tsx, App.tsx, server.ts, setup-local.sh, index.css, README.md, PRODUCTION-READY.md, examples/styles/README.md). Note: the first push attempt timed out on the egress approval card (05:06 IST, user asleep) — the action was NOT performed; the successful push ran 08:59 IST after the user approved ("Haa, push koro").
- Showcase refresh PENDING: the `examples/styles/` folders + README gallery still hold the v8.7 set (8 styles incl. retired doac). Refresh = 18 folders × (clip.mp4 + thumb.jpg + clip.gif) from `~/workspace/regression-v88/` renders (GIFs/thumbs to generate, oversize mp4s CRF 23 re-encoded to ≤25 MB), uploaded via GitHub web UI — to do after Manik has seen the styles.

## v8.8.1 — Top bar cleaned up: Export button, Backend Code, Free Stack removed (2026-11-17)

Manik, looking at the app: the top bar showed "Export .ASS & FFmpeg", "Backend Code" and "Free Stack" — he asked what they are, then asked to remove them one by one ("Eta ki rakhtei hobe?", "button-ta soriye dao", "etao hide koro", "Etao Soriye Dao").

- **Export .ASS & FFmpeg button (top bar) — removed.** It only opened `ExportModal`, which handed out the .ass subtitle file + the ffmpeg command for rendering outside the app. Preview and download never depended on it — they run through the server render (`/api/render-local-mp4` → downloadUrl/streamUrl). The preview panel had a second copy of the same button ("View .ASS & Serverless FFmpeg Command") — removed too. `ExportModal.tsx` deleted; its only callers were the two buttons. The `assContent` / `ffmpegCommand` memos, `isExportOpen` / `serverlessSectionOnly` state and the `generateAssSubtitle` / `buildFfmpegCommand` imports in `App.tsx` went with it (`copyrightSafeTransform` / `mirrorFlip` state stays — the preview still uses them).
- **Free Stack tab — hidden.** Top-bar button removed. The free-stack table (`FREE_STACK_MATRIX`) stays in `BackendBlueprintView` code, unreachable from the UI.
- **Backend Code tab — hidden.** Top-bar button, mobile tablist "Serverless Backend" tab, and the footer "Modal.com & Cloud Run Serverless" link all removed. The `BackendBlueprintView` component + the `activeTab === 'blueprint'` render branch stay in code (unreachable from the UI), so the backend code is not deleted — only hidden. Three help strings in `App.tsx` that told users to "deploy the Serverless Worker in Backend Code" now point at Trending Clips instead.
- Verified: `npx tsc --noEmit` clean, `npm run build` clean, tests 38/38, server restarted + `/api/health` OK. Built bundle contains zero occurrences of "Export .ASS", "View .ASS", "Free Stack", "Backend Code", "ফ্রি স্ট্যাক", "পাইথন ব্যাকএন্ড".
- Pushed as commit (App.tsx, TopBar.tsx, ReelPreviewPanel.tsx, PRODUCTION-READY.md) + `ExportModal.tsx` deleted from the repo via the GitHub web UI (MCP push-files cannot delete files).

## v8.9 — GTA 6 tab: countdown, LIVE grid, click-to-clip (2026-11-17)

Manik's order: a dedicated GTA 6 tab — countdown running until launch, then the countdown stops and the tab shows the big YouTube channels streaming GTA 6 gameplay in a thumbnail grid; clicking a channel/thumbnail clips that video. Then: make it GTA 6 / gaming themed, a dedicated space with a gaming vibe. Then: show the GTA 6 page beautifully in the GitHub README too.

**Launch date (verified, not guessed):** Grand Theft Auto VI launches **Thursday, November 19, 2026, at midnight local time per region**, PS5 + Xbox Series X|S (AP / USA Today / Polygon, 17 Nov 2026). No PC version announced. Countdown target = local midnight Nov 19, 2026 (the browser's local timezone).

### The tab (new `WorkspaceTab` value `'gta6'`)
- TopBar desktop nav ("GTA 6" after Trending Clips) + mobile tablist + App.tsx render branch. `Gta6TrackerPanel` MOVED out of the Workbench tab into the GTA 6 tab (not duplicated).
- **Countdown** (`src/lib/gta6.ts`, new): live ticking 1s interval, days/hours/mins/secs. At zero it STOPS and the tab flips to LIVE state; a one-shot effect then auto-fetches the gameplay grid. The manual Track/refresh button stays available; release-status text shows pre-launch.
- **LIVE state:** glowing LIVE banner (rose→fuchsia→purple gradient + glow + pulsing dot), then the thumbnail grid auto-fetched from `/api/gta6-track`.
- **Click-to-clip:** clicking a channel card, its thumbnail, or its button loads that video into the studio via the existing `onLoadGta6Clip` flow AND switches the user to the Workbench tab (timeline section) so they see it loaded and can clip it.

### Endpoint (`server.ts`, `/api/gta6-track` — existed, improved)
- Search query broadened from trailer-only `'GTA 6 official gameplay trailer 4K 60fps'` to `'GTA 6 gameplay'`; wider net (`--playlist-end` 8→12); ranking changed from duration-desc to **view-count desc** (the proven `/api/trending` pattern) so the biggest channels surface first; returns **6 videos** instead of 3; each video now carries a real `views` field. No fake data — the grid shows only what the endpoint returns; on failure the panel shows an honest error + retry state. yt-dlp search is NOT bot-blocked on this server IP (only media downloads were, in v8.8).

### Theme (GTA 6 tab ONLY)
Dark `slate-950` panel, Vice City sunset strip (fuchsia→purple→cyan gradient) across the top, "GTA 6" heading in Anton with a fuchsia→rose→cyan gradient, countdown digits in Anton 3xl–4xl with a neon glow (reads like a game launch timer), glowing LIVE badge, game-style cards (dark `slate-900`, neon fuchsia border + purple glow on hover, channel avatar as a gradient initial-letter circle — real avatars aren't in yt-dlp search results — view-count chips on thumbnails, gradient click-to-clip button). No copyrighted Rockstar artwork or logos — CSS gradients, colours and typography only.

### Verification
- Tests 46/46 (`npm test` — 38 existing + 8 new: 7 countdown tests in `src/lib/gta6.test.ts` incl. target date, zero-crossing at exactly Nov 19 00:00, after-launch live, formatting; 1 view-count format test). `package.json` test script updated to run both test files. `npx tsc --noEmit` clean, `npm run build` clean.
- Countdown verified with the real function: at Nov 17 03:47 UTC → **1d 20h 12m 49s, isLive=false** (~1d 14h 42m on IST).
- Grid fetch verified live (parent re-check, POST `/api/gta6-track`, HTTP 200, grounding true, 6 videos, view-count sorted): Rockstar Games "Grand Theft Auto VI: An Extended Look" 37,927,003 views (#1), Hollow 2.3M, GameCheck 913K, Hollow 549K, TmarTn2 449K, TmarTn2 427K.
- README showcase: a `## 🎮 GTA 6 Tab` section with the launch date, the 4 steps, and the verified Nov 17 grid snapshot (labelled as a snapshot — the live tab always shows current top videos). README DOAC staleness fixed in the same pass (How-it-works step 4 + Features bullet + "The DOAC production standard" now marked retired in v8.8).
- Caveats: (a) one transient endpoint failure during the build (Gemini hiccup, placeholder summary) — immediate retry recovered; the panel shows that placeholder text honestly in that case (pre-existing fallback, not fake data). The grounding call still flakes about once in three — the screenshot script retries Track once when it sees the placeholder. (b) The LIVE flip can't be fully live-verified until Nov 19 — zero-crossing covered by tests, auto-fetch effect fires once when `isLive` flips; eyeball the tab once. (c) Pre-existing, out of scope: the panel's `buildGta6Source` still loads placeholder transcript segments/hooks (hardcoded Vice City lines) into the studio — the workbench shows those until a real analysis/transcription runs; flag to Manik, fix next if he wants it.
- **Summary-date guard (added after the first screenshot review):** the first screenshot caught Gemini's grounded summary stating the launch as "November 16, 2026" (the news-cycle date) with raw `**` markdown showing — while the countdown correctly said Nov 19. `server.ts` now strips `**`/`__` from grounded summaries and only trusts one that states the verified launch date (Nov 19); otherwise it falls back to the verified sentence "Grand Theft Auto VI launches Thursday, November 19, 2026, at midnight local time on PS5 and Xbox Series X|S. Pre-load opened November 10, 2026." Verified live: the retry returned the verified line. The README screenshot (`assets/screenshots/ui-gta6.png`, taken with headless Chromium via CDP — the cloud browser cannot reach localhost) shows the fixed status. Note: thumbnails from i.ytimg.com do not load from this VM (egress proxy), so the README shot is cropped to the countdown + status; on a real PC the grid thumbnails load normally.
- Pushed as commit `7bde1e5` (gta6.ts, gta6.test.ts, types.ts, TopBar.tsx, App.tsx, Gta6TrackerPanel.tsx, server.ts, package.json, README.md, PRODUCTION-READY.md). Screenshot `assets/screenshots/ui-gta6.png` uploaded via web UI (binary).

## v8.9.1 — GTA 6 load: no more fake transcript + fresh screenshots of every tab (2026-11-17)

Two follow-ups to v8.9, both on Manik's orders.

### 1. No fabricated content on GTA 6 click-to-load
`buildGta6Source()` used to load 4 hardcoded Vice City transcript lines, a fake `hookScore: 95` with invented hooks, and synthesized 64–98 audio-energy values into the studio — the workbench showed them as if they were the video's real words/scores until a real analysis ran. Fixed:
- `src/lib/gta6.ts` — `buildGta6Source()` moved here from the panel (also makes it testable without importing a React component), rewritten to carry real metadata only (title, channel, URL, thumbnail, duration): empty segments, no `presetHooks`, empty audio-energy and face-track profiles.
- `src/components/Gta6TrackerPanel.tsx` — local fake builder deleted; imports the clean builder. The load note is now honest (bilingual): "Loaded {channel} — not analyzed yet, no scores. Paste this link in Trending Clips for the full analysis, or paste a transcript in the Workbench and press Analyze."
- `src/App.tsx` — `loadSourceIntoStudio()` no longer builds scored windows from an empty transcript (that would have shown baseline scores ~32–60 and generic hook lines as if real). An unanalyzed source now loads with **zero windows**, and stale hook text / face offset / playback position from the previous video are reset. Added an amber **"not analyzed yet" banner** in the workbench (bilingual) where the scoring timeline would be, with the two real next steps. Presets, pasted transcripts, and Analyze results are unaffected.
- Tests: 3 new in `src/lib/gta6.test.ts` (builder carries only real metadata; segments/hooks/profiles empty; serialized source contains none of the banned placeholder strings). Verified by the parent: tests 49/49, bundle grep 0 matches for the fake strings, server healthy.

### 2. Fresh screenshots of every tab
Manik's order: remove the old screenshots, take new ones, arrange all tabs' screenshots beautifully. Taken Nov 17, 2026 with headless Chromium via CDP (the cloud browser cannot reach localhost), 1280×900 viewport shots:
- `assets/screenshots/ui-workbench.png` (new) — pipeline header + 4-category clip pack. Caught a scripting slip first: the app's default tab is Trending, not Workbench, so the first "workbench" shot actually showed Trending — retaken after explicitly clicking Workbench.
- `assets/screenshots/ui-timeline.png` (new) — the 60s sliding-window timeline + 9:16 preview (Timeline jumps into the Workbench's timeline section).
- `assets/screenshots/ui-trending.png` (replaced) — after Fetch Trends: 10 creators re-sorted by real view count (MrBeast 527.0M subs first). The wait loop checked for "followers" but the UI says "subs", so it waited the full 60s even though the fetch had finished — the shot itself is correct.
- `assets/screenshots/ui-gta6.png` (replaced) — countdown 01d 14h + the verified Nov 19 summary + grid with view-count chips.
- README `## Screenshots` rewritten: one captioned shot per tab in nav order (Workbench, Timeline, Trending Clips, GTA 6); the GTA 6 section no longer duplicates the image.
- Retired (deleted from GitHub via web UI): `assets/screenshots/ui-video.png`, `assets/screenshots/ui-clips.png`, `assets/how-to-use.png` (v6-era shots; the how-to diagram is superseded by `assets/flow.svg` in "How it works").
- Honest caveat: avatar/thumbnail images from i.ytimg.com do not load from this VM (egress proxy), so channel avatars and video thumbnails show as broken-image placeholders in the shots; on a real PC they load normally. The text, numbers and layout are all real.
- Pushed as commit (App.tsx, Gta6TrackerPanel.tsx, gta6.ts, gta6.test.ts, README.md, PRODUCTION-READY.md). PNG uploads + old-file deletions via web UI.
