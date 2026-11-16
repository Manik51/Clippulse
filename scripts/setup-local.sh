#!/usr/bin/env bash
set -euo pipefail

echo "==> ClipPulse Local Linux/macOS Setup"

# 1. Create .env once if it doesn't exist
if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
  echo "[OK] Created .env from .env.example (edit .env once to add your free GEMINI_API_KEY and YOUTUBE_API_KEY)"
fi

# 2. Install Node dependencies
if command -v npm >/dev/null 2>&1; then
  echo "==> Installing Node.js dependencies..."
  npm install
else
  echo "[ERR] Node.js (v20+) and npm are required. Install from https://nodejs.org/ or via nvm."
  exit 1
fi

# 3. Install ffmpeg & yt-dlp automatically if missing
install_linux_pkg() {
  local pkg="$1"
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update -y && sudo apt-get install -y "$pkg"
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y "$pkg"
  elif command -v pacman >/dev/null 2>&1; then
    sudo pacman -Sy --noconfirm "$pkg"
  elif command -v brew >/dev/null 2>&1; then
    brew install "$pkg"
  else
    return 1
  fi
}

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "==> Installing ffmpeg..."
  install_linux_pkg ffmpeg || echo "[WARN] Please install ffmpeg manually for your distro."
else
  echo "[OK] ffmpeg found: $(command -v ffmpeg)"
fi

if ! command -v yt-dlp >/dev/null 2>&1; then
  echo "==> Installing yt-dlp..."
  if command -v pip3 >/dev/null 2>&1; then
    pip3 install --user -U yt-dlp || install_linux_pkg yt-dlp || true
  elif command -v python3 >/dev/null 2>&1; then
    python3 -m pip install --user -U yt-dlp || install_linux_pkg yt-dlp || true
  else
    install_linux_pkg yt-dlp || true
  fi
else
  echo "[OK] yt-dlp found: $(command -v yt-dlp)"
fi

# 4. Download the YuNet face-detection model (232KB, OpenCV model zoo) if missing.
#    The Python face scripts (detect_facecam.py, scene_faces*.py, detect_cambox.py)
#    need scripts/face_detection_yunet_2023mar.onnx next to them.
YUNET_MODEL="scripts/face_detection_yunet_2023mar.onnx"
if [ ! -f "$YUNET_MODEL" ]; then
  echo "==> Downloading YuNet face-detection model..."
  curl -fsSL -o "$YUNET_MODEL" "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx" \
    || wget -q -O "$YUNET_MODEL" "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx" \
    || echo "[WARN] Could not download the YuNet model — face tracking falls back to centre crop. Get it from https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet"
else
  echo "[OK] YuNet model found: $YUNET_MODEL"
fi

# Optional Python tools for full offline Whisper / MediaPipe pipeline
if command -v pip3 >/dev/null 2>&1; then
  echo "==> Installing optional Python pipeline packages (youtube-transcript-api, vaderSentiment)..."
  pip3 install --user -q youtube-transcript-api vaderSentiment || true
fi

echo ""
echo "Setup complete! Start ClipPulse locally with:"
echo "  npm run dev"
echo "Then open http://localhost:3000"
