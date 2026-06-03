#!/usr/bin/env python3
"""Ícono de barra de menú para Transcriptor.

Muestra un mic en la barra de menú de macOS. Arranca/abre/apaga el servidor.
El servidor (server.py) pesado solo corre cuando hay ventana abierta; al cerrarla
se apaga solo (ver AUTO_SHUTDOWN en server.py). Este menú permite reabrirlo rápido.
"""
import os
import sys
import time
import signal
import threading
import subprocess
import urllib.request

try:
    import rumps
except ImportError:
    sys.exit(0)

APP_DIR = os.path.dirname(os.path.abspath(__file__))
URL = "http://127.0.0.1:5111"
ICON = os.path.join(APP_DIR, "assets", "menubar_icon.png")
LOCK = "/tmp/transcriptor_menubar.lock"


def server_up():
    try:
        urllib.request.urlopen(URL + "/api/health", timeout=1.5)
        return True
    except Exception:
        return False


def open_window():
    chrome = "/Applications/Google Chrome.app"
    if os.path.isdir(chrome):
        subprocess.Popen([
            "/usr/bin/open", "-na", "Google Chrome", "--args",
            "--app=" + URL,
            "--user-data-dir=" + os.path.expanduser("~/Library/Application Support/Transcriptor/win"),
        ])
    else:
        subprocess.Popen(["/usr/bin/open", URL])


def notify(msg):
    try:
        rumps.notification("Transcriptor", "", msg)
    except Exception:
        pass


class Transcriptor(rumps.App):
    def __init__(self):
        super().__init__(
            "Transcriptor",
            icon=ICON if os.path.exists(ICON) else None,
            template=True,
            quit_button=None,
        )
        self.status_item = rumps.MenuItem("○ Detenido")
        self.menu = [
            rumps.MenuItem("Abrir Transcriptor", callback=self.abrir),
            rumps.MenuItem("Apagar servidor (liberar RAM)", callback=self.apagar),
            None,
            self.status_item,
            None,
            rumps.MenuItem("Salir", callback=self.salir),
        ]
        self.proc = None
        threading.Thread(target=self._boot, daemon=True).start()

    # Arranque automático al abrir la app
    def _boot(self):
        if not server_up():
            notify("Iniciando… la primera vez instala la IA (puede tardar).")
            self.start_server()
        open_window()

    def start_server(self):
        if server_up():
            return True
        try:
            self.proc = subprocess.Popen(
                ["/bin/bash", os.path.join(APP_DIR, "run_server.sh")],
                cwd=APP_DIR, env=os.environ.copy(),
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
        except Exception:
            pass
        for _ in range(720):
            if server_up():
                notify("¡Listo!")
                return True
            time.sleep(1)
        return server_up()

    def stop_server(self):
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

    def abrir(self, _):
        def go():
            if not server_up():
                notify("Iniciando…")
                self.start_server()
            open_window()
        threading.Thread(target=go, daemon=True).start()

    def apagar(self, _):
        self.stop_server()
        notify("Servidor apagado. RAM liberada.")

    def salir(self, _):
        self.stop_server()
        try:
            os.remove(LOCK)
        except Exception:
            pass
        rumps.quit_application()

    @rumps.timer(3)
    def _tick(self, _):
        self.status_item.title = "● Activo" if server_up() else "○ Detenido"


def main():
    # Instancia única: si ya corre, solo abrir ventana y salir.
    if os.path.exists(LOCK):
        try:
            with open(LOCK) as f:
                pid = int(f.read().strip())
            os.kill(pid, 0)
            open_window()
            return
        except Exception:
            pass
    try:
        with open(LOCK, "w") as f:
            f.write(str(os.getpid()))
    except Exception:
        pass
    Transcriptor().run()


if __name__ == "__main__":
    main()
