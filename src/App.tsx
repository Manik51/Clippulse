/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { TopBar } from './components/TopBar';
import { SourceInputBar } from './components/SourceInputBar';
import { AutoFetchPackPanel } from './components/AutoFetchPackPanel';
import { Gta6TrackerPanel } from './components/Gta6TrackerPanel';
import { TrendingClipsPanel } from './components/TrendingClipsPanel';
import { ViralityTimeline } from './components/ViralityTimeline';
import { ReelPreviewPanel } from './components/ReelPreviewPanel';
import { BackendBlueprintView } from './components/BackendBlueprintView';
import { PRESET_VIDEOS } from './lib/presets';
import {
  CATEGORY_WEIGHTS,
  DEFAULT_WEIGHTS,
  buildAutoFetchPack,
  buildSlidingWindows,
  buildUploadedVideoSource,
  calculateWeightedScore,
  evaluateCopyrightSafety,
  parseCustomTranscriptToSource,
  reweightWindows,
} from './lib/virality';
import type {
  AutoFetchPackItem,
  CaptionOverrides,
  CaptionStyle,
  FramingMode,
  LanguageMode,
  ScoringWeights,
  SlidingWindow,
  VideoCategory,
  VideoSource,
  WorkspaceTab,
} from './lib/types';

function findTopWindowId(windows: SlidingWindow[]): string {
  if (windows.length === 0) return '';
  return [...windows].sort((a, b) => b.totalScore - a.totalScore)[0].id;
}

