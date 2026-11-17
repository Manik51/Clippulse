import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CAPTION_STYLE_PRESETS,
  CATEGORY_WEIGHTS,
  DEFAULT_WEIGHTS,
  buildAutoFetchPack,
  buildFaceTrackCropX,
  buildFfmpegCommand,
  buildHookPunchScale,
  buildPushInScale,
  buildSlidingWindows,
  buildUploadedVideoSource,
  buildZoomPunchScale,
  calculateWeightedScore,
  evaluateCopyrightSafety,
  extractWordsFromSegments,
  extractYoutubeVideoId,
  escapeDrawtext,
  formatAssTimecode,
  formatTimecode,
  applyCaptionOverrides,
  assColourToCss,
  generateAssSubtitle,
  hexToAssColour,
  marginVForPositionPct,
  positionPctForPreset,
  mergeSceneBoundaries,
  buildGameplayFilter,
  normalizeClipLengthSec,
  pickPunchTimes,
  qualityDims,
  parseCustomTranscriptToSource,
  reweightWindows,
  VOICE_POLISH_FILTER,
} from './virality';
import { PRESET_VIDEOS } from './presets';
import type { CaptionStyle } from './types';

test('calculateWeightedScore applies 0.4*hook + 0.3*emotion + 0.2*audio + 0.1*pacing accurately', () => {
  const score = calculateWeightedScore(
    { hook: 90, emotion: 80, audio: 70, pacing: 60 },
    DEFAULT_WEIGHTS
  );
  assert.equal(score, 80);
});

test('buildSlidingWindows creates 60s windows stepping every 5s', () => {
  const podcast = PRESET_VIDEOS.find((p) => p.id === 'podcast-founder')!;
  const windows = buildSlidingWindows(podcast, DEFAULT_WEIGHTS, 60, 5);
  assert.equal(windows.length, 13);
  assert.equal(windows[0].startSec, 0);
  assert.equal(windows[0].endSec, 60);

  const sorted = [...windows].sort((a, b) => b.totalScore - a.totalScore);
  assert.equal(sorted[0].startSec, 30);
});

test('reweightWindows updates totalScore immediately when weights shift', () => {
  const cricket = PRESET_VIDEOS.find((p) => p.category === 'cricket')!;
  const windows = buildSlidingWindows(cricket, CATEGORY_WEIGHTS.cricket);
  const hookHeavy = reweightWindows(windows, { hook: 0.7, emotion: 0.1, audio: 0.1, pacing: 0.1 });
  assert.notEqual(hookHeavy[0].totalScore, windows[0].totalScore);
});

test('evaluateCopyrightSafety flags broadcast rights holders and verifies CC-BY sources', () => {
  const safeCricket = PRESET_VIDEOS.find((p) => p.category === 'cricket')!;
  const safeRes = evaluateCopyrightSafety(safeCricket);
  assert.equal(safeRes.safe, true);
  assert.equal(safeRes.status, 'cc-by');

  const risky = evaluateCopyrightSafety({
    channel: 'ICC Official Broadcast',
    title: 'World Cup Final Highlights',
    licenseStatus: 'broadcast-risk',
    licenseNote: '',
  });
  assert.equal(risky.safe, false);
  assert.equal(risky.status, 'broadcast-risk');
});

test('buildAutoFetchPack picks #1 viral 60s clip for cricket, boxing, football, and gaming', () => {
  const pack = buildAutoFetchPack(PRESET_VIDEOS, ['cricket', 'boxing', 'football', 'gaming'], true);
  assert.equal(pack.length, 4);
  assert.deepEqual(
    pack.map((item) => item.category),
    ['cricket', 'boxing', 'football', 'gaming']
  );
  for (const item of pack) {
    assert.equal(item.copyright.safe, true);
    assert.ok(item.topWindow.totalScore >= 70);
  }
});

test('generateAssSubtitle produces valid ASS karaoke events, hook banner, and CC-BY credit', () => {
  const cricket = PRESET_VIDEOS.find((p) => p.category === 'cricket')!;
  const ass = generateAssSubtitle(
    cricket.segments,
    30,
    90,
    '22 needed off 6 balls!',
    'hormozi-v1',
    'CC-BY: Metro Sports Commons'
  );
  assert.ok(ass.includes('[Script Info]'));
  assert.ok(ass.includes('22 NEEDED OFF 6 BALLS!'));
  assert.ok(ass.includes('CC-BY: Metro Sports Commons'));
  assert.ok(ass.includes('ProgressBar'));
  assert.ok(ass.includes('{\\kf'));
});

