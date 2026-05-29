import os
import sys
import threading
import multiprocessing as mp
import subprocess
import time
import json
import requests

# Intentar cargar .env si existe para la clave de API de Gemini
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# Configuración GLOBAL de estabilidad para Mac (antes de importar torch)

# Configuración GLOBAL de estabilidad para Mac (antes de importar torch)
if sys.platform == "darwin":
    os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"
    os.environ["PYTORCH_MPS_HIGH_WATERMARK_RATIO"] = "0.0"

try:
    import torch
    import whisper
    if torch is not None:
        torch.set_num_threads(4)
        if sys.platform == "darwin" and hasattr(torch.backends, "mps"):
            torch.backends.mps.is_available = lambda: False
except ImportError:
    torch = None
    whisper = None

# Motor preferido: faster-whisper (CTranslate2). Más rápido y mucho menos RAM
# (int8 en CPU). Si no está instalado, se cae a openai-whisper.
try:
    from faster_whisper import WhisperModel as FasterWhisperModel
    FW_AVAILABLE = True
except ImportError:
    FasterWhisperModel = None
    FW_AVAILABLE = False

from flask import Flask, jsonify, request, send_file, send_from_directory
try:
    from flask_cors import CORS
except ImportError:
    CORS = None
from werkzeug.utils import secure_filename

app = Flask(__name__, static_folder="frontend/public", static_url_path="")

@app.route("/")
def index():
    """Servimos el frontend desde la misma aplicación Flask."""
    return send_from_directory(app.static_folder, "index.html")

# Referencias globales para el estado y el proceso
STATE = None
manager = None
CURRENT_PROCESS = None

# FALLBACK DE RUTAS PARA MAC
_LOCAL_BIN = os.path.expanduser("~/.local/bin")
_EXTRA_PATHS = [_LOCAL_BIN, "/opt/homebrew/bin", "/usr/local/bin"]
for _p in reversed(_EXTRA_PATHS):
    if _p not in os.environ.get("PATH", ""):
        os.environ["PATH"] = _p + os.pathsep + os.environ.get("PATH", "")

def find_binary(name):
    import shutil
    local_path = os.path.join(_LOCAL_BIN, name)
    if os.path.isfile(local_path) and os.access(local_path, os.X_OK):
        return local_path
    binary_path = shutil.which(name)
    if binary_path:
        return binary_path
    standard_paths = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]
    for p in standard_paths:
        full_path = os.path.join(p, name)
        if os.path.isfile(full_path) and os.access(full_path, os.X_OK):
            return full_path
    return name

@app.after_request
def no_cache(resp):
    # App local: nunca cachear, así el navegador siempre carga la última versión
    # (evita ver pantallas viejas tras actualizar el frontend).
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp


if CORS:
    CORS(app, resources={r"/api/*": {"origins": "*"}})
else:
    @app.after_request
    def add_cors_headers(response):
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, DELETE, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
        return response

AUDIO_DIR = os.path.expanduser("~/Documents/Audios")
os.makedirs(AUDIO_DIR, exist_ok=True)
app.config['UPLOAD_FOLDER'] = AUDIO_DIR
SERVER_START_TIME = time.time()

# ── Configuración de modelos Whisper ──
# De más rápido/ligero a más preciso/pesado.
ALLOWED_MODELS = ["tiny", "base", "small", "medium", "large-v3"]
MODEL_INFO = {
    "tiny":     {"label": "Tiny — rápido, calidad básica",       "ram_gb": 1},
    "base":     {"label": "Base — equilibrado ligero",           "ram_gb": 1},
    "small":    {"label": "Small — buena calidad",               "ram_gb": 2},
    "medium":   {"label": "Medium — muy buena (recomendado)",    "ram_gb": 5},
    "large-v3": {"label": "Large-v3 — máxima calidad",           "ram_gb": 10},
}
# Modelo por defecto: lo define la variable de entorno WHISPER_MODEL.
# Con faster-whisper, "small" corre cómodo incluso en 8GB, así que es el baseline.
# El paquete para la máquina grande exporta WHISPER_MODEL=medium (lo sobreescribe).
DEFAULT_MODEL = os.environ.get("WHISPER_MODEL", "small").strip().lower()
if DEFAULT_MODEL not in ALLOWED_MODELS:
    DEFAULT_MODEL = "small"


