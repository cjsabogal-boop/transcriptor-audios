#!/bin/bash
# =========================================================
# ARRANQUE AUTOMÁTICO DEL TRANSCRIPTOR PROFESIONAL
# Instala TODO lo necesario si es la primera vez.
# Funciona en cualquier Mac (no depende del usuario).
# =========================================================

# Detectar la carpeta donde está ESTE script (portable)
DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$DIR/arranque.log"

# Asegurar que PATH incluya Homebrew y pip
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"

echo "=====================================" >> "$LOG"
echo "INICIO: $(date)" >> "$LOG"

# ── 1. Instalar Homebrew si no existe ──
if ! command -v brew &> /dev/null; then
    echo "⚙️  Instalando Homebrew (gestor de paquetes para macOS)..."
    echo "   Esto solo pasa la primera vez. Puede tardar unos minutos..."
    echo ""
    echo "⚙️ Instalando Homebrew..." >> "$LOG"
    NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" >> "$LOG" 2>&1
    eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv 2>/dev/null)"
    export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
fi
echo "✅ Homebrew OK" >> "$LOG"
echo "✅ Homebrew listo"

# ── 2. Instalar Python3 si no existe ──
if ! command -v python3 &> /dev/null; then
    echo "⚙️  Instalando Python3..."
    echo "⚙️ Instalando Python3..." >> "$LOG"
    brew install python >> "$LOG" 2>&1
fi
echo "✅ Python3 OK" >> "$LOG"
echo "✅ Python3 listo"

# ── 3. Instalar FFmpeg si no existe ──
if ! command -v ffmpeg &> /dev/null; then
    echo "⚙️  Instalando FFmpeg (procesador de audio)..."
    echo "⚙️ Instalando FFmpeg..." >> "$LOG"
    brew install ffmpeg >> "$LOG" 2>&1
fi
echo "✅ FFmpeg OK" >> "$LOG"
echo "✅ FFmpeg listo"

# ── 4. Instalar Flask y Werkzeug para el servidor web ──
if ! python3 -c "import flask" &> /dev/null; then
    echo "⚙️  Instalando servidor web (Flask)..."
    echo "⚙️ Instalando Flask..." >> "$LOG"
    python3 -m pip install flask werkzeug flask-cors --break-system-packages >> "$LOG" 2>&1 || \
    python3 -m pip install flask werkzeug flask-cors >> "$LOG" 2>&1
fi
echo "✅ Flask OK" >> "$LOG"
echo "✅ Servidor web listo"

# ── 5. Instalar Whisper + PyTorch (IA de transcripción) ──
if ! python3 -c "import whisper" &> /dev/null; then
    echo ""
    echo "⚙️  Instalando motor de IA (Whisper + PyTorch)..."
    echo "   ⏳ Esto puede tardar 5-10 minutos la primera vez."
    echo "   Descargando ~400MB de modelos de inteligencia artificial..."
    echo ""
    echo "⚙️ Instalando Whisper IA + PyTorch..." >> "$LOG"
    python3 -m pip install openai-whisper torch --break-system-packages >> "$LOG" 2>&1 || \
    python3 -m pip install openai-whisper torch >> "$LOG" 2>&1
fi
echo "✅ Whisper IA OK" >> "$LOG"
echo "✅ Motor de IA listo"

# ── 6. Matar cualquier instancia anterior del servidor ──
lsof -t -i tcp:5111 | xargs kill -9 2>/dev/null

# ── 7. Arrancar el servidor ──
echo ""
echo "🚀 Iniciando servidor de transcripción..."
echo "🚀 Iniciando servidor web..." >> "$LOG"
cd "$DIR"

# Este flag previene el crasheo interno "aten::_sparse_coo_tensor... de SparseMPS" 
# permitiendo a la gráfica del procesador Apple Silicon alternar al CPU sólo
# cuando se topa con un cálculo matemático incompatible.
export PYTORCH_ENABLE_MPS_FALLBACK=1

python3 server.py >> "$LOG" 2>&1
