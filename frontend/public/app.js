/* ============================================
   TRANSCRIPTOR PRO — APP LOGIC (SIMPLIFICADO)
   ============================================ */

let API_BASE = localStorage.getItem('server_url') || 
    ((window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') 
     ? window.location.origin 
     : 'http://127.0.0.1:5111');

// Cache settings
const SETTINGS = {
    serverUrl: localStorage.getItem('server_url') || 'http://127.0.0.1:5111'
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
    toastContainer: document.getElementById('toast-container'),
    languageSelect: document.getElementById('select-language'),
    modelSelect: document.getElementById('select-model'),
};

// Config del servidor (modelos disponibles, default, hardware)
let APP_CONFIG = null;

// ── Initialization ──
document.addEventListener('DOMContentLoaded', () => {
    setupUpload();
    setupUrl();
    setupRecord();
    setupSearch();
    cargarConfig();
    checkHealth();
    cargarTranscripciones();
    checkOllama();
    setInterval(checkHealth, 5000);
});

// Al cerrar la ventana, avisar al servidor para que se apague y libere la RAM/modelo.
// Si fue solo un "recargar", el siguiente latido (/api/health) cancela el apagado.
window.addEventListener('pagehide', () => {
    try { navigator.sendBeacon(`${API_BASE}/api/closing`); } catch (e) {}
});

// ── Cargar configuración del servidor (modelos, hardware) ──
async function cargarConfig() {
    try {
        const res = await fetch(`${API_BASE}/api/config`, { cache: 'no-store' });
        if (!res.ok) throw new Error('config no disponible');
        APP_CONFIG = await res.json();
    } catch (err) {
        APP_CONFIG = null;
    }
    poblarSelectorModelo();
}

function poblarSelectorModelo() {
    const sel = elements.modelSelect;
    if (!sel) return;

    // Fallback si el servidor no respondió
    const allowed = (APP_CONFIG && APP_CONFIG.allowed_models) || ['tiny', 'base', 'small', 'medium', 'large-v3'];
    const info = (APP_CONFIG && APP_CONFIG.model_info) || {};
    const serverDefault = (APP_CONFIG && APP_CONFIG.default_model) || 'tiny';
    const saved = localStorage.getItem('whisper_model');
    const seleccionado = (saved && allowed.includes(saved)) ? saved : serverDefault;

    sel.innerHTML = '';
    allowed.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m;
        const label = (info[m] && info[m].label) || m;
        opt.textContent = (m === serverDefault) ? `${label} — predeterminado` : label;
        if (m === seleccionado) opt.selected = true;
        sel.appendChild(opt);
    });

    actualizarHintModelo();
    sel.addEventListener('change', () => {
        localStorage.setItem('whisper_model', sel.value);
        actualizarHintModelo();
    });
}

function actualizarHintModelo() {
    const hint = document.getElementById('model-hint');
    if (!hint) return;
    const info = (APP_CONFIG && APP_CONFIG.model_info) || {};
    const m = elements.modelSelect ? elements.modelSelect.value : '';
    const ram = info[m] && info[m].ram_gb;
    const dev = APP_CONFIG && APP_CONFIG.device ? APP_CONFIG.device.toUpperCase() : '';
    let txt = ram ? `Necesita ~${ram} GB de RAM.` : '';
    if (dev) txt += ` Procesando en ${dev}.`;
    hint.textContent = txt.trim();
}


// ── Upload Setup ──
function setupUpload() {
    const zone = elements.uploadZone;
    const input = elements.fileInput;
    if (!zone || !input) return;

    // Solo abrir el selector de archivos al tocar el área vacía de la caja,
    // NO al tocar los desplegables, botones, inputs o etiquetas de configuración.
    zone.addEventListener('click', (e) => {
        if (e.target.closest('select, option, button, input, label, .settings-group')) return;
        input.click();
    });

    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', (e) => { e.preventDefault(); zone.classList.remove('drag-over'); });
    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        if (e.dataTransfer.files.length > 0) encolarArchivos(e.dataTransfer.files);
    });

    input.addEventListener('change', () => {
        if (input.files.length > 0) encolarArchivos(input.files);
        input.value = '';
    });
}

