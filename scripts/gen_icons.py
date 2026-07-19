#!/usr/bin/env python3
"""Generate WLOC PWA app icons (blue square + white location pin) and write
icons_out.js with base64-encoded PNGs + an inline SVG. Drawn at 4x then downsampled."""
import base64, io, os
from PIL import Image, ImageDraw

OUT_JS = os.path.join(os.path.dirname(__file__), "..", "src", "icons.js")

SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
    '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">'
    '<stop offset="0" stop-color="#2E9BFF"/><stop offset="1" stop-color="#0A66FF"/>'
    '</linearGradient></defs>'
    '<rect width="512" height="512" rx="112" fill="url(#g)"/>'
    '<path fill="#fff" d="M256 120a96 96 0 0 0-96 96c0 66 96 176 96 176s96-110 96-176a96 96 0 0 0-96-96z"/>'
    '<circle cx="256" cy="216" r="40" fill="#0A66FF"/></svg>'
)

def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))

def draw_icon(size):
    S = size * 4
    top, bot = (46, 155, 255), (10, 102, 255)
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for y in range(S):
        d.line([(0, y), (S, y)], fill=lerp(top, bot, y / S) + (255,))
    cx, cy = S / 2, S * 0.40
    head_r, tip_y = S * 0.20, S * 0.80
    white = (255, 255, 255, 255)
    d.ellipse([cx - head_r, cy - head_r, cx + head_r, cy + head_r], fill=white)
    half = head_r * 0.86
    d.polygon([(cx - half, cy + head_r * 0.5), (cx + half, cy + head_r * 0.5), (cx, tip_y)], fill=white)
    # inner hole: paste the gradient back through a circular mask
    hole_r = head_r * 0.42
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).ellipse([cx - hole_r, cy - hole_r, cx + hole_r, cy + hole_r], fill=255)
    grad = Image.new("RGBA", (S, S))
    gd = ImageDraw.Draw(grad)
    for y in range(S):
        gd.line([(0, y), (S, y)], fill=lerp(top, bot, y / S) + (255,))
    img.paste(grad, (0, 0), mask)
    return img.resize((size, size), Image.LANCZOS)

def png_b64(size):
    buf = io.BytesIO()
    draw_icon(size).save(buf, format="PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode("ascii")

b180, b512 = png_b64(180), png_b64(512)

js = (
    "// Auto-generated PWA app icons. Regenerate with scripts/gen_icons.py.\n"
    "// Blue square + white location pin; apple-touch-icon (180) and web manifest (512).\n"
    'export const ICON_180_B64 = "' + b180 + '";\n'
    'export const ICON_512_B64 = "' + b512 + '";\n\n'
    "// Inline vector icon (favicon + manifest 'any' purpose).\n"
    "export const ICON_SVG = `" + SVG + "`;\n\n"
    "export function b64ToBytes(b64) {\n"
    "  const bin = atob(b64);\n"
    "  const out = new Uint8Array(bin.length);\n"
    "  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);\n"
    "  return out;\n"
    "}\n"
)

with open(OUT_JS, "w") as f:
    f.write(js)
print("wrote", OUT_JS)
print("b64 lengths: 180=%d 512=%d" % (len(b180), len(b512)))
