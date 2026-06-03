#!/bin/bash
# =========================================================
# ARRANQUE AUTOMÁTICO DEL TRANSCRIPTOR PROFESIONAL
# Instala TODO lo necesario si es la primera vez.
# Funciona en cualquier Mac (no depende del usuario).
# =========================================================

# Detectar la carpeta donde está ESTE script (portable)
DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$DIR/arranque.log"

# Asegurar que PATH incluya Homebrew (Silicon e Intel), binarios locales y el sistema estándar
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

echo "=====================================" >> "$LOG"
echo "INICIO: $(date)" >> "$LOG"

# ── Arranque rápido: si ya se instaló todo, no re-verificar dependencias ──
READY_MARK="$HOME/.config/transcriptor/ready"
if [ -f "$READY_MARK" ]; then
    echo "✅ Listo (arranque rápido)"
    lsof -t -i tcp:5111 | xargs kill -9 2>/dev/null
    cd "$DIR"
    export PYTORCH_ENABLE_MPS_FALLBACK=1
    export PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.0
    exec python3 server.py >> "$LOG" 2>&1
fi

# ── 1. Instalar Python3 si no existe ──
if ! command -v python3 &> /dev/null; then
    echo "⚙️  Python3 no encontrado. Intentando instalar..."
    echo "⚙️ Instalando Python3..." >> "$LOG"
    # Intentar con Homebrew si existe
    if command -v brew &> /dev/null; then
        brew install python >> "$LOG" 2>&1
    else
        echo "❌ Python3 no encontrado y Homebrew no disponible."
        echo "   Instala Python3 desde https://www.python.org/downloads/"
        echo "   o instala Homebrew: /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
        exit 1
    fi
fi
echo "✅ Python3 OK" >> "$LOG"
echo "✅ Python3 listo"

# ── 2. Instalar FFmpeg si no existe ──
# Busca en PATH, Homebrew y ~/.local/bin
if ! command -v ffmpeg &> /dev/null; then
    echo "⚙️  FFmpeg no encontrado. Instalando procesador de audio..."
    echo "⚙️ Instalando FFmpeg..." >> "$LOG"
    
    FFMPEG_INSTALLED=false
    
    # Método 1: Intentar con Homebrew si existe
    if command -v brew &> /dev/null; then
        echo "   Intentando con Homebrew..." >> "$LOG"
        brew install ffmpeg >> "$LOG" 2>&1
        if command -v ffmpeg &> /dev/null; then
            FFMPEG_INSTALLED=true
        fi
    fi
    
    # Método 2: Descarga directa de binarios estáticos (NO requiere sudo ni Homebrew)
    if [ "$FFMPEG_INSTALLED" = false ]; then
        echo "   Descargando FFmpeg directamente (sin Homebrew)..."
        echo "   Descargando FFmpeg binario estático..." >> "$LOG"
        mkdir -p "$HOME/.local/bin"
        
        # Descargar ffmpeg
        curl -L "https://evermeet.cx/ffmpeg/getrelease/zip" -o /tmp/ffmpeg_dl.zip >> "$LOG" 2>&1
        if [ -f /tmp/ffmpeg_dl.zip ]; then
            cd /tmp && unzip -o ffmpeg_dl.zip -d /tmp/ffmpeg_extract >> "$LOG" 2>&1
            if [ -f /tmp/ffmpeg_extract/ffmpeg ]; then
                cp /tmp/ffmpeg_extract/ffmpeg "$HOME/.local/bin/ffmpeg"
            elif [ -f /tmp/ffmpeg ]; then
                cp /tmp/ffmpeg "$HOME/.local/bin/ffmpeg"
            fi
            chmod +x "$HOME/.local/bin/ffmpeg" 2>/dev/null
            rm -f /tmp/ffmpeg_dl.zip
            rm -rf /tmp/ffmpeg_extract
        fi
        
        # Descargar ffprobe
        curl -L "https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip" -o /tmp/ffprobe_dl.zip >> "$LOG" 2>&1
        if [ -f /tmp/ffprobe_dl.zip ]; then
            cd /tmp && unzip -o ffprobe_dl.zip -d /tmp/ffprobe_extract >> "$LOG" 2>&1
            if [ -f /tmp/ffprobe_extract/ffprobe ]; then
                cp /tmp/ffprobe_extract/ffprobe "$HOME/.local/bin/ffprobe"
            elif [ -f /tmp/ffprobe ]; then
                cp /tmp/ffprobe "$HOME/.local/bin/ffprobe"
            fi
            chmod +x "$HOME/.local/bin/ffprobe" 2>/dev/null
            rm -f /tmp/ffprobe_dl.zip
            rm -rf /tmp/ffprobe_extract
        fi
        
        # Verificar que se instaló
        if [ -x "$HOME/.local/bin/ffmpeg" ]; then
            FFMPEG_INSTALLED=true
            echo "   ✅ FFmpeg descargado exitosamente en ~/.local/bin/" >> "$LOG"
        fi
    fi
    
    if [ "$FFMPEG_INSTALLED" = false ]; then
        echo "❌ No se pudo instalar FFmpeg automáticamente."
        echo "   Instala manualmente: brew install ffmpeg"
        echo "❌ FFmpeg falló" >> "$LOG"
        exit 1
    fi
