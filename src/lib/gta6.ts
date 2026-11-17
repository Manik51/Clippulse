/**
 * GTA 6 launch countdown.
 *
 * Grand Theft Auto VI launches Thursday, November 19, 2026, at local
 * midnight per region (midnight local time, PS5 and Xbox Series X|S).
 * The target is local midnight in the browser's own timezone, so the
 * countdown is computed client-side from `new Date(2026, 10, 19)`.
 */

export const GTA6_LAUNCH_YEAR = 2026;
/** 0-indexed month: 10 = November. */
export const GTA6_LAUNCH_MONTH_INDEX = 10;
export const GTA6_LAUNCH_DAY = 19;

export function gta6LaunchDate(): Date {
  return new Date(GTA6_LAUNCH_YEAR, GTA6_LAUNCH_MONTH_INDEX, GTA6_LAUNCH_DAY, 0, 0, 0, 0);
}

export interface Gta6Countdown {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  /** Milliseconds left until launch; 0 once live. */
  totalMs: number;
  /** True once local midnight Nov 19, 2026 has passed — launch is live. */
  isLive: boolean;
}

export function getGta6Countdown(now: Date = new Date()): Gta6Countdown {
  const totalMs = gta6LaunchDate().getTime() - now.getTime();
  if (totalMs <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, totalMs: 0, isLive: true };
  }
  const totalSec = Math.floor(totalMs / 1000);
  return {
    days: Math.floor(totalSec / 86400),
    hours: Math.floor((totalSec % 86400) / 3600),
    minutes: Math.floor((totalSec % 3600) / 60),
    seconds: totalSec % 60,
    totalMs,
    isLive: false,
  };
}

/** Two-digit clock part: 5 -> "05", 12 -> "12". */
export function formatCountdownPart(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(2, '0');
}

import type { VideoSource } from './types';

/** Compact view count for the video grid chips: 1_234_567 -> "1.2M". */
export function formatGta6Views(views: number | null | undefined): string | null {
  if (typeof views !== 'number' || !Number.isFinite(views) || views < 0) return null;
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(views >= 10_000_000 ? 0 : 1)}M`;
  if (views >= 1_000) return `${Math.round(views / 1_000)}K`;
  return `${views}`;
}

export interface Gta6VideoCandidate {
  videoId: string;
  title: string;
  channel: string;
  youtubeUrl: string;
  thumbnailUrl: string;
  durationSec: number;
  qualityNote: string;
  views: number | null;
}

/**
 * Build the workbench source for a GTA 6 grid video.
 *
 * Deliberately carries ONLY the video's real metadata from the live
 * search result — title, channel, URL, thumbnail, duration. No
 * transcript, no hook scores, no audio-energy values: none of those
 * exist until the video is actually analyzed, and inventing them made
 * the workbench display fabricated words and scores as if they were
 * real. Empty segments/profiles mean the workbench shows an honest
 * "not analyzed yet" state and no scored windows; the real Analyze
 * flow fills them in when it runs.
 */
export function buildGta6Source(candidate: Gta6VideoCandidate): VideoSource {
  const dur = Math.max(90, candidate.durationSec || 120);
  return {
    id: `gta6-${candidate.videoId}`,
    title: candidate.title,
    channel: candidate.channel,
    category: 'gaming',
    framingMode: 'gaming-split',
    licenseStatus: 'indie-safe',
    licenseNote: 'Pro Viral Transform Ready (1.06x Zoom, Color Grade, Pitch/Speed & Progress Bar)',
    youtubeUrl: candidate.youtubeUrl,
    durationSec: dur,
    thumbnailUrl: candidate.thumbnailUrl,
    fallbackGradient: 'from-slate-900 via-rose-950 to-slate-950',
    transcriptSource: 'faster-whisper',
    segments: [],
    audioEnergyProfile: [],
    faceTrackProfile: [],
  };
}