// ── Cola de archivos (varios audios, uno tras otro) ──
const UPLOAD_QUEUE = [];

function actualizarEstadoCola() {
    const el = document.getElementById('queue-status');
    if (!el) return;
    el.textContent = UPLOAD_QUEUE.length > 0
        ? `📦 En cola: ${UPLOAD_QUEUE.length} audio(s) más`
        : '';
}

function encolarArchivos(fileList) {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    UPLOAD_QUEUE.push(...files);
    if (files.length > 1 || isProcessing) {
        showToast('info', `${files.length} audio(s) agregados a la cola.`);
    }
    actualizarEstadoCola();
    procesarSiguienteDeCola();
}

function procesarSiguienteDeCola() {
    if (isProcessing || UPLOAD_QUEUE.length === 0) return;
    const file = UPLOAD_QUEUE.shift();
    actualizarEstadoCola();
    subirArchivo(file);
}

// ── Subir Archivo ──
async function subirArchivo(file) {
    if (isProcessing) { UPLOAD_QUEUE.unshift(file); actualizarEstadoCola(); return; }

    try {
        const formData = new FormData();
        formData.append('audiofile', file);

        // Idioma del audio (vacío = auto-detectar)
        const selectedLang = elements.languageSelect ? elements.languageSelect.value : 'es';
        formData.append('language', selectedLang);

        // Modelo de calidad elegido
        if (elements.modelSelect && elements.modelSelect.value) {
            formData.append('model', elements.modelSelect.value);
        }

        showToast('info', `Subiendo: ${file.name}`);
        const res = await fetch(`${API_BASE}/api/upload`, { method: 'POST', body: formData });
        const data = await res.json();

        if (data.success) {
            iniciarPollingProgreso();
        } else {
            showToast('error', data.msg || 'Error al subir.');
            procesarSiguienteDeCola();
        }
    } catch (err) {
        showToast('error', 'No se pudo conectar al servidor local.');
    }
}

// ── Transcribir desde un link (YouTube, etc.) ──
function setupUrl() {
    const btn = document.getElementById('btn-url');
    const input = document.getElementById('input-url');
    if (!btn || !input) return;
    const lanzar = async () => {
        const url = input.value.trim();
        if (!url) { showToast('error', 'Pega primero un link.'); return; }
        if (isProcessing) { showToast('error', 'Espera a que termine el audio actual.'); return; }
        btn.disabled = true;
        try {
            const res = await fetch(`${API_BASE}/api/upload_url`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url,
                    language: elements.languageSelect ? elements.languageSelect.value : 'es',
                    model: elements.modelSelect ? elements.modelSelect.value : ''
                })
            });
            const data = await res.json();
            if (data.success) {
                input.value = '';
                showToast('info', 'Descargando el audio del link…');
                iniciarPollingProgreso();
            } else {
                showToast('error', data.msg || 'No se pudo procesar el link.');
            }
        } catch (e) {
            showToast('error', 'Sin conexión con el servidor.');
        } finally {
            btn.disabled = false;
        }
    };
    btn.addEventListener('click', lanzar);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') lanzar(); });
}

// ── Grabar desde el micrófono ──
let mediaRecorder = null;
let recordChunks = [];

