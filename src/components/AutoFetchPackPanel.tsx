import React, { useState } from 'react';
import { RefreshCw, ShieldCheck, ShieldAlert, Video } from 'lucide-react';
import { formatTimecode } from '../lib/virality';
import type { AutoFetchPackItem, LanguageMode, VideoCategory } from '../lib/types';

interface AutoFetchPackPanelProps {
  pack: AutoFetchPackItem[];
  activeSourceId: string;
  ccOnly: boolean;
  isFetching: boolean;
  fetchNote: string;
  lang: LanguageMode;
  onToggleCcOnly: (val: boolean) => void;
  onAutoFetch: () => void;
  onLoadPackItem: (item: AutoFetchPackItem) => void;
}

const CATEGORY_LABELS: Record<VideoCategory, { en: string; bn: string }> = {
  cricket: { en: 'Cricket', bn: 'ক্রিকেট' },
  boxing: { en: 'Boxing', bn: 'বক্সিং' },
  football: { en: 'Football', bn: 'ফুটবল' },
  gaming: { en: 'Gaming', bn: 'গেমিং' },
  podcast: { en: 'Podcast', bn: 'পডকাস্ট' },
};

export const AutoFetchPackPanel: React.FC<AutoFetchPackPanelProps> = ({
  pack,
  activeSourceId,
  ccOnly,
  isFetching,
  fetchNote,
  lang,
  onToggleCcOnly,
  onAutoFetch,
  onLoadPackItem,
}) => {
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-4 border-b border-slate-100">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900">
            {lang === 'bn'
              ? 'অটো-ফেচ ট্রেন্ডিং ও ভাইরাল ক্লিপ প্যাক'
              : 'Auto-Fetch Trending & Viral Clip Pack'}
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            {lang === 'bn'
              ? 'এক ক্লিকে Cricket, Boxing, Football ও Gaming-এর ট্রেন্ডিং ভিডিও থেকে ১টি করে ভাইরাল ৬০ সেঃ ক্লিপ বের করে FFmpeg ট্রান্সফর্মসহ রেডি করুন।'
              : 'Fetches trending long videos across Cricket, Boxing, Football & Gaming, scores each #1 60s climax, and prepares Pro Viral FFmpeg Transform edits.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={ccOnly}
              onChange={(e) => onToggleCcOnly(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 accent-emerald-700 cursor-pointer"
            />
            <span>{lang === 'bn' ? 'শুধু CC-BY (কপিরাইট-ফ্রি)' : 'CC-BY Only (Skip Mainstream)'}</span>
          </label>

          <button
            type="button"
            onClick={onAutoFetch}
            disabled={isFetching}
            className="inline-flex items-center gap-2 h-10 px-4 text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 shrink-0 ${isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>
              {isFetching
                ? lang === 'bn'
                  ? 'ট্রেন্ডিং খুঁজছে...'
                  : 'Fetching Pack...'
                : lang === 'bn'
                  ? 'অটো-ফেচ ট্রেন্ডিং প্যাক'
                  : 'Auto-Fetch Trending Pack'}
            </span>
          </button>
        </div>
      </div>

      {fetchNote && <p className="text-xs text-slate-500 mt-3">{fetchNote}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
        {pack.map((item) => {
          const isSelected = activeSourceId === item.source.id;
          const imgBroken = brokenImages[item.source.id] || !item.source.thumbnailUrl;
          const catLabel = CATEGORY_LABELS[item.category]?.[lang] || item.category;

          return (
            <article
              key={item.source.id}
              data-testid={`pack-card-${item.category}`}
              className={`border rounded-xl overflow-hidden flex flex-col transition-colors ${
                isSelected ? 'border-rose-600 bg-rose-50/30' : 'border-slate-200 bg-white'
              }`}
            >
              <div className="relative aspect-video bg-slate-900 overflow-hidden">
                {!imgBroken ? (
                  <img
                    src={item.source.thumbnailUrl}
                    alt={`${item.source.title} thumbnail`}
                    referrerPolicy="no-referrer"
                    onError={() =>
                      setBrokenImages((prev) => ({ ...prev, [item.source.id]: true }))
                    }
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div
                    className={`w-full h-full bg-gradient-to-br ${item.source.fallbackGradient} flex items-center justify-center`}
                  >
                    <Video className="w-8 h-8 text-slate-400" aria-hidden="true" />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent pointer-events-none" />
                <div className="absolute bottom-2 left-2.5 right-2.5 flex items-center justify-between text-[11px] font-mono tabular-nums text-white">
                  <span>
                    {formatTimecode(item.topWindow.startSec)}–{formatTimecode(item.topWindow.endSec)}
                  </span>
                  <span className="font-bold">Score {item.topWindow.totalScore.toFixed(1)}</span>
                </div>
              </div>

              <div className="p-3.5 flex-1 flex flex-col justify-between gap-3">
                <div>
                  {/* Clean unboxed metadata row */}
                  <div className="flex items-center gap-1.5 text-xs text-slate-600">
                    <span className="font-semibold text-slate-900">{catLabel}</span>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                      {item.copyright.safe ? (
                        <ShieldCheck className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      ) : (
                        <ShieldAlert className="w-3.5 h-3.5 text-amber-600 shrink-0" aria-hidden="true" />
                      )}
                      <span>{item.copyright.label}</span>
                    </span>
                  </div>

                  <h3 className="text-sm font-bold text-slate-900 mt-1.5 line-clamp-2 leading-snug">
                    {item.source.title}
                  </h3>

                  <p className="text-xs text-slate-600 mt-1.5 line-clamp-2">
                    {item.topWindow.suggestedHooks[0] || item.topWindow.hookReason}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => onLoadPackItem(item)}
                  className={`w-full h-9 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-rose-600 text-white'
                      : 'bg-slate-900 text-white hover:bg-slate-800'
                  }`}
                >
                  {isSelected
                    ? lang === 'bn'
                      ? 'স্টুডিওতে লোড করা আছে'
                      : 'Loaded in Studio'
                    : lang === 'bn'
                      ? 'ক্লিপ লোড করুন'
                      : 'Load Clip in Studio'}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
};