def detectar_device():
    if torch is not None and getattr(torch, "cuda", None) is not None and torch.cuda.is_available():
        return "cuda"
    return "cpu"


def detectar_ram_gb():
    try:
        return round(os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / (1024 ** 3), 1)
    except Exception:
        return None

# ── Singleton del modelo Whisper ──
WHISPER_MODELS = {}
WHISPER_DEVICE = "cpu"

def cargar_modelo(model_size="base"):
    """Devuelve una tupla (engine, modelo) donde engine es 'fw' (faster-whisper)
    u 'ow' (openai-whisper), para saber qué API usar al transcribir."""
    global WHISPER_MODELS, WHISPER_DEVICE
    if model_size in WHISPER_MODELS:
        return WHISPER_MODELS[model_size]

    device = "cuda" if (torch is not None and getattr(torch, "cuda", None) is not None and torch.cuda.is_available()) else "cpu"
    WHISPER_DEVICE = device

    if FW_AVAILABLE:
        # int8 en CPU (rápido y poca RAM); float16 en GPU.
        compute_type = "float16" if device == "cuda" else "int8"
        print(f"📦 Cargando faster-whisper '{model_size}' en {device.upper()} ({compute_type})...")
        modelo = FasterWhisperModel(model_size, device=device, compute_type=compute_type)
        WHISPER_MODELS[model_size] = ("fw", modelo)
        print(f"✅ Modelo '{model_size}' cargado (faster-whisper).")
    else:
        if sys.platform == "darwin" and torch is not None:
            torch.set_num_threads(mp.cpu_count())
        print(f"📦 Cargando openai-whisper '{model_size}' en {device.upper()}...")
        WHISPER_MODELS[model_size] = ("ow", whisper.load_model(model_size, device=device))
        print(f"✅ Modelo '{model_size}' cargado (openai-whisper).")

    return WHISPER_MODELS[model_size]

def obtener_duracion_audio(ruta):
    try:
        bin_ffprobe = find_binary('ffprobe')
        result = subprocess.run(
            [bin_ffprobe, '-v', 'quiet', '-show_entries', 'format=duration',
             '-of', 'default=noprint_wrappers=1:nokey=1', ruta],
            capture_output=True, text=True, timeout=10
        )
        return float(result.stdout.strip())
    except Exception:
        return None

def preconvertir_audio(ruta_entrada, start_time=None, end_time=None):
    """Convierte audio al formato que Whisper necesita (mono, 16kHz). Rápido, sin filtros pesados."""
    suffix = "_optimized.wav"
    if start_time is not None or end_time is not None:
        suffix = f"_trim_{int(start_time or 0)}_{int(end_time or 0)}.wav"
    
    ruta_opt = ruta_entrada.rsplit('.', 1)[0] + suffix
    try:
        bin_ffmpeg = find_binary('ffmpeg')
        cmd = [bin_ffmpeg, '-y', '-nostdin']
        
        # Recorte si se solicita
        if start_time: cmd.extend(['-ss', str(start_time)])
        if end_time: cmd.extend(['-to', str(end_time)])
        
        cmd.extend([
            '-i', ruta_entrada,
            '-ac', '1', '-ar', '16000',
            '-c:a', 'pcm_s16le',
            '-loglevel', 'error', ruta_opt
        ])
        
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                       stdin=subprocess.DEVNULL, timeout=120)
        
        if os.path.exists(ruta_opt) and os.path.getsize(ruta_opt) > 0:
            return ruta_opt
        return ruta_entrada
    except Exception as e:
        print(f"⚠️ Pre-conversión falló: {e}")
        return ruta_entrada

def limpiar_temporales():
    try:
        for f in os.listdir(AUDIO_DIR):
            if f.endswith('.wav') and ('_optimized' in f or '_trim_' in f or '_temp' in f):
                os.remove(os.path.join(AUDIO_DIR, f))
    except Exception:
        pass

def check_dependencies():
    # Falta instalar si no hay NINGÚN motor de transcripción disponible.
    return not (FW_AVAILABLE or whisper is not None)