function setupRecord() {
    const btn = document.getElementById('btn-record');
    if (!btn) return;
    const toggle = async () => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
            return;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            recordChunks = [];
            mediaRecorder = new MediaRecorder(stream);
            mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordChunks.push(e.data); };
            mediaRecorder.onstop = () => {
                stream.getTracks().forEach(t => t.stop());
                btn.textContent = '🎙️ Grabar';
                btn.classList.remove('btn-danger');
                const blob = new Blob(recordChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
                if (blob.size < 1000) { showToast('error', 'Grabación demasiado corta.'); return; }
                const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
                const file = new File([blob], `Grabacion_${stamp}.webm`, { type: blob.type });
                encolarArchivos([file]);
            };
            mediaRecorder.start();
            btn.textContent = '⏹ Detener';
            btn.classList.add('btn-danger');
            showToast('info', 'Grabando… pulsa Fn (o el botón) para terminar.');
        } catch (e) {
            showToast('error', 'No hay permiso de micrófono. Revisa Ajustes del sistema → Privacidad → Micrófono.');
        }
    };
    btn.addEventListener('click', toggle);

    // Disparadores por teclado:
    //  - la app nativa llama a window.__toggleGrabacion() al presionar Fn
    //  - ⌘⇧R como respaldo dentro de la ventana
    window.__toggleGrabacion = toggle;
    document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'r' || e.key === 'R')) {
            e.preventDefault();
            toggle();
        }
    });
}

