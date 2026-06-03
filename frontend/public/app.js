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
    cargarConfig();
    checkHealth();
    cargarTranscripciones();
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

        // Idioma del audio (vacío = auto-detectar)
        const selectedLang = elements.languageSelect ? elements.languageSelect.value : 'es';
        formData.append('language', selectedLang);

        // Modelo de calidad elegido
        if (elements.modelSelect && elements.modelSelect.value) {
            formData.append('model', elements.modelSelect.value);
        }

        showToast('info', 'Subiendo audio…');
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
                showToast('success', '¡Audio listo!');
                setTimeout(async () => { 
                    elements.progressSection.style.display = 'none'; 
                    await cargarTranscripciones(); 
                    // Abrir el resultado con la transcripción lista.
                    // La traducción es opcional (botón "Traducir" en el modal).
                    if (data.title) {
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
