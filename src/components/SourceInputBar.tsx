import React, { useRef } from 'react';
import { FileText, Globe, PlayCircle, Sparkles, Upload } from 'lucide-react';
import type { LanguageMode, VideoCategory, VideoSource } from '../lib/types';

interface SourceInputBarProps {
  presets: VideoSource[];
  activeSourceId: string;
  youtubeUrl: string;
  customTranscript: string;
  customCategory: VideoCategory;
  showTranscriptInput: boolean;
  isAnalyzing: boolean;
  isUploadingVideo?: boolean;
  analysisStage: string;
  validationError: string;
  statusMessage: string;
  lang: LanguageMode;
  onYoutubeUrlChange: (val: string) => void;
  onCustomTranscriptChange: (val: string) => void;
  onCustomCategoryChange: (cat: VideoCategory) => void;
  onToggleTranscriptInput: () => void;
  onSelectPreset: (preset: VideoSource) => void;
  onUploadVideo?: (file: File) => void;
  onAnalyze: (e: React.FormEvent) => void;
  onToggleLang: (lang: LanguageMode) => void;
}

export const SourceInputBar: React.FC<SourceInputBarProps> = ({
  presets,
  activeSourceId,
  youtubeUrl,
  customTranscript,
  customCategory,
  showTranscriptInput,
  isAnalyzing,
  isUploadingVideo = false,
  analysisStage,
  validationError,
  statusMessage,
  lang,
  onYoutubeUrlChange,
  onCustomTranscriptChange,
  onCustomCategoryChange,
  onToggleTranscriptInput,
  onSelectPreset,
  onUploadVideo,
  onAnalyze,
  onToggleLang,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-4 border-b border-slate-100">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 [text-wrap:balance]">
            {lang === 'bn'
              ? 'ইউটিউব থেকে ভাইরাল ৬০ সেকেন্ড রিল পাইপলাইন'
              : 'YouTube to Viral 60s Reel Pipeline'}
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            {lang === 'bn'
              ? 'Cricket, Boxing, Football, Gaming ও Podcast-এর ক্যাটাগরি-ভিত্তিক স্লাইডিং উইন্ডো স্কোরিং ও ৯:১৬ রিল জেনারেটর।'
              : 'Category-aware 60s sliding-window scorer for Cricket, Boxing, Football, Gaming & Podcasts with CC-BY copyright safety.'}
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0 self-start lg:self-center">
          <div
            role="group"
            aria-label="Interface language"
            className="inline-flex items-center p-1 bg-slate-100 rounded-lg"
          >
            <button
              type="button"
              onClick={() => onToggleLang('en')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                lang === 'en'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Globe className="w-3.5 h-3.5" aria-hidden="true" />
              <span>EN</span>
            </button>
            <button
              type="button"
              onClick={() => onToggleLang('bn')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                lang === 'bn'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              বাংলা
            </button>
          </div>
        </div>
      </div>

      {/* Preset Selector Row */}
      <div className="flex flex-wrap items-center gap-2 pt-4 pb-3">
        <span className="text-xs font-semibold text-slate-500 mr-1">
          {lang === 'bn' ? 'সোর্স লাইব্রেরি:' : 'CC-BY Sources:'}
        </span>
        {presets.map((preset) => {
          const isActive = activeSourceId === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onSelectPreset(preset)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                isActive
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <PlayCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span className="max-w-[180px] truncate">{preset.channel}</span>
            </button>
          );
        })}
      </div>

      {/* Input Form */}
      <form onSubmit={onAnalyze} noValidate className="space-y-3">
        <div className="flex flex-col lg:flex-row gap-2.5">
          <div className="flex-1 min-w-0">
            <label htmlFor="youtube-url-input" className="sr-only">
              YouTube Video URL
            </label>
            <input
              id="youtube-url-input"
              type="url"
              value={youtubeUrl}
              onChange={(e) => onYoutubeUrlChange(e.target.value)}
              placeholder={
                lang === 'bn'
                  ? 'YouTube লম্বা ভিডিও লিংক দিন অথবা .MP4 ভিডিও আপলোড করুন'
                  : 'Paste long YouTube URL (e.g. https://www.youtube.com/watch?v=...) or upload an .MP4'
              }
              className="w-full h-11 px-3.5 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-rose-600/20 focus:border-rose-600"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {onUploadVideo && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.mkv,.webm,.m4v"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      onUploadVideo(file);
                      e.target.value = '';
                    }
                  }}
                />
                <button
                  type="button"
                  disabled={isUploadingVideo || isAnalyzing}
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center justify-center gap-2 h-11 px-4 text-sm font-semibold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Upload className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>
                    {isUploadingVideo
                      ? lang === 'bn'
                        ? 'আপলোড হচ্ছে...'
                        : 'Uploading...'
                      : lang === 'bn'
                        ? 'ভিডিও আপলোড (.MP4)'
                        : 'Upload Video (.MP4)'}
                  </span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={onToggleTranscriptInput}
              aria-expanded={showTranscriptInput}
              className="inline-flex items-center justify-center gap-2 h-11 px-4 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileText className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{lang === 'bn' ? 'ট্রান্সক্রিপ্ট দিন' : 'Paste Transcript'}</span>
            </button>

            <button
              type="submit"
              disabled={isAnalyzing || isUploadingVideo}
              className="inline-flex items-center justify-center gap-2 h-11 px-5 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Sparkles className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>
                {isAnalyzing
                  ? lang === 'bn'
                    ? 'স্কোরিং চলছে...'
                    : 'Analyzing...'
                  : lang === 'bn'
                    ? 'ভাইরালিটি স্কোর বের করুন'
                    : 'Analyze Virality'}
              </span>
            </button>
          </div>
        </div>

        {showTranscriptInput && (
          <div className="space-y-2.5 pt-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="custom-transcript-input" className="text-xs font-medium text-slate-700">
                {lang === 'bn'
                  ? 'ওয়ার্ড-লেভেল বা লাইন-বাই-লাইন ট্রান্সক্রিপ্ট পেস্ট করুন ([MM:SS] ঐচ্ছিক)'
                  : 'Paste transcript lines (optional [MM:SS] prefix per line)'}
              </label>
              <div className="flex items-center gap-2">
                <label htmlFor="custom-category-select" className="text-xs font-medium text-slate-600">
                  {lang === 'bn' ? 'ক্যাটাগরি:' : 'Category:'}
                </label>
                <select
                  id="custom-category-select"
                  value={customCategory}
                  onChange={(e) =>
                    onCustomCategoryChange(e.target.value as import('../lib/types').VideoCategory)
                  }
                  className="h-8 px-2.5 text-xs font-medium bg-slate-50 border border-slate-300 rounded-md text-slate-900"
                >
                  <option value="podcast">Podcast</option>
                  <option value="cricket">Cricket</option>
                  <option value="boxing">Boxing</option>
                  <option value="football">Football</option>
                  <option value="gaming">Gaming</option>
                </select>
              </div>
            </div>
            <textarea
              id="custom-transcript-input"
              rows={4}
              value={customTranscript}
              onChange={(e) => onCustomTranscriptChange(e.target.value)}
              placeholder="[00:00] Why do 90% of creators lose viewers in the first 3 seconds?\n[00:15] Here is the shocking audio mistake nobody notices in editing..."
              className="w-full p-3 text-sm font-mono bg-slate-50 border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-rose-600/20 focus:border-rose-600"
            />
          </div>
        )}

        {validationError && (
          <p role="alert" className="text-sm font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3.5 py-2">
            {validationError}
          </p>
        )}

        {isAnalyzing && analysisStage && (
          <div className="text-xs font-medium text-slate-700 bg-slate-100 rounded-lg px-3.5 py-2">
            {analysisStage}
          </div>
        )}

        {!isAnalyzing && statusMessage && !validationError && (
          <p className="text-xs text-slate-600">{statusMessage}</p>
        )}
      </form>
    </section>
  );
};