// ── Buscador en todas las transcripciones ──
function setupSearch() {
    const input = document.getElementById('input-search');
    if (!input) return;
    let timer = null;
    input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
            const q = input.value.trim();
            if (!q) { cargarTranscripciones(); return; }
            try {
                const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(q)}`);
                const resultados = await res.json();
                renderResultadosBusqueda(resultados, q);
            } catch (e) { /* servidor caído: no romper la UI */ }
        }, 300);
    });
}

function renderResultadosBusqueda(resultados, q) {
    const list = elements.transcriptionsList;
    if (!resultados.length) {
        list.innerHTML = `<div class="empty-state">Sin resultados para “${escapeHtmlApp(q)}”.</div>`;
        return;
    }
    list.innerHTML = '';
    resultados.forEach(r => {
        const card = document.createElement('div');
        card.className = 'transcription-card';
        card.innerHTML = `
            <div class="card-content">
                <div class="card-title"></div>
                <div class="card-meta search-snippet"></div>
            </div>`;
        card.querySelector('.card-title').textContent = r.title;
        card.querySelector('.search-snippet').textContent = r.snippet || '';
        card.querySelector('.card-content').addEventListener('click', () => abrirModal(r.title));
        list.appendChild(card);
    });
}

function escapeHtmlApp(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
                showToast('success', '¡Audio listo!');
                setTimeout(async () => {
                    elements.progressSection.style.display = 'none';
                    await cargarTranscripciones();
                    // Si hay más audios en cola, seguir con el próximo y no
                    // interrumpir con el modal; si era el último, abrir el resultado.
                    if (UPLOAD_QUEUE.length > 0) {
                        procesarSiguienteDeCola();
                    } else if (data.title) {
                        abrirModal(data.title);
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
    const elOverlay = document.getElementById('settings-overlay');

    if (elUrl) elUrl.value = SETTINGS.serverUrl;

    // Enlaces de descarga (endpoints dinámicos del servidor)
    const dlApp = document.getElementById('link-download-app');
    if (dlApp) dlApp.setAttribute('href', `${API_BASE}/api/package/app`);
    const dl = document.getElementById('link-download-mac');
    if (dl) dl.setAttribute('href', `${API_BASE}/api/package/mac`);

    // Info de la máquina del servidor actual
    const info = document.getElementById('server-machine-info');
    if (info && APP_CONFIG) {
        const ram = APP_CONFIG.total_ram_gb ? `${APP_CONFIG.total_ram_gb} GB RAM` : '';
        const dev = APP_CONFIG.device ? APP_CONFIG.device.toUpperCase() : '';
        const def = APP_CONFIG.default_model || '';
        const eng = APP_CONFIG.engine || '';
        info.textContent = `Servidor actual: ${dev}${ram ? ' · ' + ram : ''} · motor: ${eng} · modelo por defecto: ${def}`;
    }

    if (elOverlay) elOverlay.style.display = 'flex';
}

function cerrarSettings() {
    document.getElementById('settings-overlay').style.display = 'none';
}

function guardarSettings() {
    const newUrl = document.getElementById('input-server-url').value.trim();

    if (newUrl) {
        localStorage.setItem('server_url', newUrl);
        SETTINGS.serverUrl = newUrl;
        API_BASE = newUrl;
    }

    showToast('success', 'Configuración guardada. Reiniciando conexión...');
    cerrarSettings();
    checkHealth();
    cargarTranscripciones();
}

// ── Buscar actualización (descarga última versión desde GitHub) ──
async function buscarActualizacion() {
    const btn = document.getElementById('btn-actualizar');
    const status = document.getElementById('update-status');
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = '🔄 Buscando…';
    if (status) status.textContent = 'Descargando última versión…';
    try {
        const res = await fetch(`${API_BASE}/api/update`, { method: 'POST' });
        const data = await res.json();

        if (data.errors && data.errors.length) {
            if (status) status.textContent = 'Error: ' + data.errors.join(' · ');
            showToast('error', 'No se pudo actualizar del todo.');
            return;
        }
        if (!data.updated || data.updated.length === 0) {
            if (status) status.textContent = '✅ Ya tienes la última versión.';
            showToast('success', 'Ya estás al día.');
            return;
        }
        if (data.needs_restart) {
            if (status) status.textContent = `✅ Actualizados ${data.updated.length} archivos. Cierra la ventana negra (Terminal) y vuelve a abrir "Transcriptor_Facil.command" para aplicar los cambios.`;
            showToast('success', '¡Actualizado! Reinicia el servidor para terminar.');
        } else {
            if (status) status.textContent = '✅ Actualizado. Recargando…';
            showToast('success', '¡Actualizado! Recargando…');
            setTimeout(() => location.reload(), 1200);
        }
    } catch (e) {
        if (status) status.textContent = 'No se pudo conectar para actualizar.';
        showToast('error', 'Sin conexión para actualizar.');
    } finally {
        btn.disabled = false;
        btn.textContent = orig;
    }
}

// ── Modal ──
let currentAudioUrl = '';

async function abrirModal(title) {
    currentTitle = title;
    elements.modalTitle.textContent = title;

    try {
        const res = await fetch(`${API_BASE}/api/audios`);
        const audios = await res.json();
        const audio = audios.find(a => a.title === title);
        
        if (audio) {
            // Mostramos la transcripción (text_es si existe, si no el texto original).
            elements.textareaEs.value = audio.text_es || audio.text_en || '';
        }
    } catch (err) { }

    // Limpiar el panel de IA local del audio anterior
    const ollamaOut = document.getElementById('ollama-result');
    if (ollamaOut) { ollamaOut.value = ''; ollamaOut.style.display = 'none'; }
    const chatInput = document.getElementById('ollama-chat-input');
    if (chatInput) chatInput.value = '';

    elements.modalOverlay.style.display = 'flex';
}

function cerrarModal() {
    elements.modalOverlay.style.display = 'none';
}

// ── Traducir (Google Translate libre, sin Gemini) ──
async function traducir() {
    const btn = document.getElementById('btn-traducir');
    const texto = elements.textareaEs.value.trim();
    if (!texto) {
        showToast('error', 'No hay texto para traducir.');
        return;
    }

    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = '🌐 Traduciendo…';
    try {
        const res = await fetch(`${API_BASE}/api/translate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: texto, target: 'es' })
        });
        const data = await res.json();
        if (data.success && data.text) {
            elements.textareaEs.value = data.text;
            showToast('success', '¡Traducido a español!');
        } else {
            showToast('error', data.msg || 'No se pudo traducir.');
        }
    } catch (err) {
        showToast('error', 'No se pudo conectar para traducir.');
    } finally {
        btn.disabled = false;
        btn.textContent = original;
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

function showToast(type, msg) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    elements.toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

async function borrarTranscripcion(event, title) {
    if (event) event.stopPropagation();
    if (!confirm(`¿Estás seguro de borrar "${title}"?`)) return;
    
    try {
        const res = await fetch(`${API_BASE}/api/audios/${encodeURIComponent(title)}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            showToast('success', 'Audio borrado');
            cargarTranscripciones();
        }
    } catch (err) {
        showToast('error', 'Error al borrar');
    }
}

// ── Exportar (txt/docx/pdf) y subtítulos (srt/vtt) ──
function toggleExportMenu(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('export-menu');
    if (menu) menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}

document.addEventListener('click', (e) => {
    const menu = document.getElementById('export-menu');
    if (menu && menu.style.display !== 'none' && !e.target.closest('#export-menu, #btn-export-menu')) {
        menu.style.display = 'none';
    }
});

function exportar(fmt) {
    if (!currentTitle) return;
    toggleExportMenu();
    window.location.href = `${API_BASE}/api/audios/${encodeURIComponent(currentTitle)}/export?fmt=${fmt}`;
}

async function descargarSubs(fmt) {
    if (!currentTitle) return;
    toggleExportMenu();
    // Verificar primero que existan timestamps (si no, avisar bonito)
    try {
        const res = await fetch(`${API_BASE}/api/audios/${encodeURIComponent(currentTitle)}/subtitles?fmt=${fmt}`);
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            showToast('error', data.msg || 'No se pudieron generar los subtítulos.');
            return;
        }
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${currentTitle}.${fmt}`;
        a.click();
        URL.revokeObjectURL(a.href);
    } catch (e) {
        showToast('error', 'Sin conexión con el servidor.');
    }
}

// ── IA local (Ollama) ──
let OLLAMA_AVAILABLE = false;

async function checkOllama() {
    try {
        const res = await fetch(`${API_BASE}/api/ollama/status`, { cache: 'no-store' });
        const data = await res.json();
        OLLAMA_AVAILABLE = !!(data.available && data.models && data.models.length);
        const panel = document.getElementById('ollama-panel');
        if (panel) panel.style.display = OLLAMA_AVAILABLE ? '' : 'none';
        const label = document.getElementById('ollama-model-label');
        if (label && OLLAMA_AVAILABLE) label.textContent = `(${data.models[0]})`;
    } catch (e) { OLLAMA_AVAILABLE = false; }
}

async function correrOllama(accion, pregunta) {
    const out = document.getElementById('ollama-result');
    if (!currentTitle || !out) return;
    out.style.display = '';
    out.value = '✨ Pensando… (la primera vez puede tardar mientras carga el modelo)';
    try {
        const res = await fetch(`${API_BASE}/api/ollama/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: accion, title: currentTitle, question: pregunta || '' })
        });
        const data = await res.json();
        if (data.success) {
            out.value = data.text;
            // El título generado se ofrece aplicar de una
            if (accion === 'titulo' && data.text && data.text.length < 120) {
                if (confirm(`¿Renombrar el audio a:\n"${data.text}"?`)) {
                    const res2 = await fetch(`${API_BASE}/api/audios/${encodeURIComponent(currentTitle)}/rename`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ new_title: data.text })
                    });
                    const d2 = await res2.json();
                    if (d2.success) {
                        showToast('success', 'Renombrado.');
                        currentTitle = data.text;
                        elements.modalTitle.textContent = data.text;
                        cargarTranscripciones();
                    }
                }
            }
        } else {
            out.value = `⚠️ ${data.msg || 'La IA local no respondió.'}`;
        }
    } catch (e) {
        out.value = '⚠️ Sin conexión con la IA local.';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.btn-ia').forEach(btn => {
        btn.addEventListener('click', () => correrOllama(btn.dataset.accion));
    });
    const chatBtn = document.getElementById('btn-ollama-chat');
    const chatInput = document.getElementById('ollama-chat-input');
    if (chatBtn && chatInput) {
        const preguntar = () => {
            const q = chatInput.value.trim();
            if (!q) { showToast('error', 'Escribe una pregunta.'); return; }
            correrOllama('chat', q);
        };
        chatBtn.addEventListener('click', preguntar);
        chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') preguntar(); });
    }
});

async function renombrarTranscripcion(event, title) {
    if (event) event.stopPropagation();
    const newTitle = prompt('Nuevo nombre para el audio:', title);
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
