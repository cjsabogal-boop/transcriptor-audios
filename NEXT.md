# NEXT — Pendientes Transcriptor de Audios

## 🔴 Bloqueante para que la nueva URL + login funcionen en producción

- [ ] **Crear el Hosting site `transcriptor-audios`** en consola Firebase.
      Si el ID está tomado globalmente, elige otro y actualiza `firebase.json` + los 2 `.command`.
      URL: https://console.firebase.google.com/project/transcriptor-hernando-2026/hosting/sites
- [ ] **Borrar el site viejo `transcriptor-hernando-2026`** (decidiste solo dejar el nuevo).
- [ ] **Habilitar Google Sign-In** en consola Firebase (Auth → Providers → Google).
      Sin esto, el botón "Entrar con Google" falla con `auth/operation-not-allowed`.
      URL: https://console.firebase.google.com/project/transcriptor-hernando-2026/authentication/providers
- [ ] **Agregar `transcriptor-audios.web.app` y `transcriptor-audios.firebaseapp.com`** en
      Authentication → Settings → Authorized domains.
- [ ] **Deployar `firestore.rules`** (pegar contenido en consola → Publicar).
      Las reglas actuales en producción son `allow read, write: if true` — abierto a cualquiera.
      URL: https://console.firebase.google.com/project/transcriptor-hernando-2026/firestore/rules
- [ ] **Deployar el `frontend/public/` al site nuevo.**
      Hoy lo desplegado sigue siendo la versión con contraseña en el dominio viejo.
- [ ] **(Opcional)** Crear doc `authorized_emails/cjsabogal@gmail.com` con `isAdmin: true`
      en Firestore (manualmente desde consola) — solo para que aparezcas en la lista del panel admin.

## 🟡 Próximas tareas razonables

- [ ] **Servidor local accesible para terceros.** Hoy el web app llama a `http://127.0.0.1:5111`,
      o sea cada Mac corre su propio server. Si quieres que otra persona use el transcriptor
      sin instalar nada, expón tu server con ngrok/Cloudflare Tunnel y guarda la URL HTTPS
      en localStorage (el botón ⚙️ ya tiene el campo "API URL").
- [ ] **Auth en el server local.** `server.py` escucha en `0.0.0.0:5111` sin auth.
      Si lo expones a internet, agrega un token Bearer compartido en la app.
- [ ] **Persistir `mode` por audio.** Hoy el modo se elige al subir pero no se guarda en el JSON
      del audio. Si reabres el modal, el selector vuelve a "General". Guardar `mode` en el JSON
      y precargar al abrir.
- [ ] **Hardware:** el M1 8 GB usa modelo `tiny`. Para mejorar calidad probar `base`
      (~7x realtime, mismo RAM). `small` y arriba no caben cómodamente.
- [ ] **Rotar API key de Gemini hardcodeada** en `app.js:13` (`AIzaSyAuVDK8IlqXUGjbInpsiNqd7zkQNVKdfc0`).
      Pasarla solo por env del server o por configuración del usuario.

## 🟢 Mejoras futuras

- [ ] Mover lista de "voces TTS" a settings (hoy `es-CO-GonzaloNeural` fijo en server.py).
- [ ] Permitir subir múltiples audios en cola.
- [ ] Histórico de quién accedió y cuándo (log en Firestore opcional).
- [ ] Consolidar `firebase.json` (hay uno en raíz y otro en `frontend/`) — decidir cuál es el canónico y borrar el otro.
- [ ] Detección automática del tipo de contenido (proponer modo según las primeras líneas).
