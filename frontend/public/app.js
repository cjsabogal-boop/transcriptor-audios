/* ============================================
   TRANSCRIPTOR PRO — APP LOGIC (SIMPLIFICADO)
   ============================================ */

let API_BASE = localStorage.getItem('server_url') || 
    ((window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') 
     ? window.location.origin 
     : 'http://127.0.0.1:5111');

// Cache settings
const SETTINGS = {
    serverUrl: localStorage.getItem('server_url') || 'http://127.0.0.1:5111',
    geminiKey: localStorage.getItem('gemini_key') || 'AIzaSyAuVDK8IlqXUGjbInpsiNqd7zkQNVKdfc0'
};

let currentTitle = null;
let isProcessing = false;

// ── DOM Elements ──
const elements = {
    uploadZone: document.getElementById('upload-zone'),
    fileInput: document.getElementById('file-input'),
    progressSection: document.getElementById('progress-section'),
    progressBar: document.getElementById('progress-bar'),
    progressTitle: document.getElementById('progress-title'),
    progressStatus: document.getElementById('progress-status'),
    transcriptionsList: document.getElementById('transcriptions-list'),
    statusIndicator: document.getElementById('status-indicator'),
    connectionStatus: document.getElementById('connection-status'),
    modalOverlay: document.getElementById('modal-overlay'),
    modalTitle: document.getElementById('modal-title'),
    textareaEs: document.getElementById('textarea-es'),
    readonlyEn: document.getElementById('readonly-en'),
    ttsPlayer: document.getElementById('tts-player'),
    toastContainer: document.getElementById('toast-container'),
    languageSelect: document.getElementById('select-language'),
};

// ── Initialization ──
document.addEventListener('DOMContentLoaded', () => {
    setupUpload();
    checkHealth();
    cargarTranscripciones();
    setInterval(checkHealth, 5000);
});

// ── Upload Setup ──
function setupUpload() {
    const zone = elements.uploadZone;
    const input = elements.fileInput;
    if (!zone || !input) return;

    zone.addEventListener('click', () => input.click());

    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', (e) => { e.preventDefault(); zone.classList.remove('drag-over'); });
    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        if (e.dataTransfer.files.length > 0) subirArchivo(e.dataTransfer.files[0]);
    });

    input.addEventListener('change', () => {
        if (input.files.length > 0) subirArchivo(input.files[0]);
        input.value = '';
    });
}

// ── Subir Archivo ──
async function subirArchivo(file) {
    if (isProcessing) { showToast('error', 'Ya hay un proceso en marcha.'); return; }
    
    try {
        const formData = new FormData();
        formData.append('audiofile', file);
        // Usar selector de idioma (default 'en' si no hay nada o es vacío)
        const selectedLang = elements.languageSelect ? elements.languageSelect.value : 'en';
        formData.append('language', selectedLang || 'en');

        showToast('info', 'Subiendo sermón...');
        const res = await fetch(`${API_BASE}/api/upload`, { method: 'POST', body: formData });
        const data = await res.json();

        if (data.success) {
            iniciarPollingProgreso();
        } else {
            showToast('error', data.msg || 'Error al subir.');
        }
    } catch (err) {
        showToast('error', 'No se pudo conectar al servidor local.');
    }
}

// ── Health Check ──
async function checkHealth() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        
        const res = await fetch(`${API_BASE}/api/health`, { 
            signal: controller.signal,
            cache: 'no-store'  // No usar cache del browser
        });
        clearTimeout(timeoutId);
        
        if (!res.ok) throw new Error('Response not ok');
        const data = await res.json();
        
        // Validar que realmente sea nuestro servidor
        if (data && data.status === 'ok') {
            elements.statusIndicator.className = 'status-indicator connected';
            elements.connectionStatus.textContent = 'Servidor activo ✓';
        } else {
            throw new Error('Invalid response');
        }
    } catch (err) {
        elements.statusIndicator.className = 'status-indicator error';
        // Mensaje más claro según si estamos en hosting o local
        const isHosted = !['localhost', '127.0.0.1'].includes(window.location.hostname);
        elements.connectionStatus.textContent = isHosted 
            ? 'Servidor local no detectado' 
            : 'Sin conexión al servidor';
    }
}

