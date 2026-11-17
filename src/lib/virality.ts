import type {
  AutoFetchPackItem,
  CaptionOverrides,
  CaptionStyle,
  CopyrightEvaluation,
  FramingMode,
  ScoringWeights,
  SlidingWindow,
  TranscriptSegment,
  TranscriptWord,
  VideoCategory,
  VideoSource,
} from './types';

export const DEFAULT_WEIGHTS: ScoringWeights = {
  hook: 0.4,
  emotion: 0.3,
  audio: 0.2,
  pacing: 0.1,
};

export const CATEGORY_WEIGHTS: Record<VideoCategory, ScoringWeights> = {
  podcast: { hook: 0.4, emotion: 0.3, audio: 0.2, pacing: 0.1 },
  cricket: { hook: 0.2, emotion: 0.2, audio: 0.45, pacing: 0.15 },
  boxing: { hook: 0.2, emotion: 0.2, audio: 0.45, pacing: 0.15 },
  football: { hook: 0.2, emotion: 0.2, audio: 0.45, pacing: 0.15 },
  gaming: { hook: 0.35, emotion: 0.25, audio: 0.3, pacing: 0.1 },
};

const BLOCKED_RIGHTS_HOLDERS = [
  'icc',
  'bcci',
  'star sports',
  'sony sports',
  'uefa',
  'premier league',
  'fifa',
  'la liga',
  'espn',
  'dazn',
  'sky sports',
  'ufc',
  'top rank',
  'showtime sports',
  't-series',
];

const EMOTION_LEXICON: Record<string, number> = {
  secret: 18,
  mistake: 17,
  shocking: 19,
  never: 12,
  truth: 15,
  exposed: 19,
  insane: 18,
  failed: 16,
  fail: 15,
  win: 14,
  won: 14,
  million: 15,
  zero: 13,
  broke: 16,
  dangerous: 17,
  trap: 16,
  crazy: 15,
  honest: 12,
  actually: 10,
  warning: 16,
  stop: 12,
  hidden: 15,
  biggest: 14,
  why: 10,
  unbelievable: 18,
  laugh: 13,
  scary: 16,
  lost: 14,
  profit: 13,
  growth: 11,
  viral: 14,
  free: 11,
  six: 16,
  wicket: 18,
  yorker: 16,
  knockout: 19,
  ko: 18,
  uppercut: 17,
  hook: 14,
  goal: 18,
  penalty: 17,
  save: 16,
  clutch: 18,
  boss: 15,
  ace: 17,
  comeback: 18,
  ভুল: 17,
  গোপন: 18,
  সত্যি: 15,
  অবাক: 17,
  ক্ষতি: 16,
  লাভ: 14,
  সাবধান: 16,
  কেন: 11,
  ফ্রি: 12,
  টাকা: 14,
  ছক্কা: 18,
  উইকেট: 18,
  গোল: 18,
};

const HOOK_PATTERNS: Array<{ pattern: RegExp; weight: number; label: string }> = [
  { pattern: /\?/, weight: 22, label: 'Opening question' },
  { pattern: /\b\d+(%|x|k|m|b|crore|lakh|thousand|million)?\b/i, weight: 20, label: 'Concrete stat / number' },
  {
    pattern: /\b(never|stop|nobody|secret|mistake|truth|don't|do not|won't believe|why)\b/i,
    weight: 24,
    label: 'Pattern interrupt / curiosity gap',
  },
  {
    pattern: /\b(six|wicket|knockout|uppercut|goal|penalty|clutch|last ball|final second|comeback)\b/i,
    weight: 23,
    label: 'High-stakes sports/gaming climax',
  },
  {
    pattern: /(কেন|কখনো|ভুল|গোপন|সত্যি|জানেন কি|ছক্কা|উইকেট|গোল)/,
    weight: 24,
    label: 'Bengali curiosity / action hook',
  },
  { pattern: /!/, weight: 12, label: 'High-energy exclamation' },
];

export function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

export function formatTimecode(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatAssTimecode(seconds: number): string {
  const safe = Math.max(0, seconds);
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const centis = Math.round((safe - Math.floor(safe)) * 100) % 100;
  return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
}

/**
 * ClipPulse v7.2 — pull the 11-char video id out of a pasted YouTube URL
 * (watch?v=, youtu.be/, /shorts/, /live/, /embed/) or a bare id, for the
 * simple tool's paste-a-link flow. Returns null for anything else.
 */
export function extractYoutubeVideoId(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const id = '[A-Za-z0-9_-]{11}';
  // Only real YouTube hosts (or a bare id) — a ?v= on another domain is not a video link.
  const isYoutubeHost = /^(https?:\/\/)?(www\.|m\.)?(youtube\.com|youtu\.be)\//.test(text);
  const isBareId = new RegExp(`^${id}$`).test(text);
  if (!isYoutubeHost && !isBareId) return null;
  const end = '(?![A-Za-z0-9_-])';
  const patterns = [
    new RegExp(`[?&]v=(${id})${end}`),
    new RegExp(`youtu\\.be/(${id})${end}`),
    new RegExp(`youtube\\.com/(?:shorts|live|embed)/(${id})${end}`),
    new RegExp(`^(${id})$`),
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1];
  }
  return null;
}

export function extractWordsFromSegments(segments: TranscriptSegment[]): TranscriptWord[] {
  const words: TranscriptWord[] = [];
  for (const seg of segments) {
    if (seg.words && seg.words.length > 0) {
      // Drop any bracketed-timestamp token that slipped into pre-built
      // words (same [100:06] leak as the text path below).
      words.push(...seg.words.filter((w) => !/^\[\d{1,3}:\d{2}(:\d{2})?\]$/.test(w.word)));
    } else {
      // ClipPulse v6 fix — Whisper/transcript lines can carry bracketed
      // timestamps ([100:06]) that survive as subtitle words; strip them
      // here so no timestamp token ever reaches a caption or a score.
      const tokens = seg.text
        .trim()
        .split(/\s+/)
        .map((t) => t.replace(/\[\d{1,3}:\d{2}(?::\d{2})?\]/g, ''))
        .filter(Boolean);
      const dur = Math.max(0.5, seg.end - seg.start);
      const step = dur / Math.max(1, tokens.length);
      tokens.forEach((word, idx) => {
        words.push({
          word,
          start: Number((seg.start + idx * step).toFixed(2)),
          end: Number((seg.start + (idx + 1) * step).toFixed(2)),
        });
      });
    }
  }
  return words;
}

