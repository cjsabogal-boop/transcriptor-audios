#!/bin/bash

# =========================================================
# 🎙️ TRANSCRIPTOR PROFESIONAL - DOBLE CLIC PARA INICIAR
# =========================================================
# Este archivo es el que el usuario hace doble clic.
# Instala todo automáticamente si es la primera vez y
# abre el navegador con la interfaz visual.
# =========================================================

clear
echo "==========================================================="
echo "   🎙️  TRANSCRIPTOR PROFESIONAL DE AUDIOS                 "
echo "==========================================================="
echo ""
echo "  Iniciando el sistema..."
echo "  Si es la primera vez, se instalarán las herramientas"
echo "  necesarias automáticamente. Ten paciencia."
echo ""

# Detectar la carpeta del script (funciona en cualquier Mac)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Detectar si server.py está aquí mismo (ZIP plano) o en subcarpeta
if [ -f "$SCRIPT_DIR/server.py" ]; then
    APP_DIR="$SCRIPT_DIR"
else
    APP_DIR="$SCRIPT_DIR/App_Transcriptor"
fi

# Verificar que exista la carpeta de la app
if [ ! -f "$APP_DIR/server.py" ]; then
    echo "❌ ERROR: No se encontró server.py en $APP_DIR"
    echo "   Asegúrate de que la carpeta App_Transcriptor esté"
    echo "   en el mismo sitio que este archivo."
    echo ""
    echo "Presiona ENTER para cerrar..."
    read
    exit 1
fi

# Dar permisos de ejecución al script de arranque
chmod +x "$APP_DIR/run_server.sh"

# Ejecutar el script de arranque (instala todo + arranca servidor)
echo "🚀 Preparando todo..."
echo ""
"$APP_DIR/run_server.sh" &

# Esperar a que el servidor esté listo
# Primera vez: instalar Homebrew + Python + FFmpeg + PyTorch puede tardar 10-15 min
# Siguientes veces: solo toma ~5 segundos
echo "⏳ Esperando a que el servidor esté listo..."
MAX_WAIT=600
WAITED=0
while ! curl -s http://127.0.0.1:5111 > /dev/null 2>&1; do
    sleep 2
    WAITED=$((WAITED + 2))
    if [ $WAITED -ge $MAX_WAIT ]; then
        echo "❌ El servidor no respondió después de ${MAX_WAIT}s."
        echo "   Revisa el log en: $APP_DIR/arranque.log"
        echo ""
        echo "Presiona ENTER para cerrar..."
        read
        exit 1
    fi
    # Mostrar progreso cada 10 segundos
    if [ $((WAITED % 10)) -eq 0 ]; then
        echo "   ... ${WAITED}s (instalando dependencias si es necesario)"
    fi
done

echo ""
echo "✅ ¡Servidor listo! Abriendo el navegador..."
echo ""
open "https://transcriptor-hernando-2026.web.app"

echo "==========================================================="
echo "   ✅ SISTEMA ACTIVO — NO CIERRES ESTA VENTANA             "
echo "   Para apagar: cierra esta ventana.                        "
echo "==========================================================="

# Esperar a que el proceso del servidor termine
wait
