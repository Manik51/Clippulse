import type {
  AutoFetchPackItem,
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

/** Per-word motion. Every style animates — a static style reads as a
 * broken render next to the others. 'wordbox' is the bold style's motion:
 * the highlight box follows the spoken word, one word per event.
 * 'typewriter' is the sentence style's motion: the line reveals itself
 * word by word through the \kf fill. */
export type CaptionMotion = 'pop' | 'fade' | 'pulse' | 'flip' | 'bounce' | 'sweep' | 'wordbox' | 'typewriter';

export interface CaptionStylePreset {
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
  motion: CaptionMotion;
  popScale: number;
  mode: 'karaoke' | 'sentence' | 'flash' | 'wordbox';
}

/**
 * ClipPulse v8.7 — seven caption designs, each unmistakably different:
 * its OWN font + its OWN highlight treatment + its OWN position/size +
 * its OWN motion. The v8.4 set failed this test — karaoke, lime, top and
 * flash all read as big yellow/white bold caps. Every font here must
 * actually exist on the machine: Anton + Archivo Black ship in ~/.fonts,
 * Bebas Neue + Montserrat ExtraBold + Poppins ExtraBold + Alfa Slab One +
 * Lilita One are installed by scripts/setup-local.sh, Noto Sans is a
 * system font. (The old 'bold' named Plus Jakarta Sans — never installed,
 * so libass silently rendered it in DejaVu Sans.)
 * DO NOT change the doac generator below — it is the locked production
 * standard. Karaoke keeps the Hormozi identity (Anton, yellow/white, pop);
 * the other styles move away from it.
 */
export const CAPTION_STYLE_PRESETS: Record<CaptionStyle, CaptionStylePreset> = {
  karaoke: { font: 'Anton', fontSize: 72, primaryColour: '&H0000D7FF', secondaryColour: '&H00FFFFFF', outlineColour: '&H00000000', outlineW: 5, shadowW: 0, alignment: 2, marginV: 340, borderStyle: 1, backColour: '&H80000000', uppercase: true, motion: 'pop', popScale: 118, mode: 'karaoke' },
  minimal: { font: 'Montserrat ExtraBold', fontSize: 40, primaryColour: '&H00FFFFFF', secondaryColour: '&H00BFBFBF', outlineColour: '&H00000000', outlineW: 1, shadowW: 0, alignment: 1, marginV: 200, borderStyle: 1, backColour: '&H80000000', uppercase: false, motion: 'fade', popScale: 118, mode: 'karaoke' },
  bold: { font: 'Alfa Slab One', fontSize: 64, primaryColour: '&H00000000', secondaryColour: '&H00404040', outlineColour: '&H0000D7FF', outlineW: 6, shadowW: 0, alignment: 2, marginV: 340, borderStyle: 3, backColour: '&H0000D7FF', uppercase: true, motion: 'wordbox', popScale: 115, mode: 'wordbox' },
  lime: { font: 'Poppins ExtraBold', fontSize: 66, primaryColour: '&H0035F1C6', secondaryColour: '&H00FFFFFF', outlineColour: '&H0035F1C6', outlineW: 4, shadowW: 0, alignment: 2, marginV: 340, borderStyle: 1, backColour: '&H80000000', uppercase: true, motion: 'pulse', popScale: 130, mode: 'karaoke' },
  sentence: { font: 'Noto Sans', fontSize: 46, primaryColour: '&H00FFFFFF', secondaryColour: '&H00808080', outlineColour: '&H00000000', outlineW: 2, shadowW: 0, alignment: 2, marginV: 260, borderStyle: 3, backColour: '&HCC000000', uppercase: false, motion: 'typewriter', popScale: 118, mode: 'sentence' },
  top: { font: 'Lilita One', fontSize: 56, primaryColour: '&H0000D7FF', secondaryColour: '&H00FFFFFF', outlineColour: '&H00000000', outlineW: 4, shadowW: 0, alignment: 8, marginV: 150, borderStyle: 1, backColour: '&H80000000', uppercase: true, motion: 'flip', popScale: 118, mode: 'karaoke' },
  flash: { font: 'Bebas Neue', fontSize: 130, primaryColour: '&H00FFFFFF', secondaryColour: '&H00FFFFFF', outlineColour: '&H000000FF', outlineW: 6, shadowW: 0, alignment: 5, marginV: 0, borderStyle: 1, backColour: '&H80000000', uppercase: true, motion: 'bounce', popScale: 125, mode: 'flash' },
};

export function generateAssSubtitle(
  segments: TranscriptSegment[],
  startSec: number,
  endSec: number,
  hookText: string,
  style: CaptionStyle = 'karaoke',
  attributionCredit?: string,
  includeProgressBar = true,
  popScale?: number,
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
    `Style: Karaoke,${preset.font},${preset.fontSize},${preset.primaryColour},${secondaryColour},${preset.outlineColour},${preset.backColour},-1,0,0,0,100,100,0,0,${preset.borderStyle},${preset.outlineW},${preset.shadowW},${preset.alignment},60,60,${preset.marginV},1`,
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

  // v8.7 — one motion per style, all real ASS \t transforms rendered by
  // libass (verified by frame pairs, not a flag). Timings are ms relative
  // to the event start, exactly like popTag's.
  const motionTag = (motion: CaptionMotion, wStartMs: number, wEndMs: number, durCs: number): string => {
    switch (motion) {
      case 'pop':
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
      case 'flip': {
        // Flips in around the horizontal axis, then the \kf fill sweeps.
        return `{${BS}fry80${BS}t(${wStartMs},${wStartMs + 200},${BS}fry0)${BS}kf${durCs}}`;
      }
      case 'bounce': {
        // Overshoots big, dips small, settles — the word bounces in.
        return `{${BS}t(${wStartMs},${wStartMs + 90},${BS}fscx150${BS}fscy150)${BS}t(${wStartMs + 90},${wStartMs + 200},${BS}fscx90${BS}fscy90)${BS}t(${wStartMs + 200},${wStartMs + 320},${BS}fscx100${BS}fscy100)${BS}kf${durCs}}`;
      }
      case 'wordbox':
      case 'typewriter':
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
              return `{${BS}kf${durCs}}${word}`;
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
        `Dialogue: 0,${formatAssTimecode(wStart)},${formatAssTimecode(wEnd)},Karaoke,,0,0,0,,${popTag(0, wEndMs, durCs)}${text}`
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
 * ClipPulse v8 — edit styles for the forced-choice variants. Manik
 * rejected the v7.1 clip as basic AND all three reference clips, so the
 * bar is set by two variants of the same moment, not by a reference.
 * 'punchy': zoom punches + loud SFX + big hook title + stronger pop.
 * 'fullframe': the source's own framing kept, gentle push-in, one whoosh.
 * Anything else (including undefined) is the current v7 behaviour.
 */
export type EditStyle = 'punchy' | 'fullframe' | 'doac';

export const ARCHIVO_BLACK_FONT_PATH = '/home/hatch/.fonts/ArchivoBlack-Regular.ttf';

/**
 * ClipPulse v8 (DOAC spec, measured from the reference Short) — blur-fill
 * layout: the 16:9 source is centre-cropped to 4:5 (720x900 at 720p) and
 * placed in the middle of the 9:16 frame; the top and bottom bars are the
 * same frame, scaled up and heavily blurred (the classic Diary Of A CEO
 * Short look — the picture is BIG, the bars carry the title/captions).
 * No face tracking, no zoom inside a shot — framing is static within
 * each shot; the source's own camera cuts do all the changing.
 * Returns the filter up to the overlay; the caller appends the visual
 * transform, title and captions, then `,format=yuv420p[v]`.
 */
export function buildDoacBlurFill(targetW: number, targetH: number): string {
  const fgH = Math.round((targetW * 5) / 4);
  return (
    `[0:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},boxblur=16:3[bg];` +
    `[0:v]crop=ih*4/5:ih:(iw-ih*4/5)/2:0,scale=${targetW}:${fgH}:flags=bilinear[fg];` +
    `[bg][fg]overlay=(W-w)/2:(H-h)/2`
  );
}

/** One detected face: centre x and width, both 0-100 of frame width. */
export interface DoacFace {
  x: number;
  w: number;
}

export type DoacShotLayout = 'crop45' | 'letterbox169';

/**
 * ClipPulse v8.2 — per-shot picture aspect for the DOAC layout. The 4:5
 * centre crop covers (4/5)/aspect of the source width (0.45 for 16:9);
 * a face survives it only when its whole box sits inside that centred
 * window (2-point margin). Two faces far apart — the Raj two-shot has
 * centres ~26% and ~77% — fail the window, so that shot gets a 16:9
 * letterbox picture instead of two half faces. No faces, or an unusable
 * aspect, falls back to the 4:5 crop (the task's required fallback).
 */
export function decideDoacShotLayout(
  faces: DoacFace[],
  sourceAspect: number,
): DoacShotLayout {
  if (!Number.isFinite(sourceAspect) || sourceAspect <= 0) return 'crop45';
  const cropW = 0.8 / sourceAspect;
  if (cropW >= 1) return 'crop45';
  const lo = (1 - cropW) / 2;
  const hi = (1 + cropW) / 2;
  const margin = 0.02;
  for (const f of faces) {
    if (!Number.isFinite(f.x) || !Number.isFinite(f.w)) continue;
    const left = (f.x - f.w / 2) / 100;
    const right = (f.x + f.w / 2) / 100;
    if (left < lo + margin || right > hi - margin) return 'letterbox169';
  }
  return 'crop45';
}

/** Foreground picture height at 720p: 900 for the 4:5 crop, 405 for the 16:9 letterbox. */
export function doacFgHeight(targetW: number, layout: DoacShotLayout): number {
  return layout === 'letterbox169' ? Math.round((targetW * 9) / 16) : Math.round((targetW * 5) / 4);
}

/**
 * ClipPulse v8.2 — one DOAC scene's video chain: the trimmed source is
 * split into a blurred full-frame background and the foreground picture
 * (4:5 centre crop, or 16:9 letterbox when the shot is a two-shot),
 * overlaid centred. Returns the chain up to `[vN]`; the caller concats
 * the scenes and applies the transform, title and captions after.
 */
export function buildDoacSceneChain(
  index: number,
  startSec: number,
  endSec: number,
  layout: DoacShotLayout,
  targetW: number,
  targetH: number,
): string {
  const fgH = doacFgHeight(targetW, layout);
  const fg =
    layout === 'letterbox169'
      ? `scale=${targetW}:${fgH}:force_original_aspect_ratio=increase,crop=${targetW}:${fgH}`
      : `crop=ih*4/5:ih:(iw-ih*4/5)/2:0,scale=${targetW}:${fgH}:flags=bilinear`;
  const s = startSec.toFixed(2);
  const e = endSec.toFixed(2);
  return (
    `[0:v]trim=start=${s}:end=${e},setpts=PTS-STARTPTS,split=2[sin${index}a][sin${index}b];` +
    `[sin${index}a]scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},boxblur=16:3[bg${index}];` +
    `[sin${index}b]${fg}[fg${index}];` +
    `[bg${index}][fg${index}]overlay=(W-w)/2:(H-h)/2,setsar=1[v${index}]`
  );
}

/**
 * ClipPulse v8 (DOAC spec) — captions for the DOAC layout. Same
 * word-by-word karaoke highlight as the Hormozi style (current word
 * yellow, rest white, ALL CAPS) but: Archivo Black (wide extra-bold,
 * NOT condensed Anton), 80pt, positioned BELOW the picture on the bottom
 * blur bar (MarginV 160 at PlayRes 1920), NO scale pop (highlight only
 * — the reference shows no pop), NO progress bar, NO hook banner (the
 * title is a drawtext overlay, not an ASS event).
 */
export function generateDoacSubtitle(
  segments: TranscriptSegment[],
  startSec: number,
  endSec: number,
): string {
  const sortedWords = extractWordsFromSegments(segments)
    .filter((w) => w.start >= startSec && w.start < endSec)
    .sort((a, b) => a.start - b.start);
  // Same overlap guard as generateAssSubtitle: never two lines at once.
  const allWords: TranscriptWord[] = [];
  for (const w of sortedWords) {
    const prev = allWords[allWords.length - 1];
    if (prev && w.start < prev.end - 0.02) continue;
    allWords.push(w);
  }
  const lines: string[] = [
    '[Script Info]',
    'Title: ClipPulse DOAC Spec',
    'ScriptType: v4.00+',
    'PlayResX: 1080',
    'PlayResY: 1920',
    'WrapStyle: 0',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Doac,Archivo Black,80,&H0000D7FF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,5,0,2,60,60,160,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const chunkSize = 4;
  for (let i = 0; i < allWords.length; i += chunkSize) {
    const chunk = allWords.slice(i, i + chunkSize);
    if (chunk.length === 0) continue;
    const chunkStart = Math.max(0, chunk[0].start - startSec);
    const chunkEnd = Math.max(chunkStart + 0.35, chunk[chunk.length - 1].end - startSec);
    const karaokeText = chunk
      .map((w) => {
        const durCs = Math.max(12, Math.round((w.end - w.start) * 100));
        return `{\\kf${durCs}}${w.word.toUpperCase()}`;
      })
      .join(' ');
    lines.push(
      `Dialogue: 0,${formatAssTimecode(chunkStart)},${formatAssTimecode(chunkEnd)},Doac,,0,0,0,,${karaokeText}`,
    );
  }
  return lines.join('\n');
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

export const ANTON_FONT_PATH = '/home/hatch/.fonts/Anton-Regular.ttf';

/**
 * ClipPulse v8.1 — measured advance widths (em) for the two title
 * fonts, read with fontTools from ~/.fonts/{ArchivoBlack,Anton}-
 * Regular.ttf. Used to wrap the hook title so it can NEVER overflow
 * the frame. v8 bug, measured on the sample: 'OF SEAL TEAM 6 WOULD
 * COME' in Archivo Black at 63px is 1089px wide on a 720px frame,
 * and drawtext's x=(w-text_w)/2 centred it off BOTH edges (frame
 * showed 'EAL TEAM 6 WOULD C'). Unknown chars fall back to 0.7em.
 */
const ARCHIVO_TITLE_EM: Record<string, number> = {
  A: 0.778, B: 0.778, C: 0.778, D: 0.778, E: 0.722, F: 0.667, G: 0.833,
  H: 0.833, I: 0.389, J: 0.667, K: 0.833, L: 0.667, M: 0.944, N: 0.833,
  O: 0.833, P: 0.722, Q: 0.833, R: 0.778, S: 0.722, T: 0.722, U: 0.833,
  V: 0.778, W: 1.0, X: 0.778, Y: 0.778, Z: 0.722,
  '0': 0.667, '1': 0.667, '2': 0.667, '3': 0.667, '4': 0.667, '5': 0.667,
  '6': 0.667, '7': 0.667, '8': 0.667, '9': 0.667,
  ' ': 0.333, '.': 0.333, ',': 0.333, '!': 0.333, '?': 0.611, "'": 0.278,
  '&': 0.889, ':': 0.333, ';': 0.333, '-': 0.333, '(': 0.389, ')': 0.389,
};
const ANTON_TITLE_EM: Record<string, number> = {
  A: 0.485, B: 0.479, C: 0.474, D: 0.493, E: 0.412, F: 0.399, G: 0.485,
  H: 0.499, I: 0.227, J: 0.466, K: 0.472, L: 0.397, M: 0.746, N: 0.498,
  O: 0.486, P: 0.472, Q: 0.494, R: 0.477, S: 0.461, T: 0.396, U: 0.474,
  V: 0.469, W: 0.712, X: 0.484, Y: 0.446, Z: 0.41,
  '0': 0.494, '1': 0.331, '2': 0.494, '3': 0.494, '4': 0.494, '5': 0.494,
  '6': 0.494, '7': 0.494, '8': 0.494, '9': 0.494,
  ' ': 0.234, '.': 0.229, ',': 0.236, '!': 0.229, '?': 0.492, "'": 0.214,
  '&': 0.52, ':': 0.242, ';': 0.245, '-': 0.311, '(': 0.291, ')': 0.291,
};

export function measureTitleWidthEm(text: string, font: 'archivo' | 'anton'): number {
  const table = font === 'anton' ? ANTON_TITLE_EM : ARCHIVO_TITLE_EM;
  let em = 0;
  for (const ch of text) em += table[ch] ?? 0.7;
  return em;
}

/** Split words into the two lines whose wider line is narrowest. */
export function bestTwoLineSplit(words: string[], font: 'archivo' | 'anton'): [string, string] {
  let best: [number, string, string] | null = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const m = Math.max(measureTitleWidthEm(a, font), measureTitleWidthEm(b, font));
    if (best === null || m < best[0]) best = [m, a, b];
  }
  return best ? [best[1], best[2]] : [words.join(' '), ''];
}

/**
 * ClipPulse v8 — big hook title for the punchy variant: Anton, white on
 * a black banner, top-centre, first `durationSec` seconds only. Returns
 * '' for empty text (caller inserts nothing). This replaces the ASS
 * HookBanner for the punchy variant — the ASS banner was a small box
 * that read as a caption, not a title.
 *
 * v8.1 — the title is width-wrapped, never clipped: one line when it
 * fits (same output as before), otherwise the best two-line split with
 * the font shrunk until the wider line fits maxWidth (targetW - 60px).
 * The DOAC reference title itself needs this: 'A SOVIET GROCERY STORE
 * HAD ONLY 77 ITEMS' is 1694px at 63px and renders as two 43px lines.
 */
export function buildHookTitleDrawtext(
  text: string,
  targetW: number,
  targetH: number,
  durationSec = 2.5,
  opts: { fontfile?: string; boxed?: boolean; fontcolor?: string } = {},
): string {
  const clean = text.trim().toUpperCase().replace(/\s+/g, ' ').slice(0, 42);
  if (!clean) return '';
  const font: 'archivo' | 'anton' =
    opts.fontfile === undefined || opts.fontfile.includes('Anton') ? 'anton' : 'archivo';
  const baseFontSize = Math.round(targetW * 0.088);
  const maxWidthPx = targetW - 60;
  const fontfile = opts.fontfile ?? ANTON_FONT_PATH;
  const fontcolor = opts.fontcolor ?? 'white';
  const enable = `enable='between(t\\,0\\,${durationSec.toFixed(1)})'`;
  const one = (line: string, size: number, y: number): string => {
    const border = Math.max(2, Math.round(size / 14));
    const boxBorder = Math.round(size * 0.35);
    const box =
      opts.boxed === false
        ? ''
        : `box=1:boxcolor=black@0.55:boxborderw=${boxBorder}:`;
    return (
      `drawtext=fontfile=${fontfile}:text='${escapeDrawtext(line)}':` +
      `fontsize=${size}:fontcolor=${fontcolor}:borderw=${border}:bordercolor=black:` +
      `${box}` +
      `x=(w-text_w)/2:y=${y}:${enable}`
    );
  };
  if (measureTitleWidthEm(clean, font) * baseFontSize <= maxWidthPx) {
    return one(clean, baseFontSize, Math.round(targetH * 0.07));
  }
  const words = clean.split(' ');
  if (words.length < 2) {
    return one(clean, baseFontSize, Math.round(targetH * 0.07));
  }
  const [l1, l2] = bestTwoLineSplit(words, font);
  const maxLineEm = Math.max(measureTitleWidthEm(l1, font), measureTitleWidthEm(l2, font));
  const fontSize = Math.max(28, Math.min(baseFontSize, Math.floor(maxWidthPx / maxLineEm)));
  const y1 = Math.round(targetH * 0.015);
  const y2 = y1 + Math.round(fontSize * 1.12);
  return `${one(l1, fontSize, y1)},${one(l2, fontSize, y2)}`;
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