@app.route("/api/health")
def health():
    return jsonify({
        "status": "ok",
        "uptime": round(time.time() - SERVER_START_TIME),
        "needs_install": check_dependencies(),
        "is_processing": STATE.get("is_processing", False) if STATE else False
    })

@app.route("/api/config")
def api_config():
    """Info de modelos disponibles y de la máquina, para que el frontend
    arme el selector de modelo y muestre el hardware."""
    return jsonify({
        "default_model": DEFAULT_MODEL,
        "allowed_models": ALLOWED_MODELS,
        "model_info": MODEL_INFO,
        "loaded_models": list(WHISPER_MODELS.keys()),
        "engine": "faster-whisper" if FW_AVAILABLE else "openai-whisper",
        "device": detectar_device(),
        "total_ram_gb": detectar_ram_gb(),
        "platform": sys.platform,
    })


@app.route("/api/status")
def status():
    global CURRENT_PROCESS
    res = dict(STATE or {})
    if res.get("is_processing") and CURRENT_PROCESS and not CURRENT_PROCESS.is_alive() and not res.get("completed"):
        res["is_processing"] = False
        res["error"] = True
        res["status_text"] = "❌ El proceso de IA se detuvo inesperadamente."
        STATE.update(res)
    return jsonify(res)

@app.route("/api/audios")
def get_audios():
    audios = []
    try:
        text_files = [f for f in os.listdir(AUDIO_DIR) if f.lower().endswith('.txt') and f != "logs_sistema.txt"]
        for txt in text_files:
            bname = os.path.splitext(txt)[0]
            txt_path = os.path.join(AUDIO_DIR, txt)
            json_path = os.path.join(AUDIO_DIR, bname + ".json")
            fecha_mod = os.path.getmtime(txt_path)
            
            if os.path.exists(json_path):
                with open(json_path, 'r', encoding='utf-8') as fj:
                    data = json.load(fj)
                    text_es = data.get("text_es", "")
                    text_en = data.get("text_en", "")
                    size_bytes = len(text_es.encode('utf-8')) + len(text_en.encode('utf-8'))
            else:
                with open(txt_path, 'r', encoding='utf-8') as f:
                    text_es = f.read()
                    text_en = ""
                    size_bytes = len(text_es.encode('utf-8'))
            
            audios.append({
                "title": bname, 
                "text_es": text_es, 
                "text_en": text_en, 
                "date": fecha_mod, 
                "size": size_bytes
            })
        audios.sort(key=lambda x: x['date'], reverse=True)
    except Exception: pass
    return jsonify(audios)

@app.route("/api/upload", methods=["POST"])
def upload_file():
    global CURRENT_PROCESS
    if STATE.get("is_processing"):
        return jsonify({"success": False, "msg": "Ya hay una transcripción en proceso."})
    
    if 'audiofile' not in request.files:
        return jsonify({"success": False, "msg": "No se envió audio"})
    
    file = request.files['audiofile']
    start_time = request.form.get('start_time')
    end_time = request.form.get('end_time')
    language = request.form.get('language', 'es')  # Default español
    task = request.form.get('task', 'transcribe')   # 'transcribe' | 'translate'
    if task not in ("transcribe", "translate"):
        task = "transcribe"
    # Modelo solicitado (override por subida) o el default del servidor
    model_size = (request.form.get('model') or DEFAULT_MODEL).strip().lower()
    if model_size not in ALLOWED_MODELS:
        model_size = DEFAULT_MODEL

    # Convertir a float si existen
    try:
        start_time = float(start_time) if start_time else None
        end_time = float(end_time) if end_time else None
    except ValueError:
        start_time = end_time = None

    filename = secure_filename(file.filename)
    if start_time is not None or end_time is not None:
        filename = f"part_{int(start_time or 0)}_{int(end_time or 0)}_{filename}"

    save_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(save_path)

    if CURRENT_PROCESS and CURRENT_PROCESS.is_alive(): CURRENT_PROCESS.terminate()
    CURRENT_PROCESS = mp.Process(target=proceso_fondo, args=(save_path, filename, STATE, start_time, end_time, language, model_size, task))
    CURRENT_PROCESS.start()
    return jsonify({"success": True})