// ── Polling de Progreso ──
function iniciarPollingProgreso() {
    isProcessing = true;
    elements.progressSection.style.display = 'block';
    
    const interval = setInterval(async () => {
        try {
            const res = await fetch(`${API_BASE}/api/status`);
            const data = await res.json();
            
            const pct = Math.round(data.progress_percent || 0);
            elements.progressBar.style.width = pct + '%';
            elements.progressStatus.textContent = `${data.status_text || 'Procesando...'} (${pct}%)`;

            if (data.completed || pct >= 100) {
                clearInterval(interval);
                isProcessing = false;
                showToast('success', '¡Sermón listo!');
                setTimeout(async () => { 
                    elements.progressSection.style.display = 'none'; 
                    await cargarTranscripciones(); 
                    // Abrir automáticamente y adaptar
                    if (data.title) {
                        abrirModal(data.title);
                        setTimeout(adaptarConGemini, 1000);
                    }
                }, 2000);
            }
        } catch (err) {
            clearInterval(interval);
            isProcessing = false;
        }
    }, 2000);
}

// ── Cargar Transcripciones ──
async function cargarTranscripciones() {
    try {
        const res = await fetch(`${API_BASE}/api/audios`);
        const audios = await res.json();
        
        if (audios.length === 0) {
            elements.transcriptionsList.innerHTML = '<div class="empty-state">No hay audios procesados.</div>';
            return;
        }

        elements.transcriptionsList.innerHTML = '';
        audios.forEach(audio => {
            const card = document.createElement('div');
            card.className = 'transcription-card';
            card.innerHTML = `
                <div class="card-content" onclick="abrirModal('${audio.title}')">
                    <div class="card-title">${audio.title}</div>
                    <div class="card-meta">📅 ${new Date(audio.date * 1000).toLocaleDateString()}</div>
                </div>
                <div class="card-actions">
                    <button class="btn-icon" onclick="renombrarTranscripcion(event, '${audio.title}')" title="Renombrar">✏️</button>
                    <button class="btn-icon btn-danger" onclick="borrarTranscripcion(event, '${audio.title}')" title="Borrar">🗑️</button>
                </div>
            `;
            elements.transcriptionsList.appendChild(card);
        });
    } catch (err) {
        console.error('Error cargando lista');
    }
}

// ── Settings ──
function abrirSettings() {
    const elUrl = document.getElementById('input-server-url');
    const elKey = document.getElementById('input-gemini-key');
    const elOverlay = document.getElementById('settings-overlay');
    
    if (elUrl) elUrl.value = SETTINGS.serverUrl;
    if (elKey) elKey.value = SETTINGS.geminiKey;
    if (elOverlay) elOverlay.style.display = 'flex';
}

function cerrarSettings() {
    document.getElementById('settings-overlay').style.display = 'none';
}

function guardarSettings() {
    const newUrl = document.getElementById('input-server-url').value.trim();
    const newKey = document.getElementById('input-gemini-key').value.trim();
    
    if (newUrl) {
        localStorage.setItem('server_url', newUrl);
        SETTINGS.serverUrl = newUrl;
        API_BASE = newUrl;
    }
    localStorage.setItem('gemini_key', newKey);
    SETTINGS.geminiKey = newKey;
    
    showToast('success', 'Configuración guardada. Reiniciando conexión...');
    cerrarSettings();
    checkHealth();
    cargarTranscripciones();
}

// ── Modal ──
let currentAudioUrl = '';

