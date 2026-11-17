import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import {
  buildSlidingWindows,
  parseCustomTranscriptToSource,
  mergeSceneBoundaries,
  buildGameplayFilter,
  buildFaceTrackCropX,
  buildHookPunchScale,
  extractYoutubeVideoId,
  normalizeClipLengthSec,
  qualityDims,
  CATEGORY_WEIGHTS,
  DEFAULT_WEIGHTS,
  VOICE_POLISH_FILTER,
} from './src/lib/virality.ts';
import type { VideoCategory } from './src/lib/types.ts';

// Security: a pasted URL reaches yt-dlp as a process argument. Without
// validation, a value starting with `--` would be parsed by yt-dlp as one of
// its own flags (e.g. --exec), which can run commands. Only accept real
// YouTube watch/shorts/live/embed URLs (or a bare video id), and pass '--'
// before the URL at every yt-dlp call site as defence in depth.
function isValidYoutubeVideoUrl(url: string): boolean {
  return extractYoutubeVideoId(url) !== null;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const isProd = process.env.NODE_ENV === 'production' || fs.existsSync(path.resolve(__dirname, 'dist', 'index.html'));

const BLOCKED_BROADCASTERS = [
  'icc',
  'bcci',
  'star sports',
  'sony sports',
  'uefa',
  'premier league',
  'fifa',
  'espn',
  'dazn',
  'ufc',
  'sky sports',
  'top rank',
];

const CATEGORY_SEARCH_QUERIES: Record<string, string> = {
  cricket: 'cricket match highlights full',
  boxing: 'amateur boxing full fight highlights',
  football: 'football match full highlights',
  gaming: 'gaming stream boss clutch highlights',
  podcast: 'tech founder podcast full interview',
};

const renderedClips = new Map<string, string>();
const thumbnails = new Map<string, string>();
// ClipPulse v6 — /tmp is a 512MB tmpfs. Renders used to leave their whole
// workDir (downloaded section + output, 60-300MB each) there, so a few 4K
// renders filled it and later jobs died with ENOSPC ("Conversion failed!").
// Finished clips now move to the home disk or project-local directory; only the in-flight download
// lives in /tmp, and it is deleted right after the render (or on failure).
const RENDERS_DIR = process.env.RENDERS_DIR || path.join(__dirname, 'renders');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
fs.mkdirSync(RENDERS_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function persistRenderedClip(jobId: string, outMp4: string, workDir: string): string {
  const dest = path.join(RENDERS_DIR, `${jobId}.mp4`);
  // copy, not rename: /tmp is a tmpfs, RENDERS_DIR is the home disk —
  // renameSync across devices throws EXDEV.
  fs.copyFileSync(outMp4, dest);
  fs.rmSync(workDir, { recursive: true, force: true });
  return dest;
}

// ClipPulse v6 — async jobs. Renders and smart-analyses take 5-15 min here
// (slow YouTube downloads), longer than many HTTP clients' headers timeout
// (Node's undici kills a fetch at 300s with no headers — the server keeps
// working, but the client never sees the result). So long routes answer
// IMMEDIATELY with a jobId and the client polls GET /api/job-status/:jobId.
// The work itself is unchanged; only the delivery changes. (The v5 30-min
// res.setTimeout stays as a backstop for direct curl callers.)
type AsyncJob = {
  kind: 'render' | 'analyze';
  status: 'rendering' | 'analyzing' | 'done' | 'failed';
  startedAt: number;
  result: Record<string, unknown> | null;
};
const asyncJobs = new Map<string, AsyncJob>();
function finishAsyncJob(jobId: string, result: Record<string, unknown>): void {
  const job = asyncJobs.get(jobId);
  if (!job) return;
  job.status = result.ok === true ? 'done' : 'failed';
  job.result = result;
  if (asyncJobs.size > 30) {
    const oldest = asyncJobs.keys().next().value;
    if (oldest && oldest !== jobId) asyncJobs.delete(oldest);
  }
}
const uploadedVideos = new Map<
  string,
  { filePath: string; thumbPath: string; filename: string; durationSec: number; hasAudio: boolean }
>();

// v8 fix: yt-dlp is a Python entry point (~1.0-1.4s cold start here) and
// this box shares 1.5 CPUs with other work, so the old 2000ms probe
// timed out under load and every smart-analyze/render answered 503
// "yt-dlp is not available" even though the binary is fine. Cache the
// resolved path (it never changes for a running server) and give the
// probe 10s so a slow cold start cannot fake an outage.
let cachedYtDlpBin: string | null | undefined;
function resolveYtDlpBinary(): string | null {
  if (cachedYtDlpBin !== undefined) return cachedYtDlpBin;
  const isWin = process.platform === 'win32';
  const candidates = [
    'yt-dlp',
    ...(isWin ? ['yt-dlp.exe'] : []),
    '/usr/local/bin/yt-dlp',
    // v2 fix: the usual pip/user install location was missing, so a server
    // restarted without ~/.local/bin on PATH silently lost yt-dlp.
    path.join(os.homedir(), '.local', 'bin', 'yt-dlp'),
    path.join(os.tmpdir(), 'clippulse-bin', isWin ? 'yt-dlp.exe' : 'yt-dlp'),
  ];
  for (const bin of candidates) {
    try {
      const res = spawnSync(bin, ['--version'], { stdio: 'ignore', timeout: 10000 });
      if (res.status === 0) {
        cachedYtDlpBin = bin;
        return bin;
      }
    } catch {
      // Try next candidate
    }
  }
  cachedYtDlpBin = null;
  return null;
}

let cachedPythonBin: string | null | undefined;
function resolvePythonBinary(): string {
  if (cachedPythonBin !== undefined && cachedPythonBin !== null) return cachedPythonBin;
  const candidates = process.platform === 'win32'
    ? ['python', 'py', 'python3']
    : ['python3', 'python'];
  for (const bin of candidates) {
    try {
      const res = spawnSync(bin, ['--version'], { stdio: 'ignore', timeout: 5000 });
      if (res.status === 0) {
        cachedPythonBin = bin;
        return bin;
      }
    } catch {
      // Try next candidate
    }
  }
  cachedPythonBin = 'python3';
  return cachedPythonBin;
}

async function ensureYtDlpAvailable(): Promise<void> {
  if (resolveYtDlpBinary()) return;
  if (process.platform !== 'linux') return;
  try {
    const binDir = path.join(os.tmpdir(), 'clippulse-bin');
    fs.mkdirSync(binDir, { recursive: true });
    const target = path.join(binDir, 'yt-dlp');
    const r = await fetch(
      'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux',
      { signal: AbortSignal.timeout(15000) }
    );
    if (!r.ok) return;
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(target, buf);
    fs.chmodSync(target, 0o755);
  } catch {
    // Non-fatal: local setup script or fallback handles absence cleanly
  }
}

function hasBinary(cmd: string): boolean {
  if (cmd === 'yt-dlp') return Boolean(resolveYtDlpBinary());
  const flag = cmd === 'ffmpeg' || cmd === 'ffprobe' ? '-version' : '--version';
  try {
    const res = spawnSync(cmd, [flag], { stdio: 'ignore', timeout: 2000 });
    return res.status === 0;
  } catch {
    return false;
  }
}

let cachedHasAssFilter: boolean | undefined;
function hasFfmpegAssFilter(): boolean {
  if (cachedHasAssFilter !== undefined) return cachedHasAssFilter;
  try {
    const res = spawnSync('ffmpeg', ['-h', 'filter=ass'], { stdio: 'pipe', timeout: 3000 });
    const output = (res.stdout?.toString() || '') + (res.stderr?.toString() || '');
    cachedHasAssFilter = !output.includes("Unknown filter 'ass'") && res.status === 0;
  } catch {
    cachedHasAssFilter = false;
  }
  return cachedHasAssFilter;
}

function getAssFilter(hasValidAss: boolean): string {
  if (!hasValidAss || !hasFfmpegAssFilter()) return '';
  const fontsDir = path.resolve(__dirname, 'public', 'fonts');
  if (fs.existsSync(fontsDir)) {
    const safeDir = fontsDir.replace(/\\/g, '/');
    return `,ass=captions.ass:fontsdir='${safeDir}'`;
  }
  return ',ass=captions.ass';
}

function runProcess(cmd: string, args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 2500) stderr = stderr.slice(-2500);
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}: ${stderr.slice(-400)}`));
    });
  });
}

function runProcessCapture(cmd: string, args: string[], timeoutMs = 12000, captureStderr = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
      // showinfo output for scene detection is long; keep it when the
      // caller asked for stderr, otherwise cap it for error messages.
      const cap = captureStderr ? 200000 : 1000;
      if (stderr.length > cap) stderr = stderr.slice(-cap);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(captureStderr ? `${stdout}\n${stderr}` : stdout);
      else reject(new Error(`${cmd} exited with code ${code}: ${stderr.slice(-200)}`));
    });
  });
}

function extractAudioEnergyProfile(filePath: string, durationSec: number): Promise<number[]> {
  return new Promise((resolve) => {
    const bucketCount = Math.max(12, Math.ceil(durationSec / 5));
    const fallback = Array.from({ length: bucketCount }, () => 62);
    const child = spawn(
      'ffmpeg',
      ['-v', 'error', '-i', filePath, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1'],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(fallback);
    }, 15000);

    child.stdout?.on('data', (c: Buffer) => chunks.push(c));
    child.on('error', () => {
      clearTimeout(timer);
      resolve(fallback);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 || chunks.length === 0) {
        resolve(fallback);
        return;
      }
      const pcm = Buffer.concat(chunks);
      const bytesPerBucket = 8000 * 2 * 5; // 8000Hz * 16-bit mono * 5s
      const rmsValues: number[] = [];
      for (let i = 0; i < bucketCount; i++) {
        const startByte = i * bytesPerBucket;
        if (startByte >= pcm.length) {
          rmsValues.push(0);
          continue;
        }
        const endByte = Math.min(pcm.length, startByte + bytesPerBucket);
        let sumSq = 0;
        let samples = 0;
        for (let b = startByte; b + 1 < endByte; b += 4) {
          const sample = pcm.readInt16LE(b) / 32768;
          sumSq += sample * sample;
          samples++;
        }
        rmsValues.push(samples > 0 ? Math.sqrt(sumSq / samples) : 0);
      }
      const maxRms = Math.max(0.001, ...rmsValues);
      const minRms = Math.min(...rmsValues);
      const span = Math.max(0.001, maxRms - minRms);
      const normalized = rmsValues.map((v) => Math.round(38 + ((v - minRms) / span) * 60));
      resolve(normalized);
    });
  });
}

async function probeDuration(filePath: string): Promise<number> {
  try {
    const out = await runProcessCapture(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath],
      15000,
    );
    const secs = Number.parseFloat(out.trim());
    return Number.isFinite(secs) && secs > 0 ? secs : 0;
  } catch {
    return 0;
  }
}

// ClipPulse v5 — source resolution, so the response can say honestly
// whether a 4K render is native (source >= 2160) or an upscale.
async function probeDimensions(filePath: string): Promise<{ width: number; height: number }> {
  try {
    const out = await runProcessCapture(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', filePath],
      15000,
    );
    const [w, h] = out.trim().split(',').map((v) => Number.parseInt(v, 10));
    return { width: Number.isFinite(w) ? w : 0, height: Number.isFinite(h) ? h : 0 };
  } catch {
    return { width: 0, height: 0 };
  }
}

// ClipPulse v3 — scene detection (OpenShorts-style per-scene reframing).
// v7: PySceneDetect first (AdaptiveDetector — verified to match the
// ffmpeg scene filter's cuts on podcast footage and catch cuts the
// content detector misses, e.g. the 6.96s cut in the Raj clip), with
// the ffmpeg showinfo path as fallback. Boundaries merge so no scene is
// shorter than minSceneSec and the count never exceeds maxScenes.
async function detectScenes(
  videoPath: string,
  durationSec: number,
): Promise<Array<{ startSec: number; endSec: number }>> {
  const script = path.resolve(__dirname, 'scripts', 'detect_scenes.py');
  if (fs.existsSync(script)) {
    try {
      const out = await runProcessCapture(resolvePythonBinary(), [script, videoPath, 'adaptive'], 90000);
      const parsed = JSON.parse(out) as Array<{ startSec: number; endSec: number }>;
      if (Array.isArray(parsed) && parsed.length > 0) {
        const cuts = parsed
          .slice(1)
          .map((s) => s.startSec)
          .filter((t) => Number.isFinite(t) && t > 0.5 && t < durationSec - 0.5);
        return mergeSceneBoundaries(cuts, durationSec, 2, 8);
      }
    } catch {
      // Fall through to the ffmpeg scene filter below.
    }
  }
  try {
    const out = await runProcessCapture(
      'ffmpeg',
      ['-v', 'info', '-i', videoPath, '-vf', "select='gt(scene,0.3)',showinfo", '-f', 'null', '-'],
      60000,
      true,
    );
    const cuts: number[] = [];
    const re = /pts_time:([0-9.]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(out)) !== null) {
      const t = Number.parseFloat(m[1]);
      if (Number.isFinite(t) && t > 0.5 && t < durationSec - 0.5) cuts.push(t);
    }
    return mergeSceneBoundaries(cuts, durationSec, 2, 8);
  } catch {
    return [{ startSec: 0, endSec: durationSec }];
  }
}

// ClipPulse v7 — free sound effects, synthesised with ffmpeg (no
// downloads, no licensing). whoosh.wav: pink noise through a bandpass +
// a rising chirp, faded in/out (verified: 1.2s, max -20.7 dB — mix it
// ~15 dB under the voice). Generated once into assets/ and cached;
// a failure here must never break a render (returns null -> no SFX).
const SFX_DIR = path.resolve(__dirname, 'assets', 'sfx');
async function ensureSfxAssets(): Promise<{ whoosh: string } | null> {
  try {
    const whoosh = path.join(SFX_DIR, 'whoosh.wav');
    if (fs.existsSync(whoosh)) return { whoosh };
    fs.mkdirSync(SFX_DIR, { recursive: true });
    await runProcess('ffmpeg', [
      '-y', '-v', 'error',
      '-f', 'lavfi', '-i', 'anoisesrc=color=pink:d=1.2',
      '-f', 'lavfi', '-i', "aevalsrc='0.5*sin(2*PI*(200*t+700*t*t))':d=1.2",
      '-filter_complex',
      '[0:a]bandpass=f=1200:width_type=q:width=0.7[bp];[1:a]afade=t=in:st=0:d=0.6,afade=t=out:st=0.6:d=0.6[sw];[bp][sw]amix=inputs=2:duration=first,afade=t=in:st=0:d=0.9,afade=t=out:st=0.3:d=0.9,volume=0.6,aformat=sample_rates=44100:channel_layouts=stereo[out]',
      '-map', '[out]', whoosh,
    ], SFX_DIR);
    return fs.existsSync(whoosh) ? { whoosh } : null;
  } catch {
    return null;
  }
}

async function detectSceneFaces(framePaths: string[]): Promise<Array<number | null>> {
  const script = path.resolve(__dirname, 'scripts', 'scene_faces.py');
  if (!fs.existsSync(script) || framePaths.length === 0) {
    return framePaths.map(() => null);
  }
  try {
    const out = await runProcessCapture(resolvePythonBinary(), [script, ...framePaths], 90000);
    const parsed = JSON.parse(out) as Array<number | null>;
    if (Array.isArray(parsed) && parsed.length === framePaths.length) return parsed;
    return framePaths.map(() => null);
  } catch {
    return framePaths.map(() => null);
  }
}


function isChannelBlocked(channelName: string): boolean {
  const ch = channelName.toLowerCase();
  return BLOCKED_BROADCASTERS.some((blocked) => ch.includes(blocked));
}

async function discoverCategoryViaYtDlp(cat: string, ccOnly: boolean) {
  const ytDlpBin = resolveYtDlpBinary();
  if (!ytDlpBin) return null;
  const query = CATEGORY_SEARCH_QUERIES[cat] || `${cat} full highlights`;
  // sp=EgIwAQ%3D%3D applies YouTube's built-in Creative Commons filter with zero API key
  const targetUrl = ccOnly
    ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIwAQ%3D%3D`
    : `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

  const raw = await runProcessCapture(
    ytDlpBin,
    [
      '--js-runtimes',
      `node:${process.execPath}`,
      '--flat-playlist',
      '--dump-single-json',
      '--no-warnings',
      '--playlist-end',
      '8',
      targetUrl,
    ],
    12000
  );
  const parsed = JSON.parse(raw) as {
    entries?: Array<{
      id?: string;
      title?: string;
      channel?: string;
      uploader?: string;
      duration?: number | null;
    }>;
  };
  const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
  const safeEntries = entries.filter((e) => {
    if (!e?.id) return false;
    const ch = e.channel || e.uploader || '';
    if (ccOnly && isChannelBlocked(ch)) return false;
    return !e.duration || e.duration >= 75;
  });

  const best = safeEntries.find((e) => !e.duration || e.duration >= 180) || safeEntries[0];
  if (!best?.id) return null;

  return {
    category: cat,
    videoId: best.id,
    title: best.title || `${cat} Creative Commons Video`,
    channel: best.channel || best.uploader || 'CC-BY Creator',
    youtubeUrl: `https://www.youtube.com/watch?v=${best.id}`,
    thumbnailUrl: `https://i.ytimg.com/vi/${best.id}/hqdefault.jpg`,
    license: ccOnly ? 'creativeCommon' : 'standard',
  };
}

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey === '<redacted>' || apiKey.startsWith('MY_')) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// ---- ClipPulse v2: real-signal helpers (no synthetic presets) ----

