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

# 5. Download the caption fonts (OFL, free) the 7 subtitle styles need:
#    Anton (Hormozi) + Archivo Black (DOAC) + Bebas Neue (Word Flash) +
#    Montserrat ExtraBold (Minimal) + Poppins ExtraBold (Lime glow) +
#    Alfa Slab One (Bold wordbox) + Lilita One (Top flip).
#    Noto Sans (Sentence) is a system font on most Linux desktops.
#    Without these, libass silently falls back to DejaVu Sans and the
#    styles stop looking distinct.
mkdir -p ~/.fonts
if [ ! -f ~/.fonts/Anton-Regular.ttf ]; then
  echo "==> Downloading Anton font..."
  curl -fsSL -o ~/.fonts/Anton-Regular.ttf "https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf" \
    || echo "[WARN] Could not download Anton — Hormozi captions fall back to a system font."
fi
if [ ! -f ~/.fonts/ArchivoBlack-Regular.ttf ]; then
  echo "==> Downloading Archivo Black font..."
  curl -fsSL -o ~/.fonts/ArchivoBlack-Regular.ttf "https://github.com/google/fonts/raw/main/ofl/archivoblack/ArchivoBlack-Regular.ttf" \
    || echo "[WARN] Could not download Archivo Black — DOAC captions fall back to a system font."
fi
if [ ! -f ~/.fonts/BebasNeue-Regular.ttf ]; then
  echo "==> Downloading Bebas Neue font..."
  curl -fsSL -o ~/.fonts/BebasNeue-Regular.ttf "https://github.com/google/fonts/raw/main/ofl/bebasneue/BebasNeue-Regular.ttf" \
    || echo "[WARN] Could not download Bebas Neue — Word Flash falls back to a system font."
fi
if [ ! -f ~/.fonts/Montserrat-ExtraBold.ttf ]; then
  echo "==> Downloading Montserrat ExtraBold font..."
  curl -fsSL -o ~/.fonts/Montserrat-ExtraBold.ttf "https://github.com/JulietaUla/Montserrat/raw/master/fonts/ttf/Montserrat-ExtraBold.ttf" \
    || echo "[WARN] Could not download Montserrat ExtraBold — Minimal falls back to a system font."
fi
if [ ! -f ~/.fonts/Poppins-ExtraBold.ttf ]; then
  echo "==> Downloading Poppins ExtraBold font..."
  curl -fsSL -o ~/.fonts/Poppins-ExtraBold.ttf "https://github.com/google/fonts/raw/main/ofl/poppins/Poppins-ExtraBold.ttf" \
    || echo "[WARN] Could not download Poppins ExtraBold — Lime glow falls back to a system font."
fi
if [ ! -f ~/.fonts/AlfaSlabOne-Regular.ttf ]; then
  echo "==> Downloading Alfa Slab One font..."
  curl -fsSL -o ~/.fonts/AlfaSlabOne-Regular.ttf "https://github.com/google/fonts/raw/main/ofl/alfaslabone/AlfaSlabOne-Regular.ttf" \
    || echo "[WARN] Could not download Alfa Slab One — Bold wordbox falls back to a system font."
fi
if [ ! -f ~/.fonts/LilitaOne-Regular.ttf ]; then
  echo "==> Downloading Lilita One font..."
  curl -fsSL -o ~/.fonts/LilitaOne-Regular.ttf "https://github.com/google/fonts/raw/main/ofl/lilitaone/LilitaOne-Regular.ttf" \
    || echo "[WARN] Could not download Lilita One — Top flip falls back to a system font."
fi
if command -v fc-cache >/dev/null 2>&1; then fc-cache -f ~/.fonts >/dev/null 2>&1 || true; fi

# Optional Python tools for full offline Whisper / MediaPipe pipeline
# (--break-system-packages: Debian/Ubuntu's pip refuses --user installs
# without it, PEP 668; the packages are optional, so failure is fine.)
if command -v pip3 >/dev/null 2>&1; then
  echo "==> Installing optional Python pipeline packages (youtube-transcript-api, vaderSentiment)..."
  pip3 install --user --break-system-packages -q youtube-transcript-api vaderSentiment || true
fi

echo ""
echo "Setup complete! Start ClipPulse locally with:"
echo "  npm run prod"
echo "Then open http://localhost:3000"
