// Transcriptor — app nativa de macOS (Cocoa + WKWebView).
// Ventana propia (no Chrome), puntito en el Dock, arranca/apaga el servidor Python.
import Cocoa
import WebKit
import AVFoundation
import ApplicationServices

let SERVER_URL = "http://127.0.0.1:5111"

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, AVAudioRecorderDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var serverProc: Process?
    var loadingLabel: NSTextField!

    // ── Dictado universal (tecla Fn en cualquier app) ──
    var audioRecorder: AVAudioRecorder?
    var dictadoURL: URL?
    var dictadoGrabando = false
    var hud: NSPanel?
    var hudLabel: NSTextField!

    // Rutas dentro del bundle: Contents/MacOS/Transcriptor + Contents/Resources/app
    var resourcesAppDir: String {
        let exe = Bundle.main.bundlePath
        return exe + "/Contents/Resources/app"
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular) // app normal del Dock (con puntito)
        buildMenu()   // sin menú, ⌘Q/⌘W/⌘C/⌘V no funcionan
        buildWindow()
        startServer()
        waitForServerThenLoad()
        setupTeclaFn()
        NSApp.activate(ignoringOtherApps: true)
    }

    // Tecla Fn = DICTADO UNIVERSAL en cualquier app.
    // keyCode 63 = tecla Fn / 🌐, llega como evento flagsChanged.
    // - monitor LOCAL: cuando Transcriptor está al frente
    // - monitor GLOBAL: cuando estás en otra app (requiere permiso de Accesibilidad)
    var fnPresionada = false
    func setupTeclaFn() {
        let handler: (NSEvent) -> Void = { [weak self] event in
            guard let self = self else { return }
            if event.keyCode == 63 {
                let activa = event.modifierFlags.contains(.function)
                if activa && !self.fnPresionada {
                    self.fnPresionada = true
                    self.toggleDictado()
                } else if !activa {
                    self.fnPresionada = false
                }
            }
        }
        NSEvent.addLocalMonitorForEvents(matching: .flagsChanged) { e in handler(e); return e }
        NSEvent.addGlobalMonitorForEvents(matching: .flagsChanged) { e in handler(e) }
    }

    // ── HUD flotante (pastilla) para mostrar el estado del dictado sin robar foco ──
    var hudDot: NSView!
    var hudSubLabel: NSTextField!
    let HUD_W: CGFloat = 340
    let HUD_H: CGFloat = 74

    func construirHUD() {
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: HUD_W, height: HUD_H),
                            styleMask: [.nonactivatingPanel, .borderless],
                            backing: .buffered, defer: false)
        panel.level = .floating
        panel.isFloatingPanel = true
        panel.hidesOnDeactivate = false
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.ignoresMouseEvents = true
        panel.hasShadow = true

        let bg = NSView(frame: panel.contentView!.bounds)
        bg.wantsLayer = true
        bg.layer?.backgroundColor = NSColor(red: 0.04, green: 0.04, blue: 0.04, alpha: 0.97).cgColor
        bg.layer?.cornerRadius = 20
        bg.layer?.borderWidth = 1
        bg.layer?.borderColor = NSColor(red: 0.78, green: 0.94, blue: 0.21, alpha: 0.30).cgColor
        bg.autoresizingMask = [.width, .height]
        panel.contentView?.addSubview(bg)

        // Punto de estado (izquierda)
        hudDot = NSView(frame: NSRect(x: 28, y: HUD_H/2 - 6, width: 12, height: 12))
        hudDot.wantsLayer = true
        hudDot.layer?.cornerRadius = 6
        bg.addSubview(hudDot)

        // Título
        hudLabel = NSTextField(labelWithString: "")
        hudLabel.font = NSFont.monospacedSystemFont(ofSize: 16, weight: .bold)
        hudLabel.frame = NSRect(x: 54, y: 36, width: HUD_W - 70, height: 22)
        hudLabel.autoresizingMask = [.width]
        bg.addSubview(hudLabel)

        // Subtítulo
        hudSubLabel = NSTextField(labelWithString: "")
        hudSubLabel.font = NSFont.monospacedSystemFont(ofSize: 11.5, weight: .regular)
        hudSubLabel.textColor = NSColor(white: 1, alpha: 0.45)
        hudSubLabel.frame = NSRect(x: 54, y: 16, width: HUD_W - 70, height: 16)
        hudSubLabel.autoresizingMask = [.width]
        bg.addSubview(hudSubLabel)

        hud = panel
    }

    func mostrarHUD(titulo: String, subtitulo: String, color: NSColor, pulsa: Bool = false) {
        if hud == nil { construirHUD() }
        hudLabel.stringValue = titulo
        hudLabel.textColor = color
        hudSubLabel.stringValue = subtitulo
        hudDot.layer?.backgroundColor = color.cgColor
        // Animación de pulso del punto mientras graba
        hudDot.layer?.removeAllAnimations()
        if pulsa {
            let a = CABasicAnimation(keyPath: "opacity")
            a.fromValue = 1.0; a.toValue = 0.25
            a.duration = 0.7; a.autoreverses = true
            a.repeatCount = .infinity
            hudDot.layer?.add(a, forKey: "pulso")
        } else {
            hudDot.layer?.opacity = 1
        }
        if let screen = NSScreen.main {
            let r = screen.visibleFrame
            hud!.setFrameOrigin(NSPoint(x: r.midX - HUD_W/2, y: r.minY + 110))
        }
        hud!.orderFrontRegardless()
    }

    // Compatibilidad: versión corta de un solo texto
    func mostrarHUD(_ texto: String, color: NSColor) {
        mostrarHUD(titulo: texto, subtitulo: "", color: color)
    }

    func ocultarHUD(despues: Double = 0) {
        if despues > 0 {
            DispatchQueue.main.asyncAfter(deadline: .now() + despues) { [weak self] in self?.hud?.orderOut(nil) }
        } else {
            hud?.orderOut(nil)
        }
    }

    // ── Empezar / parar el dictado ──
    func toggleDictado() {
        if dictadoGrabando { pararDictado() } else { empezarDictado() }
    }

    func empezarDictado() {
        // Verificar permiso de Accesibilidad (necesario para pegar y para el Fn global)
        if !AXIsProcessTrusted() {
            let opts = [kAXTrustedCheckOptionPrompt.takeRetainedValue() as String: true] as CFDictionary
            _ = AXIsProcessTrustedWithOptions(opts)
            mostrarHUD(titulo: "Permiso necesario", subtitulo: "Activa Accesibilidad para Transcriptor", color: .systemOrange)
            ocultarHUD(despues: 4)
            return
        }
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("transcriptor_dictado.m4a")
        try? FileManager.default.removeItem(at: tmp)
        dictadoURL = tmp
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 16000,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
        ]
        do {
            audioRecorder = try AVAudioRecorder(url: tmp, settings: settings)
            audioRecorder?.delegate = self
            if audioRecorder?.record() == true {
                dictadoGrabando = true
                mostrarHUD(titulo: "Dictando…", subtitulo: "toca Fn de nuevo para terminar",
                           color: NSColor(red: 0.96, green: 0.30, blue: 0.30, alpha: 1), pulsa: true)
            } else {
                mostrarHUD(titulo: "Sin micrófono", subtitulo: "no se pudo iniciar la grabación", color: .systemRed); ocultarHUD(despues: 3)
            }
        } catch {
            mostrarHUD(titulo: "Error de micrófono", subtitulo: "revisa los permisos", color: .systemRed); ocultarHUD(despues: 3)
        }
    }

    func pararDictado() {
        dictadoGrabando = false
        audioRecorder?.stop()
        audioRecorder = nil
        mostrarHUD(titulo: "Transcribiendo…", subtitulo: "un momento, ya casi",
                   color: NSColor(red: 0.78, green: 0.94, blue: 0.21, alpha: 1), pulsa: true)
        guard let url = dictadoURL else { return }
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.transcribirYpegar(url)
        }
    }

    // ── Enviar el audio al server, recibir el texto y pegarlo donde esté el cursor ──
    func transcribirYpegar(_ url: URL) {
        guard let data = try? Data(contentsOf: url), data.count > 1200 else {
            DispatchQueue.main.async { self.mostrarHUD(titulo: "Muy corto", subtitulo: "no alcancé a oír nada", color: .systemOrange); self.ocultarHUD(despues: 2) }
            return
        }
        var modelo = "small"
        let modelFile = resourcesAppDir + "/model.txt"
        if let m = try? String(contentsOfFile: modelFile, encoding: .utf8) {
            let limpio = m.trimmingCharacters(in: .whitespacesAndNewlines)
            if !limpio.isEmpty { modelo = limpio }
        }
        let boundary = "----dictado\(Int(Date().timeIntervalSince1970))"
        var body = Data()
        func campo(_ nombre: String, _ valor: String) {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"\(nombre)\"\r\n\r\n".data(using: .utf8)!)
            body.append("\(valor)\r\n".data(using: .utf8)!)
        }
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"audiofile\"; filename=\"dictado.m4a\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: audio/m4a\r\n\r\n".data(using: .utf8)!)
        body.append(data)
        body.append("\r\n".data(using: .utf8)!)
        campo("language", "es")
        campo("model", modelo)
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)

        var req = URLRequest(url: URL(string: SERVER_URL + "/api/dictado")!)
        req.httpMethod = "POST"
        req.timeoutInterval = 120
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        req.httpBody = body

        URLSession.shared.dataTask(with: req) { [weak self] respData, _, err in
            guard let self = self else { return }
            var texto = ""
            if let d = respData,
               let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
               let t = obj["text"] as? String {
                texto = t.trimmingCharacters(in: .whitespacesAndNewlines)
            }
            DispatchQueue.main.async {
                if texto.isEmpty {
                    self.mostrarHUD(titulo: "No entendí", subtitulo: "intenta hablar un poco más claro", color: .systemOrange); self.ocultarHUD(despues: 2)
                } else {
                    self.pegarTexto(texto)
                    self.mostrarHUD(titulo: "Listo ✓", subtitulo: "texto pegado donde tenías el cursor",
                                    color: NSColor(red: 0.55, green: 0.86, blue: 0.35, alpha: 1))
                    self.ocultarHUD(despues: 1.4)
                }
            }
            try? FileManager.default.removeItem(at: url)
        }.resume()
    }

    // Pegar: poner el texto en el portapapeles y simular ⌘V en la app activa
    func pegarTexto(_ texto: String) {
        let pb = NSPasteboard.general
        pb.clearContents()
        pb.setString(texto, forType: .string)
        let src = CGEventSource(stateID: .combinedSessionState)
        let vDown = CGEvent(keyboardEventSource: src, virtualKey: 0x09, keyDown: true)  // V
        vDown?.flags = .maskCommand
        let vUp = CGEvent(keyboardEventSource: src, virtualKey: 0x09, keyDown: false)
        vUp?.flags = .maskCommand
        vDown?.post(tap: .cghidEventTap)
        vUp?.post(tap: .cghidEventTap)
    }

    func buildMenu() {
        let mainMenu = NSMenu()

        // Menú de la app: Transcriptor → Ocultar / Salir (⌘Q)
        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)
        let appMenu = NSMenu()
        appItem.submenu = appMenu
        appMenu.addItem(withTitle: "Ocultar Transcriptor", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Salir de Transcriptor", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        // Menú Archivo: Cerrar ventana (⌘W)
        let fileItem = NSMenuItem()
        mainMenu.addItem(fileItem)
        let fileMenu = NSMenu(title: "Archivo")
        fileItem.submenu = fileMenu
        fileMenu.addItem(withTitle: "Cerrar ventana", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")

        // Menú Edición: copiar/pegar/seleccionar (necesario para que funcionen en el WebView)
        let editItem = NSMenuItem()
        mainMenu.addItem(editItem)
        let editMenu = NSMenu(title: "Edición")
        editItem.submenu = editMenu
        editMenu.addItem(withTitle: "Deshacer", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "Rehacer", action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(withTitle: "Cortar", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copiar", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Pegar", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Seleccionar todo", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")

        NSApp.mainMenu = mainMenu
    }

    func buildWindow() {
        let frame = NSRect(x: 0, y: 0, width: 1100, height: 760)
        window = NSWindow(
            contentRect: frame,
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered, defer: false)
        window.title = "Transcriptor"
        window.titlebarAppearsTransparent = true
        window.backgroundColor = NSColor(red: 0.05, green: 0.05, blue: 0.05, alpha: 1) // ink DGITAL76
        window.center()
        window.setFrameAutosaveName("TranscriptorMain")
        window.isReleasedWhenClosed = false

        let conf = WKWebViewConfiguration()
        conf.websiteDataStore = .nonPersistent()
        webView = WKWebView(frame: frame, configuration: conf)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.autoresizingMask = [.width, .height]
        webView.setValue(false, forKey: "drawsBackground") // sin fondo blanco al cargar
        window.contentView = webView

        // Etiqueta de "Iniciando…" mientras el servidor levanta
        loadingLabel = NSTextField(labelWithString: "Iniciando Transcriptor…")
        loadingLabel.textColor = NSColor(red: 0.78, green: 0.94, blue: 0.21, alpha: 1) // lima
        loadingLabel.font = NSFont.monospacedSystemFont(ofSize: 16, weight: .medium)
        loadingLabel.alignment = .center
        loadingLabel.frame = NSRect(x: 0, y: frame.height/2 - 12, width: frame.width, height: 24)
        loadingLabel.autoresizingMask = [.width, .minYMargin, .maxYMargin]
        webView.addSubview(loadingLabel)

        window.makeKeyAndOrderFront(nil)
    }

    func startServer() {
        // Si ya hay un servidor corriendo, no levantar otro
        if pingServer() { return }
        let runner = resourcesAppDir + "/run_server.sh"
        guard FileManager.default.fileExists(atPath: runner) else {
            showError("No se encontró run_server.sh en el bundle.")
            return
        }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/bash")
        p.arguments = [runner]
        p.currentDirectoryURL = URL(fileURLWithPath: resourcesAppDir)
        var env = ProcessInfo.processInfo.environment
        // El modelo se define en Resources/app/model.txt (lo escribe build_native_app.sh).
        // Así no hay que parchear el binario compilado. Si falta, cae a "small".
        var modelo = "small"
        let modelFile = resourcesAppDir + "/model.txt"
        if let m = try? String(contentsOfFile: modelFile, encoding: .utf8) {
            let limpio = m.trimmingCharacters(in: .whitespacesAndNewlines)
            if !limpio.isEmpty { modelo = limpio }
        }
        env["WHISPER_MODEL"] = env["WHISPER_MODEL"] ?? modelo
        // PATH amplio para encontrar python3/ffmpeg/brew
        let extra = "\(NSHomeDirectory())/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        env["PATH"] = extra + ":" + (env["PATH"] ?? "")
        p.environment = env
        let log = NSHomeDirectory() + "/Library/Logs/Transcriptor.log"
        FileManager.default.createFile(atPath: log, contents: nil)
        if let handle = FileHandle(forWritingAtPath: log) {
            p.standardOutput = handle
            p.standardError = handle
        }
        do { try p.run(); serverProc = p }
        catch { showError("No se pudo iniciar el servidor: \(error.localizedDescription)") }
    }

    func pingServer() -> Bool {
        guard let url = URL(string: SERVER_URL + "/api/health") else { return false }
        var req = URLRequest(url: url)
        req.timeoutInterval = 2
        let sem = DispatchSemaphore(value: 0)
        var ok = false
        let task = URLSession.shared.dataTask(with: req) { _, resp, _ in
            if let http = resp as? HTTPURLResponse, http.statusCode == 200 { ok = true }
            sem.signal()
        }
        task.resume()
        _ = sem.wait(timeout: .now() + 2.5)
        return ok
    }

    func waitForServerThenLoad() {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            // hasta ~12 min en la 1a instalación
            for _ in 0..<720 {
                if self.pingServer() {
                    DispatchQueue.main.async { self.loadApp() }
                    return
                }
                // Mostrar el último mensaje de progreso del instalador
                if let msg = self.lastProgressLine() {
                    DispatchQueue.main.async { self.loadingLabel.stringValue = msg }
                }
                Thread.sleep(forTimeInterval: 1)
            }
            DispatchQueue.main.async {
                self.showError("El servidor no respondió. Revisa ~/Library/Logs/Transcriptor.log")
            }
        }
    }

    // Lee el último mensaje útil del log (las líneas con ✅/⚙️/⏳/🚀 del instalador)
    func lastProgressLine() -> String? {
        let log = NSHomeDirectory() + "/Library/Logs/Transcriptor.log"
        guard let data = FileManager.default.contents(atPath: log),
              let text = String(data: data, encoding: .utf8) else { return nil }
        let interesting = text.split(separator: "\n").reversed().first { line in
            line.contains("✅") || line.contains("⚙️") || line.contains("⏳")
                || line.contains("🚀") || line.contains("Instalando") || line.contains("Descargando")
        }
        guard let line = interesting else { return "Preparando todo la primera vez…" }
        return String(line).trimmingCharacters(in: .whitespaces)
    }

    func loadApp() {
        loadingLabel.isHidden = true
        if let url = URL(string: SERVER_URL) {
            var req = URLRequest(url: url)
            req.cachePolicy = .reloadIgnoringLocalCacheData
            webView.load(req)
        }
    }

    // Si la carga falla (servidor reiniciándose), reintentar — evita la ventana en negro
    func retryLoadSoon() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            guard let self = self else { return }
            if self.pingServer() { self.loadApp() }
            else { self.retryLoadSoon() }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        retryLoadSoon()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        retryLoadSoon()
    }

    func showError(_ msg: String) {
        loadingLabel.stringValue = msg
        loadingLabel.textColor = NSColor.systemRed
        loadingLabel.isHidden = false
    }

    // Al cerrar la ventana: apagar y liberar RAM (clave en M1 8GB)
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        // avisar al server que cierre (apaga el modelo)
        if let url = URL(string: SERVER_URL + "/api/closing") {
            var req = URLRequest(url: url); req.httpMethod = "POST"; req.timeoutInterval = 2
            let sem = DispatchSemaphore(value: 0)
            URLSession.shared.dataTask(with: req) { _,_,_ in sem.signal() }.resume()
            _ = sem.wait(timeout: .now() + 2)
        }
        serverProc?.terminate()
    }

    // Permitir el micrófono para el botón "Grabar" (macOS pide su propio permiso aparte)
    @available(macOS 12.0, *)
    func webView(_ webView: WKWebView,
                 requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo,
                 type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(.grant)
    }

    // Reabrir ventana al hacer clic en el ícono del Dock
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { window.makeKeyAndOrderFront(nil) }
        return true
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
