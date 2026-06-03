#!/bin/bash
# Lanzador de Transcriptor — arranca el servidor en segundo plano (sin Terminal)
# y abre la interfaz en su propia ventana de app.
DIR="$(cd "$(dirname "$0")/../Resources/app" && pwd)"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
export WHISPER_MODEL="${WHISPER_MODEL:-medium}"
URL="http://127.0.0.1:5111"
LOG="$HOME/Library/Logs/Transcriptor.log"
mkdir -p "$HOME/Library/Logs" 2>/dev/null

notify(){ /usr/bin/osascript -e "display notification \"$1\" with title \"Transcriptor\"" >/dev/null 2>&1; }

open_window(){
  if [ -d "/Applications/Google Chrome.app" ]; then
    /usr/bin/open -na "Google Chrome" --args --app="$URL" --user-data-dir="$HOME/Library/Application Support/Transcriptor/win" >/dev/null 2>&1
  else
    /usr/bin/open "$URL"
  fi
}

# ¿Ya está corriendo? solo abrir la ventana
if /usr/bin/curl -s "$URL/api/health" >/dev/null 2>&1; then
  open_window
  exit 0
fi

notify "Iniciando… la primera vez instala la IA (puede tardar unos minutos)."
cd "$DIR"
chmod +x run_server.sh 2>/dev/null
( nohup ./run_server.sh >> "$LOG" 2>&1 & )

# Esperar a que el servidor responda (hasta ~12 min en la primera instalación)
for i in $(seq 1 720); do
  /usr/bin/curl -s "$URL/api/health" >/dev/null 2>&1 && break
  sleep 1
done

if /usr/bin/curl -s "$URL/api/health" >/dev/null 2>&1; then
  notify "¡Listo!"
  open_window
else
  notify "No se pudo iniciar. Revisa ~/Library/Logs/Transcriptor.log"
fi
