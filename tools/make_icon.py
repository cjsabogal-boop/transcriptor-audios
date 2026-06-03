#!/usr/bin/env python3
"""Genera el ícono de la app Transcriptor (estilo Dgital76: ink + lima)."""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets")
os.makedirs(OUT, exist_ok=True)

S = 1024
INK = (13, 13, 13, 255)
INK2 = (27, 27, 25, 255)
LIME = (200, 241, 53, 255)

img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# Fondo squircle (rounded rect) con borde lima sutil
r = 230
d.rounded_rectangle([(0, 0), (S, S)], radius=r, fill=INK)
# leve panel interior + borde lima tenue
d.rounded_rectangle([(24, 24), (S - 24, S - 24)], radius=r - 18, outline=(200, 241, 53, 60), width=6)

cx = S // 2

# Cuerpo del micrófono (cápsula lima)
body = [(cx - 120, 250), (cx + 120, 600)]
d.rounded_rectangle(body, radius=120, fill=LIME)
# rejilla: líneas oscuras horizontales en el cuerpo
for yy in range(320, 560, 60):
    d.line([(cx - 78, yy), (cx + 78, yy)], fill=INK, width=14)

# Cradle (arco en U que sostiene el mic)
arc_box = [(cx - 195, 470), (cx + 195, 700)]
d.arc(arc_box, start=0, end=180, fill=LIME, width=40)

# Soporte vertical
d.line([(cx, 700), (cx, 812)], fill=LIME, width=40)
# Base
d.rounded_rectangle([(cx - 115, 800), (cx + 115, 836)], radius=18, fill=LIME)

# Cursor "_" de marca (esquina inferior derecha)
d.rounded_rectangle([(S - 250, S - 150), (S - 110, S - 116)], radius=16, fill=LIME)

png = os.path.join(OUT, "icon_1024.png")
img.save(png)
print("Ícono generado:", png)

# ── Ícono de barra de menú (template: negro + alpha; macOS lo tiñe) ──
M = 44
mb = Image.new("RGBA", (M, M), (0, 0, 0, 0))
md = ImageDraw.Draw(mb)
mcx = M // 2
BLACK = (0, 0, 0, 255)
# cuerpo
md.rounded_rectangle([(mcx - 7, 7), (mcx + 7, 27)], radius=7, fill=BLACK)
# cradle
md.arc([(mcx - 12, 18), (mcx + 12, 33)], start=0, end=180, fill=BLACK, width=3)
# soporte + base
md.line([(mcx, 33), (mcx, 38)], fill=BLACK, width=3)
md.line([(mcx - 7, 38), (mcx + 7, 38)], fill=BLACK, width=3)
mbpng = os.path.join(OUT, "menubar_icon.png")
mb.save(mbpng)
print("Ícono de barra de menú generado:", mbpng)
