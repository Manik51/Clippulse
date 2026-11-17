import React, { useRef, useState } from 'react';
import { Download, Flame, Play, RefreshCw, TrendingUp } from 'lucide-react';
import { generateAssSubtitle, extractYoutubeVideoId, CLIP_LENGTH_PRESETS, normalizeClipLengthSec } from '../lib/virality';
import type { CaptionOverrides, CaptionStyle, FramingMode, TranscriptSegment } from '../lib/types';

/**
 * ClipPulse v6 — Trending Clips: the simple flow Manik asked for.
 *   [Fetch Trends] -> channel cards (logo + name) -> pick a video
 *   -> smart-analyze finds the best moments -> top 4 NON-overlapping
 *   windows render as proper 9:16 clips with karaoke subtitles
 *   -> preview each clip in the page -> Download MP4, direct.
 *
 * Renders run SEQUENTIALLY (one at a time) because this box has 1.5
 * shared CPUs — parallel 4K encodes would crawl. Each clip shows its
 * own status, so finished clips are watchable while the rest render.
 */

interface TrendVideo {
  videoId: string;
  title: string;
  views: number | null;
  durationSec: number | null;
  thumbnailUrl: string;
  url: string;
}

interface TrendChannel {
  handle: string;
  label: string;
  logoUrl: string;
  channelId: string;
  followers: number | null;
  videos: TrendVideo[];
}

interface SmartWindow {
  startSec: number;
  endSec: number;
  totalScore: number;
  factors?: Record<string, number>;
  hookReason: string;
  transcriptText: string;
  suggestedHooks: string[];
}

interface SmartAnalysis {
  title: string;
  channel: string;
  durationSec: number;
  topWindow: SmartWindow | null;
  windows: SmartWindow[];
  segments: TranscriptSegment[];
}

type ClipStatus = 'queued' | 'rendering' | 'done' | 'failed';

interface ClipJob {
  window: SmartWindow;
  status: ClipStatus;
  streamUrl: string;
  downloadUrl: string;
  error: string;
  isNative4k: boolean;
}

type Quality = '720p' | '1080p' | '4k';
type FramingChoice = 'auto' | FramingMode;