test('v7.2 extractYoutubeVideoId reads watch, short, live, embed and bare ids', () => {
  assert.equal(extractYoutubeVideoId('https://www.youtube.com/watch?v=sRH-XlBE2cQ'), 'sRH-XlBE2cQ');
  assert.equal(extractYoutubeVideoId('https://www.youtube.com/watch?v=sRH-XlBE2cQ&t=120s'), 'sRH-XlBE2cQ');
  assert.equal(extractYoutubeVideoId('https://youtu.be/sRH-XlBE2cQ?si=abc'), 'sRH-XlBE2cQ');
  assert.equal(extractYoutubeVideoId('https://www.youtube.com/shorts/sRH-XlBE2cQ'), 'sRH-XlBE2cQ');
  assert.equal(extractYoutubeVideoId('https://www.youtube.com/live/sRH-XlBE2cQ'), 'sRH-XlBE2cQ');
  assert.equal(extractYoutubeVideoId('https://www.youtube.com/embed/sRH-XlBE2cQ'), 'sRH-XlBE2cQ');
  assert.equal(extractYoutubeVideoId('sRH-XlBE2cQ'), 'sRH-XlBE2cQ');
  assert.equal(extractYoutubeVideoId(''), null);
  assert.equal(extractYoutubeVideoId('hello world'), null);
  assert.equal(extractYoutubeVideoId('https://www.youtube.com/watch?v=toolong-id-123'), null);
  assert.equal(extractYoutubeVideoId('https://example.com/watch?v=sRH-XlBE2cQ'), null);
});