async function abrirModal(title) {
    currentTitle = title;
    elements.modalTitle.textContent = title;
    
    // Reset audio player and download button
    elements.ttsPlayer.style.display = 'none';
    elements.ttsPlayer.src = '';
    currentAudioUrl = '';
    const btnDescargar = document.getElementById('btn-descargar-audio');
    if (btnDescargar) btnDescargar.style.display = 'none';
    
    try {
        const res = await fetch(`${API_BASE}/api/audios`);
        const audios = await res.json();
        const audio = audios.find(a => a.title === title);
        
        if (audio) {
            elements.textareaEs.value = audio.text_es || '';
            elements.readonlyEn.textContent = audio.text_en || '(Sin texto original)';
        }
    } catch (err) { }

    elements.modalOverlay.style.display = 'flex';
}

function cerrarModal() {
    elements.modalOverlay.style.display = 'none';
}

function cleanGeminiOutput(text) {
    if (!text) return "";
    // Eliminar introducciones típicas "Claro / Aquí tienes / Adaptado..."
    let clean = text.replace(/^.*claro,.*aquí tienes.*:\s*/i, '');
    clean = clean.replace(/^.*adaptado del sermón.*:\s*/i, '');
    clean = clean.replace(/^.*aquí está la adaptación.*:\s*/i, '');
    
    // Eliminar formatting Markdown
    clean = clean.replace(/\*\*/g, ''); // Negritas
    clean = clean.replace(/---/g, ''); // Líneas divisorias
    clean = clean.replace(/^\s*[\-\*]\s+/gm, ''); // Viñetas
    clean = clean.replace(/#/g, ''); // Encabezados
    
    return clean.trim();
}

// ── Gemini ──
async function adaptarConGemini() {
    const btn = document.getElementById('btn-gemini-adaptar');
    const originalText = elements.readonlyEn.textContent;
    
    if (!originalText || originalText.includes('(Sin texto')) {
        showToast('error', 'No hay texto original para adaptar.');
        return;
    }

    btn.disabled = true;
    btn.textContent = '✨ Adaptando...';

    const SERMON_PROMPT = `Eres un editor profesional de contenido cristiano en español. Tu tarea es tomar la siguiente transcripción de un sermón y producir un guion de audio fluido, claro y profesional en español.

INSTRUCCIONES OBLIGATORIAS:
1. ELIMINA completamente: anuncios iniciales, letras de canciones, avisos finales, saludos de bienvenida al servicio, instrucciones logísticas.
2. ENFÓCATE EXCLUSIVAMENTE en el mensaje bíblico/sermón principal.
3. Si el texto original está en inglés, tradúcelo al español de forma natural y fluida.
4. Adapta el texto para que suene natural al ser LEÍDO EN VOZ ALTA (es un guion de audio).
5. Mantén las citas bíblicas y referencias escriturales.
6. Usa un tono cálido, cercano y pastoral.

REGLAS DE FORMATO:
- Devuelve ÚNICAMENTE el texto adaptado, listo para leer.
- NO incluyas introducciones como 'Aquí tienes...', 'Claro...', 'A continuación...'.
- NO uses formato Markdown (**, ##, ---, viñetas).
- Solo texto puro, párrafos separados por líneas en blanco.

TRANSCRIPCIÓN ORIGINAL:
${originalText}`;

    try {
        // Intento 1: Servidor Local/Configurado
        try {
            const res = await fetch(`${API_BASE}/api/gemini/transform`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: currentTitle, text_en: originalText })
            });
            const data = await res.json();
            if (data.success && data.text_es) {
                elements.textareaEs.value = cleanGeminiOutput(data.text_es);
                showToast('success', '¡Adaptación con Gemini lista! ✨');
                return;
            }
        } catch (err) {
            console.warn("Fallo servidor para Gemini, intentando fallback...");
        }

        // Intento 2: Fallback Directo con API Key
        if (SETTINGS.geminiKey) {
            try {
                showToast('info', 'Usando Gemini Direct...');
                const googleUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${SETTINGS.geminiKey}`;
                const res = await fetch(googleUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: SERMON_PROMPT }] }]
                    })
                });
                const data = await res.json();
                const textEsRaw = data.candidates?.[0]?.content?.parts?.[0]?.text;
                if (textEsRaw) {
                    elements.textareaEs.value = cleanGeminiOutput(textEsRaw);
                    showToast('success', '¡Adaptación Gemini Directa exitosa! ✨');
                    return;
                }
            } catch (err) {
                console.error("Fallo total en Gemini:", err);
            }
        }

        showToast('error', 'No se pudo conectar con Gemini. Verifica la configuración.');
    } finally {
        btn.disabled = false;
        btn.textContent = '✨ Adaptar con Gemini Cloud';
    }
}

// ── Save & Delete (Omitidos los extensos pero incluido lo básico) ──
async function guardarEdicion() {
    try {
        await fetch(`${API_BASE}/api/audios/${encodeURIComponent(currentTitle)}/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text_es: elements.textareaEs.value })
        });
        showToast('success', 'Guardado.');
        cerrarModal();
        cargarTranscripciones();
    } catch (err) { }
}

