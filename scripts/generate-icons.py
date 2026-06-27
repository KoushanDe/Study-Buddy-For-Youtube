#!/usr/bin/env python3
"""Generate extension icons with transparent background and a wide red rectangle."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "public" / "icons"

RED = (249, 18, 18, 255)
WHITE = (255, 255, 255, 255)


def draw_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    pad_x = max(1, round(size * 0.04))
    pad_y = max(1, round(size * 0.06))
    rect_w = size - pad_x * 2
    rect_h = size - pad_y * 2
    radius = max(2, round(size * 0.12))

    draw.rounded_rectangle(
        [pad_x, pad_y, pad_x + rect_w, pad_y + rect_h],
        radius=radius,
        fill=RED,
    )

    cx = size // 2
    play_top = pad_y + round(rect_h * 0.16)
    play_h = round(size * 0.24)
    play_w = round(size * 0.22)
    draw.polygon(
        [
            (cx - play_w // 2, play_top),
            (cx - play_w // 2, play_top + play_h),
            (cx + play_w // 2, play_top + play_h // 2),
        ],
        fill=WHITE,
    )

    book_top = pad_y + round(rect_h * 0.56)
    book_w = round(size * 0.52)
    book_h = round(size * 0.22)
    book_left = cx - book_w // 2
    book_right = book_left + book_w
    book_bottom = book_top + book_h
    spine = max(1, round(size * 0.05))

    draw.pieslice(
        [book_left, book_top, cx - spine // 2, book_bottom],
        start=90,
        end=270,
        fill=WHITE,
    )
    draw.pieslice(
        [cx + spine // 2, book_top, book_right, book_bottom],
        start=270,
        end=90,
        fill=WHITE,
    )
    draw.rectangle(
        [book_left, book_top, book_right, book_bottom],
        fill=WHITE,
    )
    draw.rectangle(
        [cx - spine // 2, book_top, cx + spine // 2, book_bottom],
        fill=RED,
    )

    return img


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for size in (16, 48, 128):
        path = OUT_DIR / f"icon{size}.png"
        draw_icon(size).save(path, format="PNG")
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