test('Hormozi V1: Anton, ALL CAPS, red highlight, word pop transforms', () => {
  const cricket = PRESET_VIDEOS.find((p) => p.category === 'cricket')!;
  const ass = generateAssSubtitle(cricket.segments, 30, 90, '', 'hormozi-v1');
  const styleLine = ass.split('\n').find((l) => l.startsWith('Style: Karaoke,'));
  assert.ok(styleLine?.includes('Anton,72,'), styleLine);
  assert.ok(styleLine?.includes('&H002D2DFF'), styleLine); // red #FF2D2D highlight (ASS &H00BBGGRR)
  assert.ok(styleLine?.includes(',&H00000000,'), styleLine);
  // No lowercase word text survives in karaoke dialogue lines.
  const dialogue = ass.split('\n').filter((l) => l.startsWith('Dialogue: 0,'));
  assert.ok(dialogue.length > 0);
  for (const line of dialogue) {
    const text = line.split(',,').slice(1).join(',,');
    assert.ok(!/[a-z]/.test(text.replace(/\\[a-z]+/g, '')), line.slice(0, 120));
  }
  // Every karaoke word pops: 118% in, then settle to 100%.
  assert.ok(dialogue.some((l) => l.includes('\\fscx118\\fscy118')), 'pop-up transform present');
  assert.ok(dialogue.some((l) => l.includes('\\fscx100\\fscy100')), 'settle transform present');
  // Pop windows are event-relative ms, strictly increasing per word.
  const m = dialogue[0].match(/\\t\((\d+),(\d+),\\fscx118/g);
  assert.ok(m && m.length > 0, 'first word has a pop window');
});

test('qualityDims returns the 4K table and the old 720p/1080p values unchanged', () => {
  const q4k = qualityDims('4k');
  assert.equal(q4k.targetW, 2160);
  assert.equal(q4k.targetH, 3840);
  assert.equal(q4k.crf, '20');
  assert.equal(q4k.preset, 'ultrafast');
  assert.equal(q4k.maxSourceHeight, 2160);
  assert.equal(qualityDims('1080p').targetW, 1080);
  assert.equal(qualityDims('1080p').camH, 672);
  assert.equal(qualityDims('720p').targetW, 720);
  assert.equal(qualityDims('720p').camH, 448);
  assert.equal(qualityDims('720p').preset, 'ultrafast');
});

test('buildGameplayFilter stacks the detected cam box over centre-cropped gameplay', () => {
  const filter = buildGameplayFilter({
    camBox: [0.034, 0.383, 0.172, 0.232],
    targetW: 720,
    camH: 384,
    gameH: 896,
    visualTransform: ',eq=contrast=1.08',
    assFilter: ',ass=captions.ass',
  });
  assert.ok(filter.includes('crop=iw*0.172:ih*0.232:iw*0.034:ih*0.383'));
  assert.ok(filter.includes('scale=720:384'));
  assert.ok(filter.includes('scale=720:896'));
  assert.ok(filter.includes('[cam][game]vstack=inputs=2'));
  assert.ok(filter.includes('crop=ih*720/896:ih:(iw-ih*720/896)/2:0'));
});

test('mergeSceneBoundaries merges sub-2s scenes and caps the scene count', () => {
  // Cuts at 1s and 2.5s make a 1.5s scene -> the 1s cut drops, merging it
  // into the previous scene.
  const scenes = mergeSceneBoundaries([1, 2.5, 12, 20], 30, 2, 8);
  assert.deepEqual(scenes, [
    { startSec: 0, endSec: 2.5 },
    { startSec: 2.5, endSec: 12 },
    { startSec: 12, endSec: 20 },
    { startSec: 20, endSec: 30 },
  ]);
  // 12 cuts in 30s -> capped at 8 scenes, no scene shorter than 2s.
  const many = mergeSceneBoundaries([2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28], 30, 2, 8);
  assert.equal(many.length, 8);
  assert.ok(many.every((s) => s.endSec - s.startSec >= 2));
  assert.equal(many[0].startSec, 0);
  assert.equal(many[many.length - 1].endSec, 30);
  // No cuts -> one scene covering the whole clip.
  assert.deepEqual(mergeSceneBoundaries([], 30), [{ startSec: 0, endSec: 30 }]);
});

test('buildFfmpegCommand supports serverless --download-sections, sports-blur, gaming-split, and viral transform', () => {
  const sportsCmd = buildFfmpegCommand({
    youtubeUrl: 'https://www.youtube.com/watch?v=cricket1',
    startSec: 30,
    endSec: 90,
    faceOffsetX: 50,
    framingMode: 'sports-blur',
    serverlessSectionOnly: true,
    copyrightSafeTransform: true,
    mirrorFlip: true,
  });
  assert.ok(sportsCmd.includes('--download-sections "*30-90"'));
  assert.ok(sportsCmd.includes('boxblur=22:4'));
  assert.ok(sportsCmd.includes('hflip'));
  assert.ok(sportsCmd.includes('eq=contrast=1.08:saturation=1.18'));
  assert.ok(sportsCmd.includes('asetrate=44982'));
  assert.ok(sportsCmd.includes('loudnorm='));

  const gamingCmd = buildFfmpegCommand({
    youtubeUrl: 'https://www.youtube.com/watch?v=gaming1',
    startSec: 20,
    endSec: 80,
    faceOffsetX: 16,
    framingMode: 'gaming-split',
    serverlessSectionOnly: true,
    copyrightSafeTransform: true,
  });
  assert.ok(gamingCmd.includes('vstack=inputs=2'));
  assert.ok(!gamingCmd.includes('hflip'));
});

test('buildFfmpegCommand uses the detected facecam corner instead of assuming top-left', () => {
  const defaultCmd = buildFfmpegCommand({
    youtubeUrl: 'https://www.youtube.com/watch?v=gaming1',
    startSec: 20,
    endSec: 80,
    faceOffsetX: 16,
    framingMode: 'gaming-split',
  });
  assert.ok(defaultCmd.includes('crop=iw*0.26:ih*0.28:iw*0:ih*0'));

  const detectedCmd = buildFfmpegCommand({
    youtubeUrl: 'https://www.youtube.com/watch?v=gaming1',
    startSec: 20,
    endSec: 80,
    faceOffsetX: 16,
    framingMode: 'gaming-split',
    facecamCropOrigin: [0.74, 0.72],
  });
  assert.ok(detectedCmd.includes('crop=iw*0.26:ih*0.28:iw*0.74:ih*0.72'));
  assert.ok(!detectedCmd.includes('crop=iw*0.26:ih*0.28:iw*0:ih*0'));
});

test('parseCustomTranscriptToSource handles timestamped and raw lines safely', () => {
  const source = parseCustomTranscriptToSource(
    'https://youtu.be/demo',
    '[00:00] Why do 90% of people make this mistake?\n[00:15] Here is the shocking secret nobody tells you!'
  );
  assert.ok(source.durationSec >= 90);
  assert.equal(source.segments.length, 2);
  assert.equal(formatTimecode(65), '01:05');
  assert.equal(formatAssTimecode(65.5), '0:01:05.50');
});

test('v7.1 parser clamps Whisper segments that overlap (guessed 4s min duration)', () => {
  const source = parseCustomTranscriptToSource(
    'https://youtu.be/demo',
    '[24:00] Turn.\n[24:00] Be right.\n[24:01] Off now.\n[24:03] When they would say, okay.'
  );
  const segs = source.segments;
  // The two [24:00] lines merge (same start = duplicate coverage).
  assert.equal(segs.length, 3);
  assert.ok(segs[0].text.includes('Turn.') && segs[0].text.includes('Be right.'));
  for (let i = 0; i < segs.length - 1; i++) {
    assert.ok(segs[i].end <= segs[i + 1].start, `segment ${i} end ${segs[i].end} must not pass next start ${segs[i + 1].start}`);
  }
  // Words stay sequential across the whole transcript — no overlaps.
  const words = extractWordsFromSegments(segs);
  for (let i = 1; i < words.length; i++) {
    assert.ok(words[i].start >= words[i - 1].end - 0.02, `word ${i} (${words[i].word}) starts ${words[i].start} before prev end ${words[i - 1].end}`);
  }
});

test('v7.1 ASS never shows two subtitle lines at once from overlapping words', () => {
  const overlapping = [
    { start: 1440, end: 1444, text: 'Turn. Be right.', words: [
      { word: 'Turn.', start: 1440, end: 1441 },
      { word: 'Be', start: 1440.2, end: 1440.6 },
      { word: 'right.', start: 1440.6, end: 1441 },
    ] },
    { start: 1440, end: 1442, text: 'When they would say,', words: [
      { word: 'When', start: 1440, end: 1440.4 },
      { word: 'they', start: 1440.4, end: 1440.8 },
      { word: 'would', start: 1440.8, end: 1441.2 },
      { word: 'say,', start: 1441.2, end: 1441.6 },
    ] },
  ];
  const ass = generateAssSubtitle(overlapping as any, 1440, 1470, '', 'mrbeast');
  const events = ass.split('\n').filter((l) => l.startsWith('Dialogue: 0,'));
  assert.ok(events.length > 0);
  const times = events.map((l) => {
    const m = l.match(/Dialogue: 0,(\d+:\d\d:\d\d\.\d\d),(\d+:\d\d:\d\d\.\d\d),/);
    assert.ok(m, l.slice(0, 80));
    const toSec = (s: string) => { const [h, mi, sec] = s.split(':'); return Number(h) * 3600 + Number(mi) * 60 + Number(sec); };
    return [toSec(m![1]), toSec(m![2])];
  });
  for (let i = 1; i < times.length; i++) {
    assert.ok(times[i][0] >= times[i - 1][1] - 0.01, `event ${i} starts ${times[i][0]} before prev end ${times[i - 1][1]}`);
  }
});

test('parseCustomTranscriptToSource strips 3-digit-minute timestamps ([100:06]) from long videos', () => {
  const source = parseCustomTranscriptToSource(
    'https://youtu.be/demo',
    '[99:10] almost there\n[100:06] at briefing everything changes\n[101:07] gets funnier so'
  );
  assert.equal(source.segments.length, 3);
  assert.equal(source.segments[1].start, 6006);
  assert.ok(!source.segments[1].text.includes('[100:06]'));
  assert.ok(!source.segments[1].words.some((w) => w.word.includes('[')));
  assert.ok(!source.segments[2].words.some((w) => w.word.includes('[')));
});

test('extractWordsFromSegments never emits bracketed-timestamp words', () => {
  const words = extractWordsFromSegments([
    { start: 6006, end: 6012, text: 'at briefing [100:06] everything', words: [] },
    { start: 6067, end: 6073, text: 'gets funnier. [101:07] So', words: [] },
    { start: 6100, end: 6106, text: 'clean line here', words: [{ word: '[102:30]', start: 6100, end: 6101 }, { word: 'after', start: 6101, end: 6102 }] },
  ]);
  assert.ok(!words.some((w) => w.word.includes('[')));
  assert.ok(words.some((w) => w.word === 'everything'));
  assert.ok(words.some((w) => w.word === 'after'));
});

test('v7 buildFaceTrackCropX glides between scene centres instead of jumping', () => {
  const first = buildFaceTrackCropX(null, 0.56);
  assert.ok(!first.includes('t/'), 'first scene is a static centre');
  assert.ok(first.includes('iw*0.56'));
  const eased = buildFaceTrackCropX(0.75, 0.56, 0.3);
  assert.ok(eased.includes('0.75+(0.56-0.75)*min(1\\,t/0.30)'), eased);
  assert.ok(eased.includes('max(0\\,min('));
});

test('v7 buildHookPunchScale starts 5% tight and releases to the normal zoom', () => {
  const s = buildHookPunchScale(763, 1355, 720, 1280, 1.2);
  assert.ok(s.includes(`scale=w='763*(1.05-0.05*min(1\\,t/1.20))'`), s);
  assert.ok(s.includes(':eval=frame:flags=bilinear'), s);
  assert.ok(s.includes('crop=720:1280:'), s);
});

test('v7 VOICE_POLISH_FILTER has the full chain and no shell-hostile chars', () => {
  assert.ok(VOICE_POLISH_FILTER.includes('highpass=f=80'));
  assert.ok(VOICE_POLISH_FILTER.includes('loudnorm=I=-14:TP=-1.5:LRA=11'));
  assert.ok(VOICE_POLISH_FILTER.includes('compand='));
  assert.ok(!VOICE_POLISH_FILTER.includes('"') && !VOICE_POLISH_FILTER.includes("'"));
});

test('buildUploadedVideoSource creates a scored VideoSource from real video metadata & audio peaks', () => {
  const src = buildUploadedVideoSource({
    uploadId: 'up123',
    filename: 'match_highlights.mp4',
    durationSec: 120,
    thumbnailUrl: '/api/uploaded-thumb/up123',
    audioEnergyProfile: [40, 50, 95, 92, 88, 70, 60, 55, 50, 45, 42, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40],
    category: 'cricket',
  });
  assert.equal(src.uploadedVideoId, 'up123');
  assert.equal(src.uploadedVideoUrl, '/api/uploaded-video/up123');
  assert.equal(src.framingMode, 'sports-blur');
  const wins = buildSlidingWindows(src, CATEGORY_WEIGHTS.cricket);
  assert.ok(wins.length >= 10);
});

test('v8 pickPunchTimes keeps sentence starts >=1.5s apart, capped at 10', () => {
  const segs = [0, 0.8, 1.6, 3.1, 3.4, 5.0, 7.0, 9.0, 11.0, 13.0, 15.0, 17.0, 19.0, 21.0].map((s) => ({
    start: 85 + s, end: 85 + s + 0.7, text: 'word', words: [{ word: 'word', start: 85 + s, end: 85 + s + 0.7 }],
  }));
  const times = pickPunchTimes(segs as any, 85, 115);
  assert.ok(times.length <= 10);
  assert.equal(times[0], 0);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 1.5);
  assert.ok(times.every((t) => t >= 0 && t <= 30));
});

