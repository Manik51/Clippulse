import React, { useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import {
  CLOUDRUN_DOCKERFILE,
  FLUTTERFLOW_API_SCHEMA,
  FREE_STACK_MATRIX,
  MODAL_SERVERLESS_PY,
  VERCEL_AUTOFETCH_TS,
} from '../lib/backendTemplates';
import type { LanguageMode } from '../lib/types';

interface BackendBlueprintViewProps {
  lang: LanguageMode;
}

type CodeFileKey = 'modal_app.py' | 'vercel_auto_fetch.ts' | 'Dockerfile' | 'flutterflow.json';

const FILE_MAP: Record<CodeFileKey, { label: string; content: string; downloadName: string }> = {
  'modal_app.py': {
    label: 'modal_app.py (Serverless)',
    content: MODAL_SERVERLESS_PY,
    downloadName: 'modal_app.py',
  },
  'vercel_auto_fetch.ts': {
    label: 'vercel_auto_fetch.ts',
    content: VERCEL_AUTOFETCH_TS,
    downloadName: 'auto-fetch-cc.ts',
  },
  Dockerfile: {
    label: 'Dockerfile (Cloud Run)',
    content: CLOUDRUN_DOCKERFILE,
    downloadName: 'Dockerfile',
  },
  'flutterflow.json': {
    label: 'FlutterFlow API',
    content: FLUTTERFLOW_API_SCHEMA,
    downloadName: 'flutterflow_api_call.json',
  },
};

export const BackendBlueprintView: React.FC<BackendBlueprintViewProps> = ({ lang }) => {
  const [selectedFile, setSelectedFile] = useState<CodeFileKey>('modal_app.py');
  const [copied, setCopied] = useState(false);

  const activeFile = FILE_MAP[selectedFile];

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activeFile.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  const handleDownload = () => {
    const blob = new Blob([activeFile.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeFile.downloadName;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-8">
      {/* Serverless Code Exporter */}
      <section id="backend-code" className="bg-white border border-slate-200 rounded-xl overflow-hidden scroll-mt-20">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900">
              {lang === 'bn'
                ? 'স্কেল-টু-জিরো সার্ভারলেস কোড (Modal.com / Cloud Run / Vercel)'
                : 'Scale-to-Zero Serverless Worker (Modal.com / Cloud Run / Vercel)'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {lang === 'bn'
                ? 'HF, Oracle বা Render ছাড়াই অটো-স্কেলিং সার্ভারলেস: yt-dlp --download-sections দিয়ে শুধু ৬০ সেঃ কেটে Cloudflare R2-তে সেভ করে $0-এ বন্ধ হয়।'
                : 'Zero idle VPS/HF/Render servers: wakes on demand, downloads only the 60s slice, renders category-aware 9:16 + CC-BY credit, saves to R2, and scales to $0.'}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                  <span>{lang === 'bn' ? 'কপি হয়েছে' : 'Copied'}</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{lang === 'bn' ? 'কোড কপি' : 'Copy Code'}</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{lang === 'bn' ? 'ডাউনলোড' : 'Download File'}</span>
            </button>
          </div>
        </div>

        <div className="px-6 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center gap-1 overflow-x-auto">
          {(Object.keys(FILE_MAP) as CodeFileKey[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setSelectedFile(key)}
              className={`px-3 py-1.5 text-xs font-mono font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                selectedFile === key
                  ? 'bg-white text-slate-900 border border-slate-200 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {FILE_MAP[key].label}
            </button>
          ))}
        </div>

        <pre className="p-6 text-xs font-mono leading-relaxed text-slate-100 bg-slate-950 overflow-x-auto max-h-[520px]">
          <code>{activeFile.content}</code>
        </pre>
      </section>

      {/* Free Stack Table */}
      <section id="free-stack" className="bg-white border border-slate-200 rounded-xl overflow-hidden scroll-mt-20">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="font-display text-lg font-bold text-slate-900">
            {lang === 'bn' ? 'সার্ভারলেস ও কপিরাইট-সেফ টেক স্ট্যাক' : 'Serverless & Copyright-Safe Tech Stack'}
          </h2>
          <p className="text-sm text-slate-600 mt-0.5">
            {lang === 'bn'
              ? 'YouTube CC-BY সার্চ + Section-Only ডাউনলোড + Modal/Cloud Run অটো-স্কেলিং।'
              : 'Combines YouTube CC-BY filtering, 60s section-only downloads, and scale-to-zero Modal/Cloud Run workers.'}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-3 px-5 w-56">{lang === 'bn' ? 'পাইপলাইন ধাপ' : 'Pipeline Stage'}</th>
                <th className="py-3 px-5 w-64">{lang === 'bn' ? 'ফ্রি টুল / লাইব্রেরি' : 'Tool / Library'}</th>
                <th className="py-3 px-5">{lang === 'bn' ? 'কাজের ধরন' : 'Implementation Role'}</th>
                <th className="py-3 px-5 text-right w-40">{lang === 'bn' ? 'খরচ' : 'Cost'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {FREE_STACK_MATRIX.map((row) => (
                <tr key={row.stage} className="hover:bg-slate-50/70">
                  <td className="py-3 px-5 font-semibold text-slate-900 whitespace-nowrap">
                    {lang === 'bn' ? row.stageBn : row.stage}
                  </td>
                  <td className="py-3 px-5 font-mono text-xs text-slate-800 whitespace-nowrap">
                    {row.tool}
                  </td>
                  <td className="py-3 px-5 text-slate-600">
                    {lang === 'bn' ? row.purposeBn : row.purpose}
                  </td>
                  <td className="py-3 px-5 text-right font-semibold text-emerald-700 whitespace-nowrap">
                    {row.cost}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
