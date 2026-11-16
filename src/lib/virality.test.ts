import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORY_WEIGHTS,
  DEFAULT_WEIGHTS,
  buildAutoFetchPack,
  buildDoacBlurFill,
  buildDoacSceneChain,
  buildFaceTrackCropX,
  buildFfmpegCommand,
  buildHookPunchScale,
  buildHookTitleDrawtext,
  buildPushInScale,
  buildSlidingWindows,
  buildUploadedVideoSource,
  buildZoomPunchScale,
  calculateWeightedScore,
  decideDoacShotLayout,
  doacFgHeight,
  evaluateCopyrightSafety,
  extractWordsFromSegments,
  extractYoutubeVideoId,
  escapeDrawtext,
  formatAssTimecode,
  formatTimecode,
  generateAssSubtitle,
  generateDoacSubtitle,
  mergeSceneBoundaries,
  buildGameplayFilter,
  measureTitleWidthEm,
  normalizeClipLengthSec,
  pickPunchTimes,
  qualityDims,
  parseCustomTranscriptToSource,
  reweightWindows,
  VOICE_POLISH_FILTER,
} from './virality';
import { PRESET_VIDEOS } from './presets';

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
    'karaoke',
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

test('Hormozi karaoke: Anton, ALL CAPS, black outline, word pop transforms', () => {
  const cricket = PRESET_VIDEOS.find((p) => p.category === 'cricket')!;
  const ass = generateAssSubtitle(cricket.segments, 30, 90, '', 'karaoke');
  const styleLine = ass.split('\n').find((l) => l.startsWith('Style: Karaoke,'));
  assert.ok(styleLine?.includes('Anton,72,'), styleLine);
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
  const ass = generateAssSubtitle(overlapping as any, 1440, 1470, '', 'karaoke');
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

test('v8 buildHookTitleDrawtext defaults to Anton + box, DOAC opts drop the box', () => {
  const def = buildHookTitleDrawtext('Leader of Al-Qaeda', 720, 1280);
  assert.ok(def.includes('fontfile=/home/hatch/.fonts/Anton-Regular.ttf'));
  assert.ok(def.includes('box=1'));
  assert.ok(def.includes('fontcolor=white'));
  assert.ok(def.includes("enable='between(t\\,0\\,2.5)'"));
  const doac = buildHookTitleDrawtext('A Soviet Grocery Store Had Only 77 Items', 720, 1280, 2.8, {
    fontfile: '/home/hatch/.fonts/ArchivoBlack-Regular.ttf',
    boxed: false,
    fontcolor: '0xFFD800',
  });
  assert.ok(doac.includes('fontfile=/home/hatch/.fonts/ArchivoBlack-Regular.ttf'));
  assert.ok(!doac.includes('box=1'));
  assert.ok(doac.includes('fontcolor=0xFFD800'));
  assert.equal(buildHookTitleDrawtext('   ', 720, 1280), '');
});

test('v8.1 title width matches measured Archivo Black metrics (1089px at 63px)', () => {
  assert.ok(Math.abs(measureTitleWidthEm('OF SEAL TEAM 6 WOULD COME', 'archivo') - 17.275) < 0.01);
  // 17.275em x 63px = 1088px on a 720px frame: the v8 sample overflowed.
  assert.ok(measureTitleWidthEm('OF SEAL TEAM 6 WOULD COME', 'archivo') * 63 > 720);
  // Same words in condensed Anton fit on one line.
  assert.ok(measureTitleWidthEm('LEADER OF AL-QAEDA', 'anton') * 63 <= 660);
});

test('v8.1 buildHookTitleDrawtext wraps long titles to two fitting lines', () => {
  const doacOpts = {
    fontfile: '/home/hatch/.fonts/ArchivoBlack-Regular.ttf',
    boxed: false,
    fontcolor: '0xFFD800',
  };
  const frag = buildHookTitleDrawtext('Of SEAL Team 6 would come', 720, 1280, 2.8, doacOpts);
  assert.equal((frag.match(/drawtext=/g) || []).length, 2);
  assert.ok(frag.includes('OF SEAL TEAM'));
  assert.ok(frag.includes('6 WOULD COME'));
  assert.ok(frag.includes('fontsize=63'));
  const mission = buildHookTitleDrawtext('The super secret mission', 720, 1280, 2.8, doacOpts);
  assert.equal((mission.match(/drawtext=/g) || []).length, 2);
  assert.ok(mission.includes('THE SUPER'));
  assert.ok(mission.includes('SECRET MISSION'));
  // The reference title itself needs a shrink: 1694px at 63px -> two 43px lines.
  const ref = buildHookTitleDrawtext('A Soviet Grocery Store Had Only 77 Items', 720, 1280, 2.8, doacOpts);
  assert.equal((ref.match(/drawtext=/g) || []).length, 2);
  assert.ok(ref.includes('fontsize=43'));
  assert.ok(ref.includes('A SOVIET GROCERY STORE'));
  assert.ok(ref.includes('HAD ONLY 77 ITEMS'));
  // Short Anton title stays a single drawtext, as before.
  const short = buildHookTitleDrawtext('Leader of Al-Qaeda', 720, 1280);
  assert.equal((short.match(/drawtext=/g) || []).length, 1);
});

test('v8 generateAssSubtitle popScale parameter (118 default, 130 punchy)', () => {
  const segs = [{ start: 85, end: 88, text: 'Leader of Al-Qaeda.', words: [
    { word: 'Leader', start: 85, end: 85.4 },
    { word: 'of', start: 85.4, end: 85.6 },
    { word: 'Al-Qaeda.', start: 85.6, end: 86.1 },
  ] }] as any;
  const def = generateAssSubtitle(segs, 85, 115, '', 'karaoke');
  assert.ok(def.includes('fscx118'));
  const pop = generateAssSubtitle(segs, 85, 115, '', 'karaoke', undefined, true, 130);
  assert.ok(pop.includes('fscx130'));
  assert.ok(!pop.includes('fscx118'));
});

test('v8.3 caption styles: seven distinct designs, real installed fonts', () => {
  const segs = [{ start: 85, end: 88, text: 'Leader of Al-Qaeda.', words: [
    { word: 'Leader', start: 85, end: 85.4 },
    { word: 'of', start: 85.4, end: 85.6 },
    { word: 'Al-Qaeda.', start: 85.6, end: 86.1 },
  ] }] as any;
  const styleLine = (ass: string) => ass.split('\n').find((l) => l.startsWith('Style: Karaoke,'))!;
  // Hormozi stays Anton yellow with pop.
  assert.ok(styleLine(generateAssSubtitle(segs, 85, 115, '', 'karaoke')).includes('Anton,72,'));
  // Minimal is Montserrat ExtraBold white, no pop (was DM Sans -> DejaVu fallback).
  const minimal = generateAssSubtitle(segs, 85, 115, '', 'minimal');
  assert.ok(styleLine(minimal).includes('Montserrat ExtraBold,54,'));
  const minimalWordEvents = minimal.split('\n').filter((l) => l.startsWith('Dialogue: 0,'));
  assert.ok(minimalWordEvents.length > 0);
  assert.ok(minimalWordEvents.every((l) => !l.includes('fscx')));
  // Lime Pop: Anton, lime highlight, stronger pop.
  const lime = generateAssSubtitle(segs, 85, 115, '', 'lime');
  assert.ok(styleLine(lime).includes('&H0035F1C6'));
  assert.ok(lime.includes('fscx130'));
  // Sentence: opaque-box style, one event per segment, full sentence text.
  // (v8.4: Outline 2 — libass draws no box with BorderStyle=3 + Outline=0.)
  const sentence = generateAssSubtitle(segs, 85, 115, '', 'sentence');
  assert.ok(styleLine(sentence).includes('Noto Sans,46,'));
  assert.ok(styleLine(sentence).includes(',3,2,0,2,60,60,260,1'));
  assert.ok(sentence.includes('Leader of Al-Qaeda.'));
  // Top karaoke: top-centre alignment, close to the top edge (v8.4: 150,
  // was 560 — captions landed ~29% down the frame, across faces).
  const top = generateAssSubtitle(segs, 85, 115, '', 'top');
  assert.ok(styleLine(top).includes(',1,5,0,8,60,60,150,1'));
  // Word Flash: Bebas Neue 120pt, middle-centre, one event per word.
  const flash = generateAssSubtitle(segs, 85, 115, '', 'flash');
  assert.ok(styleLine(flash).includes('Bebas Neue,120,'));
  assert.ok(styleLine(flash).includes(',1,6,0,5,60,60,0,1'));
  const flashEvents = flash.split('\n').filter((l) => l.startsWith('Dialogue: 0,'));
  assert.equal(flashEvents.length, 3);
});

test('v8 buildDoacBlurFill is a 4:5 centre crop on a blurred 9:16 fill', () => {
  const f720 = buildDoacBlurFill(720, 1280);
  assert.ok(f720.includes('boxblur=16:3[bg]'));
  assert.ok(f720.includes('crop=ih*4/5:ih:(iw-ih*4/5)/2:0'));
  assert.ok(f720.includes('scale=720:900'));
  assert.ok(f720.includes('[bg][fg]overlay=(W-w)/2:(H-h)/2'));
  const f1080 = buildDoacBlurFill(1080, 1920);
  assert.ok(f1080.includes('scale=1080:1350'));
});

test('v8.2 decideDoacShotLayout: two far-apart faces -> letterbox, single/close faces -> 4:5 crop', () => {
  // Measured on the Raj 800-830 source: two-shot faces at ~26% and ~77%
  // (w ~11) fall outside the centred 4:5 window [27.5, 72.5] of a 16:9 frame.
  assert.equal(decideDoacShotLayout([{ x: 26.2, w: 11.1 }, { x: 77.2, w: 11.1 }], 16 / 9), 'letterbox169');
  assert.equal(decideDoacShotLayout([{ x: 74.0, w: 11.4 }, { x: 26.5, w: 11.0 }], 16 / 9), 'letterbox169');
  // Single centred face fits the 4:5 window.
  assert.equal(decideDoacShotLayout([{ x: 53.6, w: 13.4 }], 16 / 9), 'crop45');
  assert.equal(decideDoacShotLayout([{ x: 55.6, w: 11.1 }], 16 / 9), 'crop45');
  // Two faces close together fit.
  assert.equal(decideDoacShotLayout([{ x: 45, w: 10 }, { x: 55, w: 10 }], 16 / 9), 'crop45');
  // No faces / unusable aspect fall back to the 4:5 crop.
  assert.equal(decideDoacShotLayout([], 16 / 9), 'crop45');
  assert.equal(decideDoacShotLayout([{ x: 26, w: 11 }, { x: 77, w: 11 }], Number.NaN), 'crop45');
  // One face at the extreme edge is cut by the centred crop -> letterbox.
  assert.equal(decideDoacShotLayout([{ x: 8, w: 12 }], 16 / 9), 'letterbox169');
  // A squarer source has a wider 4:5 window, so the same pair fits.
  assert.equal(decideDoacShotLayout([{ x: 26, w: 11 }, { x: 77, w: 11 }], 1.0), 'crop45');
});

test('v8.2 buildDoacSceneChain: letterbox is 720x405, crop45 is the 4:5 chain', () => {
  assert.equal(doacFgHeight(720, 'crop45'), 900);
  assert.equal(doacFgHeight(720, 'letterbox169'), 405);
  const crop = buildDoacSceneChain(0, 0, 4.5, 'crop45', 720, 1280);
  assert.ok(crop.includes('[0:v]trim=start=0.00:end=4.50,setpts=PTS-STARTPTS,split=2[sin0a][sin0b]'));
  assert.ok(crop.includes('crop=ih*4/5:ih:(iw-ih*4/5)/2:0,scale=720:900'));
  assert.ok(crop.includes('boxblur=16:3[bg0]'));
  assert.ok(crop.includes('[bg0][fg0]overlay=(W-w)/2:(H-h)/2,setsar=1[v0]'));
  const box = buildDoacSceneChain(1, 4.5, 21.94, 'letterbox169', 720, 1280);
  assert.ok(box.includes('trim=start=4.50:end=21.94'));
  assert.ok(box.includes('scale=720:405:force_original_aspect_ratio=increase,crop=720:405'));
  assert.ok(!box.includes('crop=ih*4/5'));
  // v8.4: setsar=1 on every concat input — the hook punch-in scale and the
  // plain scale produce different SARs on 720p sources, and concat
  // rejects mismatched SARs with ffmpeg -22 ("no packets").
  assert.ok(box.includes('[bg1][fg1]overlay=(W-w)/2:(H-h)/2,setsar=1[v1]'));
});

test('v8 generateDoacSubtitle: Archivo Black, below-picture, highlight only, no extras', () => {
  const segs = [{ start: 85, end: 88, text: 'Leader of Al-Qaeda.', words: [
    { word: 'Leader', start: 85, end: 85.4 },
    { word: 'of', start: 85.4, end: 85.6 },
    { word: 'Al-Qaeda.', start: 85.6, end: 86.1 },
  ] }] as any;
  const ass = generateDoacSubtitle(segs, 85, 115);
  assert.ok(ass.includes('Style: Doac,Archivo Black,80,&H0000D7FF'));
  assert.ok(ass.includes(',60,60,160,1'));
  assert.ok(ass.includes('LEADER'));
  assert.ok(!ass.includes('\\t('), 'DOAC captions have no pop transforms');
  assert.ok(!ass.includes('ProgressBar'));
  assert.ok(!ass.includes('HookBanner'));
  const events = ass.split('\n').filter((l) => l.startsWith('Dialogue: 0,'));
  assert.ok(events.length > 0);
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