function formatViews(views: number | null): string {
  if (views === null || views === undefined) return '—';
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(views >= 10_000_000 ? 0 : 1)}M views`;
  if (views >= 1_000) return `${Math.round(views / 1_000)}K views`;
  return `${views} views`;
}

function formatCompact(n: number | null): string {
  if (n === null || n === undefined) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M subs`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K subs`;
  return `${n} subs`;
}

function formatClock(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Greedy non-overlapping top windows: take the best, skip anything that overlaps it. */
function pickTopClips(windows: SmartWindow[], count: number): SmartWindow[] {
  const sorted = [...windows].sort((a, b) => b.totalScore - a.totalScore);
  const picked: SmartWindow[] = [];
  for (const w of sorted) {
    if (picked.length >= count) break;
    const overlaps = picked.some((p) => w.startSec < p.endSec && w.endSec > p.startSec);
    if (!overlaps) picked.push(w);
  }
  return picked;
}

/** Poll GET /api/job-status/:jobId until the long job finishes. Renders and
 *  smart-analyses take minutes here — a single fetch would die at most
 *  clients' headers timeout, so the server answers immediately with a jobId
 *  and we poll. Throws with the job's message on failure/timeout. */
async function pollJob(jobId: string, timeoutMs = 30 * 60 * 1000): Promise<Record<string, unknown>> {
  const started = Date.now();
  for (;;) {
    const res = await fetch(`/api/job-status/${jobId}`);
    if (!res.ok) throw new Error('Job status check failed.');
    const data = await res.json();
    if (data.status === 'done' && data.result) return data.result as Record<string, unknown>;
    if (data.status === 'failed') {
      const r = (data.result || {}) as Record<string, unknown>;
      throw new Error(
        (r.message as string) || (r.error as string) || 'Job failed.'
      );
    }
    if (Date.now() - started > timeoutMs) throw new Error('Job timed out after 30 minutes.');
    await new Promise((r) => setTimeout(r, 8000));
  }
}

interface TrendingClipsPanelProps {
  /** Caption style picked in the workbench gallery — this is what the
   * 4 clips actually render with (v8.8: the old code hardcoded 'karaoke'
   * here, so the picker never reached a render). */
  captionStyle?: CaptionStyle;
  /** Gallery-picker overrides (font size / colour / position). */
  captionOverrides?: CaptionOverrides;
}

export const TrendingClipsPanel: React.FC<TrendingClipsPanelProps> = ({
  captionStyle = 'hormozi-v1',
  captionOverrides = {},
}) => {
  const [stage, setStage] = useState<'idle' | 'loading' | 'channels' | 'analyzing' | 'ready'>('idle');
  const [channels, setChannels] = useState<TrendChannel[]>([]);
  const [selectedHandle, setSelectedHandle] = useState<string>('');
  const [customChannel, setCustomChannel] = useState<TrendChannel | null>(null);
  const [linkUrl, setLinkUrl] = useState<string>('');
  const [selectedVideo, setSelectedVideo] = useState<TrendVideo | null>(null);
  const [analysis, setAnalysis] = useState<SmartAnalysis | null>(null);
  const [clips, setClips] = useState<ClipJob[]>([]);
  const [quality, setQuality] = useState<Quality>('1080p');
  const [framing, setFraming] = useState<FramingChoice>('auto');
  // v8.6 — clip length: 30s default; presets 30/45/60 or a custom 10–180s.
  const [clipLengthSec, setClipLengthSec] = useState<number>(30);
  const [customLength, setCustomLength] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [note, setNote] = useState<string>('');
  const runIdRef = useRef<number>(0);

  const selectedChannel = channels.find((c) => c.handle === selectedHandle) || customChannel;

  // v8.6 — custom length: a valid number updates the effective length
  // (clamped 10–180s by the normaliser); an invalid value on blur resets
  // to the 30s default instead of leaving a broken state.
  const handleCustomLength = (text: string) => {
    setCustomLength(text);
    const n = Number(text);
    if (Number.isFinite(n) && n > 0) setClipLengthSec(normalizeClipLengthSec(n));
  };
  const handleCustomLengthBlur = () => {
    if (customLength !== '' && !(Number(customLength) > 0)) {
      setCustomLength('');
      setClipLengthSec(30);
    }
  };

  const fetchTrends = async () => {
    setError('');
    setNote('');
    setCustomChannel(null);
    setSelectedHandle('');
    setStage('loading');
    try {
      const res = await fetch('/api/trending?limit=3');
      const data = await res.json();
      if (!res.ok || !data.ok || !Array.isArray(data.creators)) {
        setError(data.message || 'Could not fetch trending creators.');
        setStage('idle');
        return;
      }
      setChannels(data.creators as TrendChannel[]);
      setStage('channels');
      setNote(
        `Fetched ${data.creators.length} trending creators · sorted by real view count · ${new Date().toLocaleTimeString()}`
      );
    } catch {
      setError('Could not reach the server. Is ClipPulse running?');
      setStage('idle');
    }
  };

  const resolveFraming = (channel: TrendChannel): FramingMode => {
    if (framing !== 'auto') return framing;
    return channel.handle.toLowerCase() === 'dream' ? 'gaming-split' : 'face-track';
  };

  const renderOneClip = async (
    runId: number,
    index: number,
    video: TrendVideo,
    channel: TrendChannel,
    win: SmartWindow,
    segments: TranscriptSegment[],
    q: Quality
  ) => {
    setClips((prev) => prev.map((c, i) => (i === index ? { ...c, status: 'rendering', error: '' } : c)));
    try {
      const hook = win.suggestedHooks?.[0] || '';
      // v8.8 — the picked gallery style + overrides are what renders
      // (the old code hardcoded 'karaoke' here).
      const assContent = generateAssSubtitle(
        segments,
        win.startSec,
        win.endSec,
        hook,
        captionStyle,
        undefined,
        true,
        undefined,
        captionOverrides
      );
      const res = await fetch('/api/render-local-mp4', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          youtubeUrl: video.url,
          title: video.title,
          category: channel.handle.toLowerCase() === 'dream' ? 'gaming' : 'podcast',
          outputQuality: q,
          startSec: win.startSec,
          endSec: win.endSec,
          // v8.6 — the window's own length, so the render matches the
          // analyzed window even if the picker moved since.
          clipLengthSec: Math.round(win.endSec - win.startSec),
          faceOffsetX: 50,
          framingMode: resolveFraming(channel),
          assContent,
          copyrightSafeTransform: true,
          mirrorFlip: false,
        }),
      });
      const data = await res.json();
      if (runIdRef.current !== runId) return;
      if (!data.ok) {
        throw new Error(data.message || 'Could not start the render.');
      }
      // v6: the server answers at once with a jobId; the render itself
      // takes minutes, so poll until it lands.
      const r = data.downloadUrl ? data : await pollJob(data.jobId as string);
      if (runIdRef.current !== runId) return;
      if (r.ok && r.downloadUrl) {
        setClips((prev) =>
          prev.map((c, i) =>
            i === index
              ? {
                  ...c,
                  status: 'done',
                  streamUrl: (r.streamUrl as string) || (r.downloadUrl as string),
                  downloadUrl: r.downloadUrl as string,
                  isNative4k: Boolean(r.isNative4k),
                }
              : c
          )
        );
      } else {
        setClips((prev) =>
          prev.map((c, i) =>
            i === index
              ? { ...c, status: 'failed', error: (r.message as string) || 'Render failed.' }
              : c
          )
        );
      }
    } catch (err) {
      if (runIdRef.current !== runId) return;
      setClips((prev) =>
        prev.map((c, i) =>
          i === index
            ? { ...c, status: 'failed', error: err instanceof Error ? err.message : 'Render request failed.' }
            : c
        )
      );
    }
  };

  const makeClips = async (video: TrendVideo, channel: TrendChannel) => {
    const runId = ++runIdRef.current;
    setError('');
    setSelectedVideo(video);
    setAnalysis(null);
    setClips([]);
    setBusy(true);
    setStage('analyzing');
    setNote(`Analyzing "${video.title}" — listening to the full audio and finding the best moments…`);
    try {
      const res = await fetch('/api/smart-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          youtubeUrl: video.url,
          category: channel.handle.toLowerCase() === 'dream' ? 'gaming' : 'podcast',
          clipLengthSec,
        }),
      });
      const data = await res.json();
      if (runIdRef.current !== runId) return;
      if (!data.ok) {
        setError(data.error || 'Analysis failed.');
        setStage('channels');
        setBusy(false);
        return;
      }
      // v6: the server answers at once with a jobId (a long video takes
      // ~10 min to analyse here); poll until the result lands.
      const an = data.jobId ? await pollJob(data.jobId as string) : data;
      if (runIdRef.current !== runId) return;
      if (!an.ok || !Array.isArray(an.windows) || (an.windows as unknown[]).length === 0) {
        setError((an.error as string) || 'No strong moment found in this video.');
        setStage('channels');
        setBusy(false);
        return;
      }
      const picked = pickTopClips(an.windows as SmartWindow[], 4);
      if (picked.length === 0) {
        setError('No strong moment found in this video.');
        setStage('channels');
        setBusy(false);
        return;
      }
      const parsed: SmartAnalysis = {
        title: (an.title as string) || video.title,
        channel: (an.channel as string) || channel.label,
        durationSec: (an.durationSec as number) || 0,
        topWindow: (an.topWindow as SmartWindow) || null,
        windows: an.windows as SmartWindow[],
        segments: Array.isArray(an.segments) ? (an.segments as TranscriptSegment[]) : [],
      };
      setAnalysis(parsed);
      const jobs: ClipJob[] = picked.map((w) => ({
        window: w,
        status: 'queued',
        streamUrl: '',
        downloadUrl: '',
        error: '',
        isNative4k: false,
      }));
      setClips(jobs);
      setStage('ready');
      setNote(
        `Best moment ${formatClock(picked[0].startSec)}–${formatClock(picked[0].endSec)} (score ${picked[0].totalScore.toFixed(1)}) · rendering ${jobs.length} clips one by one…` +
          (an.hasTranscript === false
            ? ' Note: the transcript failed for this video, so these moments are picked from audio energy only — try again for transcript-based moments.'
            : '')
      );
      for (let i = 0; i < jobs.length; i++) {
        if (runIdRef.current !== runId) return;
        await renderOneClip(runId, i, video, channel, jobs[i].window, parsed.segments, quality);
      }
      if (runIdRef.current === runId) {
        setNote(`Done — ${jobs.length} clips from "${video.title}". Watch them below, then download.`);
      }
    } catch {
      if (runIdRef.current !== runId) return;
      setError('Analysis failed. Check the server and try again.');
      setStage('channels');
    } finally {
      if (runIdRef.current === runId) setBusy(false);
    }
  };

  const retryClip = async (index: number) => {
    if (!selectedVideo || !selectedChannel || !analysis) return;
    const runId = runIdRef.current;
    setBusy(true);
    await renderOneClip(runId, index, selectedVideo, selectedChannel, clips[index].window, analysis.segments, quality);
    setBusy(false);
  };

  /** v7.2 — paste-a-link: any long YouTube video goes through the exact
   * same analyse -> 4 pro clips flow as a trending video. The channel is
   * synthetic ('custom' -> podcast category -> face-track framing). */
  const makeClipsFromLink = async () => {
    const url = linkUrl.trim();
    const videoId = extractYoutubeVideoId(url);
    if (!videoId) {
      setError('That does not look like a YouTube video link. Paste a youtube.com/watch or youtu.be link (or just the video id).');
      return;
    }
    const video: TrendVideo = {
      videoId,
      title: 'Your pasted video',
      views: null,
      durationSec: null,
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      url: url.startsWith('http') ? url : `https://www.youtube.com/watch?v=${videoId}`,
    };
    const channel: TrendChannel = {
      handle: 'custom',
      label: 'Your link',
      logoUrl: '',
      channelId: '',
      followers: null,
      videos: [video],
    };
    setCustomChannel(channel);
    setSelectedHandle('');
    await makeClips(video, channel);
  };

  return (
    <section className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
        <div className="flex flex-col md:flex-row md:items-center gap-4 justify-between">
          <div>
            <h2 className="font-display text-xl font-bold text-slate-900 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-rose-600" aria-hidden="true" />
              Trending Creators — 1 click, 4 clips
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Fetch the biggest creators, pick a channel, and ClipPulse cuts its trending video into 3–4
              ready clips with subtitles. Watch them here, download the ones you like.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
              Quality
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value as Quality)}
                disabled={busy}
                className="px-2 py-2 text-sm font-semibold text-slate-900 bg-white border border-slate-300 rounded-lg cursor-pointer"
              >
                <option value="720p">720p · Fast</option>
                <option value="1080p">1080p · HD</option>
                <option value="4k">4K · Best</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
              Framing
              <select
                value={framing}
                onChange={(e) => setFraming(e.target.value as FramingChoice)}
                disabled={busy}
                className="px-2 py-2 text-sm font-semibold text-slate-900 bg-white border border-slate-300 rounded-lg cursor-pointer"
              >
                <option value="auto">Auto</option>
                <option value="face-track">Face track</option>
                <option value="gaming-split">Gameplay split</option>
                <option value="sports-blur">Sports blur</option>
              </select>
            </label>
            {/* v8.6 — clip length picker: presets 30/45/60s + custom 10–180s. */}
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
              Clip length
              <span className="flex items-center gap-1">
                {CLIP_LENGTH_PRESETS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setClipLengthSec(s);
                      setCustomLength('');
                    }}
                    disabled={busy}
                    aria-pressed={customLength === '' && clipLengthSec === s}
                    className={`px-2 py-2 text-sm font-semibold rounded-lg border cursor-pointer ${
                      customLength === '' && clipLengthSec === s
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-900 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    {s}s
                  </button>
                ))}
                <input
                  type="number"
                  min={10}
                  max={180}
                  value={customLength}
                  onChange={(e) => handleCustomLength(e.target.value)}
                  onBlur={handleCustomLengthBlur}
                  disabled={busy}
                  placeholder="Custom"
                  aria-label="Custom clip length in seconds (10 to 180)"
                  title="Custom clip length in seconds (10–180)"
                  className="w-20 px-2 py-2 text-sm font-semibold text-slate-900 bg-white border border-slate-300 rounded-lg"
                />
                <span className="font-normal text-slate-400">s</span>
              </span>
            </label>
            <button
              type="button"
              onClick={fetchTrends}
              disabled={busy || stage === 'loading'}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
            >
              <Flame className="w-4 h-4" aria-hidden="true" />
              {stage === 'loading' ? 'Fetching trends…' : 'Fetch Trends'}
            </button>
          </div>
        </div>
        {note && <p className="text-xs text-slate-500 mt-4">{note}</p>}
        {error && (
          <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mt-4">{error}</p>
        )}
        {quality === '4k' && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-4">
            4K renders take ~10 min per clip on this computer — 4 clips is about 40 min. 1080p is much faster.
          </p>
        )}
      </div>

      {/* v7.2 — paste a link: same 4-clip flow for any long video. */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
        <h3 className="font-display text-base font-bold text-slate-900">Or paste a YouTube link</h3>
        <p className="text-sm text-slate-500 mt-1">
          Any long video — paste its link and ClipPulse cuts the 4 best moments into pro clips with subtitles.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 mt-4">
          <input
            type="text"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) void makeClipsFromLink();
            }}
            disabled={busy}
            placeholder="https://www.youtube.com/watch?v=…"
            className="flex-1 px-3 py-2.5 text-sm text-slate-900 bg-white border border-slate-300 rounded-lg disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void makeClipsFromLink()}
            disabled={busy || !linkUrl.trim()}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-slate-900 hover:bg-slate-700 disabled:opacity-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
          >
            <Play className="w-4 h-4" aria-hidden="true" />
            Make 4 clips
          </button>
        </div>
      </div>

      {stage === 'idle' && (
        <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-10 text-center text-sm text-slate-500">
          Click <strong className="text-slate-900">Fetch Trends</strong> to load MrBeast, IShowSpeed, Raj Shamani,
          Joe Rogan, PewDiePie, Markiplier, Airrack, Dude Perfect, Dream and Kai Cenat — with their real
          most-viewed videos.
        </div>
      )}

      {channels.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
          <h3 className="font-display text-base font-bold text-slate-900 mb-4">1 · Pick a creator</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {channels.map((ch) => {
              const top = ch.videos[0];
              const active = selectedHandle === ch.handle;
              return (
                <button
                  key={ch.handle}
                  type="button"
                  onClick={() => { setCustomChannel(null); setSelectedHandle(ch.handle); }}
                  disabled={busy}
                  className={`text-left p-4 rounded-xl border transition-colors cursor-pointer disabled:opacity-60 ${
                    active
                      ? 'border-rose-600 ring-2 ring-rose-600/30 bg-rose-50/50'
                      : 'border-slate-200 hover:border-slate-400 bg-white'
                  }`}
                >
                  {ch.logoUrl ? (
                    <img
                      src={ch.logoUrl}
                      alt={`${ch.label} logo`}
                      className="w-14 h-14 rounded-full object-cover bg-slate-100"
                    />
                  ) : (
                    <span className="w-14 h-14 rounded-full bg-slate-200 inline-flex items-center justify-center font-display font-bold text-lg text-slate-600">
                      {ch.label.slice(0, 1)}
                    </span>
                  )}
                  <span className="block font-bold text-slate-900 mt-3 leading-tight">{ch.label}</span>
                  <span className="block text-xs text-slate-500 mt-0.5">{formatCompact(ch.followers)}</span>
                  {top && (
                    <span className="block text-xs text-slate-500 mt-2 leading-snug">
                      Top video · {formatViews(top.views)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {selectedChannel && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
          <h3 className="font-display text-base font-bold text-slate-900 mb-1">
            2 · Pick a video from {selectedChannel.label}
          </h3>
          <p className="text-xs text-slate-500 mb-4">Top videos by views. One click analyses the full video and renders the 4 best moments.</p>
          <div className="space-y-3">
            {selectedChannel.videos.map((v, i) => (
              <div
                key={v.videoId}
                className="flex flex-col sm:flex-row gap-4 items-start sm:items-center border border-slate-200 rounded-xl p-3"
              >
                {v.thumbnailUrl ? (
                  <img src={v.thumbnailUrl} alt="" className="w-full sm:w-40 aspect-video object-cover rounded-lg bg-slate-100" />
                ) : (
                  <span className="w-full sm:w-40 aspect-video rounded-lg bg-slate-100 inline-flex items-center justify-center text-slate-400">
                    <Play className="w-6 h-6" aria-hidden="true" />
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-900 leading-snug">
                    {i === 0 && <span className="text-rose-600 mr-1">#1</span>}
                    {v.title}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    {formatViews(v.views)}
                    {v.durationSec ? ` · ${formatClock(v.durationSec)}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => makeClips(v, selectedChannel)}
                  disabled={busy}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-slate-900 hover:bg-slate-700 disabled:opacity-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Play className="w-4 h-4" aria-hidden="true" />
                  Make 4 clips
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {stage === 'analyzing' && selectedVideo && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 text-sm text-slate-600">
          <span className="inline-block w-4 h-4 border-2 border-rose-600 border-t-transparent rounded-full animate-spin align-middle mr-2" aria-hidden="true" />
          Analysing “{selectedVideo.title}” — full audio + Whisper transcript + best moments. This takes a few minutes for a long video…
        </div>
      )}

      {clips.length > 0 && analysis && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
          <h3 className="font-display text-base font-bold text-slate-900">
            3 · Your clips — {analysis.title}
          </h3>
          <p className="text-xs text-slate-500 mt-1 mb-4">
            {clips.filter((c) => c.status === 'done').length}/{clips.length} ready · subtitles burned in ·{' '}
            {quality === '4k' ? '4K (2160×3840)' : quality === '1080p' ? '1080p Full HD (1080×1920)' : '720p (720×1280)'}
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {clips.map((clip, i) => (
              <article key={`${clip.window.startSec}-${clip.window.endSec}`} className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50">
                {clip.status === 'done' && clip.streamUrl ? (
                  <video
                    controls
                    playsInline
                    preload="metadata"
                    src={clip.streamUrl}
                    className="w-full aspect-[9/16] max-h-[440px] bg-black object-contain"
                  />
                ) : (
                  <div className="w-full aspect-[9/16] max-h-[440px] bg-slate-900 text-white flex flex-col items-center justify-center gap-2 p-4 text-center">
                    {clip.status === 'rendering' ? (
                      <>
                        <span className="inline-block w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true" />
                        <span className="text-sm font-semibold">Rendering clip {i + 1}…</span>
                        <span className="text-xs text-slate-300">Download + encode takes a few minutes</span>
                      </>
                    ) : clip.status === 'failed' ? (
                      <>
                        <span className="text-sm font-semibold text-rose-300">Render failed</span>
                        <span className="text-xs text-slate-300">{clip.error}</span>
                      </>
                    ) : (
                      <>
                        <span className="text-sm font-semibold">Queued…</span>
                        <span className="text-xs text-slate-300">Clip {i + 1} of {clips.length}</span>
                      </>
                    )}
                  </div>
                )}
                <div className="p-3">
                  <p className="text-sm font-bold text-slate-900">
                    Clip {i + 1} · {formatClock(clip.window.startSec)}–{formatClock(clip.window.endSec)}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Score {clip.window.totalScore.toFixed(1)} · {clip.window.hookReason}
                    {clip.isNative4k ? ' · Native 4K' : ''}
                  </p>
                  {clip.window.suggestedHooks?.[0] && (
                    <p className="text-xs text-slate-600 italic mt-1.5 leading-snug">
                      “{clip.window.suggestedHooks[0]}”
                    </p>
                  )}
                  {clip.status === 'done' && clip.downloadUrl ? (
                    <a
                      href={clip.downloadUrl}
                      download
                      className="mt-3 inline-flex w-full items-center justify-center gap-2 px-3 py-2 text-sm font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors"
                    >
                      <Download className="w-4 h-4" aria-hidden="true" />
                      Download MP4
                    </a>
                  ) : clip.status === 'failed' ? (
                    <button
                      type="button"
                      onClick={() => retryClip(i)}
                      disabled={busy}
                      className="mt-3 inline-flex w-full items-center justify-center gap-2 px-3 py-2 text-sm font-bold text-slate-900 bg-white border border-slate-300 hover:bg-slate-100 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
                    >
                      <RefreshCw className="w-4 h-4" aria-hidden="true" />
                      Retry this clip
                    </button>
                  ) : (
                    <span className="mt-3 block text-center text-xs text-slate-400 py-2">
                      {clip.status === 'rendering' ? 'Rendering…' : 'Waiting…'}
                    </span>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
