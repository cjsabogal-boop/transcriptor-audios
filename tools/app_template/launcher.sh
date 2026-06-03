#!/bin/bash
# Lanzador de Transcriptor — muestra el ícono en la barra de menú (rumps) y
# arranca el servidor en segundo plano (sin Terminal). Si rumps no está
# disponible, cae a un modo simple: arranca el servidor y abre la ventana.
DIR="$(cd "$(dirname "$0")/../Resources/app" && pwd)"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
export WHISPER_MODEL="${WHISPER_MODEL:-medium}"
URL="http://127.0.0.1:5111"
LOG="$HOME/Library/Logs/Transcriptor.log"
mkdir -p "$HOME/Library/Logs" 2>/dev/null

# Asegurar python3 (si falta, intentar con Homebrew)
if ! command -v python3 >/dev/null 2>&1; then
  command -v brew >/dev/null 2>&1 && brew install python >>"$LOG" 2>&1
fi

# Asegurar rumps (ícono de barra de menú)
python3 -c "import rumps" >/dev/null 2>&1 || \
  python3 -m pip install rumps --break-system-packages >>"$LOG" 2>&1 || \
  python3 -m pip install rumps >>"$LOG" 2>&1

cd "$DIR"

if python3 -c "import rumps" >/dev/null 2>&1; then
  # Modo barra de menú
  exec python3 menubar.py
fi

# ── Fallback sin barra de menú ──
notify(){ /usr/bin/osascript -e "display notification \"$1\" with title \"Transcriptor\"" >/dev/null 2>&1; }
open_window(){
  if [ -d "/Applications/Google Chrome.app" ]; then
    /usr/bin/open -na "Google Chrome" --args --app="$URL" >/dev/null 2>&1
  else
    /usr/bin/open "$URL"
  fi
}
if /usr/bin/curl -s "$URL/api/health" >/dev/null 2>&1; then open_window; exit 0; fi
notify "Iniciando… la primera vez instala la IA (puede tardar unos minutos)."
chmod +x run_server.sh 2>/dev/null
( nohup ./run_server.sh >> "$LOG" 2>&1 & )
for i in $(seq 1 720); do /usr/bin/curl -s "$URL/api/health" >/dev/null 2>&1 && break; sleep 1; done
if /usr/bin/curl -s "$URL/api/health" >/dev/null 2>&1; then notify "¡Listo!"; open_window; else notify "No se pudo iniciar. Revisa ~/Library/Logs/Transcriptor.log"; fi
