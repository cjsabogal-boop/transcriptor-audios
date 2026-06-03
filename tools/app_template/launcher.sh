#!/bin/bash
# Lanzador de Transcriptor (sin Terminal). Determinista y confiable:
#  - si el servidor ya corre, solo abre/enfoca la ventana
#  - si no, lo arranca en segundo plano (instala todo la 1a vez) y abre la ventana
DIR="$(cd "$(dirname "$0")/../Resources/app" && pwd)"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
export WHISPER_MODEL="${WHISPER_MODEL:-medium}"
URL="http://127.0.0.1:5111"
LOG="$HOME/Library/Logs/Transcriptor.log"
mkdir -p "$HOME/Library/Logs" 2>/dev/null

notify(){ /usr/bin/osascript -e "display notification \"$1\" with title \"Transcriptor\"" >/dev/null 2>&1; }

open_window(){
  if [ -d "/Applications/Google Chrome.app" ]; then
    /usr/bin/open -na "Google Chrome" --args --app="$URL" >/dev/null 2>&1
    /usr/bin/open -a "Google Chrome" >/dev/null 2>&1   # traer al frente
  else
    /usr/bin/open "$URL"
  fi
}

# Asegurar python3 (si falta, intentar con Homebrew)
command -v python3 >/dev/null 2>&1 || { command -v brew >/dev/null 2>&1 && brew install python >>"$LOG" 2>&1; }

# ¿Ya está corriendo? abrir la ventana y salir
if /usr/bin/curl -s --max-time 2 "$URL/api/health" >/dev/null 2>&1; then
  open_window
  exit 0
fi

# Arrancar el servidor
notify "Abriendo… (la 1ª vez instala la IA, puede tardar)"
cd "$DIR"
chmod +x run_server.sh 2>/dev/null
( nohup ./run_server.sh >> "$LOG" 2>&1 & )

# Esperar a que responda (hasta ~12 min en la 1a instalación)
for i in $(seq 1 720); do
  /usr/bin/curl -s --max-time 2 "$URL/api/health" >/dev/null 2>&1 && break
  sleep 1
done

if /usr/bin/curl -s --max-time 2 "$URL/api/health" >/dev/null 2>&1; then
  notify "¡Listo!"
  open_window
else
  notify "No se pudo iniciar. Revisa ~/Library/Logs/Transcriptor.log"
fi
