// Transcriptor — app nativa de macOS (Cocoa + WKWebView).
// Ventana propia (no Chrome), puntito en el Dock, arranca/apaga el servidor Python.
import Cocoa
import WebKit

let SERVER_URL = "http://127.0.0.1:5111"

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var serverProc: Process?
    var loadingLabel: NSTextField!

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
        NSApp.activate(ignoringOtherApps: true)
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
        env["WHISPER_MODEL"] = env["WHISPER_MODEL"] ?? "medium"
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