def proceso_fondo(ruta_audio, filename, estado, start_time, end_time, language, model_size, task):
    import traceback
    def log(msg):
        with open("child_debug.log", "a") as f: f.write(f"[{time.ctime()}] {msg}\n")
    
    try:
        estado["is_processing"] = True
        estado["completed"] = False
        estado["error"] = False
        estado["progress_percent"] = 5.0
        estado["current_filename"] = filename
        estado["status_text"] = "Convirtiendo audio..."
        
        duracion = obtener_duracion_audio(ruta_audio)
        base = os.path.splitext(filename)[0]
        
        # Medir tamaño ANTES de convertir (el archivo original comprimido)
        size_mb_original = os.path.getsize(ruta_audio) / (1024 * 1024)
        
        estado["progress_percent"] = 10.0
        estado["status_text"] = "Preparando audio para IA..."
        
        # 1. Pre-procesar (conversión rápida, sin filtros pesados)
        ruta_procesable = preconvertir_audio(ruta_audio, start_time, end_time)
        ruta_wav_temp = ruta_procesable if ruta_procesable != ruta_audio else None
        
        # 2. Transcribir con el modelo elegido (configurable por el usuario / servidor)
        estado["progress_percent"] = 20.0
        estado["status_text"] = f"Cargando modelo '{model_size}'..."
        engine, modelo = cargar_modelo(model_size)

        # LOG para depuración
        print(f"📊 Depuración - Idioma: '{language}', Tarea: '{task}', Archivo: {size_mb_original:.1f}MB, Modelo: {model_size}, Motor: {engine}")

        # Idioma de origen para Whisper. Vacío/None => auto-detectar.
        if not language or language.strip() == "" or language == "None":
            lang_whisper = None
        else:
            lang_whisper = language.strip().lower()
            if lang_whisper not in ["es", "en"]:
                lang_whisper = None

        verbo = "Traduciendo" if task == "translate" else "Transcribiendo"
        estado["status_text"] = f"{verbo} ({lang_whisper or 'Auto'}) · modelo {model_size}..."
        estado["progress_percent"] = 30.0

        # Transcripción directa (Whisper siempre transcribe en el idioma original;
        # la traducción a español, si se pide, la hace Gemini después en el frontend).
        if engine == "fw":
            seg_iter, info = modelo.transcribe(ruta_procesable, language=lang_whisper, beam_size=5)
            partes, segments = [], []
            for i, s in enumerate(seg_iter):
                partes.append(s.text)
                segments.append({"id": i, "start": s.start, "end": s.end, "text": s.text})
            texto = "".join(partes).strip()
        else:
            resultado = modelo.transcribe(ruta_procesable, language=lang_whisper, fp16=False)
            texto = resultado["text"].strip()
            segments = resultado.get("segments", [])

        # 3. Guardar resultados.
        # text_en = transcripción cruda original (entrada para la IA).
        # text_es = salida editable: si es transcripción la mostramos tal cual;
        #           si es traducción la deja vacía para que Gemini la rellene.
        text_es_val = "" if task == "translate" else texto
        with open(os.path.join(AUDIO_DIR, base + ".json"), 'w', encoding='utf-8') as f:
            json.dump({
                "text_es": text_es_val,
                "text_en": texto,
                "segments": segments,
                "language": language,
                "task": task,
                "model": model_size,
                "trimmed": (start_time is not None or end_time is not None)
            }, f, ensure_ascii=False, indent=2)
            
        with open(os.path.join(AUDIO_DIR, base + ".txt"), 'w', encoding='utf-8') as f:
            f.write(texto)

        estado["progress_percent"] = 100.0
        estado["completed"] = True
        estado["title"] = base  # Para auto-abrir el modal en el frontend
        estado["task"] = task    # 'translate' => el frontend lanza Gemini automáticamente
        estado["status_text"] = "✅ ¡Listo!"
                    
    except Exception as e:
        log(f"ERROR: {str(e)}\n{traceback.format_exc()}")
        estado["status_text"] = f"❌ Error: {str(e)}"
        estado["error"] = True
    finally:
        if 'ruta_wav_temp' in locals() and ruta_wav_temp and os.path.exists(ruta_wav_temp):
            try: os.remove(ruta_wav_temp)
            except: pass
        estado["is_processing"] = False

