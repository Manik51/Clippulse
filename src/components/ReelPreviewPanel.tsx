import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, Download, ExternalLink, Eye, Loader2, Pause, Play, RotateCcw, ShieldCheck, ShieldAlert, Sparkles, Video } from 'lucide-react';
import {
  CAPTION_STYLE_PRESETS,
  applyCaptionOverrides,
  assColourToCss,
  evaluateCopyrightSafety,
  extractWordsFromSegments,
  generateAssSubtitle,
  positionPctForPreset,
} from '../lib/virality';
import type { CaptionStylePreset } from '../lib/virality';
import type { CaptionOverrides, CaptionStyle, FramingMode, LanguageMode, SlidingWindow, VideoSource } from '../lib/types';

/** Gallery-card line style, derived from the preset — the card shows the
 * style the way the reference does: same font, colours, highlight. */
function cardLineStyle(preset: CaptionStylePreset, lineIndex: 0 | 1): React.CSSProperties {
  const isB = lineIndex === 1;
  const style: React.CSSProperties = {
    fontFamily: `'${preset.font}', sans-serif`,
    fontWeight: preset.bold ? 800 : 400,
    fontStyle: preset.italic ? 'italic' : 'normal',
    textTransform: preset.uppercase ? 'uppercase' : 'none',
    color: assColourToCss(preset.primaryColour),
    lineHeight: 1.2,
    fontSize: preset.fontSize >= 100 ? 20 : preset.fontSize >= 64 ? 15 : 13,
    textShadow: '2px 2px 0 rgba(0,0,0,0.9)',
  };
  if (preset.highlight === 'glow') {
    style.textShadow = `0 0 10px ${preset.highlightCss}, 0 0 3px ${preset.highlightCss}`;
  }
  if (isB && preset.highlight === 'word') {
    style.backgroundColor = preset.highlightCss;
    style.padding = '0 4px';
    style.borderRadius = 2;
  }
  return style;
}

interface ReelPreviewPanelProps {
  source: VideoSource;
  selectedWindow: SlidingWindow;
  playbackTime: number;
  isPlaying: boolean;
  hookText: string;
  captionStyle: CaptionStyle;
  captionOverrides: CaptionOverrides;
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
  onCaptionOverridesChange: (overrides: CaptionOverrides) => void;
  onFramingModeChange: (mode: FramingMode) => void;
  onFaceOffsetXChange: (x: number) => void;
  onToggleCredit: (val: boolean) => void;
}

