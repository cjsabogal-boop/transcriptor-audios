# Transcriptor de Audios

App privada para transcribir audios (Whisper local) y adaptarlos con Gemini. Sirve para podcasts, charlas, entrevistas, audios personales y también contenido cristiano (modo sermón opcional).

- **Frontend web:** `https://transcriptor-audios.web.app` (Firebase Hosting)
- **Backend local:** `server.py` (Flask + Whisper) corriendo en `127.0.0.1:5111` en el Mac del usuario
- **Hardware objetivo:** MacBook Air M1 8 GB → modelo Whisper `tiny` + limpieza con Gemini Cloud
- **Proyecto Firebase:** `transcriptor-hernando-2026` (no cambia; solo el site de hosting se renombra)

## Arquitectura

```
[Usuario] ──> https://transcriptor-audios.web.app   (Firebase Hosting + Auth)
                          │
                          └─ fetch /api/* ──> http://127.0.0.1:5111   (Flask local)
                                                          │
                                                          ├─ Whisper "tiny" (CPU)
                                                          ├─ Gemini 2.5 Flash Lite (cloud)
                                                          └─ Edge TTS (cloud, voz es-CO Gonzalo)
```

Cada usuario corre su propio servidor local haciendo doble clic en `Transcriptor_Facil.command`.

## Modos de adaptación

Al subir un audio y al adaptar con IA puedes elegir cómo transformarlo:

| Modo | Para qué sirve |
|---|---|
| **General** (default) | Podcast, charla, conferencia, audio personal — limpia muletillas y traduce |
| **Entrevista** | Detecta hablantes y formatea como diálogo |
| **Resumen** | Sintetiza en idea principal + puntos clave + cierre |
| **Sermón** | Contenido cristiano — quita anuncios, mantiene citas bíblicas, tono pastoral |
| **Literal** | Conserva todo, solo corrige errores de transcripción |

El modo se puede cambiar después también desde el modal de detalle (re-adaptar con otro modo).

## Login

Google Sign-In con lista de emails autorizados en Firestore (colección `authorized_emails`).

- **Super admin:** `cjsabogal@gmail.com` — hardcodeado en `frontend/public/index.html`. Siempre tiene acceso aunque Firestore esté vacío. Sirve como bootstrap.
- **Admins:** docs en `authorized_emails` con `isAdmin: true`. Pueden agregar/quitar emails desde el botón 👥 en el header.
- **Usuarios:** docs en `authorized_emails` con `isAdmin: false`.

Cuando un email no autorizado intenta entrar, ve "La cuenta X no está autorizada" y se le ofrece cerrar sesión.

## Despliegue (automático con GitHub Actions)

El deploy es **automático**: cada `push` a `main` publica el hosting y las reglas de Firestore
mediante `.github/workflows/deploy.yml`. No necesitas terminal ni `firebase-tools` en el Mac.

> También puedes lanzarlo a mano desde GitHub → pestaña **Actions** → *Deploy a Firebase Hosting + Firestore* → **Run workflow**.

### Setup inicial (una sola vez)

Estos pasos humanos solo se hacen una vez. Después, todo es automático con cada push.

#### A. Crear el Service Account y guardar el secret en GitHub

1. Consola Firebase → ⚙️ **Configuración del proyecto → Cuentas de servicio**:
   https://console.firebase.google.com/project/transcriptor-hernando-2026/settings/serviceaccounts/adminsdk
2. **Generar nueva clave privada** → se descarga un archivo `.json`.
3. En GitHub: repo → **Settings → Secrets and variables → Actions → New repository secret**.
   - **Name:** `FIREBASE_SERVICE_ACCOUNT_TRANSCRIPTOR_HERNANDO_2026`
   - **Value:** pega el **contenido completo** del `.json` descargado.
4. Listo. Borra el `.json` de tu Mac por seguridad.

#### B. Crear el Hosting site `transcriptor-audios` (una vez)

1. Consola Firebase del proyecto: https://console.firebase.google.com/project/transcriptor-hernando-2026/hosting/sites
2. **Add another site** → Site ID: `transcriptor-audios`.
   - Si el ID ya está tomado globalmente, elige otro (`transcriptor-audios-cjs`, etc.) y actualiza `firebase.json` y los `.command`.
3. (Opcional) Borrar el site viejo `transcriptor-hernando-2026` desde la misma página.

#### C. Habilitar Google Sign-In (una vez)

1. https://console.firebase.google.com/project/transcriptor-hernando-2026/authentication/providers
2. **Authentication → Sign-in method** → habilitar **Google**.
3. En **Authorized domains** agregar: `transcriptor-audios.web.app` y `transcriptor-audios.firebaseapp.com`. Para pruebas locales agrega `localhost`.

#### D. Mover el dominio personalizado al site nuevo (una vez)

`audio.palabraquetransforma.com` hoy apunta al site viejo. Para reapuntarlo:
1. https://console.firebase.google.com/project/transcriptor-hernando-2026/hosting/sites
2. Entra al site **`transcriptor-audios`** → **Add custom domain** → `audio.palabraquetransforma.com`.
3. Sigue las instrucciones de DNS (probablemente ya estén; Firebase reconoce el dominio).
4. Quita el dominio del site viejo `transcriptor-hernando-2026`.

### Reglas de Firestore y hosting

Ya **no** se deployan a mano: el workflow corre `firebase deploy --only hosting,firestore:rules`
en cada push. Edita `firestore.rules` o `frontend/public/`, haz push, y se publica solo.

### Inicializar super admin en Firestore (opcional)

Ya entras sin necesitar el doc (está hardcodeado). Pero para verlo en el listado del panel admin, crea manualmente:
- Colección: `authorized_emails`
- ID: `cjsabogal@gmail.com`
- Campos: `email: "cjsabogal@gmail.com"`, `isAdmin: true`

## Uso

1. Doble clic en `Transcriptor_Facil.command`.
2. La primera vez instala Homebrew, Python, FFmpeg, PyTorch, Whisper, EdgeTTS, Google Generative AI (10–15 min).
3. Cuando termine, abre `https://transcriptor-audios.web.app`.
4. Login con Google.
5. Arrastrar audio → elegir idioma y modo → transcripción → adaptación con IA → TTS español opcional.

## Estructura

```
transcriptor-audios/
├── server.py                          # Flask + Whisper + Gemini (con modos)
├── run_server.sh                      # Bootstrap deps + arranca server.py
├── Transcriptor_Facil.command         # Doble-clic para usuarios finales
├── firebase.json                      # Hosting + firestore (apunta a transcriptor-audios)
├── firestore.rules                    # Reglas de seguridad (admin allowlist)
├── firestore.indexes.json             # Índices
├── frontend/
│   ├── firebase.json                  # Config alterna (deploy desde frontend/)
│   └── public/                        # ← lo que se sube a Hosting
│       ├── index.html                 # Login + UI + selector de modos
│       ├── app.js                     # Lógica + prompts por modo
│       ├── styles.css
│       └── TranscriptorMac.zip        # Bundle descargable
└── docx_to_txt.py, extract_all.py, merge_data.py  # Utilidades varias
```