@app.route("/api/audios/<title>/save", methods=["POST"])
def save_audio(title):
    data = request.json
    text_es = data.get("text_es", "")
    safe_title = secure_filename(title)
    json_path = os.path.join(AUDIO_DIR, safe_title + ".json")
    if os.path.exists(json_path):
        with open(json_path, 'r', encoding='utf-8') as f: jdata = json.load(f)
        jdata["text_es"] = text_es
        with open(json_path, 'w', encoding='utf-8') as f: json.dump(jdata, f, ensure_ascii=False, indent=2)
        with open(os.path.join(AUDIO_DIR, safe_title + ".txt"), 'w', encoding='utf-8') as f: f.write(text_es)
        return jsonify({"success": True})
    return jsonify({"success": False}), 404


@app.route("/api/audios/<title>/segments")
def get_segments(title):
    safe_title = secure_filename(title)
    json_path = os.path.join(AUDIO_DIR, safe_title + ".json")
    if os.path.exists(json_path):
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return jsonify(data.get("segments", []))
    return jsonify([]), 404

@app.route("/api/audios/<title>", methods=["DELETE"])
def delete_audio(title):
    safe_title = secure_filename(title)
    # Lista de archivos a borrar
    files_to_delete = [
        safe_title + '.json',
        safe_title + '.txt',
        safe_title + '.mp3',
        safe_title + '.wav',
        safe_title + '.m4a',
        safe_title + '_audio_es.mp3'
    ]
    for filename in files_to_delete:
        filepath = os.path.join(AUDIO_DIR, filename)
        if os.path.exists(filepath): os.remove(filepath)
    return jsonify({"success": True})

@app.route("/api/audios/<title>/rename", methods=["POST"])
def rename_audio(title):
    data = request.json
    new_title = data.get("new_title", "")
    if not new_title: return jsonify({"success": False, "msg": "Nuevo nombre requerido"}), 400
    
    old_safe = secure_filename(title)
    new_safe = secure_filename(new_title)
    
    if os.path.exists(os.path.join(AUDIO_DIR, new_safe + ".json")):
        return jsonify({"success": False, "msg": "Ya existe un archivo con ese nombre"}), 400

    # Extensiones a renombrar
    exts = ['.json', '.txt', '.mp3', '.wav', '.m4a', '_audio_es.mp3']
    for ext in exts:
        old_path = os.path.join(AUDIO_DIR, (old_safe + ext) if ext.startswith('.') else (old_safe + ext))
        new_path = os.path.join(AUDIO_DIR, (new_safe + ext) if ext.startswith('.') else (new_safe + ext))
        if os.path.exists(old_path):
            os.rename(old_path, new_path)
            
    # También actualizar el título dentro del JSON
    json_path = os.path.join(AUDIO_DIR, new_safe + ".json")
    if os.path.exists(json_path):
        with open(json_path, 'r', encoding='utf-8') as f:
            jdata = json.load(f)
        jdata["title"] = new_title
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(jdata, f, ensure_ascii=False, indent=2)

    return jsonify({"success": True})
@app.route("/api/install", methods=["POST"])
def install_dependencies():
    """Lanza la instalación de dependencias en un hilo separado."""
    def run_install():
        STATE["is_installing"] = True
        STATE["status_text"] = "Iniciando instalación de IA..."
        try:
            # Whisper + PyTorch + EdgeTTS + Google Generative AI
            deps = ["openai-whisper", "torch", "torchvision", "torchaudio", "edge-tts", "google-generativeai"]
            total = len(deps)
            for i, dep in enumerate(deps):
                STATE["status_text"] = f"Instalando {dep} ({i+1}/{total})..."
                subprocess.run([sys.executable, "-m", "pip", "install", dep], check=True)
            STATE["status_text"] = "✅ Instalación finalizada."
        except Exception as e:
            STATE["status_text"] = f"❌ Error en instalación: {str(e)}"
        finally:
            STATE["is_installing"] = False

    t = threading.Thread(target=run_install)
    t.start()
    return jsonify({"success": True})

