#!/usr/bin/env bash
# ClipPulse one-command installer.
#
#   curl -fsSL https://raw.githubusercontent.com/Manik51/Clippulse/main/scripts/install.sh | bash
#
# Windows hole Git Bash-e chalao (Git install korlei Git Bash ashe).
# Eta ja kore: repo download (na thakle) -> setup-local.sh chalano
# (Node package, ffmpeg, yt-dlp, face model, font) -> server start.
# Server bondho korte terminal-e Ctrl+C.
set -euo pipefail

REPO_URL="https://github.com/Manik51/Clippulse.git"
DEST="${CLIPPULSE_DIR:-$HOME/Clippulse}"
NO_START=0
for arg in "$@"; do
  if [ "$arg" = "--no-start" ]; then NO_START=1; fi
done

command -v git >/dev/null 2>&1 || {
  echo "[ERR] Git pelam na — https://git-scm.com theke install kore abar chalao."
  exit 1
}
command -v node >/dev/null 2>&1 || {
  echo "[ERR] Node.js pelam na — https://nodejs.org theke LTS install kore abar chalao."
  exit 1
}
command -v npm >/dev/null 2>&1 || {
  echo "[ERR] npm pelam na — Node.js er sathei ashe, Node abar install koro."
  exit 1
}

if [ -d "$DEST/.git" ]; then
  echo "==> Ager Clippulse pelam ($DEST) — latest ta niye aschi..."
  git -C "$DEST" pull --ff-only || true
else
  echo "==> Clippulse download hocche..."
  git clone "$REPO_URL" "$DEST"
fi

cd "$DEST"
bash scripts/setup-local.sh

if [ "$NO_START" = 1 ]; then
  echo ""
  echo "Install done (--no-start, server start korini)."
  echo "Chalate: cd $DEST && npm run prod"
  exit 0
fi

echo ""
echo "ClipPulse cholche — browser-e kholo: http://localhost:3000"
echo "(Bondho korte: Ctrl+C)"
exec npm run prod
