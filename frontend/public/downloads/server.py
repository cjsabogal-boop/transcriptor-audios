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

# ── Singleton del modelo Whisper ──
WHISPER_MODELS = {}
WHISPER_DEVICE = "cpu"

def cargar_modelo(model_size="base"):
    global WHISPER_MODELS, WHISPER_DEVICE
    if model_size in WHISPER_MODELS:
        return WHISPER_MODELS[model_size]
    
    WHISPER_DEVICE = "cpu"
    if torch is not None:
        if torch.cuda.is_available():
            WHISPER_DEVICE = "cuda"
        elif sys.platform == "darwin":
            WHISPER_DEVICE = "cpu"
            torch.set_num_threads(mp.cpu_count()) 
        
    print(f"📦 Cargando modelo Whisper '{model_size}' en {WHISPER_DEVICE.upper()}...")
    WHISPER_MODELS[model_size] = whisper.load_model(model_size, device=WHISPER_DEVICE)
    print(f"✅ Modelo '{model_size}' cargado.")
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
    """Convierte y opcionalmente recorta el audio."""
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
            '-af', 'lowpass=f=7500,volume=1.5',
            '-c:a', 'pcm_s16le',
            '-threads', '4',
            '-loglevel', 'error', ruta_opt
        ])
        
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                       stdin=subprocess.DEVNULL, timeout=600)
        
        if os.path.exists(ruta_opt) and os.path.getsize(ruta_opt) > 0:
            return ruta_opt
        return ruta_entrada
    except Exception as e:
        print(f"⚠️ Pre-conversión/Recorte falló: {e}")
        return ruta_entrada

def limpiar_temporales():
    try:
        for f in os.listdir(AUDIO_DIR):
            if f.endswith('.wav') and ('_optimized' in f or '_trim_' in f or '_temp' in f):
                os.remove(os.path.join(AUDIO_DIR, f))
    except Exception:
        pass

def check_dependencies():
    return torch is None or whisper is None


@app.route("/api/health")
def health():
    return jsonify({
        "status": "ok",
        "uptime": round(time.time() - SERVER_START_TIME),
        "needs_install": check_dependencies(),
        "is_processing": STATE.get("is_processing", False) if STATE else False
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
    language = request.form.get('language', 'es') # Default es
    
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
    CURRENT_PROCESS = mp.Process(target=proceso_fondo, args=(save_path, filename, STATE, start_time, end_time, language))
    CURRENT_PROCESS.start()
    return jsonify({"success": True})

def proceso_fondo(ruta_audio, filename, estado, start_time, end_time, language):
    import traceback
    def log(msg):
        with open("child_debug.log", "a") as f: f.write(f"[{time.ctime()}] {msg}\n")
    
    try:
        estado["is_processing"] = True
        estado["completed"] = False
        estado["error"] = False
        estado["progress_percent"] = 5.0
        estado["current_filename"] = filename
        estado["status_text"] = "Preparando audio..."
        
        duracion = obtener_duracion_audio(ruta_audio)
        base = os.path.splitext(filename)[0]
        
        # 1. Pre-procesar (y recortar si es necesario)
        ruta_procesable = preconvertir_audio(ruta_audio, start_time, end_time)
        ruta_wav_temp = ruta_procesable if ruta_procesable != ruta_audio else None
        
        size_mb = os.path.getsize(ruta_procesable) / (1024 * 1024)
        model_size = "tiny" if size_mb > 30 else "base"
        
        # 2. Transcribir
        modelo = cargar_modelo(model_size)
        estado["status_text"] = f"Transcribiendo con IA ({language})..."
        estado["progress_percent"] = 20.0
        
        # Realizar transcripción directa
        # Whisper retorna segmentos con timestamps si no se indica lo contrario
        resultado = modelo.transcribe(ruta_procesable, language=language, fp16=False)
        texto = resultado["text"].strip()
        segments = resultado.get("segments", [])
        
        # 3. Guardar resultados
        # Guardamos tanto el texto puro como el JSON con segmentos (para partes)
        with open(os.path.join(AUDIO_DIR, base + ".json"), 'w', encoding='utf-8') as f:
            json.dump({
                "text_es": texto if language == "es" else "",
                "text_en": texto if language == "en" else "",
                "segments": segments,
                "language": language,
                "trimmed": (start_time is not None or end_time is not None)
            }, f, ensure_ascii=False, indent=2)
            
        with open(os.path.join(AUDIO_DIR, base + ".txt"), 'w', encoding='utf-8') as f:
            f.write(texto)

        estado["progress_percent"] = 100.0
        estado["completed"] = True
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
    for ext in ['.json', '.txt', '.mp3', '.wav', '.m4a']:
        filepath = os.path.join(AUDIO_DIR, safe_title + ext)
        if os.path.exists(filepath): os.remove(filepath)
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

@app.route("/api/gemini/transform", methods=["POST"])
def gemini_transform():
    import google.generativeai as genai
    data = request.json
    text_en = data.get("text_en", "")
    title = data.get("title", "Sermón")
    
    if not text_en:
        # Intentar cargar desde el archivo si no viene en el body
        safe_title = secure_filename(title)
        json_path = os.path.join(AUDIO_DIR, safe_title + ".json")
        if os.path.exists(json_path):
            with open(json_path, 'r', encoding='utf-8') as f:
                jdata = json.load(f)
                text_en = jdata.get("text_en", "")

    if not text_en:
        return jsonify({"success": False, "msg": "No hay texto en inglés para procesar."}), 400

    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        return jsonify({
            "success": False, 
            "msg": "Falta la clave de API de Gemini (GOOGLE_API_KEY). Configúrala en el servidor."
        }), 401

    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel('gemini-1.5-flash')
        
        prompt = f"""
        Eres un asistente experto en transcripción y adaptación de sermones bíblicos.
        Tu tarea es tomar la siguiente transcripción en inglés y transformarla en un guion de audio profesional en ESPAÑOL.

        Sigue estas reglas estrictamente:
        1. Extrae el sermón principal.
        2. Elimina:
           - Anuncios iniciales o introducciones no relacionadas con el mensaje bíblico.
           - Letras de canciones, himnos o coros musicales (si las hay).
           - Avisos finales, despedidas logísticas o anuncios de eventos.
        3. Edita y adapta el mensaje para que sea un guion de audio fluido, claro y profesional. No debe ser una traducción literal, sino una adaptación que mantenga la esencia y la profundidad del mensaje bíblico.
        4. El resultado final debe estar enteramente en ESPAÑOL.

        Transcripción original en inglés:
        ---
        {text_en}
        ---
        """
        
        response = model.generate_content(prompt)
        text_es = response.text.replace('```markdown', '').replace('```', '').strip()
        
        return jsonify({"success": True, "text_es": text_es})
    except Exception as e:
        print(f"❌ Error en Gemini: {str(e)}")
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
        communicate = edge_tts.Communicate(text_es, "es-CO-GonzaloNeural", rate="-20%")
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
        "current_filename": ""
    })

    limpiar_temporales()
    print("🚀 Servidor listo en http://127.0.0.1:5111")
    # Cambiado a 0.0.0.0 para acceso desde otros dispositivos y estabilidad
    app.run(host="0.0.0.0", port=5111, debug=False, threaded=True)
