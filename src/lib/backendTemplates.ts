export interface StackToolRow {
  stage: string;
  stageBn: string;
  tool: string;
  purpose: string;
  purposeBn: string;
  cost: string;
}

export const FREE_STACK_MATRIX: StackToolRow[] = [
  {
    stage: '1. Trending CC-BY Discovery',
    stageBn: '১. ট্রেন্ডিং ও কপিরাইট-ফ্রি সার্চ',
    tool: 'YouTube Data API v3 (videoLicense=creativeCommon) + RSS',
    purpose: 'Fetches long (>20m) Cricket, Boxing, Football, Gaming & Podcast CC-BY videos while filtering broadcast rights holders',
    purposeBn: 'Cricket, Boxing, Football, Gaming ও Podcast-এর দীর্ঘ CC-BY ভিডিও খুঁজে আনে এবং ব্রডকাস্ট কপিরাইট চ্যানেল বাদ দেয়',
    cost: 'Free (10k units/day)',
  },
  {
    stage: '2. Transcript + Heatmap',
    stageBn: '২. ট্রান্সক্রিপ্ট + হিটম্যাপ',
    tool: 'youtube-transcript-api / faster-whisper',
    purpose: 'Extracts captions + timestamps in <1s without downloading the full 2-hour video',
    purposeBn: 'পুরো ২ ঘণ্টার ভিডিও না নামিয়েই ১ সেকেন্ডে ক্যাপশন ও টাইমস্ট্যাম্প বের করে',
    cost: 'Free (Serverless)',
  },
  {
    stage: '3. Category-Aware Virality LLM',
    stageBn: '৩. ক্যাটাগরি ভাইরালিটি স্কোরিং',
    tool: 'Gemini Free Tier + VADER + Librosa',
    purpose: 'Podcast prioritizes Hook (40%); Sports prioritizes Crowd Audio Peak (45%); Gaming prioritizes Reaction + Clutch',
    purposeBn: 'Podcast-এ Hook (40%), Sports-এ Crowd/Audio Spike (45%) ও Gaming-এ Clutch অনুযায়ী সেরা ৬০ সেঃ বের করে',
    cost: 'Free Tier',
  },
  {
    stage: '4. 60s Section-Only Cut',
    stageBn: '৪. শুধু ৬০ সেঃ সেকশন ডাউনলোড',
    tool: 'yt-dlp --download-sections "*start-end"',
    purpose: 'Downloads ONLY the winning 60s slice (~20MB) instead of 2GB full video — renders in ~20s',
    purposeBn: 'পুরো ২GB ভিডিওর বদলে শুধুমাত্র সেরা ৬০ সেকেন্ড (~20MB) নামায় — রেন্ডার হয় মাত্র ~২০ সেকেন্ডে',
    cost: 'Free (Open Source)',
  },
  {
    stage: '5. Smart 9:16 Reframe & Safe Transform',
    stageBn: '৫. স্মার্ট ৯:১৬ ক্রপ ও সেফ ট্রান্সফর্ম',
    tool: 'MediaPipe + FFmpeg (Sports Blur / Gaming Split / Face Track)',
    purpose: 'Applies category framing + .ass karaoke + CC-BY credit + subtle eq/atempo transform',
    purposeBn: 'ক্যাটাগরি অনুযায়ী 9:16 ফ্রেমিং, কারাওকে .ass ও CC-BY অ্যাট্রিবিউশন বার্ন করে',
    cost: 'Free (Open Source)',
  },
  {
    stage: '6. Scale-to-Zero Serverless Worker',
    stageBn: '৬. সার্ভারলেস অটো-স্কেল ওয়ার্কার',
    tool: 'Modal.com ($30/mo free) or Google Cloud Run Jobs',
    purpose: 'Zero idle servers (no HF/Oracle/Render); spins up for 20s per clip, saves to Cloudflare R2, scales to $0',
    purposeBn: 'কোনো সার্ভার চালিয়ে রাখতে হয় না — রিকোয়েস্ট এলেই ২০ সেঃ কাজ করে Cloudflare R2-তে সেভ করে বন্ধ হয়',
    cost: 'Free Tier ($0 idle)',
  },
];

