#!/bin/bash
# Construye Transcriptor.app (app nativa de macOS, sin Terminal).
# Uso: build_app.sh <carpeta_destino> [modelo_whisper]
set -e

DEST="${1:?Falta carpeta destino}"
MODEL="${2:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$DEST/Transcriptor.app"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
mkdir -p "$APP/Contents/Resources/app"

# ── Código de la app (server + frontend) ──
cp "$ROOT/server.py" "$APP/Contents/Resources/app/"
cp "$ROOT/run_server.sh" "$APP/Contents/Resources/app/"
cp "$ROOT/requirements.txt" "$APP/Contents/Resources/app/" 2>/dev/null || true
mkdir -p "$APP/Contents/Resources/app/frontend"
cp -R "$ROOT/frontend/public" "$APP/Contents/Resources/app/frontend/public"
# quitar zips/descargas pesadas si las hubiera
rm -rf "$APP/Contents/Resources/app/frontend/public/downloads" 2>/dev/null || true

# plantillas + assets dentro de la app (para poder regenerar/descargar la app desde dentro)
mkdir -p "$APP/Contents/Resources/app/tools/app_template"
cp "$ROOT/tools/app_template/Info.plist" "$APP/Contents/Resources/app/tools/app_template/"
cp "$ROOT/tools/app_template/launcher.sh" "$APP/Contents/Resources/app/tools/app_template/"
mkdir -p "$APP/Contents/Resources/app/assets"
cp "$ROOT/assets/icon.icns" "$APP/Contents/Resources/app/assets/icon.icns"

# ── Ícono ──
cp "$ROOT/assets/icon.icns" "$APP/Contents/Resources/icon.icns"

# ── Info.plist ──
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Transcriptor</string>
  <key>CFBundleDisplayName</key><string>Transcriptor</string>
  <key>CFBundleIdentifier</key><string>com.dgital76.transcriptor</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleExecutable</key><string>Transcriptor</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>10.13</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

# ── Línea de modelo (opcional) ──
MODEL_LINE=""
if [ -n "$MODEL" ]; then
  MODEL_LINE="export WHISPER_MODEL=\"\${WHISPER_MODEL:-$MODEL}\""
fi

# ── Lanzador (sin Terminal) ──
cat > "$APP/Contents/MacOS/Transcriptor" <<LAUNCHER
#!/bin/bash
# Lanzador de Transcriptor — arranca el servidor en segundo plano y abre la ventana.
DIR="\$(cd "\$(dirname "\$0")/../Resources/app" && pwd)"
export PATH="\$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:\$PATH"
$MODEL_LINE
URL="http://127.0.0.1:5111"
LOG="\$HOME/Library/Logs/Transcriptor.log"
mkdir -p "\$HOME/Library/Logs" 2>/dev/null

notify(){ /usr/bin/osascript -e "display notification \"\$1\" with title \"Transcriptor\"" >/dev/null 2>&1; }

open_window(){
  if [ -d "/Applications/Google Chrome.app" ]; then
    /usr/bin/open -na "Google Chrome" --args --app="\$URL" --user-data-dir="\$HOME/Library/Application Support/Transcriptor/win" >/dev/null 2>&1
  else
    /usr/bin/open "\$URL"
  fi
}

# ¿Ya está corriendo? solo abrir la ventana
if /usr/bin/curl -s "\$URL/api/health" >/dev/null 2>&1; then
  open_window
  exit 0
fi

notify "Iniciando… la primera vez instala la IA (puede tardar unos minutos)."
cd "\$DIR"
chmod +x run_server.sh 2>/dev/null
( nohup ./run_server.sh >> "\$LOG" 2>&1 & )

# Esperar a que el servidor responda (hasta ~12 min en la primera instalación)
for i in \$(seq 1 720); do
  /usr/bin/curl -s "\$URL/api/health" >/dev/null 2>&1 && break
  sleep 1
done

if /usr/bin/curl -s "\$URL/api/health" >/dev/null 2>&1; then
  notify "¡Listo!"
  open_window
else
  notify "No se pudo iniciar. Revisa ~/Library/Logs/Transcriptor.log"
fi
LAUNCHER

chmod +x "$APP/Contents/MacOS/Transcriptor"

# Refrescar caché de íconos para este bundle
touch "$APP"

echo "App construida: $APP"