export function scoreEmotionVaderLite(text: string): { score: number; matchedKeywords: string[] } {
  const lower = text.toLowerCase();
  const tokens = lower.replace(/[.,!?"'():;]/g, ' ').split(/\s+/).filter(Boolean);
  const matched = new Set<string>();
  let raw = 28;

  for (const token of tokens) {
    if (EMOTION_LEXICON[token]) {
      raw += EMOTION_LEXICON[token];
      matched.add(token);
    }
  }

  const exclamations = (text.match(/!/g) || []).length;
  const questions = (text.match(/\?/g) || []).length;
  raw += Math.min(18, exclamations * 6 + questions * 4);

  return {
    score: clampScore(raw),
    matchedKeywords: Array.from(matched).slice(0, 5),
  };
}

export function scoreHeuristicHook(openingText: string): { score: number; reason: string } {
  let raw = 32;
  const reasons: string[] = [];

  for (const rule of HOOK_PATTERNS) {
    if (rule.pattern.test(openingText)) {
      raw += rule.weight;
      reasons.push(rule.label);
    }
  }

  if (openingText.length > 10 && openingText.length < 180) {
    raw += 8;
  }

  return {
    score: clampScore(raw),
    reason: reasons.length > 0 ? reasons.slice(0, 2).join(' + ') : 'Conversational narrative lead',
  };
}

export function computePacingScore(wordCount: number, durationSec: number): { score: number; wpm: number } {
  const safeDur = Math.max(1, durationSec);
  const wpm = Math.round((wordCount / safeDur) * 60);
  let score = 40;
  if (wpm >= 130 && wpm <= 195) {
    score = 78 + ((195 - Math.abs(165 - wpm)) / 195) * 20;
  } else if (wpm > 195) {
    score = 88;
  } else {
    score = 30 + (wpm / 130) * 45;
  }
  return {
    score: clampScore(score),
    wpm,
  };
}

export function computeAudioEnergyScore(profile: number[], startSec: number, endSec: number): number {
  if (!profile || profile.length === 0) return 60;
  const startIdx = Math.max(0, Math.floor(startSec / 5));
  const endIdx = Math.min(profile.length - 1, Math.floor(endSec / 5));
  const slice = profile.slice(startIdx, endIdx + 1);
  if (slice.length === 0) return 60;
  const avg = slice.reduce((acc, v) => acc + v, 0) / slice.length;
  const peak = Math.max(...slice);
  return clampScore(avg * 0.6 + peak * 0.4);
}

export function computeFaceOffsetForWindow(profile: number[], startSec: number, endSec: number): number {
  if (!profile || profile.length === 0) return 50;
  const startIdx = Math.max(0, Math.floor(startSec / 5));
  const endIdx = Math.min(profile.length - 1, Math.floor(endSec / 5));
  const slice = profile.slice(startIdx, endIdx + 1);
  if (slice.length === 0) return 50;
  const avg = slice.reduce((acc, v) => acc + v, 0) / slice.length;
  return Math.round(Math.max(15, Math.min(85, avg)));
}

export function calculateWeightedScore(
  factors: { hook: number; emotion: number; audio: number; pacing: number },
  weights: ScoringWeights
): number {
  const sumWeights = weights.hook + weights.emotion + weights.audio + weights.pacing;
  if (sumWeights <= 0) return 0;
  const raw =
    (factors.hook * weights.hook +
      factors.emotion * weights.emotion +
      factors.audio * weights.audio +
      factors.pacing * weights.pacing) /
    sumWeights;
  return clampScore(raw);
}

export function evaluateCopyrightSafety(source: Pick<VideoSource, 'channel' | 'title' | 'licenseStatus' | 'licenseNote'>): CopyrightEvaluation {
  const combined = `${source.channel} ${source.title}`.toLowerCase();
  const blockedMatch = BLOCKED_RIGHTS_HOLDERS.find((kw) => {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(combined);
  });

  if (blockedMatch || source.licenseStatus === 'broadcast-risk') {
    return {
      safe: false,
      status: 'broadcast-risk',
      label: 'Broadcast Risk',
      summary: blockedMatch
        ? `Matches protected rights holder (${blockedMatch.toUpperCase()}). Auto-skipped in CC-BY mode.`
        : 'Flagged as commercial broadcast feed; use CC-BY or transformative commentary.',
    };
  }

  if (source.licenseStatus === 'cc-by') {
    return {
      safe: true,
      status: 'cc-by',
      label: 'CC-BY Verified',
      summary: source.licenseNote || 'Creative Commons Attribution (CC-BY) — safe for cross-platform reuse with attribution.',
    };
  }

  return {
    safe: true,
    status: 'indie-safe',
    label: 'Creator Safe',
    summary: source.licenseNote || 'Independent creator / public domain clip with transformative captions.',
  };
}

// ClipPulse v8.6 — clip length: the user asked for 30s / 45s / 60s / custom.
// One normaliser owns the rule everywhere (server routes, UI picker, tests):
//   - missing, non-numeric, zero or negative input -> 30s (the default)
//   - a numeric value outside 10–180s is CLAMPED to that range, not
//     rejected — so a stray 5 becomes 10 and 300 becomes 180.
//   - whole seconds only (44.6 -> 45).
export const CLIP_LENGTH_MIN_SEC = 10;
export const CLIP_LENGTH_MAX_SEC = 180;
export const CLIP_LENGTH_DEFAULT_SEC = 30;
export const CLIP_LENGTH_PRESETS = [30, 45, 60] as const;

export function normalizeClipLengthSec(value: unknown): number {
  let n: number;
  if (typeof value === 'number') {
    n = value;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return CLIP_LENGTH_DEFAULT_SEC;
    n = Number(trimmed);
  } else {
    return CLIP_LENGTH_DEFAULT_SEC;
  }
  if (!Number.isFinite(n) || n <= 0) return CLIP_LENGTH_DEFAULT_SEC;
  return Math.min(CLIP_LENGTH_MAX_SEC, Math.max(CLIP_LENGTH_MIN_SEC, Math.round(n)));
}

export function buildSlidingWindows(
  source: VideoSource,
  weights: ScoringWeights = CATEGORY_WEIGHTS[source.category] || DEFAULT_WEIGHTS,
  windowSec = 60,
  stepSec = 5
): SlidingWindow[] {
  const allWords = extractWordsFromSegments(source.segments);
  const totalDuration = Math.max(windowSec, source.durationSec);
  const windows: SlidingWindow[] = [];

  for (let start = 0; start + windowSec <= totalDuration; start += stepSec) {
    const end = start + windowSec;
    const wordsInWindow = allWords.filter((w) => w.start >= start && w.start < end);
    const transcriptText = wordsInWindow.map((w) => w.word).join(' ').trim();
    const openingText = wordsInWindow
      .filter((w) => w.start < start + 10)
      .map((w) => w.word)
      .join(' ')
      .trim();

    const preset = source.presetHooks?.[String(start)];
    const heuristicHook = scoreHeuristicHook(openingText || transcriptText);
    const hookScore = preset ? preset.hookScore : heuristicHook.score;
    const hookReason = preset ? preset.reason : heuristicHook.reason;
    const suggestedHooks = preset
      ? preset.hooks
      : [
          openingText.split(/[.!?]/)[0]?.slice(0, 64) || 'Wait until you see this moment',
          'Watch what happened in the final 10 seconds',
          'Nobody expected this turn right here',
        ];

    const emotionRes = scoreEmotionVaderLite(transcriptText);
    const pacingRes = computePacingScore(wordsInWindow.length, windowSec);
    const audioScore = computeAudioEnergyScore(source.audioEnergyProfile, start, end);
    const faceOffsetX = computeFaceOffsetForWindow(source.faceTrackProfile, start, end);

    const factors = {
      hook: hookScore,
      emotion: emotionRes.score,
      audio: audioScore,
      pacing: pacingRes.score,
    };

    windows.push({
      id: `win-${start}-${end}`,
      startSec: start,
      endSec: end,
      transcriptText,
      wordCount: wordsInWindow.length,
      wordsPerMinute: pacingRes.wpm,
      factors,
      totalScore: calculateWeightedScore(factors, weights),
      hookReason,
      suggestedHooks,
      matchedKeywords: emotionRes.matchedKeywords,
      faceOffsetX,
    });
  }

  return windows;
}

export function reweightWindows(windows: SlidingWindow[], weights: ScoringWeights): SlidingWindow[] {
  return windows.map((win) => ({
    ...win,
    totalScore: calculateWeightedScore(win.factors, weights),
  }));
}

export function buildAutoFetchPack(
  sources: VideoSource[],
  categories: VideoCategory[] = ['cricket', 'boxing', 'football', 'gaming'],
  ccOnly = true
): AutoFetchPackItem[] {
  const pack: AutoFetchPackItem[] = [];

  for (const cat of categories) {
    const candidates = sources.filter((s) => s.category === cat);
    const eligible = ccOnly
      ? candidates.filter((s) => evaluateCopyrightSafety(s).safe)
      : candidates;
    const chosen = eligible[0] || candidates[0];
    if (!chosen) continue;

    const weights = CATEGORY_WEIGHTS[cat] || DEFAULT_WEIGHTS;
    const windows = buildSlidingWindows(chosen, weights);
    const sorted = [...windows].sort((a, b) => b.totalScore - a.totalScore);
    const topWindow = sorted[0];
    if (!topWindow) continue;

    pack.push({
      category: cat,
      source: chosen,
      topWindow,
      windows,
      copyright: evaluateCopyrightSafety(chosen),
    });
  }

  return pack;
}

export function parseCustomTranscriptToSource(
  youtubeUrl: string,
  rawTranscript: string,
  title = 'Custom Video Transcript',
  channel = 'Creator Studio',
  category: VideoCategory = 'podcast'
): VideoSource {
  const lines = rawTranscript
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const segments: TranscriptSegment[] = [];
  let cursor = 0;

  for (const line of lines) {
    const match = line.match(/^\[?(\d{1,3}):(\d{2})\]?\s*(.+)$/);
    let cleanText = line;
    let start = cursor;
    if (match) {
      start = Number(match[1]) * 60 + Number(match[2]);
      cleanText = match[3].trim();
    }
    const tokens = cleanText.split(/\s+/).filter(Boolean);
    const duration = Math.max(4, Math.round(tokens.length / 2.6));
    const end = start + duration;
    const step = duration / Math.max(1, tokens.length);
    const words: TranscriptWord[] = tokens.map((word, idx) => ({
      word,
      start: Number((start + idx * step).toFixed(2)),
      end: Number((start + (idx + 1) * step).toFixed(2)),
    }));
    segments.push({ start, end, text: cleanText, words });
    cursor = end;
  }

  // ClipPulse v7.1 — Whisper returns many short segments 0.2–1s apart, but
  // the duration above is GUESSED (min 4s per segment), so every segment
  // overlapped the next 1–2 segments and their even-spread words
  // interleaved — the ASS then showed two subtitle lines at once at the
  // start of a clip (caught live: "TURN. BE RIGHT. OFF." + "WHEN THEY
  // WOULD SAY," both starting at clip 0.00s). A segment is a timeline:
  // merge same-start duplicates, then clamp each one's end to the next
  // segment's start and re-spread its words inside the clamped span.
  // Last segment keeps its guessed end.
  const respace = (seg: TranscriptSegment) => {
    const tokens = seg.text.split(/\s+/).filter(Boolean);
    const dur = Math.max(0.1, seg.end - seg.start);
    const step = dur / Math.max(1, tokens.length);
    seg.words = tokens.map((word, idx) => ({
      word,
      start: Number((seg.start + idx * step).toFixed(2)),
      end: Number((seg.start + (idx + 1) * step).toFixed(2)),
    }));
  };
  segments.sort((a, b) => a.start - b.start);
  const merged: TranscriptSegment[] = [];
  for (const seg of segments) {
    const last = merged[merged.length - 1];
    if (last && last.start === seg.start) {
      last.text = `${last.text} ${seg.text}`.trim();
      last.end = Math.max(last.end, seg.end);
      respace(last);
    } else {
      merged.push(seg);
    }
  }
  segments.length = 0;
  segments.push(...merged);
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    const nextStart = segments[i + 1].start;
    if (seg.end > nextStart) {
      seg.end = nextStart;
      respace(seg);
    }
  }

  const totalDuration = Math.max(90, Math.ceil(cursor / 5) * 5);
  const bucketCount = Math.ceil(totalDuration / 5);
  const audioEnergyProfile = Array.from({ length: bucketCount }, (_, i) => {
    const t = i * 5;
    const seg = segments.find((s) => t >= s.start && t <= s.end);
    const hasBang = seg?.text.includes('!') || seg?.text.includes('?') ? 22 : 0;
    return clampScore(52 + ((i * 19) % 28) + hasBang);
  });

  const faceTrackProfile = Array.from({ length: bucketCount }, (_, i) => 46 + ((i * 7) % 10));

  const framingMode: FramingMode =
    category === 'gaming'
      ? 'gaming-split'
      : category === 'podcast'
        ? 'face-track'
        : 'sports-blur';

  return {
    id: `custom-${Date.now()}`,
    title,
    channel,
    category,
    framingMode,
    licenseStatus: 'indie-safe',
    licenseNote: 'Custom user-provided source transcript',
    youtubeUrl: youtubeUrl || 'https://www.youtube.com/watch?v=custom-input',
    durationSec: totalDuration,
    thumbnailUrl: '',
    fallbackGradient: 'from-slate-800 via-slate-900 to-zinc-950',
    transcriptSource: 'custom-paste',
    segments,
    audioEnergyProfile,
    faceTrackProfile,
  };
}

export function buildUploadedVideoSource(params: {
  uploadId: string;
  filename: string;
  durationSec: number;
  thumbnailUrl: string;
  audioEnergyProfile: number[];
  category: VideoCategory;
  rawTranscript?: string;
}): VideoSource {
  const safeDuration = Math.max(60, Math.round(params.durationSec));
  const framingMode: FramingMode =
    params.category === 'gaming'
      ? 'gaming-split'
      : params.category === 'podcast'
        ? 'face-track'
        : 'sports-blur';

  let segments: TranscriptSegment[] = [];
  if (params.rawTranscript && params.rawTranscript.trim()) {
    const parsed = parseCustomTranscriptToSource(
      '',
      params.rawTranscript,
      params.filename,
      'Local Video Upload',
      params.category
    );
    segments = parsed.segments;
  } else {
    // Build placeholder timeline cues aligned to audio peaks until transcript is pasted or Gemini transcribed
    const bucketCount = Math.ceil(safeDuration / 15);
    segments = Array.from({ length: bucketCount }, (_, i) => {
      const start = i * 15;
      const end = Math.min(safeDuration, (i + 1) * 15);
      const peakBucket = params.audioEnergyProfile[Math.floor(start / 5)] ?? 60;
      const text =
        peakBucket >= 80
          ? `[${formatTimecode(start)}] Peak audio moment (${peakBucket}% energy) — highlight climax!`
          : `[${formatTimecode(start)}] Scene segment ${i + 1}`;
      return {
        start,
        end,
        text,
        words: extractWordsFromSegments([{ start, end, text, words: [] }]),
      };
    });
  }

  const bucketCount = Math.max(12, Math.ceil(safeDuration / 5));
  const audioEnergyProfile =
    params.audioEnergyProfile.length > 0
      ? params.audioEnergyProfile
      : Array.from({ length: bucketCount }, () => 65);
  const faceTrackProfile = Array.from({ length: bucketCount }, () =>
    params.category === 'gaming' ? 20 : 50
  );

  return {
    id: `upload-${params.uploadId}`,
    title: params.filename.replace(/\.[^.]+$/, ''),
    channel: 'Uploaded Video (.MP4)',
    category: params.category,
    framingMode,
    licenseStatus: 'indie-safe',
    licenseNote: 'Real Uploaded Video — Pro Viral FFmpeg Transform Ready',
    youtubeUrl: `https://www.youtube.com/watch?v=upload-${params.uploadId}`,
    uploadedVideoId: params.uploadId,
    uploadedVideoUrl: `/api/uploaded-video/${params.uploadId}`,
    durationSec: safeDuration,
    thumbnailUrl: params.thumbnailUrl,
    fallbackGradient: 'from-slate-800 via-slate-900 to-zinc-950',
    transcriptSource: params.rawTranscript?.trim() ? 'faster-whisper' : 'custom-paste',
    segments,
    audioEnergyProfile,
    faceTrackProfile,
  };
}

/** Per-word motion — USER RULE (v8.8): 18 styles means 18 DIFFERENT
 * motions, pairwise distinct, no sharing. Each value maps to its own
 * \t transform in motionTag below (scale, rotation, blur, alpha and
 * timing all differ), so every style moves differently on screen.
 * 'wordbox*' are the four box styles' motions (the box follows the
 * spoken word, one word per event); 'typewriter' snaps each word on
 * like a keystroke (invisible until its moment, unlike 'sweep' where
 * unspoken words sit dimmed in the secondary colour). */
export type CaptionMotion =
  | 'pop' | 'pop-big' | 'wordbox' | 'wordbox-slide' | 'wordbox-flip' | 'wordbox-zoom'
  | 'sweep' | 'slide-up' | 'slide-down' | 'rise' | 'pulse' | 'pulse-glow'
  | 'fade' | 'spin' | 'bounce' | 'bounce-soft' | 'flip' | 'typewriter';

/** How the gallery card shows the style's highlight. 'word': the
 * highlight box sits behind the spoken word (follows it in the video).
 * 'line': the whole caption line sits on one box. 'glow': the text
 * glows in the highlight colour. 'none': no box or glow. */
export type CaptionHighlight = 'none' | 'word' | 'line' | 'glow';

export interface CaptionStylePreset {
  /** Name shown on the gallery card, exactly as in the reference. */
  displayName: string;
  /** Gallery-card sample split: [first line, second line], e.g. ['WATCH', 'THIS NOW']. */
  sample: [string, string];
  highlight: CaptionHighlight;
  /** CSS hex of the highlight (box/glow colour), '' when highlight is 'none'. */
  highlightCss: string;
  /** The style's ONE signature colour (CSS hex). USER RULE (v8.8): all
   * 18 accents are pairwise distinct — no two styles share a colour.
   * The accent is always a colour the render really shows: the active
   * word, the box, the glow, the outline, or the secondary (unspoken)
   * words — the v8.8 tests assert it appears in the generated ASS. */
  accentColour: string;
  font: string;
  fontSize: number;
  /** ASS colour &HAABBGGRR of the active word. */
  primaryColour: string;
  /** ASS colour of not-yet-spoken words — the \kf sweep fills from this to primaryColour. */
  secondaryColour: string;
  outlineColour: string;
  outlineW: number;
  shadowW: number;
  /** ASS alignment: 1 bottom-left, 2 bottom-centre, 8 top-centre, 5 middle-centre. */
  alignment: number;
  marginV: number;
  /** 1 outline, 3 opaque box. libass draws the box from OutlineColour,
   * not BackColour — a coloured box needs the colour in both fields. */
  borderStyle: number;
  backColour: string;
  uppercase: boolean;
  /** Bold (-1) / not-bold (0) in the ASS Style line. */
  bold: boolean;
  /** Italic (-1) / upright (0) in the ASS Style line. */
  italic: boolean;
  motion: CaptionMotion;
  popScale: number;
  mode: 'karaoke' | 'sentence' | 'flash' | 'wordbox';
}

/**
 * ClipPulse v8.8 — the 18 named styles from the reference gallery.
 * USER RULE: 18 styles means 18 DIFFERENT motions and 18 DIFFERENT
 * accent colours — pairwise distinct across the whole set, asserted by
 * the v8.8 tests. The reference itself repeats colours (white on many
 * cards, yellow on several), so where the reference's look would
 * collide, the style keeps its shape/font/motion and takes the nearest
 * distinct colour instead — the deviations are: 2026-C teal (not
 * white), MrBeast orange (not yellow), Red Line rose box (not the same
 * red as Hormozi V1), Cardone-A dark-maroon outline, Hollywood Fill
 * dark-blue outline, YELLOW BURST pale-yellow text on a near-black box.
 * ASS colours are &H00BBGGRR (CSS hex REVERSED — writing &H00 + the
 * CSS hex renders the wrong colour; three presets had that bug).
 * DOAC was removed in v8.8 (user: not needed) — the sample clips stay
 * in examples/ + demo/ as history, but no code renders it any more.
 * Default style is 'hormozi-v1' (the reference's first style).
 * Every font here must actually exist on the machine: Anton, Bebas
 * Neue, Montserrat ExtraBold, Montserrat (variable), Poppins ExtraBold
 * and Playfair Display Italic are installed by scripts/setup-local.sh
 * (Alfa Slab One + Lilita One stay installed for later styles).
 */
export const CAPTION_STYLE_PRESETS: Record<CaptionStyle, CaptionStylePreset> = {
  'hormozi-v1': { displayName: 'Hormozi V1', sample: ['WATCH', 'THIS NOW'], highlight: 'none', highlightCss: '', accentColour: '#FF2D2D', font: 'Anton', fontSize: 72, primaryColour: '&H002D2DFF', secondaryColour: '&H00FFFFFF', outlineColour: '&H00000000', outlineW: 5, shadowW: 0, alignment: 2, marginV: 340, borderStyle: 1, backColour: '&H80000000', uppercase: true, bold: true, italic: false, motion: 'pop', popScale: 118, mode: 'karaoke' },
  'red-line': { displayName: 'Red Line', sample: ['WATCH', 'THIS NOW'], highlight: 'word', highlightCss: '#E11D48', accentColour: '#E11D48', font: 'Anton', fontSize: 68, primaryColour: '&H00FFFFFF', secondaryColour: '&H00FFFFFF', outlineColour: '&H00481DE1', outlineW: 6, shadowW: 0, alignment: 2, marginV: 340, borderStyle: 3, backColour: '&H00481DE1', uppercase: true, bold: true, italic: false, motion: 'wordbox', popScale: 115, mode: 'wordbox' },
  undercut: { displayName: 'Undercut', sample: ['Watch', 'this now'], highlight: 'none', highlightCss: '', accentColour: '#FFD800', font: 'Playfair Display', fontSize: 58, primaryColour: '&H0000D8FF', secondaryColour: '&H0000D8FF', outlineColour: '&H00000000', outlineW: 2, shadowW: 0, alignment: 2, marginV: 340, borderStyle: 1, backColour: '&H80000000', uppercase: false, bold: false, italic: true, motion: 'sweep', popScale: 118, mode: 'karaoke' },
  streamline: { displayName: 'Streamline', sample: ['WATCH', 'THIS NOW'], highlight: 'word', highlightCss: '#7C3AED', accentColour: '#7C3AED', font: 'Anton', fontSize: 68, primaryColour: '&H00FFFFFF', secondaryColour: '&H00FFFFFF', outlineColour: '&H00ED3A7C', outlineW: 6, shadowW: 0, alignment: 2, marginV: 340, borderStyle: 3, backColour: '&H00ED3A7C', uppercase: true, bold: true, italic: false, motion: 'wordbox-slide', popScale: 115, mode: 'wordbox' },
  'hormozi-2026-a': { displayName: 'Hormozi Short 2026 - A', sample: ['Watch', 'this now'], highlight: 'none', highlightCss: '', accentColour: '#FFFFFF', font: 'Bebas Neue', fontSize: 64, primaryColour: '&H00FFFFFF', secondaryColour: '&H00FFFFFF', outlineColour: '&H00000000', outlineW: 3, shadowW: 0, alignment: 2, marginV: 340, borderStyle: 1, backColour: '&H80000000', uppercase: false, bold: true, italic: false, motion: 'slide-up', popScale: 118, mode: 'karaoke' },
  'hormozi-2026-b': { displayName: 'Hormozi Short 2026 - B', sample: ['WATCH', 'THIS NOW'], highlight: 'glow', highlightCss: '#FFB020', accentColour: '#FFB020', font: 'Anton', fontSize: 72, primaryColour: '&H0020B0FF', secondaryColour: '&H00FFFFFF', outlineColour: '&H0020B0FF', outlineW: 4, shadowW: 0, alignment: 2, marginV: 340, borderStyle: 1, backColour: '&H80000000', uppercase: true, bold: true, italic: false, motion: 'pulse', popScale: 130, mode: 'karaoke' },
  'hormozi-2026-c': { displayName: 'Hormozi Short 2026 - C', sample: ['Watch', 'this now'], highlight: 'none', highlightCss: '', accentColour: '#2DD4BF', font: 'Montserrat ExtraBold', fontSize: 40, primaryColour: '&H00BFD42D', secondaryColour: '&H00BFBFBF', outlineColour: '&H00000000', outlineW: 1, shadowW: 0, alignment: 2, marginV: 340, borderStyle: 1, backColour: '&H80000000', uppercase: false, bold: true, italic: false, motion: 'fade', popScale: 118, mode: 'karaoke' },
  'hormozi-2026-d': { displayName: 'Hormozi Short 2026 - D', sample: ['THIS', ''], highlight: 'glow', highlightCss: '#3B82F6', accentColour: '#3B82F6', font: 'Bebas Neue', fontSize: 110, primaryColour: '&H00F6823B', secondaryColour: '&H00FFFFFF', outlineColour: '&H00F6823B', outlineW: 4, shadowW: 0, alignment: 5, marginV: 0, borderStyle: 1, backColour: '&H80000000', uppercase: true, bold: true, italic: false, motion: 'spin', popScale: 125, mode: 'flash' },
  'hormozi-2026-e': { displayName: 'Hormozi Short 2026 - E', sample: ['WATCH', 'THIS NOW'], highlight: 'glow', highlightCss: '#4ADE80', accentColour: '#4ADE80', font: 'Anton', fontSize: 72, primaryColour: '&H0080DE4A', secondaryColour: '&H00FFFFFF', outlineColour: '&H0080DE4A', outlineW: 4, shadowW: 0, alignment: 2, marginV: 340, borderStyle: 1, backColour: '&H80000000', uppercase: true, bold: true, italic: false, motion: 'pulse-glow', popScale: 130, mode: 'karaoke' },
  mrbeast: { displayName: 'MrBeast', sample: ['WATCH', 'THIS NOW'], highlight: 'none', highlightCss: '', accentColour: '#F97316', font: 'Anton', fontSize: 76, primaryColour: '&H001673F9', secondaryColour: '&H00FFFFFF', outlineColour: '&H00000000', outlineW: 5, shadowW: 0, alignment: 2, marginV: 340, borderStyle: 1, backColour: '&H80000000', uppercase: true, bold: true, italic: false, motion: 'pop-big', popScale: 140, mode: 'karaoke' },
  'iman-a': { displayName: 'Iman - A', sample: ['Watch', 'this now'], highlight: 'none', highlightCss: '', accentColour: '#94A3B8', font: 'Montserrat', fontSize: 56, primaryColour: '&H00FFFFFF', secondaryColour: '&H00B8A394', outlineColour: '&H00000000', outlineW: 2, shadowW: 0, alignment: 2, marginV: 340, borderStyle: 1, backColour: '&H80000000', uppercase: false, bold: false, italic: false, motion: 'slide-down', popScale: 118, mode: 'karaoke' },
  'cardone-a': { displayName: 'Cardone - A', sample: ['WATCH', 'THIS NOW'], highlight: 'none', highlightCss: '', accentColour: '#7F1D1D', font: 'Anton', fontSize: 72, primaryColour: '&H00FFFFFF', secondaryColour: '&H00FFFFFF', outlineColour: '&H001D1D7F', outlineW: 5, shadowW: 0, alignment: 2, marginV: 340, borderStyle: 1, backColour: '&H80000000', uppercase: true, bold: true, italic: false, motion: 'bounce', popScale: 125, mode: 'karaoke' },
  'hollywood-fill': { displayName: 'Hollywood Fill', sample: ['WATCH', 'THIS NOW'], highlight: 'none', highlightCss: '', accentColour: '#1E3A8A', font: 'Anton', fontSize: 72, primaryColour: '&H00FFFFFF', secondaryColour: '&H00FFFFFF', outlineColour: '&H008A3A1E', outlineW: 8, shadowW: 0, alignment: 2, marginV: 340, borderStyle: 1, backColour: '&H80000000', uppercase: true, bold: true, italic: false, motion: 'flip', popScale: 118, mode: 'karaoke' },
  roman: { displayName: 'Roman', sample: ['WATCH', 'THIS NOW'], highlight: 'word', highlightCss: '#C2410C', accentColour: '#C2410C', font: 'Anton', fontSize: 68, primaryColour: '&H00FFFFFF', secondaryColour: '&H00FFFFFF', outlineColour: '&H000C41C2', outlineW: 6, shadowW: 0, alignment: 2, marginV: 340, borderStyle: 3, backColour: '&H000C41C2', uppercase: true, bold: true, italic: false, motion: 'wordbox-flip', popScale: 115, mode: 'wordbox' },
  sara: { displayName: 'SARA', sample: ['Watch', 'this'], highlight: 'glow', highlightCss: '#EC4899', accentColour: '#EC4899', font: 'Poppins ExtraBold', fontSize: 66, primaryColour: '&H009948EC', secondaryColour: '&H00FFFFFF', outlineColour: '&H009948EC', outlineW: 4, shadowW: 0, alignment: 2, marginV: 340, borderStyle: 1, backColour: '&H80000000', uppercase: false, bold: true, italic: false, motion: 'bounce-soft', popScale: 130, mode: 'karaoke' },
  ali: { displayName: 'ALI', sample: ['Watch', 'this now'], highlight: 'line', highlightCss: '#6B7280', accentColour: '#6B7280', font: 'Montserrat', fontSize: 48, primaryColour: '&H00FFFFFF', secondaryColour: '&H0080726B', outlineColour: '&H0080726B', outlineW: 2, shadowW: 0, alignment: 2, marginV: 260, borderStyle: 3, backColour: '&HCC80726B', uppercase: false, bold: false, italic: false, motion: 'typewriter', popScale: 118, mode: 'sentence' },
  axel: { displayName: 'Axel', sample: ['Watch', 'this now'], highlight: 'word', highlightCss: '#15803D', accentColour: '#15803D', font: 'Poppins ExtraBold', fontSize: 60, primaryColour: '&H00FFFFFF', secondaryColour: '&H00FFFFFF', outlineColour: '&H003D8015', outlineW: 6, shadowW: 0, alignment: 2, marginV: 340, borderStyle: 3, backColour: '&H003D8015', uppercase: false, bold: true, italic: false, motion: 'wordbox-zoom', popScale: 115, mode: 'wordbox' },
  'yellow-burst': { displayName: 'YELLOW BURST', sample: ['WATCH', 'THIS NOW'], highlight: 'line', highlightCss: '#111827', accentColour: '#111827', font: 'Anton', fontSize: 72, primaryColour: '&H0047E0FD', secondaryColour: '&H0047E0FD', outlineColour: '&H00271811', outlineW: 6, shadowW: 0, alignment: 2, marginV: 340, borderStyle: 3, backColour: '&HCC271811', uppercase: true, bold: true, italic: false, motion: 'rise', popScale: 125, mode: 'karaoke' },
};

/**
 * ClipPulse v8.8 — gallery-picker overrides, shared by the ASS
 * generator and the React preview so both show the same thing.
 * '#RRGGBB' -> ASS '&H00BBGGRR' (null when the hex is not valid).
 */
export function hexToAssColour(hex: string): string | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const rr = m[1].slice(0, 2);
  const gg = m[1].slice(2, 4);
  const bb = m[1].slice(4, 6);
  return `&H00${bb}${gg}${rr}`.toUpperCase();
}