export const MODAL_SERVERLESS_PY = `import os
import json
import subprocess
import tempfile
from pathlib import Path
import modal

# True Scale-to-Zero Serverless Video Worker (No HF / Oracle / Render needed!)
app = modal.App("clippulse-serverless-worker")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libgl1", "libglib2.0-0", "fonts-noto")
    .pip_install(
        "yt-dlp",
        "youtube-transcript-api",
        "vaderSentiment",
        "google-genai",
        "boto3",
        "fastapi[standard]",
    )
)

BLOCKED_BROADCASTERS = {"icc", "bcci", "uefa", "premier league", "dazn", "espn", "ufc", "sony sports"}

@app.function(image=image, cpu=2, memory=2048, timeout=180, secrets=[modal.Secret.from_name("clippulse-secrets")])
@modal.fastapi_endpoint(method="POST")
def auto_clip_serverless(payload: dict):
    """
    1. Accepts { youtube_url, start_sec, end_sec, category, hook_text, attribution }
    2. Downloads ONLY the 60s window via yt-dlp --download-sections (20MB instead of 2GB!)
    3. Renders category-aware 9:16 clip (sports-blur / gaming-split / face-track) + CC-BY safe transform
    4. Uploads final MP4 to Cloudflare R2 (zero egress fee) & shuts down to $0 idle.
    """
    youtube_url = payload["youtube_url"]
    start_sec = int(payload.get("start_sec", 0))
    end_sec = int(payload.get("end_sec", 60))
    category = payload.get("category", "podcast")
    hook_text = payload.get("hook_text", "WAIT FOR THE END")
    channel_name = payload.get("channel", "CC-BY Creator")

    if any(b in channel_name.lower() for b in BLOCKED_BROADCASTERS):
        return {"error": "Blocked broadcast rights holder to protect against Content ID claims."}

    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        raw_clip = work / "clip_raw.mp4"
        out_mp4 = work / "viral_reel_60s.mp4"
        ass_path = work / "captions.ass"

        # Download ONLY the winning 60s segment!
        subprocess.run([
            "yt-dlp",
            "--download-sections", f"*{start_sec}-{end_sec}",
            "--force-keyframes-at-cuts",
            "-f", "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]",
            "-o", str(raw_clip),
            youtube_url,
        ], check=True)

        # Write minimal ASS hook + CC-BY attribution banner
        ass_path.write_text(
            "[Script Info]\\nScriptType: v4.00+\\nPlayResX: 1080\\nPlayResY: 1920\\n\\n"
            "[V4+ Styles]\\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV\\n"
            "Style: HookBanner,Plus Jakarta Sans,72,&H00FFFFFF,&H00FFFFFF,&H000F172A,&HD01E1DE1,-1,3,18,0,8,70,70,220\\n"
            "Style: Credit,DM Sans,32,&H80FFFFFF,&H80FFFFFF,&H00000000,&H60000000,0,1,2,0,2,40,40,90\\n\\n"
            "[Events]\\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\\n"
            f"Dialogue: 1,0:00:00.00,0:00:02.80,HookBanner,,0,0,0,,{hook_text.upper()}\\n"
            f"Dialogue: 1,0:00:00.00,0:01:00.00,Credit,,0,0,0,,CC-BY Source: {channel_name}\\n",
            encoding="utf-8",
        )

        # Category-aware 9:16 framing + subtle copyright-safe visual/audio transform
        if category in ("cricket", "boxing", "football"):
            vf = (
                f"[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=22:4[bg];"
                f"[0:v]scale=1080:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,eq=contrast=1.03:saturation=1.06,ass={ass_path}[v]"
            )
            cmd = ["ffmpeg", "-y", "-i", str(raw_clip), "-filter_complex", vf, "-map", "[v]", "-map", "0:a?"]
        elif category == "gaming":
            vf = (
                f"[0:v]crop=iw*0.26:ih*0.28:0:0,scale=1080:672:force_original_aspect_ratio=increase,crop=1080:672[cam];"
                f"[0:v]scale=1080:1248:force_original_aspect_ratio=increase,crop=1080:1248[game];"
                f"[cam][game]vstack=inputs=2,eq=contrast=1.03:saturation=1.06,ass={ass_path}[v]"
            )
            cmd = ["ffmpeg", "-y", "-i", str(raw_clip), "-filter_complex", vf, "-map", "[v]", "-map", "0:a?"]
        else:
            vf = f"crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920,eq=contrast=1.03:saturation=1.06,ass={ass_path}"
            cmd = ["ffmpeg", "-y", "-i", str(raw_clip), "-vf", vf]

        cmd += ["-af", "atempo=1.01", "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-c:a", "aac", str(out_mp4)]
        subprocess.run(cmd, check=True)

        # Upload to Cloudflare R2 via boto3 S3-compatible endpoint
        import boto3
        s3 = boto3.client(
            "s3",
            endpoint_url=os.environ["R2_ENDPOINT"],
            aws_access_key_id=os.environ["R2_ACCESS_KEY"],
            aws_secret_access_key=os.environ["R2_SECRET_KEY"],
        )
        key = f"reels/{category}_{start_sec}_{end_sec}.mp4"
        s3.upload_file(str(out_mp4), os.environ["R2_BUCKET"], key, ExtraArgs={"ContentType": "video/mp4"})
        return {"status": "ready", "download_url": f"{os.environ['R2_PUBLIC_BASE']}/{key}"}
`;

