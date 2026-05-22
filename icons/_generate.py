#!/usr/bin/env python3
"""Generate DealerScan PWA placeholder icons using PIL.
Renders the same design as icon.svg directly to PNG (skipping SVG rendering)."""
from PIL import Image, ImageDraw

def draw_icon(size: int, maskable: bool = False) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    bg, fg = (11, 11, 12, 255), (42, 109, 244, 255)
    # Maskable variants need a "safe zone" - fill the whole canvas with bg.
    if maskable:
        d.rectangle([0, 0, size, size], fill=bg)
    else:
        # rounded square: pillow has rounded_rectangle (>=8.2)
        d.rounded_rectangle([0, 0, size, size], radius=int(size * 0.1875), fill=bg)
    # Scale all design coords from the 512 reference.
    s = size / 512
    # Document outline
    d.rounded_rectangle(
        [120 * s, 100 * s, (120 + 272) * s, (100 + 312) * s],
        radius=int(20 * s), outline=fg, width=max(2, int(14 * s))
    )
    # Three text lines
    lw = max(2, int(14 * s))
    for y_ref, x_end_ref in [(180, 356), (240, 356), (300, 280)]:
        d.line([(156 * s, y_ref * s), (x_end_ref * s, y_ref * s)], fill=fg, width=lw)
    # Camera lens dot
    cx, cy, r = 256 * s, 384 * s, 36 * s
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fg)
    inner_r = 22 * s
    d.rectangle([cx - inner_r, cy - inner_r, cx + inner_r, cy + inner_r], fill=bg)
    return img

for size in (192, 512):
    out = f"icon-{size}.png"
    draw_icon(size).save(out, "PNG")
    print(f"wrote {out}")
draw_icon(512, maskable=True).save("icon-maskable-512.png", "PNG")
print("wrote icon-maskable-512.png")
