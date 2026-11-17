# Caption styles — showcase clips

> **v8.9 (2026-11-17):** the gallery now shows **18 styles, 18 different
> videos** — every style is rendered from its own 30-second moment, no two
> rows share a moment. Each clip is 720p, ~30 seconds, 9:16, rendered from
> a real YouTube moment with a real Whisper transcript through the live
> server render pipeline. The old v8.7 folders (`karaoke`, `minimal`,
> `lime`, `sentence`, `top`, `flash`, `bold`) are gone; the 18 folders
> below are named by the v8.8 style key. The retired `doac/` folder stays
> as history (its row is out of the gallery).

Each style folder holds three files:

- `clip.mp4` — the full clip (CRF 23, under 25 MB)
- `clip.gif` — a looping 6-second excerpt from the start of the clip; it plays by itself
- `thumb.jpg` — a frame from ~5s into the clip

## The 18 moments — one per style

| Style | Video | Window | What makes it distinct |
|---|---|---|---|
| [hormozi-v1](hormozi-v1/clip.mp4) | Boxing — Erik Bazinyan vs Ronald Ellis `8HKI1fGaQ8M` | 30–60s | Anton 72pt, red current word, ALL CAPS, word pop. The default style. |
| [red-line](red-line/clip.mp4) | Boxing — same video `8HKI1fGaQ8M` | 90–120s | Anton 68pt, a rose wordbox that follows the spoken word. |
| [streamline](streamline/clip.mp4) | Boxing — same video `8HKI1fGaQ8M` | 150–180s | Anton 68pt, purple wordbox that slides in word by word. |
| [hormozi-2026-c](hormozi-2026-c/clip.mp4) | Boxing — same video `8HKI1fGaQ8M` | 210–240s | Montserrat ExtraBold 40pt, small teal captions that fade in. |
| [undercut](undercut/clip.mp4) | Apex Legends gameplay `V3_75JK_IzQ` | 300–330s | Playfair Display Italic 58pt, yellow serif, sweeping in. |
| [hormozi-2026-a](hormozi-2026-a/clip.mp4) | Apex Legends gameplay `V3_75JK_IzQ` | 900–930s | Bebas Neue 64pt, white, sliding up. |
| [hormozi-2026-d](hormozi-2026-d/clip.mp4) | Apex Legends gameplay `V3_75JK_IzQ` | 1500–1530s | Bebas Neue 110pt, blue, one huge word at a time, centre frame, spinning in. |
| [hollywood-fill](hollywood-fill/clip.mp4) | Apex Legends gameplay `V3_75JK_IzQ` | 2290–2320s | Anton 72pt, navy outline, flipping in. |
| [hormozi-2026-b](hormozi-2026-b/clip.mp4) | Raj Shamani — Ex Navy SEAL (Robert J. O'Neill) `sRH-XlBE2cQ` | 800–830s | Anton 72pt, amber glow that pulses on each word. |
| [hormozi-2026-e](hormozi-2026-e/clip.mp4) | Raj Shamani — same video `sRH-XlBE2cQ` | 1440–1470s | Anton 72pt, light-green glow, pulse-glow. |
| [iman-a](iman-a/clip.mp4) | Raj Shamani — same video `sRH-XlBE2cQ` | 2400–2430s | Montserrat 56pt, slate, sliding down. |
| [sara](sara/clip.mp4) | Raj Shamani — same video `sRH-XlBE2cQ` | 3600–3630s | Poppins ExtraBold 66pt, pink glow, bouncing in softly. |
| [mrbeast](mrbeast/clip.mp4) | MrBeast — I Survived The Most Extreme Places On Earth `gTKS8SAwUzE` | 600–630s | Anton 76pt, orange, popping in big. |
| [roman](roman/clip.mp4) | MrBeast — same video `gTKS8SAwUzE` | 1200–1230s | Anton 68pt, burnt-orange wordbox, flipping in. |
| [axel](axel/clip.mp4) | MrBeast — same video `gTKS8SAwUzE` | 300–330s | Poppins ExtraBold 60pt, dark-green wordbox, zooming in. |
| [cardone-a](cardone-a/clip.mp4) | Cricket — Big Collapse IN Big Match (GoPro) `GtsiUP-oKS0` | 60–90s | Anton 72pt, maroon outline, bouncing in. |
| [ali](ali/clip.mp4) | Cricket — same video `GtsiUP-oKS0` | 150–180s | Montserrat 48pt, grey line-box, sentence mode, revealed typewriter-style. |
| [yellow-burst](yellow-burst/clip.mp4) | Cricket — same video `GtsiUP-oKS0` | 280–310s | Anton 72pt, pale-yellow text on a near-black box, rising in. |

All eighteen styles are implemented in `src/lib/virality.ts`
(`CAPTION_STYLE_PRESETS` + `generateAssSubtitle`). No two styles share a
motion or an accent colour (the tests assert pairwise distinctness).

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
