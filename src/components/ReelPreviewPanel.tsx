import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Eye, Pause, Play, RotateCcw, ShieldCheck, ShieldAlert, Video } from 'lucide-react';
import { evaluateCopyrightSafety, extractWordsFromSegments } from '../lib/virality';
import type { CaptionStyle, FramingMode, LanguageMode, SlidingWindow, VideoSource } from '../lib/types';

interface ReelPreviewPanelProps {
  source: VideoSource;
  selectedWindow: SlidingWindow;
  playbackTime: number;
  isPlaying: boolean;
  hookText: string;
  captionStyle: CaptionStyle;
  framingMode: FramingMode;
  faceOffsetX: number;
  includeCredit: boolean;
  transformPreview?: boolean;
  mirrorFlip?: boolean;
  lang: LanguageMode;
  onTogglePlay: () => void;
  onSeek: (timeSec: number) => void;
  onResetPlayback: () => void;
  onHookTextChange: (val: string) => void;
  onCaptionStyleChange: (style: CaptionStyle) => void;
  onFramingModeChange: (mode: FramingMode) => void;
  onFaceOffsetXChange: (x: number) => void;
  onToggleCredit: (val: boolean) => void;
  onOpenExport: () => void;
}

export const ReelPreviewPanel: React.FC<ReelPreviewPanelProps> = ({
  source,
  selectedWindow,
  playbackTime,
  isPlaying,
  hookText,
  captionStyle,
  framingMode,
  faceOffsetX,
  includeCredit,
  transformPreview = true,
  mirrorFlip = false,
  lang,
  onTogglePlay,
  onSeek,
  onResetPlayback,
  onHookTextChange,
  onCaptionStyleChange,
  onFramingModeChange,
  onFaceOffsetXChange,
  onToggleCredit,
  onOpenExport,
}) => {
  const [imageError, setImageError] = useState(false);
  const [showFaceBox, setShowFaceBox] = useState(true);
  const fgVideoRef = useRef<HTMLVideoElement | null>(null);
  const bgVideoRef = useRef<HTMLVideoElement | null>(null);

  const hasUploadedVideo = Boolean(source.uploadedVideoUrl);

  useEffect(() => {
    setImageError(false);
  }, [source.id, source.thumbnailUrl, source.uploadedVideoUrl]);

  useEffect(() => {
    if (!hasUploadedVideo) return;
    const targetSec = selectedWindow.startSec + playbackTime;
    const syncVideo = (el: HTMLVideoElement | null, shouldPlay: boolean) => {
      if (!el) return;
      if (Math.abs(el.currentTime - targetSec) > 0.6) {
        try {
          el.currentTime = targetSec;
        } catch {
          // Ignore seek before metadata ready
        }
      }
      if (shouldPlay && el.paused) {
        el.play().catch(() => {});
      } else if (!shouldPlay && !el.paused) {
        el.pause();
      }
    };
    syncVideo(fgVideoRef.current, isPlaying);
    syncVideo(bgVideoRef.current, isPlaying);
  }, [hasUploadedVideo, isPlaying, playbackTime, selectedWindow.startSec, framingMode]);

  const copyright = useMemo(() => evaluateCopyrightSafety(source), [source]);

  const windowWords = useMemo(() => {
    const all = extractWordsFromSegments(source.segments);
    return all
      .filter((w) => w.start >= selectedWindow.startSec && w.start < selectedWindow.endSec)
      .map((w) => ({
        ...w,
        relStart: Math.max(0, w.start - selectedWindow.startSec),
        relEnd: Math.max(0.2, w.end - selectedWindow.startSec),
      }));
  }, [source.segments, selectedWindow.startSec, selectedWindow.endSec]);

  const activePhrase = useMemo(() => {
    for (let i = 0; i < windowWords.length; i += 4) {
      const chunk = windowWords.slice(i, i + 4);
      if (chunk.length === 0) continue;
      const start = chunk[0].relStart;
      const end = chunk[chunk.length - 1].relEnd + 0.4;
      if (playbackTime >= start && playbackTime <= end) {
        return chunk;
      }
    }
    return windowWords.slice(0, 4);
  }, [windowWords, playbackTime]);

  const showHookOverlay = playbackTime <= 3.0 && hookText.trim().length > 0;
  const hasImage = Boolean(source.thumbnailUrl) && !imageError;

  return (
    <aside className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900">
            {lang === 'bn' ? '৯:১৬ ভার্টিক্যাল রিল প্রিভিউ' : '9:16 Vertical Reel Preview'}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
            {copyright.safe ? (
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-700 shrink-0" aria-hidden="true" />
            ) : (
              <ShieldAlert className="w-3.5 h-3.5 text-amber-600 shrink-0" aria-hidden="true" />
            )}
            <span>{copyright.label}</span>
            <span aria-hidden="true">·</span>
            <span>{framingMode}</span>
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowFaceBox((prev) => !prev)}
          aria-pressed={showFaceBox}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Eye className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{showFaceBox ? 'Guides On' : 'Guides Off'}</span>
        </button>
      </div>

      {/* 9:16 Vertical Phone Canvas */}
      <div className="flex justify-center">
        <div
          data-testid="reel-preview-canvas"
          data-framing={framingMode}
          className="relative w-full max-w-[270px] aspect-[9/16] rounded-2xl overflow-hidden bg-slate-900 border border-slate-300 shadow-sm select-none"
        >
          <div
            className={`absolute inset-0 transition-transform duration-200 ${
              transformPreview ? 'contrast-110 saturate-125 brightness-105' : ''
            } ${mirrorFlip ? '-scale-x-100' : ''}`}
          >
            {hasUploadedVideo ? (
              framingMode === 'sports-blur' ? (
                <>
                  <video
                    ref={bgVideoRef}
                    src={source.uploadedVideoUrl}
                    muted
                    playsInline
                    preload="auto"
                    className="absolute inset-0 w-full h-full object-cover blur-md scale-110 opacity-75"
                  />
                  <div className="absolute inset-0 flex items-center justify-center px-1">
                    <video
                      ref={fgVideoRef}
                      src={source.uploadedVideoUrl}
                      playsInline
                      preload="auto"
                      className={`w-full aspect-video object-cover rounded-sm shadow-lg border border-white/15 ${
                        transformPreview ? 'scale-105' : ''
                      }`}
                    />
                  </div>
                </>
              ) : framingMode === 'gaming-split' ? (
                <div className="absolute inset-0 flex flex-col">
                  <div className="h-[35%] relative overflow-hidden border-b border-white/20">
                    <video
                      ref={bgVideoRef}
                      src={source.uploadedVideoUrl}
                      muted
                      playsInline
                      preload="auto"
                      className="w-full h-full object-cover object-[14%_16%] scale-150"
                    />
                  </div>
                  <div className="h-[65%] relative overflow-hidden">
                    <video
                      ref={fgVideoRef}
                      src={source.uploadedVideoUrl}
                      playsInline
                      preload="auto"
                      className="w-full h-full object-cover object-[65%_50%]"
                    />
                  </div>
                </div>
              ) : (
                <video
                  ref={fgVideoRef}
                  src={source.uploadedVideoUrl}
                  playsInline
                  preload="auto"
                  style={{ objectPosition: `${faceOffsetX}% 50%` }}
                  className={`absolute inset-0 w-full h-full object-cover transition-[object-position] duration-200 ${
                    transformPreview ? 'scale-105' : ''
                  }`}
                />
              )
            ) : hasImage ? (
              framingMode === 'sports-blur' ? (
                <>
                  <img
                    src={source.thumbnailUrl}
                    alt=""
                    aria-hidden="true"
                    referrerPolicy="no-referrer"
                    className="absolute inset-0 w-full h-full object-cover blur-md scale-110 opacity-75"
                  />
                  <div className="absolute inset-0 flex items-center justify-center px-1">
                    <img
                      src={source.thumbnailUrl}
                      alt={`${source.title} sports-blur 9:16 preview`}
                      referrerPolicy="no-referrer"
                      onError={() => setImageError(true)}
                      className={`w-full aspect-video object-cover rounded-sm shadow-lg border border-white/15 ${
                        transformPreview ? 'scale-105' : ''
                      }`}
                    />
                  </div>
                </>
              ) : framingMode === 'gaming-split' ? (
                <div className="absolute inset-0 flex flex-col">
                  <div className="h-[35%] relative overflow-hidden border-b border-white/20">
                    <img
                      src={source.thumbnailUrl}
                      alt={`${source.title} streamer facecam`}
                      referrerPolicy="no-referrer"
                      onError={() => setImageError(true)}
                      className="w-full h-full object-cover object-[14%_16%] scale-150"
                    />
                  </div>
                  <div className="h-[65%] relative overflow-hidden">
                    <img
                      src={source.thumbnailUrl}
                      alt={`${source.title} gameplay split preview`}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover object-[65%_50%]"
                    />
                  </div>
                </div>
              ) : (
                <img
                  src={source.thumbnailUrl}
                  alt={`${source.title} vertical crop preview`}
                  referrerPolicy="no-referrer"
                  onError={() => setImageError(true)}
                  style={{ objectPosition: `${faceOffsetX}% 50%` }}
                  className={`absolute inset-0 w-full h-full object-cover transition-[object-position] duration-200 ${
                    transformPreview ? 'scale-105' : ''
                  }`}
                />
              )
            ) : (
              <div
                className={`absolute inset-0 bg-gradient-to-br ${source.fallbackGradient} flex flex-col items-center justify-center p-6 text-center`}
              >
                <Video className="w-10 h-10 text-slate-400 mb-3" aria-hidden="true" />
                <p className="text-xs font-medium text-slate-300 line-clamp-3">{source.title}</p>
              </div>
            )}
          </div>

          {/* Animated Top Retention Progress Bar (burned into .ASS when Transform Edit is ON) */}
          {transformPreview && (
            <div className="absolute top-0 inset-x-0 h-1 bg-white/20 z-10 pointer-events-none">
              <div
                className="h-full bg-rose-600 transition-[width] duration-100"
                style={{ width: `${Math.max(4, Math.min(100, (playbackTime / 60) * 100))}%` }}
              />
            </div>
          )}

          {/* Measured Contrast Scrim */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-black/45 pointer-events-none" />

          {/* Optional Framing Guide Reticle */}
          {showFaceBox && framingMode === 'face-track' && (
            <div
              aria-hidden="true"
              className="absolute top-[22%] left-1/2 -translate-x-1/2 w-28 h-32 border border-dashed border-amber-300/80 rounded-lg pointer-events-none flex items-end justify-center pb-1"
            >
              <span className="text-[10px] font-mono text-amber-200 bg-black/60 px-1.5 py-0.5 rounded">
                face_x {faceOffsetX}%
              </span>
            </div>
          )}

          {/* Hook Text Overlay (0s - 3s) */}
          {showHookOverlay && (
            <div
              data-testid="hook-overlay-banner"
              className="absolute top-8 inset-x-4 text-center pointer-events-none"
            >
              <div className="inline-block bg-rose-600 text-white font-display font-extrabold text-sm leading-snug px-3 py-2 rounded-lg shadow-md uppercase tracking-tight">
                {hookText}
              </div>
            </div>
          )}

          {/* Synchronized Karaoke .ASS Caption Preview */}
          <div
            data-testid="karaoke-caption-line"
            className={`absolute ${captionStyle === 'top' ? 'top-24' : 'bottom-14'} ${captionStyle === 'minimal' ? 'left-3 text-left' : 'inset-x-3 text-center'} pointer-events-none`}
          >
            <div
              className={`inline-flex flex-wrap ${captionStyle === 'minimal' ? 'justify-start' : 'justify-center'} gap-x-1.5 gap-y-0.5 ${
                captionStyle === 'sentence' ? 'bg-black/70 px-2.5 py-1.5 rounded-lg' : ''
              }`}
            >
              {activePhrase.map((item, idx) => {
                const isActive = playbackTime >= item.relStart && playbackTime <= item.relEnd + 0.15;
                const isSpoken = playbackTime > item.relEnd + 0.15;

                // v8.7: preview mirrors the real ASS look per style.
                let wordStyle = 'text-white/85';
                if (captionStyle === 'karaoke') {
                  wordStyle = isActive
                    ? 'text-amber-300 scale-105'
                    : isSpoken
                      ? 'text-white'
                      : 'text-white/70';
                } else if (captionStyle === 'top') {
                  wordStyle = isActive
                    ? 'text-amber-300 scale-105'
                    : isSpoken
                      ? 'text-white'
                      : 'text-white/70';
                } else if (captionStyle === 'lime') {
                  wordStyle = isActive
                    ? 'text-lime-300 scale-105 [text-shadow:0_0_14px_#a3e635]'
                    : isSpoken
                      ? 'text-white'
                      : 'text-white/70';
                } else if (captionStyle === 'flash') {
                  wordStyle = isActive
                    ? 'text-white scale-110 [text-shadow:2px_2px_0_#dc2626,0_0_16px_rgba(220,38,38,0.7)]'
                    : 'text-white/70';
                } else if (captionStyle === 'sentence') {
                  wordStyle = isActive || isSpoken ? 'text-white' : 'text-white/25';
                } else if (captionStyle === 'bold') {
                  wordStyle = isActive ? 'text-black bg-yellow-400 px-1.5 rounded' : 'text-white/25';
                } else {
                  // minimal: fades in, so unspoken words are barely there.
                  wordStyle = isActive ? 'text-white' : isSpoken ? 'text-white/80' : 'text-white/30';
                }

                return (
                  <span
                    key={`${item.word}-${idx}`}
                    className={`font-display transition-transform duration-100 ${
                      captionStyle === 'flash'
                        ? 'text-3xl font-black uppercase tracking-tight drop-shadow'
                        : captionStyle === 'sentence'
                          ? 'text-base font-bold tracking-tight drop-shadow'
                          : captionStyle === 'minimal'
                            ? 'text-sm font-medium'
                            : 'text-base font-extrabold uppercase tracking-tight drop-shadow'
                    } ${wordStyle}`}
                  >
                    {item.word}
                  </span>
                );
              })}
            </div>
          </div>

          {includeCredit && (
            <div className="absolute bottom-8 inset-x-3 text-center pointer-events-none">
              <span className="text-[10px] font-mono text-white/80 bg-black/50 px-2 py-0.5 rounded">
                CC-BY Source: {source.channel}
              </span>
            </div>
          )}

          {/* Bottom Timecode Bar inside Frame */}
          <div className="absolute bottom-2.5 inset-x-4 flex items-center justify-between text-[11px] font-mono tabular-nums text-white/90">
            <span>{playbackTime.toFixed(1)}s / 60.0s</span>
            <span>1080×1920</span>
          </div>
        </div>
      </div>

      {/* Transport & Scrub Controls */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={isPlaying ? 'Pause reel preview' : 'Play reel preview'}
            className="inline-flex items-center justify-center gap-1.5 h-9 px-3.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isPlaying ? (
              <>
                <Pause className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{lang === 'bn' ? 'থামান' : 'Pause'}</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{lang === 'bn' ? 'চালান' : 'Play Clip'}</span>
              </>
            )}
          </button>

          <input
            aria-label="Reel playback position in seconds"
            type="range"
            min={0}
            max={60}
            step={0.2}
            value={playbackTime}
            onChange={(e) => onSeek(Number(e.target.value))}
            className="flex-1 accent-rose-600 cursor-pointer"
          />

          <button
            type="button"
            onClick={onResetPlayback}
            aria-label="Restart 60s preview"
            className="inline-flex items-center justify-center w-9 h-9 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors shrink-0 cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Framing Mode Switcher */}
        <div className="flex items-center justify-between gap-2 pt-2">
          <span className="text-xs font-medium text-slate-600">
            {lang === 'bn' ? '৯:১৬ ফ্রেমিং' : '9:16 Framing'}
          </span>
          <div role="group" aria-label="9:16 framing mode" className="inline-flex p-1 bg-slate-100 rounded-lg">
            {(
              [
                ['face-track', 'Face'],
                ['sports-blur', 'Sports Blur'],
                ['gaming-split', 'Gaming Split'],
              ] as Array<[FramingMode, string]>
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => onFramingModeChange(mode)}
                className={`px-2 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  framingMode === mode
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Caption Style Switcher */}
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-slate-600">
            {lang === 'bn' ? 'ক্যাপশন স্টাইল' : 'Caption Style'}
          </span>
          <div role="group" aria-label="Caption style" className="inline-flex p-1 bg-slate-100 rounded-lg">
            {(['karaoke', 'minimal', 'bold', 'lime', 'sentence', 'top', 'flash'] as CaptionStyle[]).map((style) => (
              <button
                key={style}
                type="button"
                onClick={() => onCaptionStyleChange(style)}
                className={`px-2.5 py-1 text-xs font-medium capitalize rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  captionStyle === style
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {style}
              </button>
            ))}
          </div>
        </div>

        {/* MediaPipe Face-Track Crop X Offset (for face-track mode) */}
        {framingMode === 'face-track' && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="face-crop-slider" className="font-medium text-slate-600">
                {lang === 'bn' ? 'ফেস-ট্র্যাক হরাইজন্টাল ক্রপ' : 'MediaPipe Crop Center X'}
              </label>
              <span className="font-mono tabular-nums text-slate-900 font-semibold">{faceOffsetX}%</span>
            </div>
            <input
              id="face-crop-slider"
              type="range"
              min={15}
              max={85}
              step={1}
              value={faceOffsetX}
              onChange={(e) => onFaceOffsetXChange(Number(e.target.value))}
              className="w-full accent-slate-900 cursor-pointer"
            />
          </div>
        )}

        <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer pt-1">
          <input
            type="checkbox"
            checked={includeCredit}
            onChange={(e) => onToggleCredit(e.target.checked)}
            className="w-4 h-4 rounded border-slate-300 accent-emerald-700 cursor-pointer"
          />
          <span>
            {lang === 'bn'
              ? 'ভিডিওতে CC-BY অ্যাট্রিবিউশন ক্রেডিট দেখান'
              : 'Burn CC-BY Attribution Credit (Copyright-Safe)'}
          </span>
        </label>

        {/* Editable 3-Second Hook Text Overlay */}
        <div className="pt-2 border-t border-slate-100 space-y-2">
          <label htmlFor="hook-overlay-input" className="block text-xs font-semibold text-slate-700">
            {lang === 'bn' ? 'হুক টেক্সট ওভারলে (প্রথম ৩ সেকেন্ড)' : 'Hook Text Overlay (0s – 3s)'}
          </label>
          <input
            id="hook-overlay-input"
            type="text"
            value={hookText}
            onChange={(e) => onHookTextChange(e.target.value)}
            maxLength={72}
            className="w-full h-9 px-3 text-xs font-medium bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-rose-600/20 focus:border-rose-600"
          />
          {selectedWindow.suggestedHooks.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] font-medium text-slate-500">
                {lang === 'bn' ? 'সাজেস্টেড হুক (ক্লিক করুন):' : 'Suggested hooks:'}
              </div>
              <div className="flex flex-col gap-1">
                {selectedWindow.suggestedHooks.slice(0, 3).map((suggestion, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => onHookTextChange(suggestion)}
                    className="text-left text-xs text-slate-700 hover:text-slate-900 hover:bg-slate-100 px-2.5 py-1.5 rounded-md border border-slate-200 transition-colors truncate cursor-pointer"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onOpenExport}
          className="w-full h-10 text-sm font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors cursor-pointer"
        >
          {lang === 'bn' ? 'ডাউনলোড .ASS ও Serverless FFmpeg দেখুন' : 'View .ASS & Serverless FFmpeg Command'}
        </button>
      </div>
    </aside>
  );
};
