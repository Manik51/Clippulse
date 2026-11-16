# Caption styles — showcase clips

Seven caption styles, each rendered from a real YouTube moment at 720p,
~30 seconds, 9:16. Every clip below was verified frame by frame (captions
visible, right colour and position, no overlaps, no text over faces) and
with a 0.25s RMS audio profile (voice present, no bursts).

Each style folder holds three files:

- `clip.mp4` — the full clip
- `clip.gif` — a looping excerpt from the start of the clip; it plays by itself
- `thumb.jpg` — a frame from ~5s into the clip

| Style | Video | Window | What makes it distinct |
|---|---|---|---|
| [doac](doac/clip.mp4) | Raj Shamani — Ex Navy SEAL (Robert J. O'Neill) `sRH-XlBE2cQ` | 800–830s | The locked production standard: 4:5 centre crop with blur-fill bars, big yellow hook title for 2.8s, word-by-word captions **below** the picture on the bottom bar, clean voice, no music, no SFX. |
| [karaoke](karaoke/clip.mp4) | Raj Shamani — same video `sRH-XlBE2cQ` | 85–115s | Hormozi style: Anton 72pt, yellow current word / white rest, ALL CAPS, word pop. Captions mid-frame. |
| [minimal](minimal/clip.mp4) | Boxing — Erik Bazinyan vs Ronald Ellis `8HKI1fGaQ8M` | 225–255s | Montserrat ExtraBold 54pt, small white sentence-case captions, no pop. Quiet and clean. |
| [lime](lime/clip.mp4) | Apex Legends gameplay `V3_75JK_IzQ` | 2290–2320s | Anton 72pt with a lime `#C6F135` highlight on the current words, pop 130. Built for gameplay. |
| [sentence](sentence/clip.mp4) | MrBeast — I Survived The Most Extreme Places On Earth `gTKS8SAwUzE` | 1200–1230s | Noto Sans 46pt, one full sentence at a time on a semi-transparent black box. |
| [top](top/clip.mp4) | Raj Shamani — same video `sRH-XlBE2cQ` | 1440–1470s | Anton 72pt, yellow karaoke captions pinned to the **top** of the frame, clear of faces. |
| [flash](flash/clip.mp4) | Raj Shamani — same video `sRH-XlBE2cQ` | 85–115s | Bebas Neue 120pt — one huge word at a time, centre frame, pop 125. Same moment as `karaoke`, so the style difference is easy to compare. |

All seven styles are implemented in `src/lib/virality.ts`
(`CAPTION_STYLE_PRESETS` + `generateAssSubtitle`). The `doac` style uses
its own `generateDoacSubtitle` (below-picture captions) and the per-scene
`decideDoacShotLayout` (4:5 crop for singles, 16:9 letterbox for two-shots).