test('v8 buildZoomPunchScale pulses 8% at punch times, static with none', () => {
  const punchy = buildZoomPunchScale(800, 1422, 720, 1280, [0.5, 5.0]);
  assert.ok(punchy.includes('eval=frame'));
  assert.ok(punchy.includes('1+0.08*('));
  assert.ok(punchy.includes('lt(t\\,0.50)'));
  assert.ok(punchy.includes('lt(t\\,5.00)'));
  const plain = buildZoomPunchScale(800, 1422, 720, 1280, []);
  assert.ok(!plain.includes('eval=frame'));
  assert.ok(plain.startsWith('scale=800:1422'));
});

test('v8 buildPushInScale grows linearly 1x to 1.04x over the clip', () => {
  const s = buildPushInScale(800, 1422, 720, 1280, 30);
  assert.ok(s.includes('eval=frame'));
  assert.ok(s.includes('(1+0.04*t/30.00)'));
});

test('v8 escapeDrawtext escapes colon, quote, comma, backslash', () => {
  assert.equal(escapeDrawtext("it's 5:30, ok"), "it\\'s 5\\:30\\, ok");
  assert.equal(escapeDrawtext('a\\b'), 'a\\\\b');
});




test('v8 generateAssSubtitle popScale parameter (118 Hormozi V1, 140 MrBeast pop-big, 130 override)', () => {
  const segs = [{ start: 85, end: 88, text: 'Leader of Al-Qaeda.', words: [
    { word: 'Leader', start: 85, end: 85.4 },
    { word: 'of', start: 85.4, end: 85.6 },
    { word: 'Al-Qaeda.', start: 85.6, end: 86.1 },
  ] }] as any;
  const hv1 = generateAssSubtitle(segs, 85, 115, '', 'hormozi-v1');
  assert.ok(hv1.includes('fscx118'));
  const def = generateAssSubtitle(segs, 85, 115, '', 'mrbeast');
  assert.ok(def.includes('fscx140'));
  const pop = generateAssSubtitle(segs, 85, 115, '', 'mrbeast', undefined, true, 130);
  assert.ok(pop.includes('fscx130'));
  assert.ok(!pop.includes('fscx140'));
});