async function generarTTS() {
    const btn = document.getElementById('btn-generar-audio');
    try {
        btn.disabled = true;
        btn.textContent = '🔊 Generando...';
        const res = await fetch(`${API_BASE}/api/audios/${encodeURIComponent(currentTitle)}/tts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text_es: elements.textareaEs.value })
        });
        const data = await res.json();
        if (data.success) {
            currentAudioUrl = `${API_BASE}${data.download_url}`;
            elements.ttsPlayer.src = currentAudioUrl;
            elements.ttsPlayer.style.display = 'block';
            elements.ttsPlayer.play();
            
            const btnDescargar = document.getElementById('btn-descargar-audio');
            if (btnDescargar) btnDescargar.style.display = 'inline-block';
        }
    } catch (err) { } finally {
        btn.disabled = false;
        btn.textContent = '🔊 Oír en Español (Gerardo)';
    }
}

function showToast(type, msg) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    elements.toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// ── Descargar Audio ──
async function descargarAudio() {
    if (!currentAudioUrl) {
        return showToast('error', 'No hay audio generado para descargar');
    }
    
    // Suggested filename based on sermon title
    const defaultName = `${currentTitle}_español_gerardo.mp3`;
    const newName = prompt('Ingresa un nombre para tu audio:', defaultName);
    
    // User cancelled
    if (!newName) return;
    
    let finalName = newName.trim();
    if (!finalName.toLowerCase().endsWith('.mp3')) {
        finalName += '.mp3';
    }

    try {
        showToast('info', 'Preparando descarga...');
        const response = await fetch(currentAudioUrl);
        if (!response.ok) throw new Error('Error al obtener el audio');
        
        const blob = await response.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = downloadUrl;
        a.download = finalName;
        document.body.appendChild(a);
        
        a.click();
        
        // Clean up
        window.URL.revokeObjectURL(downloadUrl);
        document.body.removeChild(a);
        
        showToast('success', '¡Audio descargado con éxito!');
    } catch (err) {
        showToast('error', 'Error al descargar el audio');
        console.error("Download Error:", err);
    }
}

async function borrarTranscripcion(event, title) {
    if (event) event.stopPropagation();
    if (!confirm(`¿Estás seguro de borrar "${title}"?`)) return;
    
    try {
        const res = await fetch(`${API_BASE}/api/audios/${encodeURIComponent(title)}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            showToast('success', 'Sermón borrado');
            cargarTranscripciones();
        }
    } catch (err) {
        showToast('error', 'Error al borrar');
    }
}

async function renombrarTranscripcion(event, title) {
    if (event) event.stopPropagation();
    const newTitle = prompt('Nuevo nombre para el sermón:', title);
    if (!newTitle || newTitle === title) return;

    try {
        const res = await fetch(`${API_BASE}/api/audios/${encodeURIComponent(title)}/rename`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ new_title: newTitle })
        });
        const data = await res.json();
        if (data.success) {
            showToast('success', 'Renombrado con éxito');
            cargarTranscripciones(); // Recarga la lista para ver el cambio
        } else {
            showToast('error', data.msg || 'Error al renombrar');
        }
    } catch (err) {
        showToast('error', 'Error de conexión');
    }
}