PROMPTS_POR_MODO = {
    "general": (
        "Eres un editor profesional. Toma la siguiente transcripción cruda de un audio "
        "(puede ser un podcast, charla, conferencia, entrevista, audio personal, etc.) y "
        "produce una versión limpia, fluida y profesional en ESPAÑOL.\n\n"
        "INSTRUCCIONES:\n"
        "1. ELIMINA muletillas, repeticiones, palabras de relleno, falsos comienzos y silencios verbales (eh, ah, este, o sea, pues, ¿no?).\n"
        "2. CONSERVA el contenido sustantivo: ideas, datos, ejemplos, anécdotas, conclusiones.\n"
        "3. Si el original está en inglés u otro idioma, TRADÚCELO al español natural.\n"
        "4. Mejora la fluidez para que se lea de corrido, manteniendo el tono del autor.\n"
        "5. Conserva los nombres propios, cifras y citas tal cual.\n"
        "6. Si hay claramente varios bloques temáticos, separa con párrafos.\n"
    ),
    "interview": (
        "Eres un editor de entrevistas. Toma la siguiente transcripción cruda y produce "
        "una versión limpia en formato de diálogo en ESPAÑOL.\n\n"
        "INSTRUCCIONES:\n"
        "1. Detecta cambios de hablante e identifícalos como 'Entrevistador:' y 'Invitado:' (o nombres si los menciona).\n"
        "2. Elimina muletillas, repeticiones y falsos comienzos.\n"
        "3. Traduce al español si el original está en otro idioma.\n"
        "4. Mantén las preguntas y respuestas completas, sin perder ideas importantes.\n"
        "5. Cada intervención en un párrafo separado.\n"
    ),
    "summary": (
        "Eres un editor experto en sintetizar. Toma la siguiente transcripción y produce "
        "un RESUMEN EJECUTIVO en ESPAÑOL.\n\n"
        "INSTRUCCIONES:\n"
        "1. Empieza con 1-2 oraciones que capturen la idea principal.\n"
        "2. Sigue con 3-7 puntos clave en párrafos cortos (no uses viñetas ni markdown).\n"
        "3. Cierra con una conclusión o llamado a la acción si lo hay.\n"
        "4. Traduce al español si el original está en otro idioma.\n"
        "5. Mantén nombres propios, cifras y citas relevantes.\n"
    ),
    "sermon": (
        "Eres un editor profesional de contenido cristiano en español. Toma la siguiente "
        "transcripción de un sermón y produce un guion de audio fluido, claro y profesional en ESPAÑOL.\n\n"
        "INSTRUCCIONES OBLIGATORIAS:\n"
        "1. ELIMINA completamente: anuncios iniciales, letras de canciones, avisos finales, saludos de bienvenida al servicio, instrucciones logísticas.\n"
        "2. ENFÓCATE EXCLUSIVAMENTE en el mensaje bíblico/sermón principal.\n"
        "3. Si el texto original está en inglés, tradúcelo al español de forma natural y fluida.\n"
        "4. Adapta el texto para que suene natural al ser LEÍDO EN VOZ ALTA (es un guion de audio).\n"
        "5. Mantén las citas bíblicas y referencias escriturales.\n"
        "6. Usa un tono cálido, cercano y pastoral.\n"
    ),
    "raw": (
        "Eres un editor literal. Toma la siguiente transcripción cruda y produce una versión "
        "que conserve EXACTAMENTE el contenido, solo con correcciones mínimas en ESPAÑOL.\n\n"
        "INSTRUCCIONES:\n"
        "1. Corrige solo errores evidentes de transcripción (palabras mal entendidas, puntuación).\n"
        "2. NO elimines muletillas, NO reformules, NO resumas.\n"
        "3. Si el original está en otro idioma, traduce literalmente.\n"
        "4. Mantén el orden y todas las palabras del original.\n"
    ),
}

REGLAS_FORMATO_COMUNES = (
    "\nREGLAS DE FORMATO:\n"
    "- Devuelve ÚNICAMENTE el texto adaptado, listo para leer.\n"
    "- NO incluyas introducciones como 'Aquí tienes...', 'Claro...', 'A continuación...'.\n"
    "- NO uses formato Markdown (**, ##, ---, viñetas).\n"
    "- Solo texto puro, párrafos separados por líneas en blanco.\n\n"
)

def construir_prompt(mode, texto_original):
    base = PROMPTS_POR_MODO.get(mode, PROMPTS_POR_MODO["general"])
    return base + REGLAS_FORMATO_COMUNES + f"TRANSCRIPCIÓN ORIGINAL:\n{texto_original}"


