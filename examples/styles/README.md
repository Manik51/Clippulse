# Caption styles — showcase clips

> **v8.8 (2026-11-17):** the app now ships **18 caption styles** (table below),
> each with its own font, accent colour, highlight and motion — no two share
> a motion or an accent colour. The folders below are the **v8.7 showcase**
> (8 styles, including retired `doac`); they are being refreshed to the
> v8.8 set. Verified v8.8 renders live in `~/workspace/regression-v88/`
> (19 renders: 18 styles + 1 override proof).

Eight caption styles, each rendered from a real YouTube moment at 720p,
~30 seconds, 9:16. Every clip below was verified frame by frame (captions
visible, right colour and position, no overlaps, no text over faces) and
with a 0.25s RMS audio profile (voice present, no bursts). Every style is
animated — each with its own motion, none of them still.

Each style folder holds three files:

- `clip.mp4` — the full clip
- `clip.gif` — a looping excerpt from the start of the clip; it plays by itself
- `thumb.jpg` — a frame from ~5s into the clip

| Style | Video | Window | What makes it distinct |
|---|---|---|---|
| [doac](doac/clip.mp4) | Raj Shamani — Ex Navy SEAL (Robert J. O'Neill) `sRH-XlBE2cQ` | 800–830s | The locked production standard: 4:5 centre crop with blur-fill bars, big yellow hook title for 2.8s, word-by-word captions **below** the picture on the bottom bar, clean voice, no music, no SFX. |
| [karaoke](karaoke/clip.mp4) | Raj Shamani — same video `sRH-XlBE2cQ` | 85–115s | Hormozi style: Anton 72pt, yellow current word / white rest, ALL CAPS, word pop. Captions mid-frame. |
| [minimal](minimal/clip.mp4) | Boxing — Erik Bazinyan vs Ronald Ellis `8HKI1fGaQ8M` | 225–255s | Montserrat ExtraBold 40pt, small white sentence-case captions **bottom-left**, fading in word by word. Quiet and clean. |
| [bold](bold/clip.mp4) | Boxing — same video `8HKI1fGaQ8M` | 225–255s | Alfa Slab One 64pt — black text on a solid **yellow box that follows the spoken word**, one word at a time, popping in. |
| [lime](lime/clip.mp4) | Apex Legends gameplay `V3_75JK_IzQ` | 2290–2320s | Poppins ExtraBold 66pt, lime `#C6F135` with a neon **glow that pulses** on each word. Built for gameplay. |
| [sentence](sentence/clip.mp4) | MrBeast — I Survived The Most Extreme Places On Earth `gTKS8SAwUzE` | 1200–1230s | Noto Sans 46pt, one full sentence at a time on a semi-transparent black box, revealed **typewriter-style** word by word. |
| [top](top/clip.mp4) | Raj Shamani — same video `sRH-XlBE2cQ` | 1440–1470s | Lilita One 56pt, yellow karaoke captions pinned to the **top** of the frame, flipping in word by word, clear of faces. |
| [flash](flash/clip.mp4) | Raj Shamani — same video `sRH-XlBE2cQ` | 1440–1470s | Bebas Neue 130pt — one huge **white word with a thick red outline** at a time, centre frame, bouncing in. Same moment as `top`, so the style difference is easy to compare. |

All eight styles are implemented in `src/lib/virality.ts`
(`CAPTION_STYLE_PRESETS` + `generateAssSubtitle`). The `doac` style uses
its own `generateDoacSubtitle` (below-picture captions) and the per-scene
`decideDoacShotLayout` (4:5 crop for singles, 16:9 letterbox for two-shots).

## The v8.8 set — 18 styles (in the app now)

| Style | Font | Accent | Highlight | Motion |
|---|---|---|---|---|
| Hormozi V1 | Anton 72 | #FF2D2D red | karaoke (red current word) | pop |
| Red Line | Anton 68 | #E11D48 rose | wordbox (rose box) | wordbox |
| Undercut | Playfair Display Italic 58 | #FFD800 yellow | karaoke italic serif | sweep |
| Streamline | Anton 68 | #7C3AED purple | wordbox (purple box) | wordbox-slide |
| Hormozi Short 2026-A | Bebas Neue 64 | #FFFFFF white | karaoke tall narrow | slide-up |
| Hormozi Short 2026-B | Anton 72 | #FFB020 amber | karaoke glow | pulse |
| Hormozi Short 2026-C | Montserrat ExtraBold 40 | #2DD4BF teal | karaoke small | fade |
| Hormozi Short 2026-D | Bebas Neue 110 | #3B82F6 blue | flash, middle-centre | spin |
| Hormozi Short 2026-E | Anton 72 | #4ADE80 light green | karaoke glow | pulse-glow |
| MrBeast | Anton 76 | #F97316 orange | karaoke, pop-big | pop-big |
| Iman-A | Montserrat 56 | #94A3B8 slate | karaoke | slide-down |
| Cardone-A | Anton 72 | #7F1D1D maroon | outline | bounce |
| Hollywood Fill | Anton 72 | #1E3A8A navy | outline | flip |
| Roman | Anton 68 | #C2410C burnt orange | wordbox | wordbox-flip |
| SARA | Poppins ExtraBold 66 | #EC4899 pink | karaoke glow | bounce-soft |
| ALI | Montserrat 48 | #6B7280 grey | line-box, sentence mode | typewriter |
| Axel | Poppins ExtraBold 60 | #15803D dark green | wordbox | wordbox-zoom |
| YELLOW BURST | Anton 72 | #111827 near-black box + #FDE047 pale-yellow text | line-box | rise |

Deviations from the reference image, forced by the distinctness rule (no two
styles may share a motion or an accent colour): 2026-C is teal text
(reference: white); MrBeast is orange (reference: yellow); Red Line is a
rose box (reference red = Hormozi V1's red); Cardone-A is a dark-maroon
outline; Hollywood Fill is a dark-blue outline; YELLOW BURST is pale-yellow
text on a near-black box. Default render style is now `hormozi-v1`.
`doac` was removed from the preset set in v8.8 (user: "doac ta lagbe na") —
its sample clip and this folder stay as history.
