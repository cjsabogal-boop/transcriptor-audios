#!/usr/bin/env python3
"""App nativa de Dock para Transcriptor (sin Terminal, sin ícono de barra de menú).

Es una app Cocoa mínima que:
- aparece en el Dock con su puntito de "abierto" mientras está corriendo,
- al abrir: arranca el servidor (si hace falta) y abre la ventana,
- al hacer clic en el ícono del Dock: reabre la ventana,
- al salir (Cmd-Q): apaga el servidor y libera la RAM.
El servidor pesado solo corre cuando hay ventana abierta (ver AUTO_SHUTDOWN).
"""
import os
import sys
import time
import signal
import threading
import subprocess
import urllib.request

APP_DIR = os.path.dirname(os.path.abspath(__file__))
URL = "http://127.0.0.1:5111"


def server_up():
    try:
        urllib.request.urlopen(URL + "/api/health", timeout=1.5)
        return True
    except Exception:
        return False


def open_window():
    # Ventana de app reutilizando el Chrome ya abierto (rápido, sin perfiles aparte).
    if os.path.isdir("/Applications/Google Chrome.app"):
        subprocess.Popen(["/usr/bin/open", "-na", "Google Chrome", "--args", "--app=" + URL])
    else:
        subprocess.Popen(["/usr/bin/open", URL])


def notify(msg):
    try:
        subprocess.Popen(["/usr/bin/osascript", "-e",
                          'display notification "%s" with title "Transcriptor"' % msg])
    except Exception:
        pass


def start_server():
    if server_up():
        return True
    try:
        subprocess.Popen(["/bin/bash", os.path.join(APP_DIR, "run_server.sh")],
                         cwd=APP_DIR, env=os.environ.copy(),
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass
    for _ in range(720):
        if server_up():
            return True
        time.sleep(1)
    return server_up()


def stop_server():
    try:
        out = subprocess.run(["/usr/sbin/lsof", "-ti", "tcp:5111"],
                             capture_output=True, text=True)
        for pid in out.stdout.split():
            try:
                os.kill(int(pid), signal.SIGKILL)
            except Exception:
                pass
    except Exception:
        pass


# ── Sin GUI disponible: arrancar servidor + ventana y salir ──
def _headless():
    if not server_up():
        notify("Iniciando… la primera vez instala la IA (puede tardar).")
        start_server()
    open_window()


def main():
    try:
        from AppKit import (NSApplication, NSObject, NSMenu, NSMenuItem,
                            NSApplicationActivationPolicyRegular)
        from PyObjCTools import AppHelper
    except Exception:
        _headless()
        return

    class AppDelegate(NSObject):
        def applicationDidFinishLaunching_(self, _n):
            threading.Thread(target=self._boot, daemon=True).start()

        def _boot(self):
            if not server_up():
                notify("Iniciando… la primera vez instala la IA (puede tardar).")
                start_server()
                notify("¡Listo!")
            open_window()

        # Clic en el ícono del Dock estando abierta -> reabrir la ventana
        def applicationShouldHandleReopen_hasVisibleWindows_(self, _app, _flag):
            threading.Thread(target=self._reopen, daemon=True).start()
            return True

        def _reopen(self):
            if not server_up():
                start_server()
            open_window()

        # Cmd-Q -> apagar el servidor antes de salir
        def applicationWillTerminate_(self, _n):
            stop_server()

    app = NSApplication.sharedApplication()
    app.setActivationPolicy_(NSApplicationActivationPolicyRegular)  # ícono en el Dock

    # Ícono y nombre propios (el proceso es python, así que los forzamos)
    try:
        from AppKit import NSImage
        from Foundation import NSProcessInfo
        NSProcessInfo.processInfo().setProcessName_("Transcriptor")
        for ic in ("icon_1024.png", os.path.join("assets", "icon.icns"),
                   os.path.join("assets", "icon_1024.png")):
            p = os.path.join(APP_DIR, ic)
            if os.path.exists(p):
                img = NSImage.alloc().initWithContentsOfFile_(p)
                if img:
                    app.setApplicationIconImage_(img)
                    break
    except Exception:
        pass

    # Menú con "Salir" (Cmd-Q)
    menubar = NSMenu.alloc().init()
    app_item = NSMenuItem.alloc().init()
    menubar.addItem_(app_item)
    app.setMainMenu_(menubar)
    app_menu = NSMenu.alloc().init()
    quit_item = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
        "Salir de Transcriptor", "terminate:", "q")
    app_menu.addItem_(quit_item)
    app_item.setSubmenu_(app_menu)

    delegate = AppDelegate.alloc().init()
    app.setDelegate_(delegate)
    app.activateIgnoringOtherApps_(True)
    AppHelper.runEventLoop()


if __name__ == "__main__":
    main()
