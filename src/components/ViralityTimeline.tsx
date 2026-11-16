import React from 'react';
import { RotateCcw } from 'lucide-react';
import { formatTimecode } from '../lib/virality';
import type { LanguageMode, ScoringWeights, SlidingWindow, VideoSource } from '../lib/types';

interface ViralityTimelineProps {
  source: VideoSource;
  windows: SlidingWindow[];
  selectedWindow: SlidingWindow;
  topWindowId: string;
  weights: ScoringWeights;
  lang: LanguageMode;
  onSelectWindow: (windowId: string) => void;
  onChangeWeight: (key: keyof ScoringWeights, value: number) => void;
  onResetWeights: () => void;
}

export const ViralityTimeline: React.FC<ViralityTimelineProps> = ({
  source,
  windows,
  selectedWindow,
  topWindowId,
  weights,
  lang,
  onSelectWindow,
  onChangeWeight,
  onResetWeights,
}) => {
  const rankedWindows = [...windows].sort((a, b) => b.totalScore - a.totalScore);
  const weightSum = weights.hook + weights.emotion + weights.audio + weights.pacing;

  const pct = (w: number) => (weightSum > 0 ? Math.round((w / weightSum) * 100) : 25);

  return (
    <div id="timeline-section" className="space-y-6 scroll-mt-20">
      {/* Sliding Window Timeline Card */}
      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-2 pb-4 border-b border-slate-100">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900">
              {lang === 'bn'
                ? '৬০ সেকেন্ড স্লাইডিং উইন্ডো ভাইরালিটি টাইমলাইন'
                : '60s Sliding-Window Virality Timeline'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {source.title} · {source.transcriptSource} ·{' '}
              <span className="tabular-nums">{formatTimecode(source.durationSec)}</span>{' '}
              {lang === 'bn' ? 'মোট দৈর্ঘ্য' : 'total'}
            </p>
          </div>
          <div className="text-xs text-slate-600 tabular-nums font-mono">
            {windows.length} {lang === 'bn' ? 'টি উইন্ডো (৫ সেঃ স্টেপ)' : 'windows (5s step)'}
          </div>
        </div>

        {/* Interactive Bar Chart */}
        <div className="mt-5">
          <div
            role="listbox"
            aria-label="Candidate 60-second windows"
            className="flex items-end gap-1.5 h-44 pt-4 pb-2 border-b border-slate-200"
          >
            {windows.map((win) => {
              const isSelected = win.id === selectedWindow.id;
              const isPeak = win.id === topWindowId;
              const heightPct = Math.max(12, Math.min(100, win.totalScore));

              return (
                <button
                  key={win.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  aria-label={`Window ${formatTimecode(win.startSec)} to ${formatTimecode(win.endSec)}, score ${win.totalScore}`}
                  onClick={() => onSelectWindow(win.id)}
                  className="group flex-1 h-full flex flex-col justify-end items-center gap-1.5 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600 rounded"
                >
                  <span
                    className={`text-[11px] font-mono tabular-nums transition-opacity ${
                      isSelected || isPeak
                        ? 'opacity-100 font-semibold text-slate-900'
                        : 'opacity-0 group-hover:opacity-100 text-slate-500'
                    }`}
                  >
                    {Math.round(win.totalScore)}
                  </span>
                  <div
                    style={{ height: `${heightPct}%` }}
                    className={`w-full max-w-[34px] rounded-t-md transition-all ${
                      isSelected
                        ? 'bg-rose-600 ring-2 ring-rose-600/25'
                        : isPeak
                          ? 'bg-rose-400 hover:bg-rose-500'
                          : 'bg-slate-200 hover:bg-slate-400'
                    }`}
                  />
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-500 mt-2">
            <span>{formatTimecode(windows[0]?.startSec ?? 0)}</span>
            <span>
              {lang === 'bn' ? 'নির্বাচিত:' : 'Selected:'}{' '}
              <strong className="text-slate-900">
                {formatTimecode(selectedWindow.startSec)} – {formatTimecode(selectedWindow.endSec)}
              </strong>
            </span>
            <span>{formatTimecode(windows[windows.length - 1]?.endSec ?? source.durationSec)}</span>
          </div>
        </div>

        {/* Formula Metric Breakdown Grid */}
        <div className="mt-6 pt-5 border-t border-slate-100">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <p className="text-xs font-mono text-slate-600">
              total_score = {(weights.hook / (weightSum || 1)).toFixed(2)}×hook +{' '}
              {(weights.emotion / (weightSum || 1)).toFixed(2)}×emotion +{' '}
              {(weights.audio / (weightSum || 1)).toFixed(2)}×audio +{' '}
              {(weights.pacing / (weightSum || 1)).toFixed(2)}×pacing
            </p>
            <button
              type="button"
              onClick={onResetWeights}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{lang === 'bn' ? 'ডিফল্ট ওয়েট (40/30/20/10)' : 'Reset 40/30/20/10'}</span>
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 border border-slate-200 rounded-lg bg-slate-50/70">
            <div className="p-3.5">
              <div className="text-xs text-slate-500">
                {lang === 'bn' ? 'হুক স্কোর' : 'Hook'} · {pct(weights.hook)}%
              </div>
              <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                {selectedWindow.factors.hook}
              </div>
              <input
                aria-label="Hook weight"
                type="range"
                min={0}
                max={80}
                step={5}
                value={Math.round(weights.hook * 100)}
                onChange={(e) => onChangeWeight('hook', Number(e.target.value) / 100)}
                className="w-full mt-2 accent-rose-600 cursor-pointer"
              />
            </div>

            <div className="p-3.5">
              <div className="text-xs text-slate-500">
                {lang === 'bn' ? 'ইমোশন (VADER)' : 'Emotion'} · {pct(weights.emotion)}%
              </div>
              <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                {selectedWindow.factors.emotion}
              </div>
              <input
                aria-label="Emotion weight"
                type="range"
                min={0}
                max={80}
                step={5}
                value={Math.round(weights.emotion * 100)}
                onChange={(e) => onChangeWeight('emotion', Number(e.target.value) / 100)}
                className="w-full mt-2 accent-slate-800 cursor-pointer"
              />
            </div>

            <div className="p-3.5">
              <div className="text-xs text-slate-500">
                {lang === 'bn' ? 'অডিও (Librosa)' : 'Audio Energy'} · {pct(weights.audio)}%
              </div>
              <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                {selectedWindow.factors.audio}
              </div>
              <input
                aria-label="Audio energy weight"
                type="range"
                min={0}
                max={80}
                step={5}
                value={Math.round(weights.audio * 100)}
                onChange={(e) => onChangeWeight('audio', Number(e.target.value) / 100)}
                className="w-full mt-2 accent-slate-800 cursor-pointer"
              />
            </div>

            <div className="p-3.5">
              <div className="text-xs text-slate-500">
                {lang === 'bn' ? 'স্পিড / পেসিং' : 'Pacing'} · {pct(weights.pacing)}%
              </div>
              <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                {selectedWindow.factors.pacing}
              </div>
              <input
                aria-label="Pacing weight"
                type="range"
                min={0}
                max={80}
                step={5}
                value={Math.round(weights.pacing * 100)}
                onChange={(e) => onChangeWeight('pacing', Number(e.target.value) / 100)}
                className="w-full mt-2 accent-slate-800 cursor-pointer"
              />
            </div>

            <div className="p-3.5 bg-white sm:rounded-r-lg col-span-2 sm:col-span-1">
              <div className="text-xs font-semibold text-rose-700">
                {lang === 'bn' ? 'মোট ভাইরাল স্কোর' : 'Total Score'}
              </div>
              <div
                data-testid="selected-total-score"
                className="text-2xl font-extrabold font-mono tabular-nums text-slate-900 mt-1"
              >
                {selectedWindow.totalScore.toFixed(1)}
              </div>
              <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-2">
                {selectedWindow.wordsPerMinute} WPM · {selectedWindow.wordCount} words
              </div>
            </div>
          </div>

          {selectedWindow.matchedKeywords.length > 0 && (
            <p className="text-xs text-slate-500 mt-3">
              <span className="font-medium text-slate-700">
                {lang === 'bn' ? 'শনাক্তকৃত ইমোশনাল শব্দ:' : 'Emotional triggers:'}
              </span>{' '}
              {selectedWindow.matchedKeywords.join(' · ')}
            </p>
          )}
        </div>
      </section>

      {/* Ranked Candidate Windows Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-display text-sm font-bold text-slate-900">
            {lang === 'bn' ? 'র‍্যাংকিং অনুযায়ী সেরা ৬০ সেকেন্ড ক্লিপ' : 'Ranked 60s Candidate Clips'}
          </h3>
          <span className="text-xs text-slate-500">
            {lang === 'bn' ? 'প্রিভিউ দেখতে ক্লিক করুন' : 'Click any row to load into 9:16 preview'}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-2.5 px-4 w-14">Rank</th>
                <th className="py-2.5 px-4 w-32">Window</th>
                <th className="py-2.5 px-4">Hook Trigger</th>
                <th className="py-2.5 px-4 text-right w-20">Hook</th>
                <th className="py-2.5 px-4 text-right w-20">Audio</th>
                <th className="py-2.5 px-4 text-right w-24">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {rankedWindows.slice(0, 6).map((win, idx) => {
                const isSelected = win.id === selectedWindow.id;
                return (
                  <tr
                    key={win.id}
                    onClick={() => onSelectWindow(win.id)}
                    className={`h-11 transition-colors cursor-pointer ${
                      isSelected ? 'bg-rose-50/70' : 'hover:bg-slate-50'
                    }`}
                  >
                    <td className="py-2 px-4 font-mono tabular-nums text-xs font-semibold text-slate-700">
                      #{idx + 1}
                    </td>
                    <td className="py-2 px-4 font-mono tabular-nums text-xs text-slate-900 whitespace-nowrap">
                      {formatTimecode(win.startSec)} – {formatTimecode(win.endSec)}
                    </td>
                    <td className="py-2 px-4 text-xs text-slate-700 max-w-[260px] truncate">
                      {win.hookReason}
                    </td>
                    <td className="py-2 px-4 font-mono tabular-nums text-xs text-right text-slate-600">
                      {win.factors.hook}
                    </td>
                    <td className="py-2 px-4 font-mono tabular-nums text-xs text-right text-slate-600">
                      {win.factors.audio}
                    </td>
                    <td className="py-2 px-4 font-mono tabular-nums text-xs font-bold text-right text-slate-900">
                      {win.totalScore.toFixed(1)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
