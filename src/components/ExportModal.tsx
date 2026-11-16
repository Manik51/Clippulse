import React, { useEffect, useState } from 'react';
import { Check, Copy, Download, Film, X } from 'lucide-react';
import { formatTimecode } from '../lib/virality';
import type { FramingMode, LanguageMode, SlidingWindow } from '../lib/types';

interface ExportModalProps {
  isOpen: boolean;
  youtubeUrl: string;
  uploadId?: string;
  thumbnailUrl?: string;
  category?: string;
  framingMode: FramingMode;
  faceOffsetX: number;
  selectedWindow: SlidingWindow;
  assContent: string;
  ffmpegCommand: string;
  serverlessSectionOnly: boolean;
  copyrightSafeTransform: boolean;
  mirrorFlip: boolean;
  lang: LanguageMode;
  onToggleSectionOnly: (val: boolean) => void;
  onToggleSafeTransform: (val: boolean) => void;
  onToggleMirrorFlip: (val: boolean) => void;
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  youtubeUrl,
  uploadId,
  thumbnailUrl,
  category,
  framingMode,
  faceOffsetX,
  selectedWindow,
  assContent,
  ffmpegCommand,
  serverlessSectionOnly,
  copyrightSafeTransform,
  mirrorFlip,
  lang,
  onToggleSectionOnly,
  onToggleSafeTransform,
  onToggleMirrorFlip,
  onClose,
}) => {
  const [copiedType, setCopiedType] = useState<'ffmpeg' | 'ass' | null>(null);
  const [canRenderLocally, setCanRenderLocally] = useState<boolean>(false);
  const [canRenderPreviewSample, setCanRenderPreviewSample] = useState<boolean>(false);
  const [outputQuality, setOutputQuality] = useState<'720p' | '1080p'>('720p');
  const [isRendering, setIsRendering] = useState<boolean>(false);
  const [renderNotice, setRenderNotice] = useState<string>('');
  const [downloadUrl, setDownloadUrl] = useState<string>('');
  const [streamUrl, setStreamUrl] = useState<string>('');

  const isRealUpload = Boolean(uploadId);
  const isPresetClip =
    !isRealUpload && (!youtubeUrl || youtubeUrl.includes('clippulse-') || youtubeUrl.includes('custom-input'));

  useEffect(() => {
    if (!isOpen) return;
    setRenderNotice('');
    setDownloadUrl('');
    setStreamUrl('');
    fetch('/api/local-capabilities')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setCanRenderLocally(Boolean(data.canRenderLocally));
          setCanRenderPreviewSample(Boolean(data.canRenderPreviewSample));
        }
      })
      .catch(() => {});
  }, [isOpen]);

  if (!isOpen) return null;

  const copyText = async (text: string, type: 'ffmpeg' | 'ass') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedType(type);
      setTimeout(() => setCopiedType(null), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  const downloadAss = () => {
    const blob = new Blob([assContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `captions_${selectedWindow.startSec}s_${selectedWindow.endSec}s.ass`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRenderLocalMp4 = async () => {
    setIsRendering(true);
    setRenderNotice('');
    setDownloadUrl('');
    setStreamUrl('');
    const applyResult = (result: {
      ok?: boolean;
      downloadUrl?: string;
      streamUrl?: string;
      isPreviewSample?: boolean;
      message?: string;
      error?: string;
    }) => {
      if (result.ok && result.downloadUrl) {
        setDownloadUrl(result.downloadUrl);
        setStreamUrl(result.streamUrl || result.downloadUrl);
        setRenderNotice(
          result.isPreviewSample
            ? lang === 'bn'
              ? 'প্রিসেট স্যাম্পল MP4 (১২ সেকেন্ড, ৭২০×১২৮০) তৈরি হয়েছে! আসল ৬০ সেকেন্ড রিয়েল ভিডিওর জন্য উপরে আপনার .MP4 ফাইল আপলোড করুন।'
              : 'Preset sample MP4 ready (12s 720×1280 with motion + Pro Transform + burned .ASS). Upload an .MP4 file above for full 60s real video!'
            : lang === 'bn'
              ? `প্রোডাকশন .MP4 (${outputQuality === '1080p' ? '1080×1920 HD' : '720×1280 Fast'} + Pro Transform + .ASS) তৈরি হয়েছে! Save MP4 ক্লিক করে ডাউনলোড করুন।`
              : `Production .MP4 (${outputQuality === '1080p' ? '1080×1920 Full HD' : '720×1280 Fast'} with Pro Transform & burned .ASS) ready! Watch below or click Save MP4.`
        );
      } else {
        setRenderNotice(result.message || result.error || 'Could not render MP4 in this environment.');
      }
    };

    try {
      // ClipPulse v6 — renders are async jobs now: a 4K render takes 8-12
      // min, past most clients' headers timeout. Submit, then poll.
      const res = await fetch('/api/render-local-mp4', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          youtubeUrl,
          uploadId,
          thumbnailUrl,
          category,
          outputQuality,
          startSec: selectedWindow.startSec,
          endSec: selectedWindow.endSec,
          faceOffsetX,
          framingMode,
          assContent,
          copyrightSafeTransform,
          mirrorFlip,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setRenderNotice(data.message || 'Could not render MP4 in this environment.');
        return;
      }
      if (data.downloadUrl) {
        applyResult(data);
        return;
      }
      if (!data.jobId) {
        setRenderNotice('Could not start the render job.');
        return;
      }
      setRenderNotice(
        lang === 'bn'
          ? 'রেন্ডার চলছে… শেষ হলে এখানেই প্রিভিউ আসবে।'
          : 'Rendering… the preview appears here when it is done.'
      );
      const started = Date.now();
      for (;;) {
        await new Promise((r) => setTimeout(r, 5000));
        const stRes = await fetch(`/api/job-status/${data.jobId}`);
        if (!stRes.ok) throw new Error('Job status check failed.');
        const st = await stRes.json();
        if (st.status === 'done' && st.result) {
          applyResult(st.result);
          break;
        }
        if (st.status === 'failed') {
          applyResult(st.result || {});
          break;
        }
        if (Date.now() - started > 30 * 60 * 1000) {
          setRenderNotice('Render timed out after 30 minutes.');
          break;
        }
      }
    } catch {
      setRenderNotice('Render request failed. Ensure server is running.');
    } finally {
      setIsRendering(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs"
    >
      <div className="w-full max-w-3xl bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div>
            <h2 id="export-modal-title" className="font-display text-lg font-bold text-slate-900">
              {lang === 'bn'
                ? 'রিল এক্সপোর্ট: MP4 রেন্ডার, .ASS ক্যাপশন ও FFmpeg'
                : 'Export Reel: Local MP4, .ASS Subtitles & FFmpeg'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
              Clip {formatTimecode(selectedWindow.startSec)} – {formatTimecode(selectedWindow.endSec)} · Score{' '}
              {selectedWindow.totalScore.toFixed(1)} · {framingMode}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close export modal"
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto">
          {/* 1-Click MP4 Render Box */}
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  {lang === 'bn'
                    ? '১-ক্লিক .MP4 রেন্ডার ও ডাউনলোড (FFmpeg)'
                    : '1-Click .MP4 Render & Download (FFmpeg)'}
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  {isRealUpload
                    ? lang === 'bn'
                      ? 'আপনার আপলোড করা আসল ভিডিও থেকে নির্বাচিত ৬০ সেকেন্ড রিয়েল .MP4 রেন্ডার হবে!'
                      : 'Real uploaded video ready — cuts your winning 60s window with Pro Transform & burned .ASS captions!'
                    : canRenderLocally
                      ? 'yt-dlp & ffmpeg ready — cuts real 60s MP4 (Note: YouTube blocks Cloud server IPs; upload .MP4 or run locally on Linux for arbitrary links).'
                      : canRenderPreviewSample
                        ? isPresetClip
                          ? 'Preview FFmpeg ready for preset sample. For full 60s real video, upload any .MP4/.MOV file above!'
                          : 'Upload any .MP4/.MOV file above or run locally on Linux (npm run setup:linux) for full YouTube MP4 downloads.'
                        : 'Run "npm run setup:linux && npm run dev" on your Linux PC to enable 1-click MP4 rendering.'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {isRealUpload && (
                  <select
                    aria-label="Output resolution"
                    value={outputQuality}
                    onChange={(e) => setOutputQuality(e.target.value === '1080p' ? '1080p' : '720p')}
                    className="h-9 px-2.5 text-xs font-semibold bg-white border border-slate-300 rounded-lg text-slate-800 cursor-pointer"
                  >
                    <option value="720p">720×1280 (Fast)</option>
                    <option value="1080p">1080×1920 (Full HD)</option>
                  </select>
                )}
                <button
                  type="button"
                  onClick={handleRenderLocalMp4}
                  disabled={isRendering}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Film className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{isRendering ? 'Rendering MP4...' : 'Render & Download .MP4'}</span>
                </button>
                {downloadUrl && (
                  <a
                    href={downloadUrl}
                    download="viral_reel_60s.mp4"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    <Download className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Save MP4</span>
                  </a>
                )}
              </div>
            </div>
          </div>

          {renderNotice && (
            <p className="text-xs font-medium text-slate-700 bg-slate-100 border border-slate-200 rounded-lg px-3.5 py-2">
              {renderNotice}
            </p>
          )}

          {streamUrl && (
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-950 flex flex-col items-center gap-3">
              <video
                key={streamUrl}
                src={streamUrl}
                controls
                playsInline
                preload="metadata"
                className="w-full max-w-[210px] aspect-[9/16] rounded-lg bg-black"
              />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-5 pb-3 border-b border-slate-100">
            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={serverlessSectionOnly}
                onChange={(e) => onToggleSectionOnly(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 accent-rose-600 cursor-pointer"
              />
              <span>Section Cut (60s slice only)</span>
            </label>
            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={copyrightSafeTransform}
                onChange={(e) => onToggleSafeTransform(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 accent-emerald-700 cursor-pointer"
              />
              <span>Pro Viral Transform (1.06x Zoom, Color, Vignette, 1.03x Speed/Pitch, Progress Bar)</span>
            </label>
            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={mirrorFlip}
                onChange={(e) => onToggleMirrorFlip(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 accent-slate-800 cursor-pointer"
              />
              <span>Mirror Flip (hflip)</span>
            </label>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-900">
                1. {lang === 'bn' ? 'yt-dlp + FFmpeg ৯:১৬ ক্রপ ও বার্ন কমান্ড' : 'yt-dlp + FFmpeg 9:16 Render Command'}
              </h3>
              <button
                type="button"
                onClick={() => copyText(ffmpegCommand, 'ffmpeg')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {copiedType === 'ffmpeg' ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Copy Command</span>
                  </>
                )}
              </button>
            </div>
            <pre className="p-4 text-xs font-mono text-slate-100 bg-slate-950 rounded-xl overflow-x-auto leading-relaxed">
              <code>{ffmpegCommand}</code>
            </pre>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-900">
                2. {lang === 'bn' ? 'অ্যানিমেটেড কারাওকে .ASS সাবটাইটেল ফাইল' : 'Animated Karaoke .ASS Subtitle File'}
              </h3>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => copyText(assContent, 'ass')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {copiedType === 'ass' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Copy .ASS</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={downloadAss}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Download .ass</span>
                </button>
              </div>
            </div>
            <pre className="p-4 text-xs font-mono text-slate-100 bg-slate-950 rounded-xl overflow-x-auto max-h-56 leading-relaxed">
              <code>{assContent}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