@app.route("/api/gemini/transform", methods=["POST"])
def gemini_transform():
    import traceback
    try:
        import google.generativeai as genai
        data = request.json
        text_en = data.get("text_en", "")
        title = data.get("title", "Audio")
        mode = data.get("mode", "general")
        if mode not in PROMPTS_POR_MODO:
            mode = "general"

        if not text_en:
            # Intentar cargar desde el archivo si no viene en el body
            safe_title = secure_filename(title)
            json_path = os.path.join(AUDIO_DIR, safe_title + ".json")
            if os.path.exists(json_path):
                try:
                    with open(json_path, 'r', encoding='utf-8') as f:
                        jdata = json.load(f)
                        text_en = jdata.get("text_en", "")
                except Exception as e:
                    print(f"⚠️ Error al leer JSON para Gemini: {e}")

        if not text_en:
            return jsonify({"success": False, "msg": "No hay texto para procesar."}), 400

        api_key = os.environ.get("GOOGLE_API_KEY")
        if not api_key:
            return jsonify({
                "success": False,
                "msg": "Falta la clave de API de Gemini (GOOGLE_API_KEY). Configúrala en el servidor."
            }), 401

        print(f"✨ Adaptación Gemini [{mode}] para: {title}")
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel('gemini-2.5-flash-lite')

        prompt = construir_prompt(mode, text_en)

        response = model.generate_content(prompt)
        text_es = response.text.replace('```markdown', '').replace('```', '').strip()

        print(f"✅ Adaptación exitosa [{mode}]: {title}")
        return jsonify({"success": True, "text_es": text_es, "mode": mode})
    except Exception as e:
        err_msg = traceback.format_exc()
        print(f"❌ Error CRÍTICO en Gemini:\n{err_msg}")
        return jsonify({"success": False, "msg": str(e)}), 500

# TTS endpoints se mantienen igual (omitidos por brevedad pero incluidos en la escritura final)
@app.route("/api/audios/<title>/tts", methods=["POST"])
def generate_tts(title):
    text_es = request.json.get("text_es", "")
    if not text_es: return jsonify({"success": False}), 400
    safe_title = secure_filename(title)
    output_mp3 = os.path.join(AUDIO_DIR, safe_title + "_audio_es.mp3")
    import edge_tts, asyncio
    
    async def _crear():
        # Gerardo es la voz colombiana masculina natural
        communicate = edge_tts.Communicate(text_es, "es-CO-GonzaloNeural", rate="-5%")
        await communicate.save(output_mp3)

    try:
        # Modo más robusto de correr asyncio en hilos de Flask
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(_crear())
        finally:
            loop.close()
            
        return jsonify({"success": True, "download_url": f"/api/download_tts/{safe_title}_audio_es.mp3"})
    except Exception as e:
        print(f"❌ Error TTS: {e}")
        return jsonify({"success": False, "msg": str(e)}), 500

@app.route("/api/download_tts/<filename>")
def download_tts_file(filename):
    from flask import send_from_directory
    return send_from_directory(AUDIO_DIR, filename, as_attachment=True)


@app.route("/api/translate", methods=["POST"])
def api_translate():
    """Traduce texto a español (u otro idioma) con Google Translate libre.
    No usa Gemini ni ninguna API key."""
    data = request.json or {}
    text = (data.get("text") or "").strip()
    target = (data.get("target") or "es").strip().lower()
    if not text:
        return jsonify({"success": False, "msg": "No hay texto para traducir."}), 400
    try:
        from deep_translator import GoogleTranslator
        # Google Translate limita ~5000 chars por llamada: troceamos por seguridad.
        chunks = [text[i:i + 4500] for i in range(0, len(text), 4500)]
        traducidos = [GoogleTranslator(source="auto", target=target).translate(c) for c in chunks]
        return jsonify({"success": True, "text": "\n".join(t for t in traducidos if t)})
    except Exception as e:
        print(f"❌ Error traduciendo: {e}")
        return jsonify({"success": False, "msg": str(e)}), 500