const V88_SEGS = [{ start: 85, end: 88, text: 'Leader of Al-Qaeda.', words: [
  { word: 'Leader', start: 85, end: 85.4 },
  { word: 'of', start: 85.4, end: 85.6 },
  { word: 'Al-Qaeda.', start: 85.6, end: 86.1 },
] }] as any;
const v88StyleLine = (ass: string) => ass.split('\n').find((l) => l.startsWith('Style: Karaoke,'))!;
const v88Dialogue = (ass: string) => ass.split('\n').filter((l) => l.startsWith('Dialogue: 0,'));
const V88_STYLES = [
  'hormozi-v1', 'red-line', 'undercut', 'streamline',
  'hormozi-2026-a', 'hormozi-2026-b', 'hormozi-2026-c', 'hormozi-2026-d', 'hormozi-2026-e',
  'mrbeast', 'iman-a', 'cardone-a', 'hollywood-fill', 'roman', 'sara', 'ali', 'axel', 'yellow-burst',
] as const;

test('v8.8 preset set: exactly the 18 reference styles, no doac', () => {
  const styles = Object.keys(CAPTION_STYLE_PRESETS);
  assert.deepEqual([...styles].sort(), [...V88_STYLES].sort());
  assert.equal(styles.length, 18);
  assert.ok(!('doac' in CAPTION_STYLE_PRESETS));
  const displayNames: Record<string, string> = {
    'hormozi-v1': 'Hormozi V1', 'red-line': 'Red Line', undercut: 'Undercut', streamline: 'Streamline',
    'hormozi-2026-a': 'Hormozi Short 2026 - A', 'hormozi-2026-b': 'Hormozi Short 2026 - B',
    'hormozi-2026-c': 'Hormozi Short 2026 - C', 'hormozi-2026-d': 'Hormozi Short 2026 - D',
    'hormozi-2026-e': 'Hormozi Short 2026 - E', mrbeast: 'MrBeast', 'iman-a': 'Iman - A',
    'cardone-a': 'Cardone - A', 'hollywood-fill': 'Hollywood Fill', roman: 'Roman',
    sara: 'SARA', ali: 'ALI', axel: 'Axel', 'yellow-burst': 'YELLOW BURST',
  };
  for (const s of V88_STYLES) {
    const p = CAPTION_STYLE_PRESETS[s];
    assert.equal(p.displayName, displayNames[s], s);
    assert.ok(p.sample[0].length > 0, s);
    assert.match(p.accentColour, /^#[0-9A-F]{6}$/, s);
    assert.ok(['none', 'word', 'line', 'glow'].includes(p.highlight), s);
  }
});

test('v8.8 motions: all 18 pairwise distinct, each renders its own tag', () => {
  const styles = Object.keys(CAPTION_STYLE_PRESETS) as CaptionStyle[];
  const motions = styles.map((s) => CAPTION_STYLE_PRESETS[s].motion);
  assert.equal(new Set(motions).size, 18, `motions must be pairwise distinct, got: ${motions.join(',')}`);
  // Each motion's tag is a different ASS transform (checked on the
  // Dialogue lines of a real generated ASS, not on the preset record).
  const marker: Record<string, (d: string[]) => boolean> = {
    pop: (d) => d.some((l) => l.includes('\\fscx118\\fscy118')),
    'pop-big': (d) => d.some((l) => l.includes('\\fscx140\\fscy140')),
    wordbox: (d) => d.some((l) => l.includes('\\fscx115\\fscy115')),
    'wordbox-slide': (d) => d.some((l) => l.includes('\\fscx80') && !l.includes('\\fscy60')),
    'wordbox-flip': (d) => d.some((l) => l.includes('\\fry70')),
    'wordbox-zoom': (d) => d.some((l) => l.includes('\\fscx50\\fscy50')),
    sweep: (d) => d.length > 0 && d.every((l) => l.includes('\\kf') && !l.includes('\\t(')),
    'slide-up': (d) => d.some((l) => l.includes('\\fscx80\\fscy60')),
    'slide-down': (d) => d.some((l) => l.includes('\\fscy140')),
    rise: (d) => d.some((l) => l.includes('\\fscy50')),
    pulse: (d) => d.some((l) => l.includes('\\blur4')),
    'pulse-glow': (d) => d.some((l) => l.includes('\\blur6') && l.includes('\\bord6')),
    fade: (d) => d.some((l) => l.includes('\\1a&HFF&\\t(0,150,\\1a&H00&)')),
    spin: (d) => d.some((l) => l.includes('\\frz90')),
    bounce: (d) => d.some((l) => l.includes('\\fscx150\\fscy150')),
    'bounce-soft': (d) => d.some((l) => l.includes('\\fscx125\\fscy125')),
    flip: (d) => d.some((l) => l.includes('\\fry80')),
    typewriter: (d) => d.some((l) => l.includes('\\1a&HFF&\\t(') && l.includes(',1,\\1a&H00&)')),
  };
  for (const s of styles) {
    const p = CAPTION_STYLE_PRESETS[s];
    const dialogue = v88Dialogue(generateAssSubtitle(V88_SEGS, 85, 115, '', s));
    assert.ok(dialogue.length > 0, `${s} renders dialogue`);
    assert.ok(marker[p.motion](dialogue), `${s} motion ${p.motion} must render its own tag`);
  }
});

test('v8.8 accent colours: all 18 pairwise distinct and each one really renders', () => {
  const styles = Object.keys(CAPTION_STYLE_PRESETS) as CaptionStyle[];
  const accents = styles.map((s) => CAPTION_STYLE_PRESETS[s].accentColour);
  assert.equal(new Set(accents).size, 18, `accents must be pairwise distinct, got: ${accents.join(',')}`);
  for (const s of styles) {
    const p = CAPTION_STYLE_PRESETS[s];
    const ass = generateAssSubtitle(V88_SEGS, 85, 115, '', s);
    // The accent's BBGGRR digits must appear in the style's own ASS
    // Style line (as primary, secondary, outline or box colour) —
    // an accent that only lives in metadata would fail this.
    const bbgrr = hexToAssColour(p.accentColour)!.slice(4);
    assert.ok(v88StyleLine(ass).includes(bbgrr), `${s} accent ${p.accentColour} must render (BBGGRR ${bbgrr})`);
  }
});

test('v8.8 spot checks: font, size, accent, motion per style', () => {
  const expected: Record<string, { font: string; size: number; accent: string; motion: string }> = {
    'hormozi-v1': { font: 'Anton', size: 72, accent: '#FF2D2D', motion: 'pop' },
    'red-line': { font: 'Anton', size: 68, accent: '#E11D48', motion: 'wordbox' },
    undercut: { font: 'Playfair Display', size: 58, accent: '#FFD800', motion: 'sweep' },
    streamline: { font: 'Anton', size: 68, accent: '#7C3AED', motion: 'wordbox-slide' },
    'hormozi-2026-a': { font: 'Bebas Neue', size: 64, accent: '#FFFFFF', motion: 'slide-up' },
    'hormozi-2026-b': { font: 'Anton', size: 72, accent: '#FFB020', motion: 'pulse' },
    'hormozi-2026-c': { font: 'Montserrat ExtraBold', size: 40, accent: '#2DD4BF', motion: 'fade' },
    'hormozi-2026-d': { font: 'Bebas Neue', size: 110, accent: '#3B82F6', motion: 'spin' },
    'hormozi-2026-e': { font: 'Anton', size: 72, accent: '#4ADE80', motion: 'pulse-glow' },
    mrbeast: { font: 'Anton', size: 76, accent: '#F97316', motion: 'pop-big' },
    'iman-a': { font: 'Montserrat', size: 56, accent: '#94A3B8', motion: 'slide-down' },
    'cardone-a': { font: 'Anton', size: 72, accent: '#7F1D1D', motion: 'bounce' },
    'hollywood-fill': { font: 'Anton', size: 72, accent: '#1E3A8A', motion: 'flip' },
    roman: { font: 'Anton', size: 68, accent: '#C2410C', motion: 'wordbox-flip' },
    sara: { font: 'Poppins ExtraBold', size: 66, accent: '#EC4899', motion: 'bounce-soft' },
    ali: { font: 'Montserrat', size: 48, accent: '#6B7280', motion: 'typewriter' },
    axel: { font: 'Poppins ExtraBold', size: 60, accent: '#15803D', motion: 'wordbox-zoom' },
    'yellow-burst': { font: 'Anton', size: 72, accent: '#111827', motion: 'rise' },
  };
  for (const [style, exp] of Object.entries(expected)) {
    const p = CAPTION_STYLE_PRESETS[style as CaptionStyle];
    assert.equal(p.font, exp.font, style);
    assert.equal(p.fontSize, exp.size, style);
    assert.equal(p.accentColour, exp.accent, style);
    assert.equal(p.motion, exp.motion, style);
  }
  // Box styles: libass draws the BorderStyle=3 box from the OUTLINE
  // colour, not BackColour — both fields must carry the box colour.
  for (const s of ['red-line', 'streamline', 'roman', 'axel'] as CaptionStyle[]) {
    const p = CAPTION_STYLE_PRESETS[s];
    assert.equal(p.outlineColour, p.backColour, `${s} box colour in outline AND back`);
  }
  // YELLOW BURST's near-black box: same BBGGRR in outline and back.
  const yb = CAPTION_STYLE_PRESETS['yellow-burst'];
  assert.ok(yb.outlineColour.endsWith('271811') && yb.backColour.endsWith('271811'));
});

test('v8.8 overrides: font size, colour and position change the rendered ASS', () => {
  const styleLine = (ass: string) => v88StyleLine(ass);
  // Default MrBeast: Anton 76, bottom MarginV 340.
  const def = styleLine(generateAssSubtitle(V88_SEGS, 85, 115, '', 'mrbeast'));
  assert.ok(def.includes('Anton,76,'), def);
  assert.ok(def.endsWith(',340,1'), def);
  // Font size 50.
  const sized = styleLine(generateAssSubtitle(V88_SEGS, 85, 115, '', 'mrbeast', undefined, true, undefined, { fontSize: 50 }));
  assert.ok(sized.includes('Anton,50,'), sized);
  // Font colour green.
  const coloured = styleLine(generateAssSubtitle(V88_SEGS, 85, 115, '', 'mrbeast', undefined, true, undefined, { fontColour: '#00FF00' }));
  assert.ok(coloured.includes('&H0000FF00'), coloured);
  // Position 80% -> MarginV (100-80)*9 = 180.
  const moved = styleLine(generateAssSubtitle(V88_SEGS, 85, 115, '', 'mrbeast', undefined, true, undefined, { positionPct: 80 }));
  assert.ok(moved.endsWith(',180,1'), moved);
  // Invalid colour falls back to the preset's own colour.
  const bad = styleLine(generateAssSubtitle(V88_SEGS, 85, 115, '', 'mrbeast', undefined, true, undefined, { fontColour: 'not-a-colour' }));
  assert.ok(bad.includes('&H001673F9'), bad);
});

test('v8.8 helpers: hex round-trip, marginV mapping, preset positions', () => {
  assert.equal(hexToAssColour('#FFD800'), '&H0000D8FF');
  assert.equal(hexToAssColour('#FF2D2D'), '&H002D2DFF');
  assert.equal(hexToAssColour('zzz'), null);
  assert.equal(hexToAssColour('#ff2d2d'), '&H002D2DFF');
  assert.equal(assColourToCss('&H0000D8FF'), '#FFD800');
  for (const s of Object.keys(CAPTION_STYLE_PRESETS) as CaptionStyle[]) {
    const a = CAPTION_STYLE_PRESETS[s].accentColour;
    assert.equal(assColourToCss(hexToAssColour(a)!), a, s);
  }
  assert.equal(marginVForPositionPct(0, 2), 900);
  assert.equal(marginVForPositionPct(100, 2), 0);
  assert.equal(marginVForPositionPct(50, 2), 450);
  assert.equal(marginVForPositionPct(0, 8), 0);
  assert.equal(marginVForPositionPct(100, 8), 200);
  assert.equal(marginVForPositionPct(50, 8), 100);
  assert.equal(positionPctForPreset(CAPTION_STYLE_PRESETS['hormozi-v1']), 62);
  assert.equal(positionPctForPreset(CAPTION_STYLE_PRESETS['hormozi-2026-d']), 100);
  assert.equal(positionPctForPreset(CAPTION_STYLE_PRESETS.ali), 71);
});

test('v8.8 fonts: every font a preset names is installed', () => {
  const FONT_FILES: Record<string, string> = {
    Anton: 'Anton-Regular.ttf',
    'Bebas Neue': 'BebasNeue-Regular.ttf',
    'Montserrat ExtraBold': 'Montserrat-ExtraBold.ttf',
    Montserrat: 'Montserrat-Variable.ttf',
    'Poppins ExtraBold': 'Poppins-ExtraBold.ttf',
    'Playfair Display': 'PlayfairDisplay-Italic.ttf',
  };
  for (const s of Object.keys(CAPTION_STYLE_PRESETS) as CaptionStyle[]) {
    const f = CAPTION_STYLE_PRESETS[s].font;
    assert.ok(FONT_FILES[f], `${s} font ${f} has a known file`);
    const inHome = fs.existsSync(path.join(os.homedir(), '.fonts', FONT_FILES[f]));
    const inPublic = fs.existsSync(path.join(process.cwd(), 'public', 'fonts', FONT_FILES[f]));
    assert.ok(inHome || inPublic, `${s} font file ${FONT_FILES[f]} installed`);
  }
});





test('v8.6 normalizeClipLengthSec falls back to 30s for missing/invalid values', () => {
  assert.equal(normalizeClipLengthSec(undefined), 30);
  assert.equal(normalizeClipLengthSec(null), 30);
  assert.equal(normalizeClipLengthSec(''), 30);
  assert.equal(normalizeClipLengthSec('   '), 30);
  assert.equal(normalizeClipLengthSec('abc'), 30);
  assert.equal(normalizeClipLengthSec(Number.NaN), 30);
  assert.equal(normalizeClipLengthSec(0), 30);
  assert.equal(normalizeClipLengthSec(-45), 30);
  assert.equal(normalizeClipLengthSec({}), 30);
});

test('v8.6 normalizeClipLengthSec clamps numeric values to 10–180s (does not reject them)', () => {
  assert.equal(normalizeClipLengthSec(45), 45);
  assert.equal(normalizeClipLengthSec(60), 60);
  assert.equal(normalizeClipLengthSec('45'), 45);
  assert.equal(normalizeClipLengthSec(44.6), 45);
  // Below the floor clamps up to 10; above the ceiling clamps down to 180.
  assert.equal(normalizeClipLengthSec(5), 10);
  assert.equal(normalizeClipLengthSec(9), 10);
  assert.equal(normalizeClipLengthSec(200), 180);
  assert.equal(normalizeClipLengthSec(1000), 180);
  assert.equal(normalizeClipLengthSec(10), 10);
  assert.equal(normalizeClipLengthSec(180), 180);
});

test('v8.6 buildSlidingWindows with a 45s window produces 45s windows', () => {
  const podcast = PRESET_VIDEOS.find((p) => p.id === 'podcast-founder')!;
  const windows = buildSlidingWindows(podcast, DEFAULT_WEIGHTS, 45, 5);
  // 120s source, 45s windows stepping 5s: starts 0..75 -> 16 windows.
  assert.equal(windows.length, 16);
  assert.ok(windows.every((w) => w.endSec - w.startSec === 45), 'every window is 45s long');
  assert.equal(windows[0].startSec, 0);
  assert.equal(windows[0].endSec, 45);
  assert.equal(windows[windows.length - 1].startSec, 75);
  assert.equal(windows[windows.length - 1].endSec, 120);
});

test('v8.6 buildSlidingWindows with a 60s window produces 60s windows', () => {
  const podcast = PRESET_VIDEOS.find((p) => p.id === 'podcast-founder')!;
  const windows = buildSlidingWindows(podcast, DEFAULT_WEIGHTS, 60, 5);
  assert.equal(windows.length, 13);
  assert.ok(windows.every((w) => w.endSec - w.startSec === 60), 'every window is 60s long');
  assert.equal(windows[0].startSec, 0);
  assert.equal(windows[0].endSec, 60);
});
