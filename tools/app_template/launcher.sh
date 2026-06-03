#!/bin/bash
# Lanzador de Transcriptor — app normal del Dock (sin Terminal). Arranca una app
# Cocoa (macapp.py) que se ve "abierta" en el Dock y maneja la ventana. Si falta
# PyObjC, macapp.py cae solo a un modo simple (arranca servidor + abre ventana).
DIR="$(cd "$(dirname "$0")/../Resources/app" && pwd)"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
export WHISPER_MODEL="${WHISPER_MODEL:-medium}"
LOG="$HOME/Library/Logs/Transcriptor.log"
mkdir -p "$HOME/Library/Logs" 2>/dev/null

# Asegurar python3 (si falta, intentar con Homebrew)
if ! command -v python3 >/dev/null 2>&1; then
  command -v brew >/dev/null 2>&1 && brew install python >>"$LOG" 2>&1
fi

# Asegurar PyObjC (AppKit) para la app de Dock
python3 -c "import AppKit" >/dev/null 2>&1 || \
  python3 -m pip install pyobjc-framework-Cocoa --break-system-packages >>"$LOG" 2>&1 || \
  python3 -m pip install pyobjc-framework-Cocoa >>"$LOG" 2>&1

cd "$DIR"
exec python3 macapp.py
