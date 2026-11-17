export type LanguageMode = 'en' | 'bn';

export type CaptionStyle =
  | 'hormozi-v1'
  | 'red-line'
  | 'undercut'
  | 'streamline'
  | 'hormozi-2026-a'
  | 'hormozi-2026-b'
  | 'hormozi-2026-c'
  | 'hormozi-2026-d'
  | 'hormozi-2026-e'
  | 'mrbeast'
  | 'iman-a'
  | 'cardone-a'
  | 'hollywood-fill'
  | 'roman'
  | 'sara'
  | 'ali'
  | 'axel'
  | 'yellow-burst';

/**
 * ClipPulse v8.8 — gallery-picker overrides, wired into the render.
 * Any field left undefined keeps the preset's own value. fontSize is
 * px (slider 20–72); fontColour is a '#RRGGBB' hex; positionPct is
 * 0–100 (0 = lowest, 100 = highest on screen).
 */
export interface CaptionOverrides {
  fontSize?: number;
  fontColour?: string;
  positionPct?: number;
}

export type WorkspaceTab = 'workbench' | 'blueprint' | 'trending';

export type VideoCategory = 'podcast' | 'cricket' | 'boxing' | 'football' | 'gaming';

export type FramingMode = 'face-track' | 'sports-blur' | 'gaming-split';

export type LicenseStatus = 'cc-by' | 'indie-safe' | 'broadcast-risk';

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  words: TranscriptWord[];
}

export interface ScoringWeights {
  hook: number;
  emotion: number;
  audio: number;
  pacing: number;
}

export interface WindowScoreFactors {
  hook: number;
  emotion: number;
  audio: number;
  pacing: number;
}

export interface SlidingWindow {
  id: string;
  startSec: number;
  endSec: number;
  transcriptText: string;
  wordCount: number;
  wordsPerMinute: number;
  factors: WindowScoreFactors;
  totalScore: number;
  hookReason: string;
  suggestedHooks: string[];
  matchedKeywords: string[];
  faceOffsetX: number; // 0-100 percentage across 16:9 frame for 9:16 crop center
}

export interface VideoSource {
  id: string;
  title: string;
  channel: string;
  category: VideoCategory;
  framingMode: FramingMode;
  licenseStatus: LicenseStatus;
  licenseNote: string;
  youtubeUrl: string;
  uploadedVideoId?: string;
  uploadedVideoUrl?: string;
  durationSec: number;
  thumbnailUrl: string;
  fallbackGradient: string;
  transcriptSource: 'youtube-transcript-api' | 'faster-whisper' | 'custom-paste';
  segments: TranscriptSegment[];
  audioEnergyProfile: number[]; // energy 0..100 per 5-second bucket
  faceTrackProfile: number[]; // horizontal center % (20..80) per 5-second bucket
  presetHooks?: Record<string, { hookScore: number; reason: string; hooks: string[] }>;
}

export interface CopyrightEvaluation {
  safe: boolean;
  status: LicenseStatus;
  label: string;
  summary: string;
}

export interface AutoFetchPackItem {
  category: VideoCategory;
  source: VideoSource;
  topWindow: SlidingWindow;
  windows: SlidingWindow[];
  copyright: CopyrightEvaluation;
}
