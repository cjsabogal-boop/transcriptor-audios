#!/bin/bash
# Construye Transcriptor.app NATIVA (Swift + WKWebView): ventana propia, puntito en el Dock.
# Uso: build_native_app.sh <carpeta_destino> [modelo_whisper]
set -e

DEST="${1:?Falta carpeta destino}"
MODEL="${2:-medium}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$DEST/Transcriptor.app"

mkdir -p "$DEST"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
mkdir -p "$APP/Contents/Resources/app"

# ── Compilar el binario nativo en Swift ──
echo "Compilando binario nativo (Swift)…"
swiftc -O \
  -framework Cocoa -framework WebKit \
  -o "$APP/Contents/MacOS/Transcriptor" \
  "$ROOT/tools/native/main.swift"
chmod +x "$APP/Contents/MacOS/Transcriptor"

# ── Código de la app (server + frontend) ──
cp "$ROOT/server.py" "$APP/Contents/Resources/app/"
cp "$ROOT/run_server.sh" "$APP/Contents/Resources/app/"
cp "$ROOT/requirements.txt" "$APP/Contents/Resources/app/" 2>/dev/null || true
mkdir -p "$APP/Contents/Resources/app/frontend"
cp -R "$ROOT/frontend/public" "$APP/Contents/Resources/app/frontend/public"
rm -rf "$APP/Contents/Resources/app/frontend/public/downloads" 2>/dev/null || true

# ── Ícono ──
cp "$ROOT/assets/icon.icns" "$APP/Contents/Resources/icon.icns"

# ── Info.plist ──
cp "$ROOT/tools/app_template/Info.plist" "$APP/Contents/Info.plist"

# ── Modelo por defecto ──
# El binario Swift lee el modelo de este archivo (método confiable, sin parchear binario).
printf '%s' "$MODEL" > "$APP/Contents/Resources/app/model.txt"

# ── Firma ad-hoc (evita "app dañada"; NO quita el clic-derecho la 1a vez) ──
codesign --force --deep --sign - "$APP" 2>/dev/null || true

touch "$APP"
echo "App NATIVA construida: $APP  (modelo: $MODEL)"
