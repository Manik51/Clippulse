import React from 'react';
import { Scissors } from 'lucide-react';
import type { LanguageMode, WorkspaceTab } from '../lib/types';

interface TopBarProps {
  activeTab: WorkspaceTab;
  lang: LanguageMode;
  onSelectTab: (tab: WorkspaceTab, sectionId?: string) => void;
  onOpenExport: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  lang,
  onSelectTab,
  onOpenExport,
}) => {
  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-slate-200">
      <div className="max-w-[1440px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            onSelectTab('workbench', 'top');
          }}
          className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600 rounded"
        >
          ClipPulse
        </a>

        {/* Zone 2: 4 concise single-line nav links */}
        <nav aria-label="Primary navigation" className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
          <button
            type="button"
            onClick={() => onSelectTab('workbench', 'top')}
            className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'workbench'
                ? 'border-rose-600 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            {lang === 'bn' ? 'ওয়ার্কবেঞ্চ' : 'Workbench'}
          </button>
          <button
            type="button"
            onClick={() => onSelectTab('workbench', 'timeline-section')}
            className="whitespace-nowrap shrink-0 py-1 border-b-2 border-transparent hover:text-slate-900 transition-colors cursor-pointer"
          >
            {lang === 'bn' ? 'স্কোরিং টাইমলাইন' : 'Timeline'}
          </button>
          <button
            type="button"
            onClick={() => onSelectTab('trending', 'top')}
            className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'trending'
                ? 'border-rose-600 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            {lang === 'bn' ? 'ট্রেন্ডিং ক্লিপ' : 'Trending Clips'}
          </button>
          <button
            type="button"
            onClick={() => onSelectTab('blueprint', 'backend-code')}
            className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'blueprint'
                ? 'border-rose-600 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            {lang === 'bn' ? 'পাইথন ব্যাকএন্ড' : 'Backend Code'}
          </button>
          <button
            type="button"
            onClick={() => onSelectTab('blueprint', 'free-stack')}
            className="whitespace-nowrap shrink-0 py-1 border-b-2 border-transparent hover:text-slate-900 transition-colors cursor-pointer"
          >
            {lang === 'bn' ? 'ফ্রি স্ট্যাক' : 'Free Stack'}
          </button>
        </nav>

        {/* Zone 3: 1 primary CTA */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onOpenExport}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600"
          >
            <Scissors className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{lang === 'bn' ? 'এক্সপোর্ট .ASS ও FFmpeg' : 'Export .ASS & FFmpeg'}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