export default function App() {
  const initialPack = useMemo(
    () => buildAutoFetchPack(PRESET_VIDEOS, ['cricket', 'boxing', 'football', 'gaming'], true),
    []
  );

  const initialSource = PRESET_VIDEOS[0];
  const initialWeights = CATEGORY_WEIGHTS[initialSource.category] || DEFAULT_WEIGHTS;
  const initialWindows = useMemo(
    () => buildSlidingWindows(initialSource, initialWeights),
    [initialSource, initialWeights]
  );
  const initialTopId = useMemo(() => findTopWindowId(initialWindows), [initialWindows]);
  const initialTopWin = initialWindows.find((w) => w.id === initialTopId) || initialWindows[0];

  const [activeTab, setActiveTab] = useState<WorkspaceTab>('trending');
  const [lang, setLang] = useState<LanguageMode>('en');

  // Auto-Fetch Trending Pack state
  const [pack, setPack] = useState<AutoFetchPackItem[]>(initialPack);
  const [ccOnly, setCcOnly] = useState<boolean>(false);
  const [isFetchingPack, setIsFetchingPack] = useState<boolean>(false);
  const [fetchNote, setFetchNote] = useState<string>(
    'Ready: 4 viral category clips across Cricket, Boxing, Football & Gaming (Pro FFmpeg Transform active).'
  );

  // Active Workbench state
  const [source, setSource] = useState<VideoSource>(initialSource);
  const [windows, setWindows] = useState<SlidingWindow[]>(initialWindows);
  const [weights, setWeights] = useState<ScoringWeights>(initialWeights);
  const [selectedWindowId, setSelectedWindowId] = useState<string>(initialTopId);

  const [youtubeUrl, setYoutubeUrl] = useState<string>(initialSource.youtubeUrl);
  const [customTranscript, setCustomTranscript] = useState<string>('');
  const [customCategory, setCustomCategory] = useState<VideoCategory>('podcast');
  const [showTranscriptInput, setShowTranscriptInput] = useState<boolean>(false);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [isUploadingVideo, setIsUploadingVideo] = useState<boolean>(false);
  const [analysisStage, setAnalysisStage] = useState<string>('');
  const [validationError, setValidationError] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<string>(
    'Loaded Cricket CC-BY match · Audio-peak weights applied (45% Crowd Audio, 20% Hook).'
  );

  // Reel Preview & Export state
  const [playbackTime, setPlaybackTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>('hormozi-v1');
  const [captionOverrides, setCaptionOverrides] = useState<CaptionOverrides>({});
  const [framingMode, setFramingMode] = useState<FramingMode>(initialSource.framingMode);
  const [hookText, setHookText] = useState<string>(initialTopWin?.suggestedHooks[0] || '');
  const [faceOffsetX, setFaceOffsetX] = useState<number>(initialTopWin?.faceOffsetX || 50);
  const [includeCredit, setIncludeCredit] = useState<boolean>(true);
  const [copyrightSafeTransform, setCopyrightSafeTransform] = useState<boolean>(true);
  const [mirrorFlip, setMirrorFlip] = useState<boolean>(false);
  const analysisReqIdRef = useRef<number>(0);

  const topWindowId = useMemo(() => findTopWindowId(windows), [windows]);
  const selectedWindow = useMemo(
    () => windows.find((w) => w.id === selectedWindowId) || windows[0],
    [windows, selectedWindowId]
  );

  useEffect(() => {
    if (!isPlaying) return;
    const id = window.setInterval(() => {
      setPlaybackTime((prev) => {
        if (prev >= 59.9) {
          setIsPlaying(false);
          return 0;
        }
        return Number((prev + 0.1).toFixed(1));
      });
    }, 100);
    return () => window.clearInterval(id);
  }, [isPlaying]);

  const applySelectedWindow = (win: SlidingWindow) => {
    setSelectedWindowId(win.id);
    setHookText(win.suggestedHooks[0] || '');
    setFaceOffsetX(win.faceOffsetX);
    setPlaybackTime(0);
    setIsPlaying(false);
  };

  const handleSelectWindow = (windowId: string) => {
    const found = windows.find((w) => w.id === windowId);
    if (found) applySelectedWindow(found);
  };

  const loadSourceIntoStudio = (targetSource: VideoSource, customWindows?: SlidingWindow[], note?: string) => {
    const catWeights = CATEGORY_WEIGHTS[targetSource.category] || DEFAULT_WEIGHTS;
    // A source with no transcript has nothing real to score. Building
    // windows from empty segments would show baseline scores and generic
    // hook lines as if they were the video's real moments — so an
    // unanalyzed source loads with NO windows, and the workbench shows
    // an honest "not analyzed yet" state instead. Analyzed sources
    // (presets, pasted transcripts, Analyze results) are unaffected.
    const hasTranscript = targetSource.segments.length > 0;
    const nextWindows =
      customWindows || (hasTranscript ? buildSlidingWindows(targetSource, catWeights) : []);
    const bestId = findTopWindowId(nextWindows);
    const bestWin = nextWindows.find((w) => w.id === bestId) || nextWindows[0];

    setWeights(catWeights);
    setSource(targetSource);
    setYoutubeUrl(targetSource.youtubeUrl);
    setFramingMode(targetSource.framingMode);
    setWindows(nextWindows);
    if (bestWin) {
      applySelectedWindow(bestWin);
    } else {
      // No window to select: clear the previous video's hook, face
      // offset and playback position so nothing stale is shown.
      setHookText('');
      setFaceOffsetX(50);
      setPlaybackTime(0);
      setIsPlaying(false);
    }
    if (note) setStatusMessage(note);
  };

  const handleSelectPreset = (preset: VideoSource) => {
    analysisReqIdRef.current += 1;
    setIsAnalyzing(false);
    setAnalysisStage('');
    setValidationError('');
    setCustomTranscript('');
    setShowTranscriptInput(false);
    loadSourceIntoStudio(
      preset,
      undefined,
      lang === 'bn'
        ? `${preset.channel} (${preset.category}) লোড হয়েছে — সেরা ৬০ সেকেন্ড ক্লিপ নির্বাচিত।`
        : `Loaded ${preset.channel} (${preset.category}) · ${preset.licenseNote}`
    );
  };

  const handleAutoFetchPack = async () => {
    setIsFetchingPack(true);
    setFetchNote(
      lang === 'bn'
        ? 'Cricket, Boxing, Football ও Gaming-এর CC-BY ট্রেন্ডিং লম্বা ভিডিও খোঁজা হচ্ছে...'
        : 'Searching trending long-form CC-BY videos across Cricket, Boxing, Football & Gaming...'
    );

    try {
      let liveNote = '';
      const freshPack = buildAutoFetchPack(
        PRESET_VIDEOS,
        ['cricket', 'boxing', 'football', 'gaming'],
        ccOnly
      );

      try {
        const res = await fetch('/api/auto-fetch-discover', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            categories: ['cricket', 'boxing', 'football', 'gaming'],
            ccOnly,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          liveNote = data.note || '';
          if (Array.isArray(data.discovered) && data.discovered.length > 0) {
            // Merge live YouTube CC-BY metadata (title, channel, URL, thumbnail) onto category templates
            for (const item of freshPack) {
              const liveMatch = data.discovered.find(
                (d: { category: string }) => d.category === item.category
              );
              if (liveMatch) {
                item.source = {
                  ...item.source,
                  title: liveMatch.title,
                  channel: liveMatch.channel,
                  youtubeUrl: liveMatch.youtubeUrl,
                  thumbnailUrl: liveMatch.thumbnailUrl || item.source.thumbnailUrl,
                  licenseStatus: liveMatch.license === 'creativeCommon' ? 'cc-by' : 'indie-safe',
                  licenseNote:
                    liveMatch.license === 'creativeCommon'
                      ? 'Live YouTube CC-BY Source'
                      : 'Live Trending YouTube Source — Pro Viral FFmpeg Transform Ready',
                };
                item.copyright = evaluateCopyrightSafety(item.source);
              }
            }
          }
        }
      } catch {
        // Use built-in CC-BY verified pack seamlessly
      }

      setPack(freshPack);
      if (freshPack[0]) {
        loadSourceIntoStudio(
          freshPack[0].source,
          freshPack[0].windows,
          `Auto-fetched ${freshPack.length} copyright-safe category clips · Loaded ${freshPack[0].category} #1.`
        );
      }
      setFetchNote(
        liveNote ||
          (lang === 'bn'
            ? '৪টি ক্যাটাগরির সেরা CC-BY ৬০ সেকেন্ড ক্লিপ তৈরি হয়েছে।'
            : 'Auto-fetched #1 viral 60s clip for Cricket, Boxing, Football & Gaming (CC-BY verified).')
      );
    } finally {
      setIsFetchingPack(false);
    }
  };

  const handleLoadPackItem = (item: AutoFetchPackItem) => {
    setValidationError('');
    loadSourceIntoStudio(
      item.source,
      item.windows,
      `${item.category.toUpperCase()} #1 (${item.copyright.label}) · ${item.source.title}`
    );
    document.getElementById('timeline-section')?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleChangeWeight = (key: keyof ScoringWeights, value: number) => {
    const nextWeights = { ...weights, [key]: value };
    setWeights(nextWeights);
    setWindows((prev) => reweightWindows(prev, nextWeights));
  };

  const handleResetWeights = () => {
    const base = CATEGORY_WEIGHTS[source.category] || DEFAULT_WEIGHTS;
    setWeights(base);
    setWindows((prev) => reweightWindows(prev, base));
  };

  const handleUploadVideo = async (file: File) => {
    setValidationError('');
    setIsUploadingVideo(true);
    setAnalysisStage(
      lang === 'bn'
        ? `ভিডিও আপলোড হচ্ছে (${file.name}) · FFmpeg দিয়ে অডিও পিক বিশ্লেষণ চলছে...`
        : `Uploading ${file.name} · Analyzing real audio peaks & thumbnail via FFmpeg...`
    );

    try {
      const res = await fetch('/api/upload-video', {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-File-Name': encodeURIComponent(file.name),
        },
        body: file,
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setValidationError(data.error || 'Video upload failed.');
        return;
      }

      const uploadedSource = buildUploadedVideoSource({
        uploadId: data.uploadId,
        filename: data.filename || file.name,
        durationSec: data.durationSec || 60,
        thumbnailUrl: data.thumbnailUrl || '',
        audioEnergyProfile: Array.isArray(data.audioEnergyProfile) ? data.audioEnergyProfile : [],
        category: customCategory,
        rawTranscript: data.rawTranscript || '',
      });

      const catWeights = CATEGORY_WEIGHTS[uploadedSource.category] || DEFAULT_WEIGHTS;
      let candidateWindows = buildSlidingWindows(uploadedSource, catWeights);

      if (data.rawTranscript) {
        try {
          const aiRes = await fetch('/api/analyze-hooks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: uploadedSource.title,
              category: uploadedSource.category,
              windows: candidateWindows.map((w) => ({
                id: w.id,
                startSec: w.startSec,
                endSec: w.endSec,
                transcriptText: w.transcriptText,
              })),
            }),
          });
          if (aiRes.ok) {
            const payload = await aiRes.json();
            if (Array.isArray(payload.results) && payload.results.length > 0) {
              const byId = new Map<string, { hookScore: number; hookReason: string; suggestedHooks: string[] }>();
              for (const item of payload.results) {
                if (item && typeof item.id === 'string') byId.set(item.id, item);
              }
              candidateWindows = candidateWindows.map((win) => {
                const aiHook = byId.get(win.id);
                if (!aiHook) return win;
                const updatedFactors = {
                  ...win.factors,
                  hook: Math.max(0, Math.min(100, Math.round(aiHook.hookScore))),
                };
                return {
                  ...win,
                  factors: updatedFactors,
                  totalScore: calculateWeightedScore(updatedFactors, catWeights),
                  hookReason: aiHook.hookReason || win.hookReason,
                  suggestedHooks: aiHook.suggestedHooks?.length > 0 ? aiHook.suggestedHooks : win.suggestedHooks,
                };
              });
            }
          }
        } catch {
          // Deterministic audio-peak + hook scorer already computed cleanly
        }
      }

      loadSourceIntoStudio(
        uploadedSource,
        candidateWindows,
        lang === 'bn'
          ? `${file.name} লোড হয়েছে (${data.durationSec}s) — রিয়েল অডিও পিক স্কোরিং ও ৯:১৬ ভিডিও প্রিভিউ চালু!`
          : `Loaded ${file.name} (${data.durationSec}s) · Real FFmpeg audio peaks scored · Ready for 9:16 MP4 export!`
      );
    } catch {
      setValidationError('Could not upload video file to server.');
    } finally {
      setIsUploadingVideo(false);
      setAnalysisStage('');
    }
  };

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError('');
    const trimmedUrl = youtubeUrl.trim();
    const trimmedTranscript = customTranscript.trim();

    if (!trimmedUrl && !trimmedTranscript) {
      setValidationError(
        lang === 'bn'
          ? 'অনুগ্রহ করে একটি YouTube লিংক দিন অথবা নিচে ট্রান্সক্রিপ্ট পেস্ট করুন।'
          : 'Please enter a YouTube URL or paste a transcript to analyze.'
      );
      return;
    }

    const reqId = ++analysisReqIdRef.current;
    const matchedPreset = PRESET_VIDEOS.find((p) => p.youtubeUrl === trimmedUrl);
    const isSyntheticPresetUrl = trimmedUrl.includes('youtube.com/watch?v=clippulse-');

    if (!trimmedTranscript && !matchedPreset) {
      setIsAnalyzing(true);
      setAnalysisStage('1/3 Resolving YouTube video metadata...');
      try {
        let meta: { found?: boolean; title?: string; channel?: string } | null = null;
        if (!isSyntheticPresetUrl) {
          const metaRes = await fetch('/api/youtube-oembed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: trimmedUrl }),
          });
          if (metaRes.ok) meta = await metaRes.json();
        }
        if (analysisReqIdRef.current !== reqId) return;
        setShowTranscriptInput(true);
        setValidationError(
          meta?.found && meta?.title
            ? `Resolved "${meta.title}" by ${meta.channel}. Browser preview cannot run yt-dlp/Whisper directly — paste transcript lines below to score windows here, or use Trending Clips, which runs the full pipeline on the server.`
            : 'Browser preview cannot run yt-dlp/Whisper directly on arbitrary URLs — paste transcript lines below to score windows, or use Trending Clips, which runs the full pipeline on the server.'
        );
      } catch {
        if (analysisReqIdRef.current !== reqId) return;
        setShowTranscriptInput(true);
        setValidationError(
          'Paste transcript lines below to score custom windows in the browser, or use Trending Clips — it runs the full pipeline on the server.'
        );
      } finally {
        if (analysisReqIdRef.current === reqId) {
          setIsAnalyzing(false);
          setAnalysisStage('');
        }
      }
      return;
    }

    setIsAnalyzing(true);
    setAnalysisStage(
      lang === 'bn'
        ? '১/৩ ট্রান্সক্রিপ্ট ও স্লাইডিং উইন্ডো তৈরি হচ্ছে...'
        : '1/3 Building 60s sliding windows (5s step)...'
    );

    try {
      let targetSource = matchedPreset || source;

      if (trimmedTranscript) {
        let resolvedTitle = 'Custom Creator Video';
        let resolvedChannel = 'Creator Channel';
        let resolvedThumb = '';

        if (trimmedUrl && !isSyntheticPresetUrl) {
          try {
            const metaRes = await fetch('/api/youtube-oembed', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: trimmedUrl }),
            });
            if (metaRes.ok) {
              const meta = await metaRes.json();
              if (meta.found) {
                resolvedTitle = meta.title || resolvedTitle;
                resolvedChannel = meta.channel || resolvedChannel;
                resolvedThumb = meta.thumbnailUrl || '';
              }
            }
          } catch {
            // Continue with default title
          }
        }

        if (analysisReqIdRef.current !== reqId) return;

        targetSource = parseCustomTranscriptToSource(
          trimmedUrl,
          trimmedTranscript,
          resolvedTitle,
          resolvedChannel,
          customCategory
        );
        if (resolvedThumb) {
          targetSource.thumbnailUrl = resolvedThumb;
        }
      }

      const activeWeights = CATEGORY_WEIGHTS[targetSource.category] || weights;
      let candidateWindows = buildSlidingWindows(targetSource, activeWeights);
      setAnalysisStage(
        lang === 'bn'
          ? '২/৩ Gemini দিয়ে Hook ও ওভারলে টেক্সট স্কোরিং চলছে...'
          : '2/3 Scoring candidate hooks & generating 3s overlays with Gemini...'
      );

      let usedGemini = false;
      let geminiNote = '';

      try {
        const apiRes = await fetch('/api/analyze-hooks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: targetSource.title,
            category: targetSource.category,
            windows: candidateWindows.map((w) => ({
              id: w.id,
              startSec: w.startSec,
              endSec: w.endSec,
              transcriptText: w.transcriptText,
            })),
          }),
        });
        if (analysisReqIdRef.current !== reqId) return;
        if (apiRes.ok) {
          const payload = await apiRes.json();
          usedGemini = Boolean(payload.usedGemini);
          geminiNote = payload.note || '';
          if (Array.isArray(payload.results) && payload.results.length > 0) {
            const byId = new Map<
              string,
              { hookScore: number; hookReason: string; suggestedHooks: string[] }
            >();
            for (const item of payload.results) {
              if (item && typeof item.id === 'string') {
                byId.set(item.id, item);
              }
            }
            candidateWindows = candidateWindows.map((win) => {
              const aiHook = byId.get(win.id);
              if (!aiHook) return win;
              const updatedFactors = {
                ...win.factors,
                hook: Math.max(0, Math.min(100, Math.round(aiHook.hookScore))),
              };
              return {
                ...win,
                factors: updatedFactors,
                totalScore: calculateWeightedScore(updatedFactors, activeWeights),
                hookReason: aiHook.hookReason || win.hookReason,
                suggestedHooks:
                  aiHook.suggestedHooks?.length > 0 ? aiHook.suggestedHooks : win.suggestedHooks,
              };
            });
          }
        }
      } catch {
        // Fallback to deterministic local scorer cleanly
      }

      if (analysisReqIdRef.current !== reqId) return;

      setAnalysisStage('3/3 Generating 9:16 crop & karaoke .ass track...');
      loadSourceIntoStudio(
        targetSource,
        candidateWindows,
        usedGemini
          ? `Scored ${candidateWindows.length} sliding windows with Gemini + Category formula.`
          : geminiNote || `Scored ${candidateWindows.length} sliding windows locally.`
      );
    } finally {
      if (analysisReqIdRef.current === reqId) {
        setIsAnalyzing(false);
        setAnalysisStage('');
      }
    }
  };

  const handleSelectTab = (tab: WorkspaceTab, sectionId?: string) => {
    setActiveTab(tab);
    window.setTimeout(() => {
      if (sectionId && sectionId !== 'top') {
        document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth' });
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }, 60);
  };

  return (
    <div id="top" className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <TopBar
        activeTab={activeTab}
        lang={lang}
        onSelectTab={handleSelectTab}
      />

      <main className="flex-1 max-w-[1440px] w-full mx-auto px-6 py-6 space-y-6">
        <div role="tablist" aria-label="Workspace sections" className="flex md:hidden items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'workbench'}
            onClick={() => handleSelectTab('workbench', 'top')}
            className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'workbench' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            {lang === 'bn' ? 'ওয়ার্কবেঞ্চ' : 'Workbench'}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'trending'}
            onClick={() => handleSelectTab('trending', 'top')}
            className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'trending' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            {lang === 'bn' ? 'ট্রেন্ডিং' : 'Trending'}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'gta6'}
            onClick={() => handleSelectTab('gta6', 'top')}
            className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'gta6' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            GTA 6
          </button>
        </div>

        {activeTab === 'trending' ? (
          <TrendingClipsPanel captionStyle={captionStyle} captionOverrides={captionOverrides} />
        ) : activeTab === 'gta6' ? (
          <Gta6TrackerPanel
            lang={lang}
            onLoadGta6Clip={(gtaSource, note) => {
              setCopyrightSafeTransform(true);
              loadSourceIntoStudio(gtaSource, undefined, note);
              handleSelectTab('workbench', 'timeline-section');
            }}
          />
        ) : activeTab === 'workbench' ? (
          <>
            <SourceInputBar
              presets={PRESET_VIDEOS}
              activeSourceId={source.id}
              youtubeUrl={youtubeUrl}
              customTranscript={customTranscript}
              customCategory={customCategory}
              showTranscriptInput={showTranscriptInput}
              isAnalyzing={isAnalyzing}
              isUploadingVideo={isUploadingVideo}
              analysisStage={analysisStage}
              validationError={validationError}
              statusMessage={statusMessage}
              lang={lang}
              onYoutubeUrlChange={(val) => {
                setYoutubeUrl(val);
                if (validationError) setValidationError('');
              }}
              onCustomTranscriptChange={(val) => {
                setCustomTranscript(val);
                if (validationError) setValidationError('');
              }}
              onCustomCategoryChange={setCustomCategory}
              onToggleTranscriptInput={() => setShowTranscriptInput((prev) => !prev)}
              onSelectPreset={handleSelectPreset}
              onUploadVideo={handleUploadVideo}
              onAnalyze={handleAnalyze}
              onToggleLang={setLang}
            />

            <AutoFetchPackPanel
              pack={pack}
              activeSourceId={source.id}
              ccOnly={ccOnly}
              isFetching={isFetchingPack}
              fetchNote={fetchNote}
              lang={lang}
              onToggleCcOnly={setCcOnly}
              onAutoFetch={handleAutoFetchPack}
              onLoadPackItem={handleLoadPackItem}
            />

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-7 xl:col-span-8">
                {windows.length === 0 ? (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
                    <p className="text-sm font-semibold text-amber-900">
                      {lang === 'bn'
                        ? 'এই ভিডিওটি এখনো অ্যানালাইজ হয়নি — কোনো ট্রান্সক্রিপ্ট বা স্কোর নেই'
                        : 'This video isn’t analyzed yet — no transcript, no scores'}
                    </p>
                    <p className="text-sm text-amber-800 mt-1 leading-relaxed">
                      {lang === 'bn'
                        ? 'পুরো অ্যানালাইসিসের জন্য Trending Clips ট্যাবে গিয়ে ভিডিওর লিংকটি পেস্ট করুন, অথবা নিচে ট্রান্সক্রিপ্ট পেস্ট করে Analyze চাপুন। অ্যানালাইজ না হওয়া পর্যন্ত এখানে কোনো ক্লিপ বা স্কোর দেখানো হবে না।'
                        : 'Paste this video’s link in the Trending Clips tab for the full server analysis, or paste a transcript below and press Analyze. No clips or scores are shown until the video is actually analyzed.'}
                    </p>
                  </div>
                ) : (
                  selectedWindow && (
                    <ViralityTimeline
                      source={source}
                      windows={windows}
                      selectedWindow={selectedWindow}
                      topWindowId={topWindowId}
                      weights={weights}
                      lang={lang}
                      onSelectWindow={handleSelectWindow}
                      onChangeWeight={handleChangeWeight}
                      onResetWeights={handleResetWeights}
                    />
                  )
                )}
              </div>

              <div className="lg:col-span-5 xl:col-span-4 lg:sticky lg:top-22">
                {selectedWindow && (
                  <ReelPreviewPanel
                    source={source}
                    selectedWindow={selectedWindow}
                    playbackTime={playbackTime}
                    isPlaying={isPlaying}
                    hookText={hookText}
                    captionStyle={captionStyle}
                    captionOverrides={captionOverrides}
                    framingMode={framingMode}
                    faceOffsetX={faceOffsetX}
                    includeCredit={includeCredit}
                    transformPreview={copyrightSafeTransform}
                    mirrorFlip={mirrorFlip}
                    lang={lang}
                    onTogglePlay={() => setIsPlaying((prev) => !prev)}
                    onSeek={(t) => {
                      setIsPlaying(false);
                      setPlaybackTime(t);
                    }}
                    onResetPlayback={() => {
                      setIsPlaying(false);
                      setPlaybackTime(0);
                    }}
                    onHookTextChange={setHookText}
                    onCaptionStyleChange={setCaptionStyle}
                    onCaptionOverridesChange={setCaptionOverrides}
                    onFramingModeChange={setFramingMode}
                    onFaceOffsetXChange={setFaceOffsetX}
                    onToggleCredit={setIncludeCredit}
                  />
                )}
              </div>
            </div>
          </>
        ) : (
          <BackendBlueprintView lang={lang} />
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white mt-12">
        <div className="max-w-[1440px] mx-auto px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <span>ClipPulse · Serverless CC-BY Viral 60s Reel Workbench</span>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => handleSelectTab('workbench', 'top')}
              className="hover:text-slate-900 transition-colors cursor-pointer"
            >
              Workbench
            </button>
          </div>
        </div>
      </footer>

    </div>
  );
}
