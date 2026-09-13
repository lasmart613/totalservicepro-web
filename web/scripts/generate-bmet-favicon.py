#!/usr/bin/env python3
"""Rasterize the RepairPlanet BMET mark into App Router + public favicon assets.

Source of truth for the vector mark is app/icon.svg (navy field, teal medical
cross, gold open-end wrench). Re-run from web/: python3 scripts/generate-bmet-favicon.py
"""

from __future__ import annotations

import io
import struct
from pathlib import Path

from PIL import Image, ImageDraw

NAVY = (0x11, 0x18, 0x27, 255)
TEAL = (0x2D, 0xD4, 0xBF, 255)
GOLD = (0xFB, 0xBF, 0x24, 255)

WEB = Path(__file__).resolve().parents[1]
APP = WEB / "app"
PUBLIC = WEB / "public"

# Geometry in a 32-unit grid. Even numbers stay pixel-aligned at 16×16.
STEM = (12, 4, 8, 16)  # x, y, w, h
BAR = (4, 12, 24, 8)
JAW_L = (8, 20, 6, 8)
JAW_R = (18, 20, 6, 8)


def _box(size: int, x: int, y: int, w: int, h: int) -> tuple[float, float, float, float]:
    s = size / 32
    return (x * s, y * s, (x + w) * s - 1e-6, (y + h) * s - 1e-6)


def draw_mark(size: int, *, rounded: bool, pad_units: float = 0) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    inset = pad_units * size / 32
    if rounded:
        radius = max(2, int(round((size - 2 * inset) * 0.22)))
        d.rounded_rectangle(
            [inset, inset, size - 1 - inset, size - 1 - inset],
            radius=radius,
            fill=NAVY,
        )
    else:
        d.rectangle([0, 0, size - 1, size - 1], fill=NAVY)

    # Shift the glyph down slightly when padded so the wrench isn't clipped by iOS masks.
    dy = inset * 0.15
    def box(x, y, w, h):
        x0, y0, x1, y1 = _box(size, x, y, w, h)
        return (x0, y0 + dy, x1, y1 + dy)

    d.rectangle(box(*STEM), fill=TEAL)
    d.rectangle(box(*BAR), fill=TEAL)
    # Gold jaws read as "service" at 32px+; stay teal at 16px so the glyph stays one mark.
    jaw = GOLD if size >= 32 else TEAL
    d.rectangle(box(*JAW_L), fill=jaw)
    d.rectangle(box(*JAW_R), fill=jaw)
    return img


def write_png(path: Path, image: Image.Image) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG", optimize=True)


def write_ico(path: Path, images: list[Image.Image]) -> None:
    """ICO with embedded PNGs (crisp, widely supported)."""
    count = len(images)
    header = struct.pack("<HHH", 0, 1, count)
    entries = []
    blobs = []
    offset = 6 + 16 * count
    for im in images:
        buf = io.BytesIO()
        im.save(buf, format="PNG")
        blob = buf.getvalue()
        w, h = im.size
        entries.append(
            struct.pack(
                "<BBBBHHII",
                w if w < 256 else 0,
                h if h < 256 else 0,
                0,
                0,
                1,
                32,
                len(blob),
                offset,
            )
        )
        offset += len(blob)
        blobs.append(blob)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(header + b"".join(entries) + b"".join(blobs))


def main() -> None:
    icon_16 = draw_mark(16, rounded=True)
    icon_32 = draw_mark(32, rounded=True)
    icon_48 = draw_mark(48, rounded=True)
    icon_192 = draw_mark(192, rounded=True)
    apple = draw_mark(180, rounded=False, pad_units=2.4)

    write_ico(APP / "favicon.ico", [icon_16, icon_32, icon_48])
    write_ico(PUBLIC / "favicon.ico", [icon_16, icon_32, icon_48])
    write_png(APP / "icon.png", icon_192)
    write_png(PUBLIC / "icon-48.png", icon_48)
    write_png(APP / "apple-icon.png", apple)
    write_png(PUBLIC / "apple-icon.png", apple)
    print("wrote BMET favicon assets")


if __name__ == "__main__":
    main()
