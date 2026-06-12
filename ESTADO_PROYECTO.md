# Transcriptor de Audios — Estado del proyecto

> Resumen completo para retomar rápido (Carlos). Última actualización: jun 2026.
> Idioma: español colombiano neutro (sin voseo).

## Qué es
App para **transcribir audios** (local, con IA) y **traducir** opcionalmente.
Pensada para uso personal (Carlos) y compartible con su hermano. Marca: **DGITAL76**.

- **Repo (público):** https://github.com/cjsabogal-boop/transcriptor-audios — rama `main`
- **Carpeta local:** `/Users/carlos/Proyectos 2026/ia-tools/transcriptor-audios`
- **App instalada:** `/Applications/Transcriptor.app`
- **ZIP para compartir:** `~/Downloads/Transcriptor-App-Mac.zip` (se regenera; ver abajo)
- **Proyecto Firebase:** `transcriptor-hernando-2026` (NO desplegado aún; ver pendientes)

## Cómo funciona (arquitectura)
```
[Transcriptor.app] --(lanzador bash, sin Terminal)--> arranca servidor + abre ventana
        |
   server.py (Flask, 127.0.0.1:5111)  --sirve el frontend y la API--
        ├─ faster-whisper (CTranslate2, int8 CPU) = transcribe audio→texto
        ├─ deep_translator (Google Translate libre) = traducir (sin Gemini)
        └─ ventana = Chrome en modo --app (sin barra). UI en frontend/public/
```
- Los audios se guardan en `~/Documents/Audios`.
- 100% local, gratis, sin API keys, offline (salvo la traducción que usa Google Translate libre).

## Funcionalidades implementadas
- **App 100% nativa (Swift + WKWebView):** ventana propia (no Chrome), puntito en el Dock,
  menú nativo (⌘Q/⌘W/⌘C/⌘V), progreso de instalación en vivo, reintento si el server tarda.
  Fuente: `tools/native/main.swift` · build: `tools/build_native_app.sh <dest> [modelo]`.
- **Subtítulos `.srt`/`.vtt`** desde los timestamps de Whisper (menú ⬇️ Exportar del modal).
- **Exportar a TXT / Word / PDF** (python-docx, fpdf2).
- **Buscador** en TODAS las transcripciones (campo sobre la lista, busca dentro del texto).
- **Transcribir desde link** (YouTube etc., con yt-dlp). Campo "pega un link" + botón.
- **Grabar con el micrófono** (botón 🎙️ Grabar; pide permiso de mic la 1ª vez).
- **Cola de varios audios** (arrastra varios; se procesan uno tras otro).
- **IA local con Ollama (opcional):** si Ollama corre (`ollama serve` + un modelo), aparece el
  panel ✨ IA local en el modal: Resumen, Título (con renombrar), Tareas, Post redes, Blog,
  Devocional y chat con el audio. Si no está instalado, el panel se oculta solo.
- **Transcripción** con faster-whisper. Modelos: `tiny/base/small/medium/large-v3`.
  - Default del servidor por env `WHISPER_MODEL`. Este Mac (M1 8GB) → `small`. Paquete/M4 → `medium`.
  - Selector de modelo y de idioma en la pantalla de subida. `/api/config` expone modelos/hardware.
  - El modelo se descarga al primer uso (cacheado en `~/.cache/huggingface`).
- **Traducir a español** (botón en el modal) vía `/api/translate` (deep_translator). Sin Gemini.
- **Modal simplificado:** una sola columna editable (transcripción) + botones `Cerrar · Traducir · Guardar`.
  (Se quitó toda la parte de Gemini y la API key hardcodeada, por seguridad.)
- **Acepta cualquier audio/video** (el filtro de archivos es amplio; ffmpeg convierte).
- **Apagado automático:** al cerrar la ventana, el servidor se apaga y libera la RAM/modelo
  (clave para el M1 8GB). `/api/closing` (sendBeacon en `pagehide`) + watchdog en server.py.
  NUNCA apaga durante una transcripción. Gateable con env `AUTO_SHUTDOWN=0`.
- **No-cache:** el server manda headers `no-store` para que el navegador siempre cargue lo último.
- **App nativa de Mac (sin Terminal):** `Transcriptor.app` con ícono propio (mic lima sobre ink).
  Doble clic → rebota → arranca servidor → abre ventana en su propio marco (Chrome `--app`).
- **Auto-actualización:** Configuración → "🔄 Buscar actualización" → `/api/update` baja los archivos
  más recientes del repo (API de GitHub, sin caché CDN). Tras actualizar: recarga o reabrir si cambió el server.
- **Descargas para otra Mac:** Configuración → "Descargar Transcriptor.app" (`/api/package/app`, modelo medium)
  y "Paquete .command (.zip)" (`/api/package/mac`). Se generan al vuelo con el código actual.

## Diseño (marca DGITAL76)
- Tema terminal oscuro: ink `#0D0D0D`, acento lima `#C8F135`, crema `#F2EDE6`.
- Tipografía: **Space Mono** (títulos) + **DM Sans** (texto).
- Detalles: logo `transcriptor_` con cursor, ventana con puntos de colores, prompts `$`.
- Tomado de https://dgital76.com.

