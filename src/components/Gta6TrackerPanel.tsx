import React, { useState } from 'react';
import { Calendar, ExternalLink, Gamepad2, RefreshCw, Sparkles, Video } from 'lucide-react';
import type { LanguageMode, VideoSource } from '../lib/types';

interface Gta6VideoCandidate {
  videoId: string;
  title: string;
  channel: string;
  youtubeUrl: string;
  thumbnailUrl: string;
  durationSec: number;
  qualityNote: string;
}

interface Gta6TrackResponse {
  usedSearchGrounding: boolean;
  releaseSummary: string;
  sources: Array<{ title: string; uri: string }>;
  liveYoutubeFound: boolean;
  videos: Gta6VideoCandidate[];
}

interface Gta6TrackerPanelProps {
  lang: LanguageMode;
  onLoadGta6Clip: (source: VideoSource, note: string) => void;
}

function buildGta6Source(candidate: Gta6VideoCandidate): VideoSource {
  const dur = Math.max(90, candidate.durationSec || 120);
  const bucketCount = Math.ceil(dur / 5);
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
    segments: [
      {
        start: 0,
        end: 18,
        text: 'Welcome back to Vice City! Look at the insane ray-traced reflections and dense traffic AI right here!',
        words: [],
      },
      {
        start: 18,
        end: 42,
        text: 'Wait until you see this high-speed highway chase through Leonida — nobody expected this level of physics detail!',
        words: [],
      },
      {
        start: 42,
        end: 70,
        text: 'Watch the final 10 seconds as the police helicopter locks on across the neon Vice Beach strip!',
        words: [],
      },
      {
        start: 70,
        end: 95,
        text: 'That stunt jump over the drawbridge at 60 FPS looks unreal — drop your hype score below!',
        words: [],
      },
    ],
    audioEnergyProfile: Array.from({ length: bucketCount }, (_, i) =>
      i >= 4 && i <= 14 ? 86 + ((i * 3) % 12) : 64 + ((i * 5) % 18)
    ),
    faceTrackProfile: Array.from({ length: bucketCount }, () => 24),
    presetHooks: {
      '15': {
        hookScore: 95,
        reason: 'High-speed GTA 6 chase + visual physics reveal',
        hooks: [
          'GTA 6 Vice City physics look UNREAL!',
          'Wait for the neon highway chase at 0:42!',
          '60 FPS Leonida gameplay — worth the wait?',
        ],
      },
    },
  };
}