export const ReelPreviewPanel: React.FC<ReelPreviewPanelProps> = ({
  source,
  selectedWindow,
  playbackTime,
  isPlaying,
  hookText,
  captionStyle,
  captionOverrides,
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
  onCaptionOverridesChange,
  onFramingModeChange,
  onFaceOffsetXChange,
  onToggleCredit,
}) => {
  const [imageError, setImageError] = useState(false);
  const [showFaceBox, setShowFaceBox] = useState(true);
  const fgVideoRef = useRef<HTMLVideoElement | null>(null);
  const bgVideoRef = useRef<HTMLVideoElement | null>(null);

  const [renderQuality, setRenderQuality] = useState<'720p' | '1080p' | '4k'>('1080p');
  const [renderStatus, setRenderStatus] = useState<'idle' | 'rendering' | 'done' | 'failed'>('idle');
  const [renderProgressMessage, setRenderProgressMessage] = useState<string>('');
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [isNative4k, setIsNative4k] = useState<boolean>(false);

  const handleRenderWorkbenchClip = async () => {
    setRenderStatus('rendering');
    setRenderError(null);
    setDownloadUrl(null);
    setStreamUrl(null);
    setRenderProgressMessage(lang === 'bn' ? 'রেন্ডার শুরু হচ্ছে...' : 'Starting render...');

    try {
      const assContent = generateAssSubtitle(
        source.segments,
        selectedWindow.startSec,
        selectedWindow.endSec,
        hookText || selectedWindow.suggestedHooks[0] || '',
        captionStyle,
        includeCredit ? `Source: ${source.channel}` : undefined,
        true,
        undefined,
        captionOverrides
      );

      const payload: Record<string, unknown> = {
        title: source.title,
        category: source.category,
        outputQuality: renderQuality,
        startSec: selectedWindow.startSec,
        endSec: selectedWindow.endSec,
        clipLengthSec: Math.round(selectedWindow.endSec - selectedWindow.startSec),
        faceOffsetX,
        framingMode,
        assContent,
        copyrightSafeTransform: transformPreview,
        mirrorFlip,
      };

      if (source.uploadedVideoUrl) {
        payload.uploadId = source.id.replace('upload-', '');
      } else {
        payload.youtubeUrl = source.youtubeUrl;
      }

      const res = await fetch('/api/render-local-mp4', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!data.ok) {
        throw new Error(data.message || data.reason || 'Could not start render.');
      }

      if (data.downloadUrl) {
        setDownloadUrl(data.downloadUrl);
        setStreamUrl(data.streamUrl || data.downloadUrl);
        setRenderStatus('done');
        return;
      }

      const jobId = data.jobId;
      setRenderProgressMessage(
        lang === 'bn'
          ? 'FFmpeg দিয়ে ভিডিও প্রসেস ও ক্যাপশন বার্ন হচ্ছে...'
          : 'FFmpeg is encoding 9:16 clip with burned captions...'
      );

      const startedAt = Date.now();
      const timeoutMs = 30 * 60 * 1000;

      while (Date.now() - startedAt < timeoutMs) {
        await new Promise((r) => setTimeout(r, 4000));
        const statusRes = await fetch(`/api/job-status/${jobId}`);
        if (!statusRes.ok) throw new Error('Job status check failed.');
        const statusData = await statusRes.json();

        if (statusData.status === 'done' && statusData.result) {
          const result = statusData.result;
          setDownloadUrl(result.downloadUrl || null);
          setStreamUrl(result.streamUrl || result.downloadUrl || null);
          setIsNative4k(Boolean(result.isNative4k));
          setRenderStatus('done');
          return;
        }

        if (statusData.status === 'failed') {
          const errResult = statusData.result || {};
          throw new Error(errResult.message || errResult.error || 'Render failed on server.');
        }
      }

      throw new Error('Render timed out after 30 minutes.');
    } catch (err) {
      setRenderStatus('failed');
      setRenderError(err instanceof Error ? err.message : 'Render failed.');
    }
  };

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

  // v8.8 — the picked preset + overrides are what BOTH the preview and
  // the render use (same helpers as generateAssSubtitle).
  const preset = CAPTION_STYLE_PRESETS[captionStyle];
  const effective = useMemo(
    () => applyCaptionOverrides(preset, captionOverrides),
    [preset, captionOverrides]
  );
  const positionPct = captionOverrides.positionPct ?? positionPctForPreset(preset);
  const fontColourCss = assColourToCss(effective.primaryColour);
  // Effective font size for the controls: the override, else the preset
  // (clamped to the 20–72 slider range for the thumb position only).
  const displayFontSize = effective.fontSize;
  const captionPosClass =
    preset.alignment === 5
      ? 'top-1/2 -translate-y-1/2'
      : preset.alignment === 8
        ? 'top-20'
        : positionPct >= 66
          ? 'top-1/4'
          : positionPct >= 33
            ? 'bottom-1/4'
            : 'bottom-14';
  // Flash mode shows one huge word at a time, not the whole chunk.
  const displayWords = useMemo(() => {
    if (preset.mode !== 'flash') return activePhrase;
    const active = activePhrase.filter(
      (w) => playbackTime >= w.relStart && playbackTime <= w.relEnd + 0.15
    );
    return active.length > 0 ? active : activePhrase.slice(0, 1);
  }, [preset.mode, activePhrase, playbackTime]);

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

          {/* Synchronized .ASS Caption Preview — driven by the picked
              preset + overrides, the same values generateAssSubtitle
              burns into the render (v8.8). */}
          <div
            data-testid="karaoke-caption-line"
            className={`absolute ${captionPosClass} ${preset.alignment === 1 ? 'left-3 text-left' : 'inset-x-3 text-center'} pointer-events-none`}
          >
            <div
              className={`inline-flex flex-wrap ${preset.alignment === 1 ? 'justify-start' : 'justify-center'} gap-x-1.5 gap-y-0.5`}
              style={
                preset.highlight === 'line'
                  ? { backgroundColor: `${preset.highlightCss}CC`, padding: '6px 10px', borderRadius: 8 }
                  : undefined
              }
            >
              {displayWords.map((item, idx) => {
                const isActive = playbackTime >= item.relStart && playbackTime <= item.relEnd + 0.15;
                const isSpoken = playbackTime > item.relEnd + 0.15;
                const wordStyle: React.CSSProperties = {
                  fontFamily: `'${preset.font}', sans-serif`,
                  fontWeight: preset.bold ? 800 : 400,
                  fontStyle: preset.italic ? 'italic' : 'normal',
                  textTransform: preset.uppercase ? 'uppercase' : 'none',
                  fontSize: `${Math.max(10, Math.round(effective.fontSize * 0.25))}px`,
                  color: isActive
                    ? assColourToCss(effective.primaryColour)
                    : assColourToCss(preset.secondaryColour),
                  opacity:
                    preset.mode === 'wordbox' ? (isActive ? 1 : 0.15) : isActive || isSpoken ? 1 : 0.35,
                  textShadow: '2px 2px 0 rgba(0,0,0,0.85)',
                  lineHeight: 1.2,
                };
                if (preset.highlight === 'glow' && isActive) {
                  wordStyle.textShadow = `0 0 14px ${preset.highlightCss}, 0 0 4px ${preset.highlightCss}`;
                }
                if (preset.mode === 'wordbox' && isActive) {
                  wordStyle.backgroundColor = preset.highlightCss;
                  wordStyle.padding = '0 6px';
                  wordStyle.borderRadius = 3;
                }
                if (isActive && preset.motion === 'pop') {
                  wordStyle.transform = 'scale(1.08)';
                }
                return (
                  <span
                    key={`${item.word}-${idx}`}
                    className="transition-transform duration-100 tracking-tight drop-shadow"
                    style={wordStyle}
                  >
                    {preset.uppercase ? item.word.toUpperCase() : item.word}
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

        {/* Choose Style gallery (v8.8 — like the reference): named
            cards, each a live mini-preview of its style on the sample
            text "WATCH THIS NOW". The selected card gets the violet
            ring + check. Below it, the reference's bottom controls —
            Font Size, Font Color, Caption Position — which override
            the picked style in BOTH the preview and the render. */}
        <div className="space-y-2 pt-2 border-t border-slate-100">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-bold text-slate-900">Choose Style</span>
            <span className="text-xs font-semibold text-violet-700 bg-violet-50 px-2 py-1 rounded-md whitespace-nowrap">
              {preset.displayName}
            </span>
          </div>
          <div role="group" aria-label="Caption style gallery" className="grid grid-cols-3 gap-2">
            {(Object.keys(CAPTION_STYLE_PRESETS) as CaptionStyle[]).map((style) => {
              const p = CAPTION_STYLE_PRESETS[style];
              const selected = captionStyle === style;
              return (
                <button
                  key={style}
                  type="button"
                  onClick={() => {
                    onCaptionStyleChange(style);
                    onCaptionOverridesChange({});
                  }}
                  aria-pressed={selected}
                  className={`relative text-left rounded-md overflow-hidden border transition-colors cursor-pointer ${
                    selected ? 'border-violet-600 ring-2 ring-violet-600/60' : 'border-slate-200 hover:border-slate-400'
                  }`}
                >
                  <span className="flex items-center justify-between gap-1 bg-slate-50 px-1.5 py-1">
                    <span className="text-[11px] font-medium text-slate-700 truncate">{p.displayName}</span>
                    {selected && <Check className="w-3.5 h-3.5 text-white bg-violet-600 rounded-full p-0.5 shrink-0" aria-hidden="true" />}
                  </span>
                  <span className="flex items-center justify-center bg-[#6b7280] px-1 py-2.5 min-h-[62px]">
                    <span
                      style={{
                        display: 'inline-flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        backgroundColor: p.highlight === 'line' ? p.highlightCss : undefined,
                        padding: p.highlight === 'line' ? '2px 6px' : 0,
                        borderRadius: 3,
                      }}
                    >
                      <span style={cardLineStyle(p, 0)}>{p.sample[0]}</span>
                      {p.sample[1] && <span style={cardLineStyle(p, 1)}>{p.sample[1]}</span>}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* Bottom controls — Font Size / Font Color / Caption Position */}
          <div className="grid grid-cols-3 gap-3 pt-1">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="caption-font-size" className="font-medium text-slate-600">
                  Font Size
                </label>
                <span className="font-mono tabular-nums text-violet-700 font-semibold">{displayFontSize}px</span>
              </div>
              <input
                id="caption-font-size"
                type="range"
                min={20}
                max={72}
                step={1}
                value={Math.min(displayFontSize, 72)}
                onChange={(e) => onCaptionOverridesChange({ ...captionOverrides, fontSize: Number(e.target.value) })}
                className="w-full accent-violet-600 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                <span>20</span>
                <span>72</span>
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="caption-font-color" className="font-medium text-slate-600">
                  Font Color
                </label>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  id="caption-font-color"
                  type="color"
                  value={fontColourCss}
                  onChange={(e) => onCaptionOverridesChange({ ...captionOverrides, fontColour: e.target.value.toUpperCase() })}
                  className="w-7 h-7 p-0.5 rounded-full border border-slate-300 bg-white cursor-pointer shrink-0"
                  aria-label="Caption font color picker"
                />
                <input
                  type="text"
                  value={fontColourCss}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
                      onCaptionOverridesChange({ ...captionOverrides, fontColour: v.toUpperCase() });
                    }
                  }}
                  className="w-full min-w-0 h-7 px-1.5 text-xs font-mono text-slate-900 bg-slate-50 border border-slate-300 rounded-md focus:outline-none focus:border-violet-600"
                  aria-label="Caption font color hex"
                />
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="caption-position" className="font-medium text-slate-600">
                  Caption Position
                </label>
                <span className="font-mono tabular-nums text-violet-700 font-semibold">{positionPct}%</span>
              </div>
              <input
                id="caption-position"
                type="range"
                min={0}
                max={100}
                step={1}
                value={positionPct}
                onChange={(e) => onCaptionOverridesChange({ ...captionOverrides, positionPct: Number(e.target.value) })}
                className="w-full accent-violet-600 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                <span>0%</span>
                <span>100%</span>
              </div>
            </div>
          </div>
          {(captionOverrides.fontSize !== undefined ||
            captionOverrides.fontColour !== undefined ||
            captionOverrides.positionPct !== undefined) && (
            <button
              type="button"
              onClick={() => onCaptionOverridesChange({})}
              className="text-xs font-medium text-violet-700 hover:text-violet-900 underline underline-offset-2 cursor-pointer"
            >
              Reset style overrides
            </button>
          )}
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

        {/* Render & Download Export Action Card */}
        <div className="pt-4 mt-2 border-t border-slate-200 space-y-3 bg-slate-50 -mx-4 -mb-4 p-4 rounded-b-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
              <Sparkles className="w-4 h-4 text-rose-600" aria-hidden="true" />
              <span>{lang === 'bn' ? 'এক্সপোর্ট ও রেন্ডার (FFmpeg)' : 'Render 9:16 Short (FFmpeg)'}</span>
            </div>
            {/* Quality selector */}
            <div className="inline-flex p-0.5 bg-slate-200 rounded-md text-[11px] font-semibold">
              {(['720p', '1080p', '4k'] as const).map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={renderStatus === 'rendering'}
                  onClick={() => setRenderQuality(q)}
                  className={`px-2 py-0.5 rounded transition-colors cursor-pointer uppercase ${
                    renderQuality === q
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          {renderStatus === 'idle' && (
            <button
              type="button"
              onClick={handleRenderWorkbenchClip}
              className="w-full inline-flex items-center justify-center gap-2 h-10 px-4 text-xs font-semibold text-white bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600 shadow-sm rounded-lg transition-all cursor-pointer"
            >
              <Download className="w-4 h-4" aria-hidden="true" />
              <span>
                {lang === 'bn'
                  ? `রেন্ডার ও ডাউনলোড (${renderQuality.toUpperCase()})`
                  : `Render & Download MP4 (${renderQuality.toUpperCase()})`}
              </span>
            </button>
          )}

          {renderStatus === 'rendering' && (
            <div className="space-y-2 p-3 bg-white border border-rose-200 rounded-lg">
              <div className="flex items-center gap-2 text-xs font-medium text-rose-700">
                <Loader2 className="w-4 h-4 animate-spin shrink-0 text-rose-600" />
                <span className="truncate">{renderProgressMessage}</span>
              </div>
              <p className="text-[11px] text-slate-500">
                {lang === 'bn'
                  ? 'লোকাল সার্ভারে FFmpeg দিয়ে প্রসেসিং চলছে। শেষ হলে ডাউনলোড লিংক আসবে।'
                  : 'Processing locally with FFmpeg. Download link will appear once done.'}
              </p>
            </div>
          )}

          {renderStatus === 'done' && downloadUrl && (
            <div className="space-y-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-800 flex items-center gap-1.5">
                  <Check className="w-4 h-4 text-emerald-600" />
                  {lang === 'bn' ? 'রেন্ডার সম্পন্ন!' : 'Render Ready!'}
                </span>
                {isNative4k && (
                  <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 bg-emerald-600 text-white rounded">
                    Native 4K
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={downloadUrl}
                  download
                  className="flex-1 inline-flex items-center justify-center gap-1.5 h-8 px-3 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-md transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{lang === 'bn' ? 'ভিডিও সেভ করুন (.mp4)' : 'Download .MP4'}</span>
                </a>
                {streamUrl && (
                  <a
                    href={streamUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center w-8 h-8 text-emerald-700 bg-emerald-100 hover:bg-emerald-200 rounded-md transition-colors"
                    title={lang === 'bn' ? 'নতুন ট্যাবে দেখুন' : 'Stream video in new tab'}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setRenderStatus('idle')}
                  className="px-2 h-8 text-xs text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                >
                  {lang === 'bn' ? 'আবার' : 'Reset'}
                </button>
              </div>
            </div>
          )}

          {renderStatus === 'failed' && (
            <div className="space-y-2 p-3 bg-rose-50 border border-rose-200 rounded-lg">
              <div className="flex items-start gap-1.5 text-xs text-rose-700 font-medium">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
                <span className="break-words">{renderError}</span>
              </div>
              <button
                type="button"
                onClick={handleRenderWorkbenchClip}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-700 hover:text-rose-900 underline cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>{lang === 'bn' ? 'আবার চেষ্টা করুন' : 'Try Again'}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};