/** ASS '&H00BBGGRR' -> CSS '#RRGGBB' (falls back to white on bad input). */
export function assColourToCss(ass: string): string {
  const m = /^&H[0-9a-fA-F]{2}([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(ass.trim());
  if (!m) return '#FFFFFF';
  return `#${m[3]}${m[2]}${m[1]}`.toUpperCase();
}

/**
 * Caption Position slider (0–100%) -> ASS MarginV. For bottom/middle
 * styles MarginV is the distance from the bottom edge (0–900px of the
 * 1920px frame); for top-pinned styles it is the distance from the top
 * edge (0–200px). 0% = lowest on screen, 100% = highest.
 */
export function marginVForPositionPct(pct: number, alignment: number): number {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  return alignment === 8 ? Math.round(p * 2) : Math.round((100 - p) * 9);
}

/** The slider position that reproduces a preset's own MarginV. */
export function positionPctForPreset(preset: CaptionStylePreset): number {
  return preset.alignment === 8
    ? Math.max(0, Math.min(100, Math.round(preset.marginV / 2)))
    : Math.max(0, Math.min(100, Math.round(100 - preset.marginV / 9)));
}

/** Resolve a preset + user overrides to the values that actually render. */
export function applyCaptionOverrides(
  preset: CaptionStylePreset,
  overrides?: CaptionOverrides,
): { fontSize: number; primaryColour: string; marginV: number } {
  const fontSize =
    overrides?.fontSize !== undefined && Number.isFinite(overrides.fontSize)
      ? Math.max(20, Math.min(150, Math.round(overrides.fontSize)))
      : preset.fontSize;
  const primaryColour =
    overrides?.fontColour !== undefined
      ? hexToAssColour(overrides.fontColour) ?? preset.primaryColour
      : preset.primaryColour;
  const marginV =
    overrides?.positionPct !== undefined && Number.isFinite(overrides.positionPct)
      ? marginVForPositionPct(overrides.positionPct, preset.alignment)
      : preset.marginV;
  return { fontSize, primaryColour, marginV };
}

export function generateAssSubtitle(
  segments: TranscriptSegment[],
  startSec: number,
  endSec: number,
  hookText: string,
  style: CaptionStyle = 'hormozi-v1',
  attributionCredit?: string,
  includeProgressBar = true,
  popScale?: number,
  overrides?: CaptionOverrides,
): string {
  const sortedWords = extractWordsFromSegments(segments)
    .filter((w) => w.start >= startSec && w.start < endSec)
    .sort((a, b) => a.start - b.start);
  // v7.1 defense in depth (see the parser clamp above): if words still
  // overlap — e.g. a transcript with duplicate coverage — keep only the
  // first of any overlapping run so the ASS never shows two lines at
  // once. Genuine rapid speech starts at/after the previous word's end.
  const allWords: TranscriptWord[] = [];
  for (const w of sortedWords) {
    const prev = allWords[allWords.length - 1];
    if (prev && w.start < prev.end - 0.02) continue;
    allWords.push(w);
  }
  const clipDuration = Math.max(1, endSec - startSec);
  const clipDurationMs = Math.round(clipDuration * 1000);

  const preset = CAPTION_STYLE_PRESETS[style];
  const effective = applyCaptionOverrides(preset, overrides);
  const effectivePopScale = popScale ?? preset.popScale;
  const secondaryColour = preset.secondaryColour;

  const lines: string[] = [
    '[Script Info]',
    'Title: ClipPulse Viral 60s Reel',
    'ScriptType: v4.00+',
    'PlayResX: 1080',
    'PlayResY: 1920',
    'WrapStyle: 0',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Karaoke,${preset.font},${effective.fontSize},${effective.primaryColour},${secondaryColour},${preset.outlineColour},${preset.backColour},${preset.bold ? -1 : 0},${preset.italic ? -1 : 0},0,0,100,100,0,0,${preset.borderStyle},${preset.outlineW},${preset.shadowW},${preset.alignment},60,60,${effective.marginV},1`,
    'Style: HookBanner,Plus Jakarta Sans,74,&H00FFFFFF,&H00FFFFFF,&H000F172A,&HD01E1DE1,-1,0,0,0,100,100,0,0,3,18,0,8,70,70,220,1',
    'Style: CreditTag,DM Sans,32,&H80FFFFFF,&H80FFFFFF,&H00000000,&H60000000,0,0,0,0,100,100,0,0,1,2,0,2,40,40,90,1',
    'Style: ProgressBar,DM Sans,10,&H00481DE1,&H00481DE1,&H00481DE1,&H00481DE1,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  if (includeProgressBar) {
    lines.push(
      `Dialogue: 2,0:00:00.00,${formatAssTimecode(clipDuration)},ProgressBar,,0,0,0,,{\\an7\\pos(0,0)\\fscx1\\t(0,${clipDurationMs},\\fscx100)\\p1}m 0 0 l 1080 0 1080 12 0 12{\\p0}`
    );
  }

  if (hookText.trim()) {
    lines.push(
      `Dialogue: 1,0:00:00.00,0:00:02.80,HookBanner,,0,0,0,,{\\fad(120,180)}${hookText.trim().toUpperCase()}`
    );
  }

  if (attributionCredit) {
    lines.push(
      `Dialogue: 1,0:00:00.00,${formatAssTimecode(clipDuration)},CreditTag,,0,0,0,,${attributionCredit}`
    );
  }

  // Word pop: scale to effectivePopScale% in its first ~90ms, then settle
  // back to 100% — backslash-t times are in ms relative to the event.
  // (The old subs only changed colour, never moved — that is why they did
  // not read as Hormozi style.) BS is one backslash: ASS tags are built
  // from it so this block carries no backslash literals.
  const BS = String.fromCharCode(92);
  const popTag = (wStartMs: number, wEndMs: number, durCs: number): string => {
    const popMs = Math.min(90, Math.max(40, Math.round((wEndMs - wStartMs) * 0.4)));
    const settleMs = Math.min(wEndMs, wStartMs + 260);
    return `{${BS}kf${durCs}${BS}t(${wStartMs},${wStartMs + popMs},${BS}fscx${effectivePopScale}${BS}fscy${effectivePopScale})${BS}t(${wStartMs + popMs},${settleMs},${BS}fscx100${BS}fscy100)}`;
  };

  // v8.8 — one DIFFERENT motion per style (user rule: 18 styles,
  // 18 motions, no sharing), all real ASS \t transforms rendered by
  // libass (verified by frame pairs, not a flag). Timings are ms relative
  // to the event start, exactly like popTag's. 'pop-big' and 'wordbox'
  // reuse popTag, which reads the preset's own popScale (140 / 115),
  // so they still move differently from 'pop' (118).
  const motionTag = (motion: CaptionMotion, wStartMs: number, wEndMs: number, durCs: number): string => {
    switch (motion) {
      case 'pop':
      case 'pop-big':
      case 'wordbox':
        return popTag(wStartMs, wEndMs, durCs);
      case 'fade': {
        // Invisible until spoken, then fades in over ~150ms.
        const fadeEnd = wStartMs + 150;
        return `{${BS}1a&HFF&${BS}t(${wStartMs},${fadeEnd},${BS}1a&H00&)${BS}kf${durCs}}`;
      }
      case 'pulse': {
        // Neon glow that settles: heavy blur decaying to a soft halo.
        return `{${BS}blur4${BS}t(${wStartMs},${wEndMs},${BS}blur1)${BS}kf${durCs}}`;
      }
      case 'pulse-glow': {
        // Stronger glow: blur + border both decay (the halo shrinks).
        return `{${BS}blur6${BS}bord6${BS}t(${wStartMs},${wEndMs},${BS}blur2${BS}bord2)${BS}kf${durCs}}`;
      }
      case 'flip': {
        // Flips in around the horizontal axis, then the \kf fill sweeps.
        return `{${BS}fry80${BS}t(${wStartMs},${wStartMs + 200},${BS}fry0)${BS}kf${durCs}}`;
      }
      case 'bounce': {
        // Overshoots big, dips small, settles — the word bounces in.
        return `{${BS}t(${wStartMs},${wStartMs + 90},${BS}fscx150${BS}fscy150)${BS}t(${wStartMs + 90},${wStartMs + 200},${BS}fscx90${BS}fscy90)${BS}t(${wStartMs + 200},${wStartMs + 320},${BS}fscx100${BS}fscy100)${BS}kf${durCs}}`;
      }
      case 'bounce-soft': {
        // Gentle bounce: grows a little, settles — no dip below 100.
        return `{${BS}t(${wStartMs},${wStartMs + 90},${BS}fscx125${BS}fscy125)${BS}t(${wStartMs + 90},${wStartMs + 220},${BS}fscx100${BS}fscy100)${BS}kf${durCs}}`;
      }
      case 'slide-up': {
        // Rises into place: starts small + transparent, grows to full size.
        return `{${BS}1a&HCC&${BS}fscx80${BS}fscy60${BS}t(${wStartMs},${wStartMs + 160},${BS}1a&H00&${BS}fscx100${BS}fscy100)${BS}kf${durCs}}`;
      }
      case 'slide-down': {
        // Drops into place: starts tall + transparent, squashes to normal.
        return `{${BS}1a&HCC&${BS}fscy140${BS}t(${wStartMs},${wStartMs + 160},${BS}1a&H00&${BS}fscy100)${BS}kf${durCs}}`;
      }
      case 'rise': {
        // Rises from flat: invisible + squashed flat, grows tall. Unlike
        // slide-up it scales vertically only and starts fully invisible.
        return `{${BS}1a&HFF&${BS}fscy50${BS}t(${wStartMs},${wStartMs + 200},${BS}1a&H00&${BS}fscy100)${BS}kf${durCs}}`;
      }
      case 'spin': {
        // Spins in around the screen axis, then the \kf fill sweeps.
        return `{${BS}frz90${BS}t(${wStartMs},${wStartMs + 200},${BS}frz0)${BS}kf${durCs}}`;
      }
      case 'wordbox-slide': {
        // The box grows in sideways: narrow + transparent, widens to full.
        return `{${BS}1a&HCC&${BS}fscx80${BS}t(${wStartMs},${wStartMs + 200},${BS}1a&H00&${BS}fscx100)${BS}kf${durCs}}`;
      }
      case 'wordbox-flip': {
        // The box flips in around the horizontal axis.
        return `{${BS}fry70${BS}t(${wStartMs},${wStartMs + 180},${BS}fry0)${BS}kf${durCs}}`;
      }
      case 'wordbox-zoom': {
        // The box zooms in from half size.
        return `{${BS}fscx50${BS}fscy50${BS}t(${wStartMs},${wStartMs + 180},${BS}fscx100${BS}fscy100)${BS}kf${durCs}}`;
      }
      case 'typewriter': {
        // Snaps on like a keystroke: invisible until its exact moment,
        // then fully visible at once (no fade, no fill-in-advance).
        return `{${BS}1a&HFF&${BS}t(${wStartMs},${wStartMs + 1},${BS}1a&H00&)${BS}kf${durCs}}`;
      }
      case 'sweep':
      default:
        return `{${BS}kf${durCs}}`;
    }
  };

  if (preset.mode === 'sentence') {
    // One full-sentence line per transcript segment — the classic
    // documentary subtitle look. v8.7 typewriter reveal: the line fills
    // itself in word by word through the \kf sweep (unrevealed words sit
    // in secondary grey until their turn).
    for (const seg of segments) {
      const segStart = Math.max(startSec, seg.start);
      const segEnd = Math.min(endSec, seg.end);
      if (segEnd <= segStart) continue;
      const segWords = allWords.filter((w) => w.start >= seg.start && w.start < seg.end);
      const text = segWords.length > 0
        ? segWords
            .map((w) => {
              const durCs = Math.max(12, Math.round((w.end - w.start) * 100));
              const word = preset.uppercase ? w.word.toUpperCase() : w.word;
              // v8.8: the sentence style's motion (typewriter) gets its
              // own tag, timed at the word's offset inside the segment.
              const wStartMs = Math.max(0, Math.round((w.start - segStart) * 1000));
              const wEndMs = Math.max(wStartMs + 120, Math.round((w.end - segStart) * 1000));
              return `${motionTag(preset.motion, wStartMs, wEndMs, durCs)}${word}`;
            })
            .join(' ')
        : seg.text.trim().replace(/\s+/g, ' ');
      if (!text.trim()) continue;
      lines.push(
        `Dialogue: 0,${formatAssTimecode(segStart - startSec)},${formatAssTimecode(segEnd - startSec)},Karaoke,,0,0,0,,${text}`
      );
    }
  } else if (preset.mode === 'flash') {
    // One huge word at a time, centred — the word-flash Shorts look.
    for (const w of allWords) {
      const wStart = Math.max(0, w.start - startSec);
      const wEnd = Math.max(wStart + 0.35, w.end - startSec);
      const durCs = Math.max(12, Math.round((w.end - w.start) * 100));
      const text = preset.uppercase ? w.word.toUpperCase() : w.word;
      const wEndMs = Math.max(120, Math.round((wEnd - wStart) * 1000));
      lines.push(
        `Dialogue: 0,${formatAssTimecode(wStart)},${formatAssTimecode(wEnd)},Karaoke,,0,0,0,,${motionTag(preset.motion, 0, wEndMs, durCs)}${text}`
      );
    }
  } else if (preset.mode === 'wordbox') {
    // One word at a time, each on its own solid box — the highlight box
    // follows the spoken word. Small pop-in + \kf fill inside the box.
    for (const w of allWords) {
      const wStart = Math.max(0, w.start - startSec);
      const wEnd = Math.max(wStart + 0.35, w.end - startSec);
      const durCs = Math.max(12, Math.round((w.end - w.start) * 100));
      const text = preset.uppercase ? w.word.toUpperCase() : w.word;
      const wEndMs = Math.max(120, Math.round((wEnd - wStart) * 1000));
      lines.push(
        `Dialogue: 0,${formatAssTimecode(wStart)},${formatAssTimecode(wEnd)},Karaoke,,0,0,0,,${motionTag(preset.motion, 0, wEndMs, durCs)}${text}`
      );
    }
  } else {
    const chunkSize = 4;
    for (let i = 0; i < allWords.length; i += chunkSize) {
      const chunk = allWords.slice(i, i + chunkSize);
      if (chunk.length === 0) continue;
      const chunkStart = Math.max(0, chunk[0].start - startSec);
      const chunkEnd = Math.max(chunkStart + 0.35, chunk[chunk.length - 1].end - startSec);

      const karaokeText = chunk
        .map((w) => {
          const durCs = Math.max(12, Math.round((w.end - w.start) * 100));
          const text = preset.uppercase ? w.word.toUpperCase() : w.word;
          const wStartMs = Math.max(0, Math.round((w.start - startSec - chunkStart) * 1000));
          const wEndMs = Math.max(wStartMs + 120, Math.round((w.end - startSec - chunkStart) * 1000));
          return `${motionTag(preset.motion, wStartMs, wEndMs, durCs)}${text}`;
        })
        .join(' ');

      lines.push(
        `Dialogue: 0,${formatAssTimecode(chunkStart)},${formatAssTimecode(chunkEnd)},Karaoke,,0,0,0,,${karaokeText}`
      );
    }
  }

  return lines.join('\n');
}

/**
 * ClipPulse v7 — voice polish chain (verified live on Raj clip audio:
 * raw mean -17.0 dB / max -5.0 dB -> polished, loudnorm hits its
 * target with -1.5 dBTP peak). Rumble cut -> presence lift -> gentle
 * compression -> de-ess -> loudness normalise. I=-14 LUFS is YouTube's
 * Shorts norm (the old chain used -14 too); -16 measured ~2 dB quieter
 * than v6 on the same window, so -14 keeps the voice as loud as before
 * while the compand/EQ/deesser do the polish work. Drop-in for the
 * old loudnorm-only chain, for every render path (not just the
 * copyright-safe one). Commas are filter separators, as in any -af /
 * -filter_complex audio chain.
 */
export const VOICE_POLISH_FILTER =
  'highpass=f=80,equalizer=f=3000:width_type=o:width=2:g=3,compand=attacks=0.01:decays=0.15:points=-70/-70|-30/-18|-20/-12|-10/-8|-3/-3|0/-1,deesser,loudnorm=I=-14:TP=-1.5:LRA=11';

/**
 * ClipPulse v7 — smooth face tracking. The old per-scene crop jumped
 * instantly to each scene's faceX at the cut, so the face teleported
 * across the frame (the "not smooth" feel Manik flagged). This builds
 * the crop x-expression for one scene: when a previous scene's face
 * ratio is given, the crop glides from the previous centre to this
 * scene's centre over `easeSec` (segment-local `t`, reset by the
 * trim+setpts before the crop), so the face stays in nearly the same
 * screen position across the cut — the match-cut feel pro Shorts get
 * from cutting on near-identical frames. First scene: static centre.
 * Commas inside expressions are escaped (\\,) for filtergraph use.
 */
export function buildFaceTrackCropX(prevRatio: number | null, ratio: number, easeSec = 0.3): string {
  const cur = ratio.toFixed(2);
  if (prevRatio == null) {
    return `max(0\\,min(iw-ih*9/16\\,iw*${cur}-(ih*9/16)/2))`;
  }
  const prev = prevRatio.toFixed(2);
  const ease = easeSec.toFixed(2);
  return `max(0\\,min(iw-ih*9/16\\,iw*(${prev}+(${cur}-${prev})*min(1\\,t/${ease}))-(ih*9/16)/2))`;
}

/**
 * ClipPulse v8 — sentence-start punch times (clip-relative seconds)
 * for the punchy variant. Whisper segments are short and frequent, so
 * punching at every segment start would strobe; keep a start only when
 * it is at least `minGapSec` after the last kept punch, capped at
 * `maxPunches` so the clip never gets more than ~one punch per 3s.
 */
export function pickPunchTimes(
  segments: TranscriptSegment[],
  windowStart: number,
  windowEnd: number,
  minGapSec = 1.5,
  maxPunches = 10,
): number[] {
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const times: number[] = [];
  let last = -Infinity;
  for (const s of sorted) {
    const t = s.start - windowStart;
    if (t < 0 || t > windowEnd - windowStart) continue;
    if (t - last < minGapSec) continue;
    times.push(Math.round(t * 100) / 100);
    last = t;
    if (times.length >= maxPunches) break;
  }
  return times;
}

/**
 * ClipPulse v8 — zoom punches for the punchy variant: the scale jumps
 * ~8% (108%) for `holdSec` at each punch time, then eases back linearly
 * over `releaseSec`. `t` is scene-local (trim+setpts resets it per
 * scene), so pass scene-relative punch times. No punches -> the plain
 * static zoom scale (no eval=frame). Commas inside expressions are
 * escaped (\\,), same rule as buildHookPunchScale.
 */
export function buildZoomPunchScale(
  zoomW: number,
  zoomH: number,
  targetW: number,
  targetH: number,
  punchTimes: number[],
  punchPct = 0.08,
  holdSec = 0.35,
  releaseSec = 0.35,
): string {
  const centreCrop =
    `crop=${targetW}:${targetH}:${Math.round((zoomW - targetW) / 2)}:${Math.round((zoomH - targetH) / 2)}`;
  if (punchTimes.length === 0) {
    return `scale=${zoomW}:${zoomH}:flags=bilinear,${centreCrop}`;
  }
  const pulses = punchTimes
    .map((p) => {
      const a = p.toFixed(2);
      const b = (p + holdSec).toFixed(2);
      const c = (p + holdSec + releaseSec).toFixed(2);
      return `if(lt(t\\,${a})\\,0\\,if(lt(t\\,${b})\\,1\\,if(lt(t\\,${c})\\,(${c}-t)/${releaseSec.toFixed(2)}\\,0)))`;
    })
    .join('+');
  const pct = punchPct.toFixed(2);
  return (
    `scale=w='${zoomW}*(1+${pct}*(${pulses}))':h='${zoomH}*(1+${pct}*(${pulses}))':eval=frame:flags=bilinear,` +
    centreCrop
  );
}

/**
 * ClipPulse v8 — gentle slow push-in for the fullframe variant: the
 * scale grows linearly from 1x to 1+`pushPct` over the whole clip, so
 * the frame breathes without ever cutting or jumping. eval=frame is
 * REQUIRED for the per-frame `t`.
 */
export function buildPushInScale(
  zoomW: number,
  zoomH: number,
  targetW: number,
  targetH: number,
  clipDuration: number,
  pushPct = 0.04,
): string {
  const dur = Math.max(1, clipDuration).toFixed(2);
  const pct = pushPct.toFixed(2);
  return (
    `scale=w='${zoomW}*(1+${pct}*t/${dur})':h='${zoomH}*(1+${pct}*t/${dur})':eval=frame:flags=bilinear,` +
    `crop=${targetW}:${targetH}:${Math.round((zoomW - targetW) / 2)}:${Math.round((zoomH - targetH) / 2)}`
  );
}

/** ClipPulse v8 — escape drawtext text: backslash, colon, quote, comma. */
export function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/,/g, '\\,');
}

/**
 * ClipPulse v7 — hook punch-in for the FIRST scene only (the opening
 * 1-2s that decide the Short). A 5% push-in easing out over `punchSec`:
 * the scale starts 5% tighter and releases to the normal zoom size, so
 * the opening feels like a deliberate punch, not a static frame. Only
 * valid where the fixed centre-crop after the scale pins the output
 * size (the copyright-safe path); the plain scale path has no second
 * crop, so a time-varying scale would change the output size mid-stream.
 */
export function buildHookPunchScale(
  zoomW: number,
  zoomH: number,
  targetW: number,
  targetH: number,
  punchSec = 1.2,
): string {
  const punch = punchSec.toFixed(2);
  // eval=frame is REQUIRED: scale evaluates w/h once at init by
  // default, and per-frame variables (t) are rejected in init mode
  // ("Expressions with frame variables 'n', 't', 'pos' are not valid
  // in init eval_mode" — caught live in the first v7 verify render).
  return (
    `scale=w='${zoomW}*(1.05-0.05*min(1\\,t/${punch}))':h='${zoomH}*(1.05-0.05*min(1\\,t/${punch}))':eval=frame:flags=bilinear,` +
    `crop=${targetW}:${targetH}:${Math.round((zoomW - targetW) / 2)}:${Math.round((zoomH - targetH) / 2)}`
  );
}

/**
 * ClipPulse v4 — OpusClip "Gameplay" layout filter (facecam top 30%,
 * gameplay below 70%). The cam box is the DETECTED box from
 * scripts/detect_cambox.py (fractions of the source frame, anywhere in
 * the frame — not a corner assumption). The game is centre-cropped to the
 * action zone so the crosshair/kill feed survive the vertical crop.
 */
export function buildGameplayFilter(params: {
  camBox: [number, number, number, number];
  targetW: number;
  camH: number;
  gameH: number;
  visualTransform: string;
  assFilter: string;
}): string {
  const [bx, by, bw, bh] = params.camBox.map((v) => v.toFixed(3));
  const { targetW, camH, gameH } = params;
  return (
    `[0:v]crop=iw*${bw}:ih*${bh}:iw*${bx}:ih*${by},` +
    `scale=${targetW}:${camH}:force_original_aspect_ratio=increase,crop=${targetW}:${camH}[cam];` +
    `[0:v]crop=ih*${targetW}/${gameH}:ih:(iw-ih*${targetW}/${gameH})/2:0,` +
    `scale=${targetW}:${gameH}[game];` +
    `[cam][game]vstack=inputs=2${params.visualTransform}${params.assFilter},format=yuv420p[v]`
  );
}

/**
 * ClipPulse v5 — output-quality table. 4K (2160x3840) is a real output
 * size; whether it is NATIVE depends on the source — most stream VODs top
 * out at 720p/1080p, so 4K from them is a high-bitrate upscale (CRF 18,
 * veryfast). A 4K-native source (most MrBeast uploads) renders native.
 * zoomW/zoomH keep the v1 zoom-pan headroom (~6% overscan).
 */
export type OutputQuality = '720p' | '1080p' | '4k';

export function qualityDims(quality: OutputQuality): {
  targetW: number;
  targetH: number;
  zoomW: number;
  zoomH: number;
  camH: number;
  gameH: number;
  preset: string;
  crf: string;
  audioKbps: string;
  maxSourceHeight: number;
} {
  switch (quality) {
    case '4k':
      return {
        targetW: 2160,
        targetH: 3840,
        zoomW: 2290,
        zoomH: 4070,
        camH: 1344,
        gameH: 2496,
        // ultrafast, not veryfast: on this box (1.5 shared CPUs) a 30s 4K
        // veryfast encode ran 10+ min; ultrafast CRF 20 is still visibly
        // cleaner than 1080p on a phone and finishes in reasonable time.
        preset: 'ultrafast',
        crf: '20',
        audioKbps: '192k',
        maxSourceHeight: 2160,
      };
    case '1080p':
      return {
        targetW: 1080,
        targetH: 1920,
        zoomW: 1144,
        zoomH: 2034,
        camH: 672,
        gameH: 1248,
        preset: 'veryfast',
        crf: '20',
        audioKbps: '160k',
        maxSourceHeight: 1080,
      };
    default:
      return {
        targetW: 720,
        targetH: 1280,
        zoomW: 764,
        zoomH: 1358,
        camH: 448,
        gameH: 832,
        preset: 'ultrafast',
        crf: '22',
        audioKbps: '160k',
        maxSourceHeight: 1080,
      };
  }
}

export function mergeSceneBoundaries(
  cuts: number[],
  durationSec: number,
  minSceneSec = 2,
  maxScenes = 8,
): Array<{ startSec: number; endSec: number }> {
  const sorted = [...cuts].filter((c) => c > 0.5 && c < durationSec - 0.5).sort((a, b) => a - b);
  let bounds = [0, ...sorted, durationSec];
  // Merge scenes shorter than minSceneSec into the previous scene.
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 1; i < bounds.length - 1; i++) {
      const sceneLen = bounds[i + 1] - bounds[i];
      if (sceneLen < minSceneSec) {
        bounds.splice(i, 1);
        merged = true;
        break;
      }
    }
  }
  // Cap the count by merging the shortest scene into its neighbour.
  while (bounds.length - 1 > maxScenes) {
    let shortest = 1;
    for (let i = 1; i < bounds.length - 1; i++) {
      if (bounds[i + 1] - bounds[i] < bounds[shortest + 1] - bounds[shortest]) shortest = i;
    }
    bounds.splice(shortest, 1);
  }
  const scenes: Array<{ startSec: number; endSec: number }> = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    scenes.push({ startSec: Math.round(bounds[i] * 100) / 100, endSec: Math.round(bounds[i + 1] * 100) / 100 });
  }
  return scenes;
}

export function buildFfmpegCommand(params: {
  youtubeUrl: string;
  startSec: number;
  endSec: number;
  faceOffsetX: number;
  framingMode?: FramingMode;
  serverlessSectionOnly?: boolean;
  copyrightSafeTransform?: boolean;
  mirrorFlip?: boolean;
  assFilename?: string;
  /** ClipPulse v2: detected facecam crop origin (fractions of frame), from
   * scripts/detect_facecam.py. v1 always assumed top-left (0, 0). */
  facecamCropOrigin?: [number, number];
}): string {
  const duration = Math.max(1, params.endSec - params.startSec);
  const assFile = params.assFilename || 'captions.ass';
  const framing = params.framingMode || 'face-track';
  const sectionOnly = params.serverlessSectionOnly ?? true;
  const safeTransform = params.copyrightSafeTransform ?? true;
  const mirrorFlip = params.mirrorFlip ?? false;

  const cropRatio = Math.max(0.15, Math.min(0.85, params.faceOffsetX / 100));

  const downloadStep = sectionOnly
    ? [
        `# 1. Section Download (downloads ONLY the winning 60s slice, ~20MB!)`,
        `yt-dlp --download-sections "*${params.startSec}-${params.endSec}" --force-keyframes-at-cuts \\`,
        `  -f "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]" -o "clip_raw.mp4" "${params.youtubeUrl}"`,
      ].join('\n')
    : [
        `# 1. Download source video via yt-dlp (Free)`,
        `yt-dlp -f "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]" -o "source.mp4" "${params.youtubeUrl}"`,
      ].join('\n');

  const inputFlags = sectionOnly
    ? `-i clip_raw.mp4`
    : `-ss ${params.startSec} -t ${duration} -i source.mp4`;

  const flipFilter = mirrorFlip ? ',hflip' : '';
  const visualTransform = safeTransform
    ? `${flipFilter},eq=contrast=1.08:saturation=1.18:brightness=0.02,unsharp=5:5:0.8:5:5:0.0,vignette=PI/5`
    : flipFilter;
  const audioTransform = safeTransform
    ? `-af "aresample=44100,asetrate=44982,aresample=44100,atempo=1.01,loudnorm=I=-14:TP=-1.5:LRA=11" `
    : '';

  let filterComplex = '';
  if (framing === 'sports-blur') {
    const fgScale = safeTransform ? 'scale=1144:-2,crop=1080:ih*1080/1144' : 'scale=1080:-2';
    filterComplex = `-filter_complex "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=22:4[bg];[0:v]${fgScale}[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2${visualTransform},ass=${assFile}[v]" -map "[v]" -map 0:a?`;
  } else if (framing === 'gaming-split') {
    const camOrigin = params.facecamCropOrigin || [0, 0];
    filterComplex = `-filter_complex "[0:v]crop=iw*0.26:ih*0.28:iw*${camOrigin[0]}:ih*${camOrigin[1]},scale=1080:672:force_original_aspect_ratio=increase,crop=1080:672[cam];[0:v]scale=1080:1248:force_original_aspect_ratio=increase,crop=1080:1248[game];[cam][game]vstack=inputs=2${visualTransform},ass=${assFile}[v]" -map "[v]" -map 0:a?`;
  } else {
    const cropExpr = `crop=ih*9/16:ih:max(0\\,min(iw-ih*9/16\\,iw*${cropRatio.toFixed(2)}-(ih*9/16)/2)):0`;
    const zoomScale = safeTransform
      ? 'scale=1144:2034:flags=lanczos,crop=1080:1920:32:57'
      : 'scale=1080:1920:flags=lanczos';
    filterComplex = `-vf "${cropExpr},${zoomScale}${visualTransform},ass=${assFile}"`;
  }

  return [
    downloadStep,
    ``,
    `# 2. ${framing} 9:16 Viral Transform Render (Zoom + Color Grade + Vignette + Pitch/Loudnorm + .ASS)`,
    `ffmpeg -y ${inputFlags} \\`,
    `  ${filterComplex} \\`,
    `  ${audioTransform}-c:v libx264 -preset fast -crf 20 -c:a aac -b:a 160k viral_reel_60s.mp4`,
  ].join('\n');
}