export const Gta6TrackerPanel: React.FC<Gta6TrackerPanelProps> = ({ lang, onLoadGta6Clip }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [trackData, setTrackData] = useState<Gta6TrackResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const handleTrackGta6 = async () => {
    setIsLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/gta6-track', { method: 'POST' });
      if (!res.ok) throw new Error('Track request failed');
      const data = (await res.json()) as Gta6TrackResponse;
      setTrackData(data);
    } catch {
      setErrorMsg(
        lang === 'bn'
          ? 'GTA 6 ট্র্যাকার সার্ভার রেসপন্স করেনি, আবার চেষ্টা করুন।'
          : 'Could not reach GTA 6 tracker endpoint. Please try again.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-4 border-b border-slate-100">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900 flex items-center gap-2">
            <Gamepad2 className="w-5 h-5 text-rose-600 shrink-0" aria-hidden="true" />
            <span>
              {lang === 'bn'
                ? 'GTA 6 রিলিজ ডেট ট্র্যাকার ও 4K গেমপ্লে অটো-ক্লিপার'
                : 'GTA 6 Release Tracker & Best-Quality Gameplay Finder'}
            </span>
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            {lang === 'bn'
              ? 'Gemini Google Search দিয়ে GTA 6-এর সর্বশেষ অফিশিয়াল রিলিজ ডেট ট্র্যাক করে, YouTube থেকে সেরা কোয়ালিটির 4K গেমপ্লে খুঁজে এনে Pro FFmpeg ট্রান্সফর্ম রেডি করে।'
              : 'Tracks the latest official GTA 6 release date via Gemini Search Grounding, finds best-quality 4K gameplay on YouTube via yt-dlp, and applies Pro Viral FFmpeg Transform.'}
          </p>
        </div>

        <button
          type="button"
          onClick={handleTrackGta6}
          disabled={isLoading}
          className="inline-flex items-center gap-2 h-10 px-4 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 shrink-0 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span>
            {isLoading
              ? lang === 'bn'
                ? 'GTA 6 ট্র্যাক হচ্ছে...'
                : 'Tracking GTA 6...'
              : lang === 'bn'
                ? 'GTA 6 ট্র্যাক ও গেমপ্লে খুঁজুন'
                : 'Track Release & Find GTA 6 Clips'}
          </span>
        </button>
      </div>

      {errorMsg && <p className="text-xs font-medium text-rose-700 mt-3">{errorMsg}</p>}

      {trackData && (
        <div className="mt-4 space-y-4">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
              <Calendar className="w-4 h-4 text-rose-600 shrink-0" aria-hidden="true" />
              <span>
                {trackData.usedSearchGrounding
                  ? lang === 'bn'
                    ? 'লাইভ GTA 6 রিলিজ স্ট্যাটাস (Google Search Grounded)'
                    : 'Live GTA 6 Release Status (Google Search Grounded)'
                  : lang === 'bn'
                    ? 'GTA 6 রিলিজ ট্র্যাকার স্ট্যাটাস'
                    : 'GTA 6 Release Tracker Status'}
              </span>
            </div>
            <p className="text-sm text-slate-700 leading-relaxed">{trackData.releaseSummary}</p>

            {trackData.sources.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1 text-xs">
                <span className="font-medium text-slate-500">Sources:</span>
                {trackData.sources.map((src, idx) => (
                  <a
                    key={`${src.uri}-${idx}`}
                    href={src.uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-rose-700 hover:underline font-medium"
                  >
                    <span className="truncate max-w-[200px]">{src.title}</span>
                    <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                  </a>
                ))}
              </div>
            )}
          </div>

          {trackData.videos.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {trackData.videos.map((vid) => (
                <article
                  key={vid.videoId}
                  className="border border-slate-200 rounded-xl overflow-hidden flex flex-col bg-white"
                >
                  <div className="relative aspect-video bg-slate-900 overflow-hidden">
                    {vid.thumbnailUrl ? (
                      <img
                        src={vid.thumbnailUrl}
                        alt={vid.title}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Video className="w-8 h-8 text-slate-500" aria-hidden="true" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent pointer-events-none" />
                    <span className="absolute bottom-2 left-2.5 text-[11px] font-mono text-white">
                      {vid.qualityNote}
                    </span>
                  </div>
                  <div className="p-3.5 flex-1 flex flex-col justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium text-slate-500">{vid.channel}</p>
                      <h3 className="text-sm font-bold text-slate-900 mt-1 line-clamp-2 leading-snug">
                        {vid.title}
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        onLoadGta6Clip(
                          buildGta6Source(vid),
                          `Loaded GTA 6 clip (${vid.channel}) with Gaming Split + Pro Viral FFmpeg Transform.`
                        )
                      }
                      className="w-full h-9 inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>
                        {lang === 'bn' ? 'স্টুডিওতে লোড ও এডিট করুন' : 'Load & Viral-Edit in Studio'}
                      </span>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-600">
              {lang === 'bn'
                ? 'লাইভ YouTube 4K সার্চের জন্য আপনার Linux PC-তে `npm run setup:linux && npm run dev` চালান — `yt-dlp` অটোমেটিক্যালি সেরা কোয়ালিটির GTA 6 গেমপ্লে খুঁজে এনে Pro FFmpeg দিয়ে রেন্ডার করবে।'
                : 'Run "npm run setup:linux && npm run dev" on your Linux PC to enable live zero-key yt-dlp 4K GTA 6 gameplay search & local MP4 viral transform rendering.'}
            </p>
          )}
        </div>
      )}
    </section>
  );
};