export const VERCEL_AUTOFETCH_TS = `// Vercel / Cloud Functions Serverless Route: /api/auto-fetch-cc
// Fetches trending LONG (>20m) Creative Commons (CC-BY) videos across Cricket, Boxing, Football, Gaming
import type { NextApiRequest, NextApiResponse } from 'next';

const CATEGORY_QUERIES: Record<string, string> = {
  cricket: 'cricket match highlights full',
  boxing: 'boxing full fight amateur',
  football: 'football match full highlights',
  gaming: 'gaming stream full clutch boss',
};

const BLOCKED_CHANNELS = ['icc', 'bcci', 'uefa', 'premier league', 'dazn', 'espn', 'ufc', 'sony sports'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'YOUTUBE_API_KEY missing' });

  const results = [];
  for (const [category, query] of Object.entries(CATEGORY_QUERIES)) {
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('type', 'video');
    url.searchParams.set('videoLicense', 'creativeCommon'); // Strictly CC-BY!
    url.searchParams.set('videoDuration', 'long');          // Strictly >20 minutes!
    url.searchParams.set('order', 'viewCount');
    url.searchParams.set('maxResults', '5');
    url.searchParams.set('q', query);
    url.searchParams.set('key', apiKey);

    const r = await fetch(url.toString());
    const data = await r.json();
    const safeItem = (data.items || []).find((item: any) => {
      const ch = (item.snippet?.channelTitle || '').toLowerCase();
      return !BLOCKED_CHANNELS.some((b) => ch.includes(b));
    });

    if (safeItem) {
      results.push({
        category,
        videoId: safeItem.id.videoId,
        title: safeItem.snippet.title,
        channel: safeItem.snippet.channelTitle,
        license: 'creativeCommon',
        youtubeUrl: \`https://www.youtube.com/watch?v=\${safeItem.id.videoId}\`,
      });
    }
  }
  return res.status(200).json({ pack: results });
}
`;

export const CLOUDRUN_DOCKERFILE = `FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \\
    ffmpeg \\
    fonts-noto \\
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN pip install --no-cache-dir yt-dlp youtube-transcript-api vaderSentiment google-genai boto3 fastapi uvicorn

COPY modal_app.py /app/main.py

# Google Cloud Run exposes $PORT (defaults to 8080) and scales to zero when idle
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port \${PORT:-8080}"]
`;

export const FLUTTERFLOW_API_SCHEMA = `{
  "autoFetchPackEndpoint": "POST https://<your-vercel-or-cloudrun>/api/auto-fetch-pack",
  "renderClipEndpoint": "POST https://<your-modal-endpoint>.modal.run",
  "requestBody": {
    "categories": ["cricket", "boxing", "football", "gaming"],
    "ccOnly": true
  },
  "responseJsonPaths": {
    "cricketClipUrl": "$.pack[0].source.youtubeUrl",
    "cricketStartSec": "$.pack[0].topWindow.startSec",
    "cricketHook": "$.pack[0].topWindow.suggestedHooks[0]",
    "copyrightStatus": "$.pack[0].copyright.label"
  }
}`;