fi

# Verificar que ffmpeg realmente funciona
if command -v ffmpeg &> /dev/null; then
    FFMPEG_VER=$(ffmpeg -version 2>&1 | head -1)
    echo "✅ FFmpeg OK: $FFMPEG_VER" >> "$LOG"
    echo "✅ FFmpeg listo"
else
    echo "❌ FFmpeg no funciona tras instalación" >> "$LOG"
    echo "❌ FFmpeg no funciona. Revisa el log: $LOG"
    exit 1
fi

# ── 3. Instalar Flask y Werkzeug para el servidor web ──
if ! python3 -c "import flask" &> /dev/null; then
    echo "⚙️  Instalando servidor web (Flask)..."
    echo "⚙️ Instalando Flask..." >> "$LOG"
    python3 -m pip install flask werkzeug flask-cors --break-system-packages >> "$LOG" 2>&1 || \
    python3 -m pip install flask werkzeug flask-cors >> "$LOG" 2>&1
fi
echo "✅ Flask OK" >> "$LOG"
echo "✅ Servidor web listo"

# ── 4. Instalar dependencias de red, traducción, TTS e IA Nube ──
if ! python3 -c "import requests" &> /dev/null || ! python3 -c "import deep_translator" &> /dev/null || ! python3 -c "import edge_tts" &> /dev/null || ! python3 -c "import google.generativeai" &> /dev/null; then
    echo "⚙️  Instalando módulos de red, traducción, voz e inteligencia avanzada..."
    echo "⚙️ Instalando requests + deep-translator + edge-tts + google-generativeai + python-dotenv..." >> "$LOG"
    python3 -m pip install requests deep-translator edge-tts google-generativeai python-dotenv --break-system-packages >> "$LOG" 2>&1 || \
    python3 -m pip install requests deep-translator edge-tts google-generativeai python-dotenv >> "$LOG" 2>&1
fi
echo "✅ Red + Traducción + TTS + Gemini OK" >> "$LOG"
echo "✅ Módulos listos"

# ── 5. Instalar el motor de transcripción (faster-whisper) ──
# faster-whisper (CTranslate2) es más rápido y usa mucha menos RAM (int8 en CPU),
# y NO requiere PyTorch. Ideal para Mac. El modelo se descarga al primer uso.
if ! python3 -c "import faster_whisper" &> /dev/null; then
    echo ""
    echo "⚙️  Instalando motor de IA Local (faster-whisper)..."
    echo "   ⏳ Esto puede tardar unos minutos la primera vez."
    echo ""
    echo "⚙️ Instalando faster-whisper..." >> "$LOG"
    python3 -m pip install faster-whisper --break-system-packages >> "$LOG" 2>&1 || \
    python3 -m pip install faster-whisper >> "$LOG" 2>&1
fi
echo "✅ Motor faster-whisper OK" >> "$LOG"
echo "✅ Motor de IA listo"

# Marca de "todo instalado" para acelerar los próximos arranques
mkdir -p "$(dirname "$READY_MARK")" 2>/dev/null && touch "$READY_MARK" 2>/dev/null

# ── 6. Matar cualquier instancia anterior del servidor ──
lsof -t -i tcp:5111 | xargs kill -9 2>/dev/null

# ── 7. Arrancar el servidor ──
echo ""
echo "🚀 Iniciando servidor de transcripción..."
echo "🚀 Iniciando servidor web..." >> "$LOG"
cd "$DIR"

# FLAGS de estabilidad para macOS Apple Silicon
export PYTORCH_ENABLE_MPS_FALLBACK=1
export PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.0

python3 server.py >> "$LOG" 2>&1