function formatMmSs(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

// Groq Whisper (whisper-large-v3-turbo) is fast and returns timestamped
// segments. Gemini audio transcription works but is ~3x realtime on this
// key, so it cannot cover a long video in one call.
async function transcribeWithGroqWhisper(
  audioPath: string,
  workDir: string,
  groqKey: string,
  durationSec: number
): Promise<string> {
  const chunkSec = 600;
  const chunkCount = Math.max(1, Math.ceil(durationSec / chunkSec));
  const lines: string[] = [];
  for (let i = 0; i < chunkCount; i++) {
    const offset = i * chunkSec;
    const chunkPath = path.join(workDir, `whisper_chunk_${i}.mp3`);
    await runProcess(
      'ffmpeg',
      ['-y', '-ss', String(offset), '-t', String(chunkSec), '-i', audioPath, '-vn', '-ac', '1', '-ab', '32k', chunkPath],
      workDir
    );
    const buf = fs.readFileSync(chunkPath);
    if (buf.length === 0 || buf.length >= 25 * 1024 * 1024) {
      fs.rmSync(chunkPath, { force: true });
      continue;
    }
    // ClipPulse v6 — a long video is 11+ chunks; ONE transient Groq blip
    // (429/500) used to throw away the WHOLE transcript. Retry each chunk,
    // and skip it (keeping the other chunks) instead of failing everything.
    // (The FormData is rebuilt per attempt so a half-sent body is never reused.)
    let gRes: Response | null = null;
    let lastErr = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      const form = new FormData();
      form.append('file', new Blob([buf], { type: 'audio/mpeg' }), 'chunk.mp3');
      form.append('model', 'whisper-large-v3-turbo');
      form.append('response_format', 'verbose_json');
      form.append('timestamp_granularities[]', 'word');
      try {
        gRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${groqKey}` },
          body: form,
          signal: AbortSignal.timeout(120000),
        });
        if (gRes.ok) break;
        lastErr = `Groq Whisper failed (${gRes.status})`;
        gRes = null;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : 'Groq Whisper request failed';
        gRes = null;
      }
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt === 1 ? 5000 : 15000));
    }
    fs.rmSync(chunkPath, { force: true });
    if (!gRes) {
      console.error(`[smart-analyze] chunk ${i} (${offset}s) skipped after 3 attempts: ${lastErr}`);
      continue;
    }
    const parsed = (await gRes.json()) as {
      segments?: Array<{ start?: number; text?: string }>;
      text?: string;
    };
    for (const seg of parsed.segments || []) {
      const text = (seg.text || '').trim();
      if (!text) continue;
      lines.push(`[${formatMmSs(offset + (seg.start || 0))}] ${text}`);
    }
    if (lines.length === 0 && parsed.text?.trim()) {
      lines.push(`[${formatMmSs(offset)}] ${parsed.text.trim()}`);
    }
  }
  return lines.join('\n').trim();
}

async function transcribeAudioFile(
  audioPath: string,
  workDir: string,
  ai: GoogleGenAI | null,
  durationSec = 180
): Promise<string> {
  const groqKey = process.env.GROQ_API_KEY;
  const hasValidGroq = Boolean(
    groqKey && groqKey !== 'MY_GROQ_API_KEY' && groqKey !== '<redacted>' && !groqKey.startsWith('MY_')
  );
  if (hasValidGroq && groqKey) {
    try {
      const whisperText = await transcribeWithGroqWhisper(audioPath, workDir, groqKey, durationSec);
      if (whisperText.length > 0) return whisperText;
    } catch (e) {
      // Fall through to Gemini on the first 180s.
      console.error('[smart-analyze] Groq Whisper failed:', e instanceof Error ? e.message : e);
    }
  }
  if (!ai) return '';
  const mp3Path = path.join(workDir, 'audio_sample.mp3');
  try {
    await runProcess(
      'ffmpeg',
      ['-y', '-i', audioPath, '-t', '180', '-vn', '-ac', '1', '-ab', '32k', mp3Path],
      workDir
    );
    const mp3Buf = fs.readFileSync(mp3Path);
    if (mp3Buf.length === 0 || mp3Buf.length >= 15 * 1024 * 1024) return '';
    const aiRes = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'audio/mp3', data: mp3Buf.toString('base64') } },
            {
              text: 'Transcribe the speech/commentary into concise timestamped lines formatted strictly as [MM:SS] spoken text. Keep original language (English or Bengali). No intro or markdown.',
            },
          ],
        },
      ],
    });
    return aiRes.text ? aiRes.text.trim() : '';
  } catch {
    return '';
  } finally {
    fs.rmSync(mp3Path, { force: true });
  }
}

async function getYoutubeMeta(
  ytDlpBin: string,
  youtubeUrl: string
): Promise<{ videoId: string; title: string; channel: string; durationSec: number } | null> {
  try {
    const raw = await runProcessCapture(
      ytDlpBin,
      [
        '--js-runtimes',
        `node:${process.execPath}`,
        '--dump-single-json',
        '--no-download',
        '--no-warnings',
        '--',
        youtubeUrl,
      ],
      20000
    );
    const parsed = JSON.parse(raw) as {
      id?: string;
      title?: string;
      channel?: string;
      uploader?: string;
      duration?: number;
    };
    return {
      videoId: parsed.id || '',
      title: parsed.title || 'YouTube Video',
      channel: parsed.channel || parsed.uploader || 'YouTube Creator',
      durationSec: Math.round(parsed.duration || 0),
    };
  } catch {
    return null;
  }
}

type FacecamResult = {
  corner: string | null;
  cropOrigin: [number, number] | null;
  cornerScore: number;
  facesDetected: number;
  faceX: number | null;
} | null;

async function detectFacecam(videoPath: string): Promise<FacecamResult> {
  const script = path.resolve(__dirname, 'scripts', 'detect_facecam.py');
  if (!fs.existsSync(script)) return null;
  try {
    const out = await runProcessCapture(resolvePythonBinary(), [script, videoPath], 90000);
    const parsed = JSON.parse(out) as FacecamResult & { error?: string };
    if (parsed && !parsed.error) return parsed;
    return null;
  } catch {
    return null;
  }
}

type CamboxResult = {
  box: [number, number, number, number] | null;
  faceX: number | null;
  faceY: number | null;
  facesDetected: number;
  method: string | null;
} | null;

// ClipPulse v4 — facecam BOX detection (OpusClip Gameplay layout). v2's
// corner-only check missed cams that sit mid-frame (this Apex stream's cam
// is a pink-bordered box at x 0.03-0.21, y 0.38-0.62). The detector finds
// the box anywhere via YuNet + contour search, and only trusts it when it
// persists across >=2 sampled frames.
async function detectCambox(videoPath: string): Promise<CamboxResult> {
  const script = path.resolve(__dirname, 'scripts', 'detect_cambox.py');
  if (!fs.existsSync(script)) return null;
  try {
    const out = await runProcessCapture(resolvePythonBinary(), [script, videoPath], 90000);
    const parsed = JSON.parse(out) as CamboxResult & { error?: string };
    if (parsed && !parsed.error) return parsed;
    return null;
  } catch {
    return null;
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  ensureYtDlpAvailable().catch(() => {});

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'clippulse-api' });
  });

  // ClipPulse v6 — poll a long job (render / smart-analyze) submitted with
  // the async pattern. Returns { jobId, kind, status, startedAt } plus
  // `result` (the exact payload the old sync response carried) once done.
  app.get('/api/job-status/:jobId', (req, res) => {
    const job = asyncJobs.get(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'Job not found or expired.' });
      return;
    }
    res.json({
      jobId: req.params.jobId,
      kind: job.kind,
      status: job.status,
      startedAt: job.startedAt,
      ...(job.result ? { result: job.result } : {}),
    });
  });

  app.get('/api/local-capabilities', (_req, res) => {
    const hasYtDlp = hasBinary('yt-dlp');
    const hasFfmpeg = hasBinary('ffmpeg');
    const hasGeminiKey = Boolean(
      process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY' && process.env.GEMINI_API_KEY !== '<redacted>'
    );
    const hasGroqKey = Boolean(
      process.env.GROQ_API_KEY && process.env.GROQ_API_KEY !== 'MY_GROQ_API_KEY' && process.env.GROQ_API_KEY !== '<redacted>'
    );
    const hasYoutubeKey = Boolean(
      process.env.YOUTUBE_API_KEY && process.env.YOUTUBE_API_KEY !== 'MY_YOUTUBE_DATA_API_V3_KEY' && process.env.YOUTUBE_API_KEY !== '<redacted>'
    );
    res.json({
      hasYtDlp,
      hasFfmpeg,
      hasAssFilter: hasFfmpegAssFilter(),
      canRenderLocally: hasYtDlp && hasFfmpeg,
      canRenderPreviewSample: hasFfmpeg,
      canUploadVideo: hasFfmpeg,
      hasGeminiKey,
      hasGroqKey,
      hasYoutubeKey,
    });
  });

  app.post(
    '/api/upload-video',
    express.raw({ type: '*/*', limit: '300mb' }),
    async (req, res) => {
      if (!hasBinary('ffmpeg') || !hasBinary('ffprobe')) {
        res.status(503).json({ ok: false, error: 'FFmpeg / FFprobe unavailable on server.' });
        return;
      }

      const rawBuf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (rawBuf.length < 1024) {
        res.status(400).json({ ok: false, error: 'Please select a valid video file (.mp4, .mov, .mkv, .webm).' });
        return;
      }

      if (uploadedVideos.size >= 10) {
        const oldestId = uploadedVideos.keys().next().value;
        if (oldestId) {
          const oldEntry = uploadedVideos.get(oldestId);
          uploadedVideos.delete(oldestId);
          if (oldEntry) {
            fs.rmSync(path.dirname(oldEntry.filePath), { recursive: true, force: true });
          }
        }
      }

      const rawHeaderName = typeof req.headers['x-file-name'] === 'string' ? req.headers['x-file-name'] : 'uploaded_video.mp4';
      let decodedName = 'uploaded_video.mp4';
      try {
        decodedName = decodeURIComponent(rawHeaderName);
      } catch {
        decodedName = rawHeaderName;
      }
      const extMatch = path.extname(decodedName).toLowerCase();
      const safeExt = ['.mp4', '.mov', '.mkv', '.webm', '.m4v'].includes(extMatch) ? extMatch : '.mp4';

      const uploadId = crypto.randomUUID();
      // v6: uploads live on the home disk, not the 512MB /tmp tmpfs.
      const uploadDir = fs.mkdtempSync(path.join(UPLOADS_DIR, `clippulse-up-${uploadId}-`));
      const filePath = path.join(uploadDir, `source${safeExt}`);
      const thumbPath = path.join(uploadDir, 'thumb.jpg');

      try {
        fs.writeFileSync(filePath, rawBuf);

        const durOut = await runProcessCapture(
          'ffprobe',
          ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
          6000
        );
        const parsedDur = Number.parseFloat(durOut.trim());
        const durationSec = Number.isFinite(parsedDur) && parsedDur > 1 ? Math.round(parsedDur) : 60;

        const audioProbe = await runProcessCapture(
          'ffprobe',
          ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', filePath],
          5000
        ).catch(() => '');
        const hasAudio = audioProbe.trim().length > 0;

        const thumbSeek = Math.min(2, Math.max(0, Math.floor(durationSec / 4)));
        await runProcess('ffmpeg', ['-y', '-ss', String(thumbSeek), '-i', filePath, '-frames:v', '1', '-q:v', '3', thumbPath], uploadDir).catch(() => {});

        const audioEnergyProfile = hasAudio
          ? await extractAudioEnergyProfile(filePath, durationSec)
          : Array.from({ length: Math.max(12, Math.ceil(durationSec / 5)) }, () => 60);

        let rawTranscript = '';
        const ai = getGeminiClient();
        if (hasAudio && ai) {
          const mp3Path = path.join(uploadDir, 'audio_sample.mp3');
          try {
            await runProcess(
              'ffmpeg',
              ['-y', '-i', filePath, '-t', '180', '-vn', '-ac', '1', '-ab', '32k', mp3Path],
              uploadDir
            );
            const mp3Buf = fs.readFileSync(mp3Path);
            if (mp3Buf.length > 0 && mp3Buf.length < 15 * 1024 * 1024) {
              const aiRes = await ai.models.generateContent({
                model: GEMINI_MODEL,
                contents: [
                  {
                    role: 'user',
                    parts: [
                      {
                        inlineData: {
                          mimeType: 'audio/mp3',
                          data: mp3Buf.toString('base64'),
                        },
                      },
                      {
                        text: 'Transcribe the speech/commentary into concise timestamped lines formatted strictly as [MM:SS] spoken text. Keep original language (English or Bengali). No intro or markdown.',
                      },
                    ],
                  },
                ],
              });
              if (aiRes.text) rawTranscript = aiRes.text.trim();
            }
          } catch {
            // Optional AI transcription failure should never block real video upload
          } finally {
            fs.rmSync(mp3Path, { force: true });
          }
        }

        uploadedVideos.set(uploadId, {
          filePath,
          thumbPath,
          filename: decodedName,
          durationSec,
          hasAudio,
        });

        res.json({
          ok: true,
          uploadId,
          filename: decodedName,
          durationSec,
          hasAudio,
          thumbnailUrl: fs.existsSync(thumbPath) ? `/api/uploaded-thumb/${uploadId}` : '',
          videoUrl: `/api/uploaded-video/${uploadId}`,
          audioEnergyProfile,
          rawTranscript,
        });
      } catch (err) {
        fs.rmSync(uploadDir, { recursive: true, force: true });
        res.status(500).json({
          ok: false,
          error: err instanceof Error ? err.message : 'Failed to inspect uploaded video.',
        });
      }
    }
  );

  app.get('/api/uploaded-video/:uploadId', (req, res) => {
    const entry = uploadedVideos.get(req.params.uploadId);
    if (!entry || !fs.existsSync(entry.filePath)) {
      res.status(404).json({ error: 'Uploaded video not found or expired.' });
      return;
    }
    res.sendFile(entry.filePath);
  });

  app.get('/api/uploaded-thumb/:uploadId', (req, res) => {
    const entry = uploadedVideos.get(req.params.uploadId);
    if (!entry || !fs.existsSync(entry.thumbPath)) {
      res.status(404).json({ error: 'Thumbnail not found.' });
      return;
    }
    res.sendFile(entry.thumbPath);
  });

  app.post('/api/youtube-oembed', async (req, res) => {
    const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (!url) {
      res.status(400).json({ error: 'YouTube URL is required.' });
      return;
    }

    try {
      const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(4500) });
      if (!response.ok) {
        res.json({
          found: false,
          title: '',
          channel: '',
          thumbnailUrl: '',
        });
        return;
      }
      const data = (await response.json()) as {
        title?: string;
        author_name?: string;
        thumbnail_url?: string;
      };
      res.json({
        found: true,
        title: data.title || 'YouTube Video',
        channel: data.author_name || 'YouTube Creator',
        thumbnailUrl: data.thumbnail_url || '',
      });
    } catch {
      res.json({
        found: false,
        title: '',
        channel: '',
        thumbnailUrl: '',
      });
    }
  });

  // ClipPulse v3 — 2-pass packaging (OpenShorts-style detail pass).
  // Pass 1 (smart-analyze) finds the best window from real signals; this
  // pass turns that window into publish-ready packaging: a short title with
  // a VERIFIED concrete number/name from the transcript (never invented),
  // a spoken hook line, a description with CTA, and hashtags.
  app.post('/api/package-clip', async (req, res) => {
    const videoTitle = typeof req.body?.title === 'string' ? req.body.title : 'Creator Video';
    const category = typeof req.body?.category === 'string' ? req.body.category : 'podcast';
    const transcriptText = typeof req.body?.transcriptText === 'string' ? req.body.transcriptText : '';
    const startSec = Number(req.body?.startSec ?? 0);
    const endSec = Number(req.body?.endSec ?? 60);
    const hookReason = typeof req.body?.hookReason === 'string' ? req.body.hookReason : '';

    const groqKey = process.env.GROQ_API_KEY;
    const hasValidGroq = Boolean(groqKey && groqKey !== 'MY_GROQ_API_KEY' && groqKey !== '<redacted>');
    const ai = getGeminiClient();

    const localPackage = () => {
      const firstLine = transcriptText.split(/[.!?]/)[0]?.trim() || videoTitle;
      return {
        title: videoTitle.slice(0, 60),
        hook: firstLine.slice(0, 80) || 'Wait until you see this moment',
        description: `${videoTitle} — best moment ${startSec}s-${endSec}s. What do you think? Comment below!`,
        hashtags: ['#shorts', `#${category}`, '#viral', '#moments'],
        provider: 'local',
      };
    };

    const systemPrompt =
      'You are a YouTube Shorts packaging expert. Return JSON with keys: title (max 60 chars, MUST include one concrete number, name or event copied from the transcript — never invent one), hook (max 10 words, spoken style, the first line of the video), description (2 sentences + one comment CTA question), hashtags (array of 5-8 tags, no spaces, no # prefix needed). No other keys, no markdown. CRITICAL: the transcript is messy live commentary — the WINNER is the name announced at the very END of the transcript (the winner announcement). Never swap winner and loser. If you cannot tell who won from the transcript, describe the moment without naming a winner.';

    const userPrompt = `Video title: ${videoTitle}\nCategory: ${category}\nWindow: ${startSec}s-${endSec}s (${hookReason})\nTranscript of the window:\n${transcriptText.slice(0, 1500)}`;

    async function tryGroq(): Promise<Record<string, unknown> | null> {
      if (!hasValidGroq) return null;
      try {
        const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqKey}` },
          signal: AbortSignal.timeout(15000),
          body: JSON.stringify({
            model: 'openai/gpt-oss-120b',
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
          }),
        });
        if (!groqRes.ok) return null;
        const groqJson = (await groqRes.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const content = groqJson.choices?.[0]?.message?.content;
        if (!content) return null;
        return JSON.parse(content) as Record<string, unknown>;
      } catch {
        return null;
      }
    }

    async function tryGemini(): Promise<Record<string, unknown> | null> {
      if (!ai) return null;
      try {
        const aiRes = await ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
          config: { responseMimeType: 'application/json' },
        });
        const text = aiRes.text;
        if (!text) return null;
        return JSON.parse(text) as Record<string, unknown>;
      } catch {
        return null;
      }
    }

    const parsed = (await tryGroq()) || (await tryGemini());
    if (parsed && typeof parsed.title === 'string' && parsed.title.trim()) {
      const hashtags = Array.isArray(parsed.hashtags)
        ? (parsed.hashtags as unknown[]).map((h) => String(h).replace(/^#/, '')).filter(Boolean).slice(0, 8)
        : localPackage().hashtags;
      res.json({
        ok: true,
        title: String(parsed.title).slice(0, 60),
        hook: typeof parsed.hook === 'string' ? parsed.hook : localPackage().hook,
        description: typeof parsed.description === 'string' ? parsed.description : localPackage().description,
        hashtags,
        provider: 'ai',
      });
      return;
    }
    res.json({ ok: true, ...localPackage() });
  });

  // ClipPulse v2 — Smart Analyze: pick the best window from REAL signals.
  // v1 scored preset (synthetic) transcripts, so the "top" window could be a
  // lobby screen. v2 downloads the real audio, measures its real energy,
  // transcribes it with Gemini, and scores sliding windows on that.
  app.post('/api/smart-analyze', async (req, res) => {
    res.setTimeout(30 * 60 * 1000);
    const youtubeUrl = typeof req.body?.youtubeUrl === 'string' ? req.body.youtubeUrl.trim() : '';
    const category = (typeof req.body?.category === 'string' ? req.body.category : 'podcast') as VideoCategory;
    // v8.6 — clipLengthSec (30/45/60/custom, 10–180s, default 30).
    // windowSec stays as a legacy alias for older clients.
    const clipLengthSec = normalizeClipLengthSec(req.body?.clipLengthSec ?? req.body?.windowSec);
    if (!youtubeUrl) {
      res.status(400).json({ ok: false, error: 'YouTube URL is required.' });
      return;
    }
    if (!isValidYoutubeVideoUrl(youtubeUrl)) {
      res.status(400).json({ ok: false, error: 'Provide a valid YouTube video URL.' });
      return;
    }
    const ytDlpBin = resolveYtDlpBinary();
    if (!ytDlpBin) {
      res.status(503).json({ ok: false, error: 'yt-dlp is not available on this server.' });
      return;
    }
    const jobId = crypto.randomUUID();
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `clippulse-smart-${jobId}-`));
    // ClipPulse v6 — async: answer now, finish the job when the analysis
    // lands (a 109-min video takes ~10 min here). Fast validation above
    // still answers synchronously.
    asyncJobs.set(jobId, { kind: 'analyze', status: 'analyzing', startedAt: Date.now(), result: null });
    res.json({ ok: true, jobId, status: 'analyzing' });
    try {
      const meta = await getYoutubeMeta(ytDlpBin, youtubeUrl);
      const audioPath = path.join(workDir, 'audio.m4a');
      await runProcess(
        ytDlpBin,
        [
          '--js-runtimes',
          `node:${process.execPath}`,
          '-f',
          'ba[ext=m4a]/ba',
          '--no-playlist',
          '-o',
          audioPath,
          '--',
          youtubeUrl,
        ],
        workDir
      );
      const durOut = await runProcessCapture(
        'ffprobe',
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', audioPath],
        15000
      ).catch(() => '');
      const parsedDur = Number.parseFloat(durOut.trim());
      const durationSec =
        Number.isFinite(parsedDur) && parsedDur > 0 ? Math.round(parsedDur) : meta?.durationSec || 0;
      if (!durationSec || durationSec < clipLengthSec) {
        finishAsyncJob(jobId, { ok: false, error: 'Video is too short for a smart window analysis.' });
        return;
      }
      const audioProfile = await extractAudioEnergyProfile(audioPath, durationSec);
      const ai = getGeminiClient();
      const transcript = await transcribeAudioFile(audioPath, workDir, ai, durationSec);
      const weights = CATEGORY_WEIGHTS[category] || DEFAULT_WEIGHTS;
      const source = parseCustomTranscriptToSource(
        youtubeUrl,
        transcript || '[00:00] (No transcript — scoring on real audio energy only.)',
        meta?.title || 'YouTube Video',
        meta?.channel || 'YouTube Creator',
        category
      );
      source.audioEnergyProfile = audioProfile;
      source.durationSec = durationSec;
      const windows = buildSlidingWindows(source, weights, clipLengthSec, 5);
      const sorted = [...windows].sort((a, b) => b.totalScore - a.totalScore);
      const top = sorted[0];
      finishAsyncJob(jobId, {
        ok: true,
        videoId: meta?.videoId || '',
        title: meta?.title || 'YouTube Video',
        channel: meta?.channel || 'YouTube Creator',
        durationSec,
        windowSec: clipLengthSec,
        clipLengthSec,
        hasTranscript: transcript.length > 0,
        transcriptChars: transcript.length,
        topWindow: top
          ? {
              startSec: top.startSec,
              endSec: top.endSec,
              totalScore: top.totalScore,
              factors: top.factors,
              hookReason: top.hookReason,
              suggestedHooks: top.suggestedHooks,
              matchedKeywords: top.matchedKeywords,
              transcriptText: top.transcriptText,
            }
          : null,
        windows: sorted.slice(0, 12).map((w) => ({
          startSec: w.startSec,
          endSec: w.endSec,
          totalScore: w.totalScore,
          factors: w.factors,
          hookReason: w.hookReason,
          transcriptText: w.transcriptText,
          suggestedHooks: w.suggestedHooks,
        })),
        audioEnergyProfile: audioProfile,
        // ClipPulse v6 — the full timestamped transcript segments, so the
        // UI can build karaoke .ass subtitles for any window with the same
        // generateAssSubtitle the workbench uses (line-level Whisper timing,
        // words spread evenly inside each line).
        segments: source.segments,
      });
      return;
    } catch (err) {
      finishAsyncJob(jobId, { ok: false, error: err instanceof Error ? err.message : 'Smart analysis failed.' });
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  app.post('/api/auto-fetch-discover', async (req, res) => {
    const categories: string[] = Array.isArray(req.body?.categories)
      ? req.body.categories
      : ['cricket', 'boxing', 'football', 'gaming'];
    const ccOnly = req.body?.ccOnly !== false;
    const ytApiKey = process.env.YOUTUBE_API_KEY;
    const hasValidYtKey = Boolean(ytApiKey && ytApiKey !== 'MY_YOUTUBE_DATA_API_V3_KEY' && ytApiKey !== '<redacted>');

    const discovered: Array<{
      category: string;
      videoId: string;
      title: string;
      channel: string;
      youtubeUrl: string;
      thumbnailUrl: string;
      license: string;
    }> = [];

    if (!hasValidYtKey) {
      if (hasBinary('yt-dlp')) {
        try {
          const results = await Promise.all(
            categories.map((cat) => discoverCategoryViaYtDlp(cat, ccOnly).catch(() => null))
          );
          for (const item of results) {
            if (item) discovered.push(item);
          }
          if (discovered.length > 0) {
            res.json({
              liveApiUsed: true,
              note: ccOnly
                ? `Fetched ${discovered.length} live Creative Commons videos via zero-key yt-dlp search.`
                : `Fetched ${discovered.length} live trending viral videos via zero-key yt-dlp search.`,
              discovered,
            });
            return;
          }
        } catch {
          // Fall through to built-in CC-BY verified library
        }
      }

      res.json({
        liveApiUsed: false,
        note: ccOnly
          ? 'Loaded verified CC-BY Creative Commons pack (zero-key live yt-dlp search runs automatically on Linux PC).'
          : 'Loaded trending viral pack with Pro FFmpeg Transform ready (zero-key live yt-dlp trending search runs automatically on Linux PC).',
        discovered: [],
      });
      return;
    }

    try {
      for (const cat of categories) {
        const query = CATEGORY_SEARCH_QUERIES[cat] || `${cat} full highlights`;
        const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
        searchUrl.searchParams.set('part', 'snippet');
        searchUrl.searchParams.set('type', 'video');
        if (ccOnly) searchUrl.searchParams.set('videoLicense', 'creativeCommon');
        searchUrl.searchParams.set('videoDuration', 'long');
        searchUrl.searchParams.set('order', 'viewCount');
        searchUrl.searchParams.set('maxResults', '6');
        searchUrl.searchParams.set('q', query);
        searchUrl.searchParams.set('key', ytApiKey!);

        const r = await fetch(searchUrl.toString(), { signal: AbortSignal.timeout(5000) });
        if (!r.ok) continue;
        const json = (await r.json()) as {
          items?: Array<{
            id?: { videoId?: string };
            snippet?: {
              title?: string;
              channelTitle?: string;
              thumbnails?: { high?: { url?: string } };
            };
          }>;
        };

        const safeItem = (json.items || []).find((item) => {
          if (!ccOnly) return true;
          const ch = item.snippet?.channelTitle || '';
          return !isChannelBlocked(ch);
        });

        if (safeItem?.id?.videoId) {
          discovered.push({
            category: cat,
            videoId: safeItem.id.videoId,
            title: safeItem.snippet?.title || `${cat} Creative Commons Video`,
            channel: safeItem.snippet?.channelTitle || 'CC-BY Creator',
            youtubeUrl: `https://www.youtube.com/watch?v=${safeItem.id.videoId}`,
            thumbnailUrl: safeItem.snippet?.thumbnails?.high?.url || '',
            license: ccOnly ? 'creativeCommon' : 'standard',
          });
        }
      }

      res.json({
        liveApiUsed: true,
        note: `Fetched ${discovered.length} live Creative Commons long videos via YouTube Data API v3.`,
        discovered,
      });
    } catch {
      res.json({
        liveApiUsed: false,
        note: 'YouTube Data API unavailable; loaded verified CC-BY Creative Commons pack.',
        discovered: [],
      });
    }
  });

  app.post('/api/gta6-track', async (_req, res) => {
    const ai = getGeminiClient();
    let releaseSummary =
      'Configure GEMINI_API_KEY in .env (or Secrets) for AI-grounded GTA 6 release date tracking.';
    let usedSearchGrounding = false;
    const sources: Array<{ title: string; uri: string }> = [];

    if (ai) {
      try {
        const response = await ai.models.generateContent({
          model: GEMINI_MODEL,
          contents:
            'What is the latest official Rockstar Games / Take-Two release date and current launch status for GTA 6 (Grand Theft Auto VI) including any trailers or gameplay reveals? Give a concise 2-3 sentence summary with exact dates.',
          config: {
            tools: [{ googleSearch: {} }],
          },
        });

        if (response.text) {
          releaseSummary = response.text.trim();
          usedSearchGrounding = true;
        }
        const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
        if (Array.isArray(chunks)) {
          for (const chunk of chunks) {
            if (chunk?.web?.uri) {
              sources.push({
                title: chunk.web.title || chunk.web.uri,
                uri: chunk.web.uri,
              });
            }
          }
        }
      } catch {
        // Fall through cleanly to Google News RSS + Groq fallback without exposing raw error JSON
      }
    }

    if (!usedSearchGrounding) {
      try {
        const rssUrl =
          'https://news.google.com/rss/search?q=GTA+6+release+date+Rockstar+Games&hl=en-US&gl=US&ceid=US:en';
        const rssRes = await fetch(rssUrl, { signal: AbortSignal.timeout(5000) });
        if (rssRes.ok) {
          const xml = await rssRes.text();
          const itemMatches = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/g)).slice(0, 4);
          const headlines: Array<{ title: string; uri: string; pubDate: string }> = [];
          for (const m of itemMatches) {
            const block = m[1] || '';
            const rawTitle = (block.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '')
              .replace(/<!\[CDATA\[|\]\]>/g, '')
              .trim();
            const link = (block.match(/<link>([\s\S]*?)<\/link>/)?.[1] || '').trim();
            const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || '').trim();
            if (rawTitle && link) {
              headlines.push({ title: rawTitle, uri: link, pubDate });
              sources.push({ title: rawTitle, uri: link });
            }
          }

          if (headlines.length > 0) {
            const groqKey = process.env.GROQ_API_KEY;
            const hasValidGroq = Boolean(groqKey && groqKey !== 'MY_GROQ_API_KEY' && groqKey !== '<redacted>');
            let summarized = false;
            if (hasValidGroq) {
              try {
                const gRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${groqKey}`,
                  },
                  signal: AbortSignal.timeout(6000),
                  body: JSON.stringify({
                    model: 'openai/gpt-oss-120b',
                    messages: [
                      {
                        role: 'user',
                        content: `Based strictly on these latest news headlines, give a 2-sentence summary of the current GTA 6 official release date & launch status:\n${headlines.map((h) => `- ${h.title} (${h.pubDate})`).join('\n')}`,
                      },
                    ],
                  }),
                });
                if (gRes.ok) {
                  const gJson = (await gRes.json()) as {
                    choices?: Array<{ message?: { content?: string } }>;
                  };
                  const txt = gJson.choices?.[0]?.message?.content?.trim();
                  if (txt) {
                    releaseSummary = txt;
                    usedSearchGrounding = true;
                    summarized = true;
                  }
                }
              } catch {
                // Fall back to clean headline summary
              }
            }
            if (!summarized) {
              releaseSummary = `Latest GTA 6 news tracked (${headlines[0].pubDate.slice(0, 16)}): ${headlines
                .slice(0, 2)
                .map((h) => h.title)
                .join(' · ')}`;
              usedSearchGrounding = true;
            }
          }
        }
      } catch {
        releaseSummary =
          'Live web tracker could not fetch news right now. Check GEMINI_API_KEY / internet connection and try again.';
      }
    }

    const ytApiKey = process.env.YOUTUBE_API_KEY;
    const hasValidYtKey = Boolean(ytApiKey && ytApiKey !== 'MY_YOUTUBE_DATA_API_V3_KEY' && ytApiKey !== '<redacted>');
    const videos: Array<{
      videoId: string;
      title: string;
      channel: string;
      youtubeUrl: string;
      thumbnailUrl: string;
      durationSec: number;
      qualityNote: string;
      views: number | null;
    }> = [];

    const ytDlpBin = resolveYtDlpBinary();
    if (ytDlpBin) {
      try {
        // Post-launch the grid must show the biggest channels' gameplay, so
        // search broad ("GTA 6 gameplay") and rank by view count — the same
        // view-sorted pattern /api/trending uses.
        const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(
          'GTA 6 gameplay'
        )}`;
        const raw = await runProcessCapture(
          ytDlpBin,
          [
            '--js-runtimes',
            `node:${process.execPath}`,
            '--flat-playlist',
            '--dump-single-json',
            '--no-warnings',
            '--playlist-end',
            '12',
            searchUrl,
          ],
          12000
        );
        const parsed = JSON.parse(raw) as {
          entries?: Array<{
            id?: string;
            title?: string;
            channel?: string;
            uploader?: string;
            duration?: number | null;
            view_count?: number;
          }>;
        };
        const entries = (parsed.entries || [])
          .filter((e) => e?.id && (!e.duration || e.duration >= 60))
          .sort(
            (a, b) =>
              (b.view_count ?? 0) - (a.view_count ?? 0) || (b.duration || 0) - (a.duration || 0)
          )
          .slice(0, 6);

        for (const entry of entries) {
          if (!entry.id) continue;
          videos.push({
            videoId: entry.id,
            title: entry.title || 'GTA 6 4K Gameplay & Trailer',
            channel: entry.channel || entry.uploader || 'YouTube Gaming',
            youtubeUrl: `https://www.youtube.com/watch?v=${entry.id}`,
            thumbnailUrl: `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg`,
            durationSec: Math.max(90, Math.round(entry.duration || 120)),
            qualityNote: 'Best Quality 1080p/4K via yt-dlp',
            views: typeof entry.view_count === 'number' ? entry.view_count : null,
          });
        }
      } catch {
        // Ignore yt-dlp transient failure and check API/fallback
      }
    } else if (hasValidYtKey) {
      try {
        const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
        searchUrl.searchParams.set('part', 'snippet');
        searchUrl.searchParams.set('type', 'video');
        searchUrl.searchParams.set('order', 'viewCount');
        searchUrl.searchParams.set('videoDefinition', 'high');
        searchUrl.searchParams.set('maxResults', '6');
        searchUrl.searchParams.set('q', 'GTA 6 gameplay');
        searchUrl.searchParams.set('key', ytApiKey!);
        const r = await fetch(searchUrl.toString(), { signal: AbortSignal.timeout(5000) });
        if (r.ok) {
          const json = (await r.json()) as {
            items?: Array<{
              id?: { videoId?: string };
              snippet?: {
                title?: string;
                channelTitle?: string;
                thumbnails?: { high?: { url?: string } };
              };
            }>;
          };
          for (const item of (json.items || []).slice(0, 6)) {
            if (!item.id?.videoId) continue;
            videos.push({
              videoId: item.id.videoId,
              title: item.snippet?.title || 'GTA 6 HD Gameplay',
              channel: item.snippet?.channelTitle || 'YouTube Gaming',
              youtubeUrl: `https://www.youtube.com/watch?v=${item.id.videoId}`,
              thumbnailUrl: item.snippet?.thumbnails?.high?.url || '',
              durationSec: 120,
              qualityNote: 'HD/4K via YouTube Search',
              views: null,
            });
          }
        }
      } catch {
        // Fall through
      }
    }

    // The grounded summary is AI text and has stated a wrong launch date
    // before (Nov 16 instead of the verified Nov 19, 2026), and it can
    // carry markdown markers the panel renders as plain text. Only trust
    // a grounded summary that states the verified launch date; otherwise
    // fall back to the verified fact. Ungrounded placeholders are left
    // alone so a missing key still shows as a config problem.
    if (usedSearchGrounding) {
      const cleanedSummary = releaseSummary.replace(/\*\*/g, '').replace(/__/g, '').trim();
      const statesLaunchDate = /november\s+19|nov\.?\s+19|19\s+november|19\s+nov/i.test(
        cleanedSummary
      );
      releaseSummary = statesLaunchDate
        ? cleanedSummary
        : 'Grand Theft Auto VI launches Thursday, November 19, 2026, at midnight local time on PS5 and Xbox Series X|S. Pre-load opened November 10, 2026.';
    }

    res.json({
      usedSearchGrounding,
      releaseSummary,
      sources: sources.slice(0, 5),
      liveYoutubeFound: videos.length > 0,
      videos,
    });
  });

  app.post('/api/analyze-hooks', async (req, res) => {
    const windows = Array.isArray(req.body?.windows) ? req.body.windows : [];
    const videoTitle = typeof req.body?.title === 'string' ? req.body.title : 'Creator Video';
    const category = typeof req.body?.category === 'string' ? req.body.category : 'podcast';

    if (windows.length === 0) {
      res.status(400).json({ error: 'At least one candidate window is required.' });
      return;
    }

    const compactCandidates = windows.slice(0, 8).map((w: { id: string; startSec: number; endSec: number; transcriptText: string }) => ({
      id: w.id,
      range: `${w.startSec}s-${w.endSec}s`,
      opening: w.transcriptText.slice(0, 420),
    }));

    const groqKey = process.env.GROQ_API_KEY;
    const hasValidGroq = Boolean(groqKey && groqKey !== 'MY_GROQ_API_KEY' && groqKey !== '<redacted>');
    const ai = getGeminiClient();

    async function tryGroq(): Promise<unknown[] | null> {
      if (!hasValidGroq) return null;
      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groqKey}`,
        },
        signal: AbortSignal.timeout(8000),
        body: JSON.stringify({
          model: 'openai/gpt-oss-120b',
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                'You are a short-form viral video editor. Return JSON with key "results" containing an array of { id, hookScore (0-100), hookReason (max 8 words), suggestedHooks (array of 3 short hook strings under 8 words) }.',
            },
            {
              role: 'user',
              content: `Video title: ${videoTitle}\nCategory: ${category}\nCandidates: ${JSON.stringify(compactCandidates)}`,
            },
          ],
        }),
      });
      if (!groqRes.ok) return null;
      const groqJson = (await groqRes.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = groqJson.choices?.[0]?.message?.content;
      if (!content) return null;
      const parsed = JSON.parse(content) as { results?: unknown[] };
      return Array.isArray(parsed.results) ? parsed.results : null;
    }

    // If Groq key is provided alongside Gemini, try ultra-fast Groq first or fail over between them
    if (hasValidGroq && !ai) {
      try {
        const groqResults = await tryGroq();
        if (groqResults) {
          res.json({ usedGemini: true, provider: 'groq', results: groqResults });
          return;
        }
      } catch {
        // Fall through to deterministic scorer
      }
    }

    if (!ai) {
      res.status(200).json({
        usedGemini: false,
        provider: 'local',
        note: 'Using deterministic local hook scorer (set GEMINI_API_KEY or GROQ_API_KEY in .env).',
        results: [],
      });
      return;
    }

    try {
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [
          `Video title: ${videoTitle}`,
          `Category: ${category}`,
          `Evaluate these 60-second candidate windows for short-form Reels/Shorts virality.`,
          `For sports (cricket/boxing/football), value dramatic match turning points, last-second saves/goals/sixes/knockdowns. For gaming, value 1 HP clutches and reactions. For podcasts, value opening questions, stats, and curiosity gaps.`,
          `Score each window's Hook Strength (0-100) and return a short reason (max 8 words) + 3 punchy 1-line Hook Text Overlays (under 8 words each, matching the transcript language).`,
          JSON.stringify(compactCandidates),
        ].join('\n\n'),
        config: {
          systemInstruction:
            'You are a short-form viral video editor. Return accurate JSON matching the schema.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                hookScore: { type: Type.NUMBER },
                hookReason: { type: Type.STRING },
                suggestedHooks: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
              required: ['id', 'hookScore', 'hookReason', 'suggestedHooks'],
            },
          },
        },
      });

      const rawText = (response.text || '[]').trim();
      const parsed = JSON.parse(rawText);
      res.json({
        usedGemini: true,
        provider: 'gemini',
        results: Array.isArray(parsed) ? parsed : [],
      });
    } catch (err) {
      // Automatic failover to Groq if configured!
      if (hasValidGroq) {
        try {
          const groqResults = await tryGroq();
          if (groqResults) {
            res.json({
              usedGemini: true,
              provider: 'groq-failover',
              results: groqResults,
            });
            return;
          }
        } catch {
          // Ignore and fall back locally
        }
      }

      const message = err instanceof Error ? err.message : 'Gemini scoring failed.';
      res.status(200).json({
        usedGemini: false,
        provider: 'local',
        note: `Deterministic scorer active (${message.slice(0, 80)})`,
        results: [],
      });
    }
  });

  app.post('/api/render-local-mp4', async (req, res) => {
    // ClipPulse v5 — this was the 300s wall: res.setTimeout(300000) killed
    // the client's 4K response mid-encode (ffmpeg kept going, file finished
    // on disk, jobId lost). 4K renders take 8-12 min here, so allow 30 min.
    res.setTimeout(30 * 60 * 1000);
    const youtubeUrl = typeof req.body?.youtubeUrl === 'string' ? req.body.youtubeUrl.trim() : '';
    const uploadId = typeof req.body?.uploadId === 'string' ? req.body.uploadId.trim() : '';
    const startSec = Number(req.body?.startSec ?? 0);
    const endSec = Number(req.body?.endSec ?? 60);
    const faceOffsetX = Number(req.body?.faceOffsetX ?? 50);
    const framingMode = typeof req.body?.framingMode === 'string' ? req.body.framingMode : 'face-track';
    const assContent = typeof req.body?.assContent === 'string' ? req.body.assContent : '';
    const copyrightSafeTransform = req.body?.copyrightSafeTransform !== false;
    const mirrorFlip = req.body?.mirrorFlip === true;
    const thumbnailUrl = typeof req.body?.thumbnailUrl === 'string' ? req.body.thumbnailUrl.trim() : '';
    const category = typeof req.body?.category === 'string' ? req.body.category.trim().toLowerCase() : 'cricket';
    const outputQuality =
      req.body?.outputQuality === '1080p' ? '1080p' : req.body?.outputQuality === '4k' ? '4k' : '720p';
    const dims = qualityDims(outputQuality);

    const uploadedEntry = uploadId ? uploadedVideos.get(uploadId) : undefined;
    const isRealUpload = Boolean(uploadedEntry && fs.existsSync(uploadedEntry.filePath));
    const isPresetOrCustom =
      !isRealUpload && (!youtubeUrl || youtubeUrl.includes('clippulse-') || youtubeUrl.includes('custom-input'));

    const hasFfmpeg = hasBinary('ffmpeg');
    const ytDlpBin = resolveYtDlpBinary();

    if (!hasFfmpeg) {
      res.json({
        ok: false,
        reason: 'missing_binaries',
        message:
          'ffmpeg is not installed in this environment. Run "npm run setup:linux" locally on your Linux PC to enable 1-click MP4 rendering.',
      });
      return;
    }

    if (!isRealUpload && !isPresetOrCustom && !ytDlpBin) {
      res.json({
        ok: false,
        reason: 'missing_ytdlp_in_preview',
        message:
          'External YouTube URLs need yt-dlp (available when you run locally on Linux). Upload a real .MP4/.MOV file above OR load a built-in preset to render here.',
      });
      return;
    }

    if (!isRealUpload && !isPresetOrCustom && !isValidYoutubeVideoUrl(youtubeUrl)) {
      res.json({
        ok: false,
        reason: 'invalid_youtube_url',
        message: 'Provide a valid YouTube video URL.',
      });
      return;
    }

    if (renderedClips.size >= 15) {
      const oldestKey = renderedClips.keys().next().value;
      if (oldestKey) {
        const oldPath = renderedClips.get(oldestKey);
        renderedClips.delete(oldestKey);
        if (oldPath) {
          // v6: finished clips live as single files in RENDERS_DIR — delete
          // just the file. Only rm a whole directory for pre-v6 /tmp entries.
          fs.rmSync(oldPath, { force: true });
          const dir = path.dirname(oldPath);
          if (dir.startsWith(os.tmpdir())) fs.rmSync(dir, { recursive: true, force: true });
        }
      }
    }

    const safeStart = Math.max(0, Math.floor(startSec));
    let safeEnd = Math.max(safeStart + 5, Math.floor(endSec));
    // v8.6 — clipLengthSec (30/45/60/custom, 10–180s) overrides the
    // endSec-derived length when the caller sends it; otherwise the
    // startSec/endSec pair rules, exactly as before.
    if (req.body?.clipLengthSec !== undefined && req.body?.clipLengthSec !== null && req.body?.clipLengthSec !== '') {
      safeEnd = safeStart + normalizeClipLengthSec(req.body.clipLengthSec);
    }
    // v8.6 — was Math.min(60, ...): a custom 90s/180s clip was silently
    // cut to 60s. The cap is now the same 10–180s range as analyze.
    const clipDuration = Math.min(180, Math.max(5, safeEnd - safeStart));
    const cropRatio = Math.max(0.15, Math.min(0.85, faceOffsetX / 100));
    const hasValidAss = assContent.includes('[Events]');

    const jobId = crypto.randomUUID();
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `clippulse-${jobId}-`));
    const rawClip = path.join(workDir, 'clip_raw.mp4');
    const assPath = path.join(workDir, 'captions.ass');
    const outMp4 = path.join(workDir, 'viral_reel_60s.mp4');
    // ClipPulse v6 — async: answer now with the jobId; the client polls
    // /api/job-status/:jobId. A 4K render takes 8-12 min here, far past
    // most clients' headers timeout. Fast validation above still answers
    // synchronously.
    asyncJobs.set(jobId, { kind: 'render', status: 'rendering', startedAt: Date.now(), result: null });
    res.json({ ok: true, jobId, status: 'rendering' });

    try {
      if (hasValidAss) {
        fs.writeFileSync(assPath, assContent, 'utf8');
      }

      if (isPresetOrCustom) {
        // Preset preview sample with smooth sinusoidal motion pan + 9:16 crop + Pro Viral Transform + burned .ASS
        const imagesDir = path.resolve(__dirname, 'src', 'assets', 'images');
        const categoryImageMap: Record<string, string> = {
          cricket: 'demo_cricket_match_1794760389943.jpg',
          boxing: 'demo_boxing_ring_1794760374236.jpg',
          football: 'demo_football_pitch_1794760374529.jpg',
          gaming: 'demo_gaming_stream_1794760375327.jpg',
          podcast: 'demo_podcast_host_1794757492362.jpg',
        };
        const candidateFilename = thumbnailUrl ? path.basename(thumbnailUrl) : '';
        const candidatePath = candidateFilename ? path.resolve(imagesDir, candidateFilename) : '';
        const fallbackPath = path.resolve(
          imagesDir,
          categoryImageMap[category] || 'demo_cricket_match_1794760389943.jpg'
        );
        const sourceImage =
          candidatePath.startsWith(imagesDir + path.sep) && fs.existsSync(candidatePath)
            ? candidatePath
            : fallbackPath;

        const flipFilter = mirrorFlip ? ',hflip' : '';
        const visualTransform = copyrightSafeTransform
          ? `${flipFilter},eq=contrast=1.08:saturation=1.18:brightness=0.02,unsharp=5:5:0.8:5:5:0.0,vignette=PI/5`
          : flipFilter;
        const assFilter = getAssFilter(hasValidAss);

        const ffmpegArgs: string[] = [
          '-y',
          '-loop',
          '1',
          '-framerate',
          '24',
          '-t',
          '12',
          '-i',
          sourceImage,
          '-f',
          'lavfi',
          '-t',
          '12',
          '-i',
          'anullsrc=r=44100:cl=stereo',
        ];

        if (framingMode === 'sports-blur') {
          const fgScale = copyrightSafeTransform
            ? 'scale=800:-2,crop=720:ih*720/800:(iw-720)/2+18*sin(t*0.8):0'
            : 'scale=720:-2';
          ffmpegArgs.push(
            '-filter_complex',
            `[0:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,boxblur=16:3[bg];[0:v]${fgScale}[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2${visualTransform}${assFilter},format=yuv420p[v]`,
            '-map',
            '[v]',
            '-map',
            '1:a'
          );
        } else if (framingMode === 'gaming-split') {
          ffmpegArgs.push(
            '-filter_complex',
            `[0:v]crop=iw*0.28:ih*0.30:0:0,scale=720:448:force_original_aspect_ratio=increase,crop=720:448[cam];[0:v]scale=780:832:force_original_aspect_ratio=increase,crop=720:832:(iw-720)/2+16*sin(t*0.7):0[game];[cam][game]vstack=inputs=2${visualTransform}${assFilter},format=yuv420p[v]`,
            '-map',
            '[v]',
            '-map',
            '1:a'
          );
        } else {
          const zoomScale = copyrightSafeTransform
            ? `scale=800:1360:flags=bilinear,crop=720:1280:(iw-720)/2+16*sin(t*0.7):40`
            : 'scale=720:1280:flags=bilinear';
          ffmpegArgs.push(
            '-vf',
            `crop=ih*9/16:ih:max(0\\,min(iw-ih*9/16\\,iw*${cropRatio.toFixed(2)}-(ih*9/16)/2)):0,${zoomScale}${visualTransform}${assFilter},format=yuv420p`,
            '-map',
            '0:v',
            '-map',
            '1:a'
          );
        }

        ffmpegArgs.push(
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
          '-crf',
          '23',
          '-c:a',
          'aac',
          '-b:a',
          '128k',
          '-movflags',
          '+faststart',
          '-shortest',
          outMp4
        );

        await runProcess('ffmpeg', ffmpegArgs, workDir);
        renderedClips.set(jobId, persistRenderedClip(jobId, outMp4, workDir));

        finishAsyncJob(jobId, {
          ok: true,
          isPreviewSample: true,
          jobId,
          streamUrl: `/api/stream-mp4/${jobId}`,
          downloadUrl: `/api/download-mp4/${jobId}`,
        });
        return;
      }

      let sourceVideoPath = rawClip;
      let hasAudioStream = true;
      const ffmpegArgs: string[] = ['-y'];

      if (isRealUpload && uploadedEntry) {
        sourceVideoPath = uploadedEntry.filePath;
        hasAudioStream = uploadedEntry.hasAudio;
        ffmpegArgs.push('-ss', String(safeStart), '-t', String(clipDuration), '-i', sourceVideoPath);
        if (!hasAudioStream) {
          ffmpegArgs.push('-f', 'lavfi', '-t', String(clipDuration), '-i', 'anullsrc=r=44100:cl=stereo');
        }
      } else {
        try {
          await runProcess(
            ytDlpBin!,
            [
              '--js-runtimes',
              `node:${process.execPath}`,
              '--download-sections',
              `*${safeStart}-${safeEnd}`,
              '--force-keyframes-at-cuts',
              '-f',
              `bv*[height<=${dims.maxSourceHeight}][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b`,
              '-o',
              rawClip,
              '--',
              youtubeUrl,
            ],
            workDir
          );
        } catch (dlErr) {
          const errMsg = dlErr instanceof Error ? dlErr.message : '';
          if (errMsg.toLowerCase().includes('confirm you') || errMsg.toLowerCase().includes('bot')) {
            finishAsyncJob(jobId, {
              ok: false,
              reason: 'youtube_bot_check',
              message:
                'YouTube blocked media download from this Cloud server IP (bot check). To edit & download real 60s Reels right now: (1) Upload any .MP4/.MOV video file in the Upload Video button above, OR (2) Run locally on your Linux PC (npm run setup:linux && npm run dev) where your home IP downloads directly.',
            });
            return;
          }
          throw dlErr;
        }
        ffmpegArgs.push('-i', rawClip);
      }

      // ClipPulse v4 — Gameplay layout first (OpusClip: facecam top 30% +
      // gameplay below 70%). v2's corner-only facecam check missed cams
      // that sit mid-frame, so the cam BOX is detected anywhere first; the
      // old corner split is only a fallback, and face-track the last one.
      let framingUsed = framingMode;
      let facecam: FacecamResult = null;
      let camBox: CamboxResult = null;
      if (framingMode === 'gaming-split') {
        camBox = await detectCambox(isRealUpload ? sourceVideoPath : rawClip);
        if (!camBox || !camBox.box) {
          if (!isRealUpload) {
            facecam = await detectFacecam(rawClip);
            if (!facecam || !facecam.corner) {
              framingUsed = 'face-track';
            }
          } else {
            framingUsed = 'face-track';
          }
        }
      }

      const { targetW, targetH, zoomW, zoomH, camH, gameH } = dims;

      const flipFilter = mirrorFlip ? ',hflip' : '';
      const visualTransform = copyrightSafeTransform
        ? `${flipFilter},eq=contrast=1.08:saturation=1.18:brightness=0.02,unsharp=5:5:0.8:5:5:0.0,vignette=PI/5`
        : flipFilter;
      const assFilter = getAssFilter(hasValidAss);
      const audioMap = isRealUpload && !hasAudioStream ? '1:a' : '0:a?';

      let sceneInfo: Array<{ startSec: number; endSec: number; faceX: number | null; layout: string }> = [];
      let sceneAware = false;
      let sfxUsed = false;
      // v8: hoisted out of the face-track block — the -af guard below
      // (outside the block) must see whether a filter_complex branch
      // already polished the audio.
      let usedScenes = false;

      if (framingUsed === 'sports-blur') {
        const fgScale = copyrightSafeTransform
          ? `scale=${zoomW}:-2,crop=${targetW}:ih*${targetW}/${zoomW}`
          : `scale=${targetW}:-2`;
        // v7: voice polish leg — [aout] when audio exists, else the
        // original audioMap (silent-upload anullsrc stays untouched).
        const sportsAudio = hasAudioStream
          ? `;[0:a]${VOICE_POLISH_FILTER}[aout]`
          : '';
        ffmpegArgs.push(
          '-filter_complex',
          `[0:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},boxblur=16:3[bg];[0:v]${fgScale}[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2${visualTransform}${assFilter},format=yuv420p[v]${sportsAudio}`,
          '-map',
          '[v]',
          '-map',
          hasAudioStream ? '[aout]' : audioMap
        );
        // v8.4: this branch already polished the audio inside
        // -filter_complex — the -af guard below must not add a second
        // audio filter (ffmpeg rejects -af beside -filter_complex).
        usedScenes = true;
      } else if (framingUsed === 'gaming-split') {
        // v7: voice polish leg, same as sports-blur above.
        const gameAudio = hasAudioStream ? `;[0:a]${VOICE_POLISH_FILTER}[aout]` : '';
        const gameAudioMap = hasAudioStream ? '[aout]' : audioMap;
        if (camBox?.box) {
          // OpusClip Gameplay layout: detected cam box on top (30%),
          // centre-cropped gameplay below (70%) — the game stays visible.
          const gameplayCamH = Math.round(targetH * 0.3);
          const gameplayGameH = targetH - gameplayCamH;
          ffmpegArgs.push(
            '-filter_complex',
            buildGameplayFilter({
              camBox: camBox.box,
              targetW,
              camH: gameplayCamH,
              gameH: gameplayGameH,
              visualTransform,
              assFilter,
            }) + gameAudio,
            '-map',
            '[v]',
            '-map',
            gameAudioMap,
          );
        } else {
          const camOx = facecam?.cropOrigin?.[0] ?? 0;
          const camOy = facecam?.cropOrigin?.[1] ?? 0;
          ffmpegArgs.push(
            '-filter_complex',
            `[0:v]crop=iw*0.26:ih*0.28:iw*${camOx}:ih*${camOy},scale=${targetW}:${camH}:force_original_aspect_ratio=increase,crop=${targetW}:${camH}[cam];[0:v]scale=${targetW}:${gameH}:force_original_aspect_ratio=increase,crop=${targetW}:${gameH}[game];[cam][game]vstack=inputs=2${visualTransform}${assFilter},format=yuv420p[v]${gameAudio}`,
            '-map',
            '[v]',
            '-map',
            gameAudioMap,
          );
        }
        // v8.4: same as sports-blur above — audio already polished inside
        // -filter_complex, so the -af guard below must stay off.
        usedScenes = true;
      } else {
        // ClipPulse v3 — scene-aware face-track (OpenShorts per-scene
        // reframing): detect real cuts, check each scene's middle frame for
        // a face, and crop each scene around its own subject instead of one
        // fixed offset for the whole clip. Falls back to the single-filter
        // path when there is one scene, no audio, or detection fails.
        // v8: `usedScenes` lives at the outer scope now (see above) so
        // the -af guard after this block can read it.
        if (hasAudioStream) {
          try {
            // Uploads render from the uploaded file (rawClip never exists
            // for them); YouTube sections render from the downloaded
            // section, which is already 0-based. Upload inputs also start
            // at safeStart, so scene times shift into input-relative time.
            const sceneSource = isRealUpload ? sourceVideoPath : rawClip;
            const sceneDuration = await probeDuration(sceneSource);
            const rawScenes = sceneDuration > 0 ? await detectScenes(sceneSource, sceneDuration) : [];
            const pairs = rawScenes
              .map((s) => ({
                src: s,
                in: isRealUpload
                  ? { startSec: Math.max(0, s.startSec - safeStart), endSec: Math.min(clipDuration, s.endSec - safeStart) }
                  : { startSec: s.startSec, endSec: s.endSec },
              }))
              .filter((p) => p.in.endSec - p.in.startSec >= 0.5);
            if (pairs.length > 1) {
              const framePaths: string[] = [];
              for (let idx = 0; idx < pairs.length; idx++) {
                const mid = (pairs[idx].src.startSec + pairs[idx].src.endSec) / 2;
                const fp = path.join(workDir, `scene-${idx}.jpg`);
                await runProcess(
                  'ffmpeg',
                  ['-y', '-v', 'error', '-ss', String(mid), '-i', sceneSource, '-frames:v', '1', '-q:v', '3', fp],
                  workDir,
                );
                framePaths.push(fp);
              }
              const faceXs = await detectSceneFaces(framePaths);
              const sceneZoomScale = copyrightSafeTransform
                ? `scale=${zoomW}:${zoomH}:flags=bilinear,crop=${targetW}:${targetH}:${Math.round((zoomW - targetW) / 2)}:${Math.round((zoomH - targetH) / 2)}`
                : `scale=${targetW}:${targetH}:flags=bilinear`;
              const vChains: string[] = [];
              const aChains: string[] = [];
              const concatInputs: string[] = [];
              // v7 — smooth face tracking: each scene's crop glides from
              // the previous scene's face centre instead of jumping to a
              // new centre at the cut (see buildFaceTrackCropX). Scene 0
              // gets the hook punch-in (copyright-safe path only — the
              // plain scale path has no second crop to pin the size).
              let prevRatio: number | null = null;
              sceneInfo = pairs.map((p, i) => {
                const fx = faceXs[i] ?? null;
                const ratio = fx != null ? Math.max(0.15, Math.min(0.85, fx / 100)) : 0.5;
                const cropX = buildFaceTrackCropX(prevRatio, ratio);
                prevRatio = ratio;
                const zoomScale =
                  i === 0 && copyrightSafeTransform
                    ? buildHookPunchScale(zoomW, zoomH, targetW, targetH)
                    : sceneZoomScale;
                vChains.push(
                  `[0:v]trim=start=${p.in.startSec}:end=${p.in.endSec},setpts=PTS-STARTPTS,crop=ih*9/16:ih:${cropX}:0,${zoomScale},setsar=1[v${i}]`,
                );
                // apad: yt-dlp section downloads sometimes carry a short
                // audio stream (9s in a 30s section); pad each segment with
                // silence so a truncated download never truncates the clip.
                const segDur = (p.in.endSec - p.in.startSec).toFixed(2);
                aChains.push(`[0:a]atrim=start=${p.in.startSec}:end=${p.in.endSec},asetpts=PTS-STARTPTS,apad=whole_dur=${segDur}[a${i}]`);
                concatInputs.push(`[v${i}][a${i}]`);
                return { startSec: p.in.startSec, endSec: p.in.endSec, faceX: fx, layout: fx != null ? 'track' : 'center' };
              });
              // visualTransform starts with a comma (it follows a filter
              // in the other branches); after [vc] there is no filter
              // before it, so strip the leading comma or ffmpeg fails with
              // "No such filter: ''".
              const vt = visualTransform.replace(/^,/, '');
              // Audio also runs through this filtergraph ([ac]), so the
              // voice-polish chain must live inside it — a separate -af
              // on a complex-filtered stream is rejected by ffmpeg.
              // v7: polish applies to EVERY render now (not just the
              // copyright-safe path); the pitch trick stays copyright-only.
              const pitchTrick = copyrightSafeTransform
                ? 'aresample=44100,asetrate=44982,aresample=44100,atempo=1.01,'
                : '';
              // v7 — SFX: one whoosh at the hook (t=0) + one at every
              // scene cut, mixed ~15 dB under the voice. The whoosh is
              // input 1 (scene-aware runs only when audio exists, so no
              // anullsrc input occupies slot 1 here). If the SFX asset
              // is missing, the render proceeds without SFX.
              const sfx = await ensureSfxAssets();
              let sfxMix = '';
              let finalAudioLabel = 'acp';
              if (sfx) {
                ffmpegArgs.push('-i', sfx.whoosh);
                const cutTimes = [0, ...pairs.slice(1).map((p) => p.in.startSec)];
                const sfxChains = cutTimes.map((t, k) => {
                  const ms = Math.round(t * 1000);
                  return `[1:a]adelay=${ms}|${ms},volume=0.5[w${k}]`;
                });
                const sfxInputs = cutTimes.map((_, k) => `[w${k}]`).join('');
                sfxMix = `;${sfxChains.join(';')};${sfxInputs}amix=inputs=${cutTimes.length}:duration=first:normalize=0[sfx];[acp][sfx]amix=inputs=2:duration=first:normalize=0[acm]`;
                finalAudioLabel = 'acm';
              }
              ffmpegArgs.push(
                '-filter_complex',
                `${[...vChains, ...aChains].join(';')};${concatInputs.join('')}concat=n=${pairs.length}:v=1:a=1[vc][ac];[ac]${pitchTrick}${VOICE_POLISH_FILTER}[acp]${sfxMix};[vc]${vt}${assFilter},format=yuv420p[v]`,
                '-map',
                '[v]',
                '-map',
                `[${finalAudioLabel}]`,
              );
              sceneAware = true;
              usedScenes = true;
              sfxUsed = sfx != null;
            }
          } catch {
            // Fall through to the single-filter path below.
          }
        }
        if (!usedScenes) {
          const zoomScale = copyrightSafeTransform
            ? `scale=${zoomW}:${zoomH}:flags=bilinear,crop=${targetW}:${targetH}:${Math.round((zoomW - targetW) / 2)}:${Math.round((zoomH - targetH) / 2)}`
            : `scale=${targetW}:${targetH}:flags=bilinear`;
          ffmpegArgs.push(
            '-vf',
            `crop=ih*9/16:ih:max(0\\,min(iw-ih*9/16\\,iw*${cropRatio.toFixed(2)}-(ih*9/16)/2)):0,${zoomScale}${visualTransform}${assFilter},format=yuv420p`,
            '-map',
            '0:v',
            '-map',
            audioMap,
          );
        }
      }

      // v7: voice polish on the single-filter path too (was loudnorm-only
      // and copyright-safe-only). The pitch trick stays copyright-only.
      // v8: skip when a filter_complex branch already polished the audio
      // (sports-blur and gaming-split set usedScenes) — -af
      // beside -filter_complex is rejected by ffmpeg.
      if (hasAudioStream && !sceneAware && !usedScenes) {
        const pitchTrick = copyrightSafeTransform
          ? 'aresample=44100,asetrate=44982,aresample=44100,atempo=1.01,'
          : '';
        ffmpegArgs.push('-af', `${pitchTrick}${VOICE_POLISH_FILTER}`);
      }

      ffmpegArgs.push(
        '-c:v',
        'libx264',
        '-preset',
        dims.preset,
        '-crf',
        dims.crf,
        '-c:a',
        'aac',
        '-b:a',
        dims.audioKbps,
        '-movflags',
        '+faststart',
        '-shortest',
        outMp4
      );

      await runProcess('ffmpeg', ffmpegArgs, workDir);

      // v5: report the source resolution so a 4K render is honestly
      // labelled native (source >= 2160) or upscale.
      const sourceDims = await probeDimensions(isRealUpload ? sourceVideoPath : rawClip);
      // v6: move the finished clip to the home disk and drop the /tmp
      // workDir (downloaded section) — probeDimensions above is the last
      // read of rawClip, so it is safe to delete the dir now.
      renderedClips.set(jobId, persistRenderedClip(jobId, outMp4, workDir));

      finishAsyncJob(jobId, {
        ok: true,
        isPreviewSample: false,
        jobId,
        streamUrl: `/api/stream-mp4/${jobId}`,
        downloadUrl: `/api/download-mp4/${jobId}`,
        outputQuality,
        sourceHeight: sourceDims.height,
        isNative4k: outputQuality === '4k' && sourceDims.height >= 2160,
        framingRequested: framingMode,
        framingUsed,
        layout: camBox?.box ? 'gameplay' : framingUsed,
        camBox: camBox?.box ?? null,
        sceneAware,
        scenes: sceneInfo,
        sfxUsed,
        facecam: facecam
          ? {
              corner: facecam.corner,
              cornerScore: facecam.cornerScore,
              facesDetected: facecam.facesDetected,
              faceX: facecam.faceX,
            }
          : null,
      });
      return;
    } catch (err) {
      // v6: a failed render must not leave its downloaded section in /tmp.
      fs.rmSync(workDir, { recursive: true, force: true });
      const msg = err instanceof Error ? err.message : 'Local MP4 rendering failed.';
      finishAsyncJob(jobId, {
        ok: false,
        reason: 'render_failed',
        message: msg,
      });
      return;
    }
  });

  app.get('/api/stream-mp4/:jobId', (req, res) => {
    const filePath = renderedClips.get(req.params.jobId);
    if (!filePath || !fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Rendered clip not found or expired.' });
      return;
    }
    res.sendFile(filePath, {
      headers: {
        'Content-Type': 'video/mp4',
      },
    });
  });

  app.get('/api/download-mp4/:jobId', (req, res) => {
    const filePath = renderedClips.get(req.params.jobId);
    if (!filePath || !fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Rendered clip not found or expired.' });
      return;
    }
    res.download(filePath, 'viral_reel_60s.mp4');
  });

  // ClipPulse v5 — trending creators (MrBeast, IShowSpeed + other big
  // creators). YouTube has no public trending API, so this reads each
  // creator's channel page sorted by popularity and re-sorts by real view
  // count itself — the sort=p page order is NOT view-sorted (verified live:
  // MrBeast's page listed 52M before 348M). Results cache 1h in memory;
  // a stale cache is refreshed automatically on the next call.
  const TRENDING_CREATORS: Array<{ handle: string; label: string }> = [
    { handle: 'MrBeast', label: 'MrBeast' },
    { handle: 'IShowSpeed', label: 'IShowSpeed' },
    { handle: 'KaiCenat', label: 'Kai Cenat' },
    { handle: 'RajShamani', label: 'Raj Shamani' },
    { handle: 'joerogan', label: 'Joe Rogan' },
    { handle: 'pewdiepie', label: 'PewDiePie' },
    { handle: 'markiplier', label: 'Markiplier' },
    { handle: 'Airrack', label: 'Airrack' },
    { handle: 'DudePerfect', label: 'Dude Perfect' },
    { handle: 'Dream', label: 'Dream' },
  ];
  const trendingCache = new Map<string, { at: number; payload: Record<string, unknown> }>();

  app.get('/api/trending', async (req, res) => {
    const ytDlpBin = resolveYtDlpBinary();
    if (!ytDlpBin) {
      res.json({ ok: false, reason: 'missing_ytdlp', message: 'yt-dlp is not installed.' });
      return;
    }
    const requested =
      typeof req.query.creators === 'string'
        ? req.query.creators.split(',').map((s) => s.trim()).filter(Boolean)
        : [];
    const handles = requested.length > 0 ? requested : TRENDING_CREATORS.map((c) => c.handle);
    const limit = Math.max(1, Math.min(5, Number(req.query.limit ?? 3) || 3));
    const cacheKey = `${handles.join(',')}:${limit}`;
    const cached = trendingCache.get(cacheKey);
    if (cached && Date.now() - cached.at < 3600_000) {
      res.json({ ok: true, cached: true, ...cached.payload });
      return;
    }
    const settled = await Promise.allSettled(
      handles.map(async (handle) => {
        const url = `https://www.youtube.com/@${handle}/videos?view=0&sort=p&flow=grid`;
        // Fetch more entries than the limit: the page order is NOT
        // view-sorted, so the top-N by views only emerges after sorting a
        // wider net (verified: with --playlist-end 2, MrBeast's 193M video
        // never appeared at all).
        const out = await runProcessCapture(
          ytDlpBin,
          ['--flat-playlist', '--dump-single-json', '--playlist-end', '10', url],
          60000,
        );
        const data = JSON.parse(out) as {
          entries?: Array<{
            id?: string;
            title?: string;
            view_count?: number;
            duration?: number;
            thumbnails?: Array<{ width?: number; height?: number; url?: string }>;
          }>;
          thumbnails?: Array<{ width?: number; height?: number; url?: string }>;
          channel_id?: string;
          channel_follower_count?: number;
        };
        const videos = (data.entries ?? [])
          .filter((e) => e?.id)
          .map((e) => {
            const vthumbs = e.thumbnails ?? [];
            const vthumb =
              vthumbs.find((t) => t.width === 480) || vthumbs[vthumbs.length - 1];
            return {
              videoId: e.id as string,
              title: e.title ?? '',
              views: typeof e.view_count === 'number' ? e.view_count : null,
              durationSec: typeof e.duration === 'number' ? e.duration : null,
              thumbnailUrl: vthumb?.url ?? '',
              url: `https://www.youtube.com/watch?v=${e.id}`,
            };
          })
          .sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
          .slice(0, limit);
        const label =
          TRENDING_CREATORS.find((c) => c.handle.toLowerCase() === handle.toLowerCase())?.label ?? handle;
        // Channel logo = the SQUARE thumbnail (900x900 avatar); the wide
        // ones are the channel banner. Verified on MrBeast's page JSON.
        const thumbs = data.thumbnails ?? [];
        const logoThumb =
          thumbs.find((t) => t.width && t.height && t.width === t.height) ||
          thumbs[thumbs.length - 1];
        return {
          handle,
          label,
          logoUrl: logoThumb?.url ?? '',
          channelId: data.channel_id ?? '',
          followers:
            typeof data.channel_follower_count === 'number' ? data.channel_follower_count : null,
          videos,
        };
      }),
    );
    const creators = settled.map((r, i) =>
      r.status === 'fulfilled'
        ? r.value
        : { handle: handles[i], label: handles[i], videos: [], error: 'fetch_failed' },
    );
    const payload: Record<string, unknown> = { fetchedAt: new Date().toISOString(), creators };
    trendingCache.set(cacheKey, { at: Date.now(), payload });
    res.json({ ok: true, cached: false, ...payload });
  });

  // ClipPulse v3 — thumbnail generator (OpenShorts-style YouTube Studio).
  // Picks the frame at the clip's audio-energy peak (the loudest second —
  // usually the reaction/knockout moment), then lays the packaged title on
  // it with PIL. Peak is measured, never guessed.
  app.post('/api/thumbnail', async (req, res) => {
    const jobId = typeof req.body?.jobId === 'string' ? req.body.jobId : '';
    const title = typeof req.body?.title === 'string' ? req.body.title : 'Viral Moment';
    const subtitle = typeof req.body?.subtitle === 'string' ? req.body.subtitle : '';
    const clipPath = renderedClips.get(jobId);
    if (!clipPath || !fs.existsSync(clipPath)) {
      res.status(404).json({ error: 'Rendered clip not found or expired.' });
      return;
    }
    try {
      const durationSec = await probeDuration(clipPath);
      const profile = await extractAudioEnergyProfile(clipPath, Math.max(1, Math.round(durationSec)));
      let peakSec = 2;
      let peakEnergy = -1;
      profile.forEach((energy, idx) => {
        if (energy > peakEnergy) {
          peakEnergy = energy;
          peakSec = idx * 5 + 2;
        }
      });
      peakSec = Math.min(Math.max(0, peakSec), Math.max(0, durationSec - 0.5));
      const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clippulse-thumb-'));
      const framePath = path.join(workDir, 'frame.jpg');
      const thumbPath = path.join(workDir, 'thumbnail.jpg');
      await runProcess('ffmpeg', ['-y', '-ss', String(peakSec), '-i', clipPath, '-frames:v', '1', '-q:v', '2', framePath]);
      const scriptPath = path.resolve(__dirname, 'scripts', 'make_thumbnail.py');
      await runProcessCapture(
        resolvePythonBinary(),
        [scriptPath, '--frame', framePath, '--title', title, '--subtitle', subtitle, '--output', thumbPath],
        60000,
      );
      if (!fs.existsSync(thumbPath)) {
        res.status(500).json({ error: 'Thumbnail generation failed.' });
        return;
      }
      thumbnails.set(jobId, thumbPath);
      res.json({ ok: true, thumbnailUrl: `/api/thumbnail/${jobId}`, peakSec });
    } catch (err) {
      res.status(500).json({ error: 'Thumbnail generation failed.', detail: String(err).slice(0, 200) });
    }
  });

  app.get('/api/thumbnail/:jobId', (req, res) => {
    const filePath = thumbnails.get(req.params.jobId);
    if (!filePath || !fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Thumbnail not found.' });
      return;
    }
    res.sendFile(filePath, { headers: { 'Content-Type': 'image/jpeg' } });
  });

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // ClipPulse v5 — Node's default request timeout is 300s, which killed
  // the client's 4K render response mid-encode (the ffmpeg kept going and
  // the file finished on disk, but the jobId never reached the caller).
  // 4K renders take 6-9 min on this box, so allow 30 min.
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`ClipPulse server running at http://0.0.0.0:${PORT}`);
  });
  server.requestTimeout = 30 * 60 * 1000;
  server.headersTimeout = 31 * 60 * 1000;
}

startServer();