PACKAGE_README = """TRANSCRIPTOR DE AUDIOS — Instalación en Mac
============================================

1. Descomprime esta carpeta donde quieras (por ejemplo, el Escritorio).
2. Haz doble clic en "Transcriptor_Facil.command".
   - La primera vez instala Python, FFmpeg y la IA (Whisper). Puede tardar
     varios minutos y descargar el modelo "medium" (~1.5 GB). Ten paciencia.
   - Si macOS bloquea el archivo: clic derecho -> Abrir, o en Terminal:
       chmod +x Transcriptor_Facil.command
3. Se abrira tu navegador en http://127.0.0.1:5111

MODELO DE TRANSCRIPCION
-----------------------
Por defecto usa "medium" (muy buena calidad, ~5 GB de RAM). Puedes cambiarlo:
- Desde la interfaz, en el selector "Modelo (calidad)" al subir un audio.
- O de forma permanente: abre "Transcriptor_Facil.command" con un editor de
  texto y cambia el valor de WHISPER_MODEL por: tiny / base / small / medium / large-v3

NOTAS
-----
- Es 100% local: tus audios no salen de tu Mac.
- Para apagarlo, cierra la ventana negra (Terminal).
"""


@app.route("/api/package/mac")
def descargar_paquete_mac():
    """Genera al vuelo un .zip con la app lista para correr en otro Mac,
    con el modelo por defecto en 'medium'. Siempre refleja el codigo actual."""
    import io, zipfile
    ROOT = os.path.dirname(os.path.abspath(__file__))
    TOP = "TranscriptorAudios"

    def leer(path):
        with open(path, "r", encoding="utf-8") as fh:
            return fh.read()

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        # server.py
        z.writestr(f"{TOP}/server.py", leer(os.path.join(ROOT, "server.py")))

        # run_server.sh con WHISPER_MODEL=medium por defecto (override por env)
        run_sh = leer(os.path.join(ROOT, "run_server.sh"))
        run_sh = run_sh.replace(
            "python3 server.py",
            'export WHISPER_MODEL="${WHISPER_MODEL:-medium}"\npython3 server.py'
        )
        zi = zipfile.ZipInfo(f"{TOP}/run_server.sh"); zi.external_attr = 0o755 << 16
        z.writestr(zi, run_sh)

        # .command que abre localhost (no la URL de la nube)
        cmd = leer(os.path.join(ROOT, "Transcriptor_Facil.command"))
        cmd = cmd.replace("https://transcriptor-audios.web.app", "http://127.0.0.1:5111")
        zic = zipfile.ZipInfo(f"{TOP}/Transcriptor_Facil.command"); zic.external_attr = 0o755 << 16
        z.writestr(zic, cmd)

        # requirements.txt
        req_path = os.path.join(ROOT, "requirements.txt")
        if os.path.exists(req_path):
            z.writestr(f"{TOP}/requirements.txt", leer(req_path))

        # frontend/public (sin la carpeta downloads ni ocultos)
        fe_root = os.path.join(ROOT, "frontend", "public")
        for dirpath, dirnames, filenames in os.walk(fe_root):
            dirnames[:] = [d for d in dirnames if d != "downloads" and not d.startswith(".")]
            for fn in filenames:
                if fn.startswith(".") or fn.lower().endswith(".zip"):
                    continue
                full = os.path.join(dirpath, fn)
                rel = os.path.relpath(full, fe_root)
                z.write(full, f"{TOP}/frontend/public/{rel}")

        # Instrucciones
        z.writestr(f"{TOP}/LEEME_PRIMERO.txt", PACKAGE_README)

    buf.seek(0)
    return send_file(buf, mimetype="application/zip", as_attachment=True,
                     download_name="TranscriptorAudios-Mac.zip")


if __name__ == "__main__":
    try:
        if mp.get_start_method(allow_none=True) != 'spawn':
            mp.set_start_method('spawn', force=True)
    except RuntimeError: pass

    manager = mp.Manager()
    STATE = manager.dict({
        "is_processing": False,
        "status_text": "Listo para transcribir.",
        "is_installing": False,
        "progress_percent": 0.0,
        "completed": False,
        "error": False,
        "current_filename": "",
        "title": ""
    })

    limpiar_temporales()
    print("🚀 Servidor listo en http://127.0.0.1:5111")
    # Cambiado a 0.0.0.0 para acceso desde otros dispositivos y estabilidad
    app.run(host="0.0.0.0", port=5111, debug=False, threaded=True)