## Archivos clave
- `server.py` — Flask + faster-whisper + endpoints (/api/upload, /api/config, /api/translate,
  /api/update, /api/closing, /api/package/app, /api/package/mac, etc.).
- `run_server.sh` — instala dependencias (python/ffmpeg/faster-whisper) y arranca server.py.
  Tiene "arranque rápido": si existe `~/.config/transcriptor/ready`, salta las verificaciones.
- `frontend/public/index.html`, `app.js`, `styles.css` — la interfaz.
- `requirements.txt` — flask, flask-cors, requests, deep-translator, edge-tts, python-dotenv, faster-whisper.
- `tools/build_app.sh` — construye `Transcriptor.app` desde el repo. Uso: `./tools/build_app.sh <dest> [modelo]`.
- `tools/app_template/{Info.plist, launcher.sh}` — plantillas del bundle (única fuente de verdad).
- `tools/make_icon.py` — genera `assets/icon.icns` (ícono de la app).
- `.github/workflows/deploy.yml` — CI de deploy a Firebase (pendiente de activar).

## Comandos útiles (cheat sheet)
```bash
cd "/Users/carlos/Proyectos 2026/ia-tools/transcriptor-audios"

# Construir la app (local = modelo small)
./tools/build_app.sh dist
# Construir para otra Mac (medium)
./tools/build_app.sh /tmp/share medium

# Instalar en Aplicaciones
rm -rf /Applications/Transcriptor.app && cp -R dist/Transcriptor.app /Applications/

# Regenerar el ZIP para compartir (Descargas)
cd /tmp/share && ditto -c -k --sequesterRsrc --keepParent Transcriptor.app ~/Downloads/Transcriptor-App-Mac.zip

# Arrancar el server a mano (debug)
./run_server.sh    # (AUTO_SHUTDOWN=0 ./run_server.sh para que no se apague)

# Regenerar ícono
python3 tools/make_icon.py && (cd assets && rm -rf icon.iconset && mkdir icon.iconset && \
  for s in 16 32 64 128 256 512 1024; do sips -z $s $s icon_1024.png --out icon.iconset/icon_${s}x${s}.png; done && \
  iconutil -c icns icon.iconset -o icon.icns)
```

## Cómo compartir con otra persona (hermano)
1. Configuración (⚙️) → **Descargar Transcriptor.app** → genera `~/Downloads/Transcriptor-App-Mac.zip`.
2. Enviar el zip (AirDrop/WhatsApp/Drive).
3. La persona: descomprime → arrastra `Transcriptor.app` a Aplicaciones →
   **CLIC DERECHO → Abrir → Abrir** (¡obligatorio la 1ª vez! El doble clic la bloquea por Gatekeeper).
4. La 1ª vez instala todo solo (python si falta, ffmpeg, faster-whisper, el modelo ~1.5GB). Necesita internet.

## ⚠️ "No abre" — causas comunes
- **Desde un .zip descargado:** macOS la pone en cuarentena → doble clic la bloquea.
  **Solución: clic derecho → Abrir → Abrir** (solo la 1ª vez). O quitar cuarentena:
  `xattr -dr com.apple.quarantine /ruta/Transcriptor.app`
- **El .zip NO se abre directo:** primero hay que **descomprimirlo** y abrir el `Transcriptor.app` que sale.
- **Requiere Python en el Mac** (casi todos lo tienen; si no, macOS ofrece instalar herramientas de desarrollo).

## Estado actual de la app de Dock (decisión)
Se intentó una app persistente (NSApplication/rumps/AppleScript) para mostrar el "puntito de abierto"
en el Dock, pero resultaba **frágil** (a veces no arrancaba / la ventana no se veía / macOS la etiquetaba
"Python"). **Decisión final:** lanzador simple y **confiable** — clic en el Dock → rebota → abre la ventana
cada vez (probado en ciclos abrir/cerrar/reabrir). Trade-off aceptado: sin puntito persistente en el Dock.

## Pendientes / próximos pasos
- [ ] **Desplegar a Firebase Hosting** (sitio `transcriptor-audios` + secret de GitHub Actions).
      Pasos humanos en consola Firebase. Ver README sección Despliegue. (Hoy solo corre local.)
- [ ] **Habilitar Google Sign-In** en Firebase (solo si se usa la versión web/nube). En local NO pide login.
- [ ] **IA local con Ollama** (en el M4 24GB): resumen, título automático, acciones/tareas,
      "chatear con el audio", generar contenido (blog/redes/sermón/devocional). Reemplaza a Gemini, 100% local.
- [ ] **Subtítulos `.srt`/`.vtt`** (Whisper ya tiene marcas de tiempo) y exportar a Word/PDF.
- [ ] **(Opcional) Firmar la app** con Apple Developer (US$99/año) para evitar el clic-derecho y el
      nombre "Python", y poder distribuirla sin fricción.

## Notas de contexto
- Whisper solo hace audio→texto (+ detección de idioma + timestamps). Para "entender/crear" (resumir,
  redactar) se necesita un LLM local (Ollama) — es la fase grande pendiente.
- El repo es **público** (sin secretos: las apiKey de Firebase son públicas por diseño; la service account
  está como secret de GitHub, no en el código). Se hizo público para que el auto-update funcione.
- Carlos transcribe contenido de **agencia/negocio** y **cristiano/sermones** (dos mundos de contenido).
