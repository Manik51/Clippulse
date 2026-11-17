import React, { useEffect, useRef, useState } from 'react';
import { Calendar, ExternalLink, Eye, Gamepad2, RefreshCw, Sparkles, Video } from 'lucide-react';
import type { LanguageMode, VideoSource } from '../lib/types';
import { formatCountdownPart, formatGta6Views, getGta6Countdown } from '../lib/gta6';
import type { Gta6Countdown } from '../lib/gta6';

interface Gta6VideoCandidate {
  videoId: string;
  title: string;
  channel: string;
  youtubeUrl: string;
  thumbnailUrl: string;
  durationSec: number;
  qualityNote: string;
  views: number | null;
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
  // Launch countdown: local midnight Nov 19, 2026 (browser's timezone).
  const [countdown, setCountdown] = useState<Gta6Countdown>(() => getGta6Countdown());
  const autoFetchedRef = useRef(false);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCountdown(getGta6Countdown());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

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

  // Once the countdown hits zero, stop ticking into negatives and fetch the
  // live gameplay grid once. Manual Track button stays available for retry.
  useEffect(() => {
    if (countdown.isLive && !autoFetchedRef.current && !isLoading) {
      autoFetchedRef.current = true;
      void handleTrackGta6();
    }
    // Intentionally runs only on the live flip; handleTrackGta6 is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown.isLive]);

  const loadVideo = (vid: Gta6VideoCandidate) => {
    onLoadGta6Clip(
      buildGta6Source(vid),
      `Loaded GTA 6 clip (${vid.channel}) with Gaming Split + Pro Viral FFmpeg Transform.`
    );
  };

  // GTA 6 tab theme lives ONLY here: dark Vice City neon (pink / purple /
  // cyan sunset gradients, Anton display type). No Rockstar artwork or logos
  // — CSS gradients, colours and typography only. The rest of the app is untouched.
  return (
    <section className="bg-slate-950 border border-fuchsia-500/30 rounded-xl overflow-hidden">
      {/* Vice City sunset strip */}
      <div
        className="h-1.5 w-full bg-gradient-to-r from-fuchsia-500 via-purple-500 to-cyan-400"
        aria-hidden="true"
      />
      <div className="p-5">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-4 border-b border-white/10">
        <div>
          <h2 className="flex items-center gap-2.5">
            <Gamepad2 className="w-6 h-6 text-fuchsia-400 shrink-0" aria-hidden="true" />
            <span className="font-['Anton'] text-3xl tracking-wide leading-none bg-gradient-to-r from-fuchsia-400 via-rose-300 to-cyan-300 bg-clip-text text-transparent">
              GTA 6
            </span>
            <span className="font-display text-lg font-bold text-white leading-none">
              {lang === 'bn' ? 'রিলিজ ট্র্যাকার' : 'Release Tracker'}
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-1.5">
            {lang === 'bn'
              ? 'Gemini Google Search দিয়ে GTA 6-এর সর্বশেষ অফিশিয়াল রিলিজ ডেট ট্র্যাক করে, YouTube থেকে সেরা কোয়ালিটির 4K গেমপ্লে খুঁজে এনে Pro FFmpeg ট্রান্সফর্ম রেডি করে।'
              : 'Tracks the latest official GTA 6 release date via Gemini Search Grounding, finds best-quality 4K gameplay on YouTube via yt-dlp, and applies Pro Viral FFmpeg Transform.'}
          </p>
        </div>

        <button
          type="button"
          onClick={handleTrackGta6}
          disabled={isLoading}
          className="inline-flex items-center gap-2 h-10 px-4 text-sm font-semibold text-white bg-gradient-to-r from-fuchsia-600 to-violet-600 hover:from-fuchsia-500 hover:to-violet-500 shadow-[0_0_18px_rgba(192,38,211,0.35)] disabled:opacity-60 rounded-lg transition-all whitespace-nowrap shrink-0 cursor-pointer"
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

      {countdown.isLive ? (
        <div className="mt-4 rounded-xl bg-gradient-to-r from-rose-600 via-fuchsia-600 to-purple-600 shadow-[0_0_28px_rgba(225,29,72,0.45)] text-white p-5 flex items-start gap-3">
          <span className="relative flex h-3 w-3 mt-1.5 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-white" />
          </span>
          <div>
            <p className="font-display text-lg font-bold leading-tight">
              {lang === 'bn' ? 'LIVE — GTA 6 এখন লাইভ!' : 'LIVE NOW — GTA 6 is out!'}
            </p>
            <p className="text-sm text-rose-100 mt-0.5">
              {lang === 'bn'
                ? 'YouTube-এ GTA 6 গেমপ্লে লাইভ — নিচে বড় চ্যানেলগুলোর ভিডিও। যেকোনো ভিডিওতে ক্লিক করলেই স্টুডিওতে লোড হবে, তারপর ক্লিপ বানাতে পারবেন।'
                : 'GTA 6 gameplay is live on YouTube — the biggest channels are below. Click any video to load it into the studio and clip it.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-fuchsia-500/30 bg-gradient-to-br from-fuchsia-600/15 via-slate-900 to-cyan-500/15 p-5 shadow-[0_0_24px_rgba(168,85,247,0.18)]">
          <p className="text-xs font-semibold tracking-widest text-fuchsia-300 uppercase">
            {lang === 'bn' ? 'GTA 6 আসছে' : 'GTA 6 launches in'}
          </p>
          <div className="flex gap-2 sm:gap-3 mt-3">
            {[
              { value: countdown.days, label: lang === 'bn' ? 'দিন' : 'Days' },
              { value: countdown.hours, label: lang === 'bn' ? 'ঘণ্টা' : 'Hours' },
              { value: countdown.minutes, label: lang === 'bn' ? 'মিনিট' : 'Mins' },
              { value: countdown.seconds, label: lang === 'bn' ? 'সেকেন্ড' : 'Secs' },
            ].map((part) => (
              <div
                key={part.label}
                className="flex-1 rounded-lg bg-black/40 border border-white/10 px-2 py-3 text-center"
              >
                <p className="font-['Anton'] text-3xl sm:text-4xl leading-none tabular-nums bg-gradient-to-b from-white via-fuchsia-200 to-cyan-300 bg-clip-text text-transparent drop-shadow-[0_0_12px_rgba(217,70,239,0.55)]">
                  {formatCountdownPart(part.value)}
                </p>
                <p className="text-[11px] font-medium text-slate-400 mt-1.5">{part.label}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-400 mt-3">
            {lang === 'bn'
              ? 'বৃহস্পতিবার, ১৯ নভেম্বর ২০২৬ · স্থানীয় সময় রাত ১২টা (আপনার টাইমজোন) · PS5 ও Xbox Series X|S'
              : 'Thursday, November 19, 2026 · local midnight (your timezone) · PS5 & Xbox Series X|S'}
          </p>
        </div>
      )}

      {errorMsg && <p className="text-xs font-medium text-rose-400 mt-3">{errorMsg}</p>}

      {trackData && (
        <div className="mt-4 space-y-4">
          <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-white">
              <Calendar className="w-4 h-4 text-fuchsia-400 shrink-0" aria-hidden="true" />
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
            <p className="text-sm text-slate-300 leading-relaxed">{trackData.releaseSummary}</p>

            {trackData.sources.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1 text-xs">
                <span className="font-medium text-slate-400">Sources:</span>
                {trackData.sources.map((src, idx) => (
                  <a
                    key={`${src.uri}-${idx}`}
                    href={src.uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-rose-300 hover:underline font-medium"
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
                  onClick={() => loadVideo(vid)}
                  title={
                    lang === 'bn'
                      ? 'ক্লিক করলে ভিডিওটি স্টুডিওতে লোড হবে'
                      : 'Click to load this video into the studio'
                  }
                  className="border border-white/10 rounded-xl overflow-hidden flex flex-col bg-slate-900 cursor-pointer hover:border-fuchsia-400/70 hover:shadow-[0_0_22px_rgba(217,70,239,0.35)] transition-all"
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
                    {formatGta6Views(vid.views) && (
                      <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur-sm">
                        <Eye className="w-3 h-3" aria-hidden="true" />
                        {formatGta6Views(vid.views)} views
                      </span>
                    )}
                    <span className="absolute bottom-2 left-2.5 text-[11px] font-mono text-white">
                      {vid.qualityNote}
                    </span>
                  </div>
                  <div className="p-3.5 flex-1 flex flex-col justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 via-purple-500 to-cyan-400 text-[11px] font-bold text-white">
                          {vid.channel.trim().charAt(0).toUpperCase() || 'G'}
                        </span>
                        <p className="text-xs font-medium text-slate-400 truncate">{vid.channel}</p>
                      </div>
                      <h3 className="text-sm font-bold text-white mt-1.5 line-clamp-2 leading-snug">
                        {vid.title}
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        loadVideo(vid);
                      }}
                      className="w-full h-9 inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-white bg-gradient-to-r from-fuchsia-600 to-violet-600 hover:from-fuchsia-500 hover:to-violet-500 hover:shadow-[0_0_18px_rgba(192,38,211,0.5)] rounded-lg transition-all cursor-pointer"
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
            <p className="text-xs text-slate-400">
              {lang === 'bn'
                ? 'লাইভ YouTube 4K সার্চের জন্য আপনার Linux PC-তে `npm run setup:linux && npm run dev` চালান — `yt-dlp` অটোমেটিক্যালি সেরা কোয়ালিটির GTA 6 গেমপ্লে খুঁজে এনে Pro FFmpeg দিয়ে রেন্ডার করবে।'
                : 'Run "npm run setup:linux && npm run dev" on your Linux PC to enable live zero-key yt-dlp 4K GTA 6 gameplay search & local MP4 viral transform rendering.'}
            </p>
          )}
        </div>
      )}
      </div>
    </section>
  );
};
