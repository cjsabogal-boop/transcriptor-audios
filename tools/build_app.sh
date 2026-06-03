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
cp "$ROOT/assets/icon_1024.png" "$APP/Contents/Resources/app/assets/icon_1024.png" 2>/dev/null || true

# ── Ícono ──
cp "$ROOT/assets/icon.icns" "$APP/Contents/Resources/icon.icns"

# ── Info.plist y lanzador (desde las plantillas: única fuente de verdad) ──
cp "$ROOT/tools/app_template/Info.plist" "$APP/Contents/Info.plist"
cp "$ROOT/tools/app_template/launcher.sh" "$APP/Contents/MacOS/Transcriptor"
# Sustituir el modelo por defecto (la plantilla trae medium; local usa small)
DEF_MODEL="${MODEL:-small}"
sed -i '' "s/:-medium}/:-$DEF_MODEL}/" "$APP/Contents/MacOS/Transcriptor"
chmod +x "$APP/Contents/MacOS/Transcriptor"

# Refrescar caché de íconos para este bundle
touch "$APP"

echo "App construida: $APP"
