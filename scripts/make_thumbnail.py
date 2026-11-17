#!/usr/bin/env python3
"""ClipPulse v3 — thumbnail generator (OpenShorts-style YouTube Studio).

Takes the best frame of a clip (the audio-energy peak second), darkens the
bottom, and lays a big bold title on it — purpose-designed, never a bare
video frame.

Usage:
    python3 make_thumbnail.py --frame frame.jpg --title "TITLE TEXT" \
        --subtitle "KNOCKOUT • 03:45" --output thumb.jpg [--accent DC2626]
"""
import argparse
import os
import sys

from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1280, 720


def get_fonts():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(script_dir, "..", "public", "fonts", "Anton-Regular.ttf"),
        os.path.join(script_dir, "..", "public", "fonts", "Montserrat-ExtraBold.ttf"),
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "C:\\Windows\\Fonts\\arialbd.ttf",
        "C:\\Windows\\Fonts\\segoeui.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/Library/Fonts/Arial Bold.ttf",
    ]
    for p in candidates:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, 92), ImageFont.truetype(p, 40)
            except Exception:
                continue
    default_font = ImageFont.load_default()
    return default_font, default_font


def wrap(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_w: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    cur = ""
    for word in words:
        trial = f"{cur} {word}".strip()
        if draw.textlength(trial, font=font) <= max_w:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines[:3]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--frame", required=True)
    ap.add_argument("--title", required=True)
    ap.add_argument("--subtitle", default="")
    ap.add_argument("--output", required=True)
    ap.add_argument("--accent", default="DC2626")
    args = ap.parse_args()

    img = Image.open(args.frame).convert("RGB")
    # Cover-crop to 16:9
    target_ratio = W / H
    w, h = img.size
    if w / h > target_ratio:
        new_w = int(h * target_ratio)
        left = (w - new_w) // 2
        img = img.crop((left, 0, left + new_w, h))
    else:
        new_h = int(w / target_ratio)
        top = (h - new_h) // 2
        img = img.crop((0, top, w, top + new_h))
    img = img.resize((W, H), Image.LANCZOS)

    # Bottom gradient scrim so text stays readable on any frame
    scrim = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(scrim)
    band_h = int(H * 0.52)
    for y in range(band_h):
        alpha = int(215 * (y / band_h) ** 1.4)
        sd.line([(0, H - band_h + y), (W, H - band_h + y)], fill=(0, 0, 0, alpha))
    img = Image.alpha_composite(img.convert("RGBA"), scrim).convert("RGB")
    img = img.filter(ImageFilter.GaussianBlur(0.4))
    draw = ImageDraw.Draw(img)

    accent = tuple(int(args.accent[i : i + 2], 16) for i in (0, 2, 4))
    margin = 64
    y = H - 64

    title_font, sub_font = get_fonts()
    lines = wrap(draw, args.title.upper(), title_font, W - 2 * margin)
    line_h = 104
    y = H - 64 - line_h * len(lines)
    if args.subtitle:
        sub_y = y - 62
        draw.rectangle([margin, sub_y + 6, margin + 14, sub_y + 46], fill=accent)
        draw.text((margin + 28, sub_y), args.subtitle.upper(), font=sub_font, fill=accent)
        y = H - 64 - line_h * len(lines)
    for line in lines:
        draw.text(
            (margin, y),
            line,
            font=title_font,
            fill=(255, 255, 255),
            stroke_width=3,
            stroke_fill=(0, 0, 0),
        )
        y += line_h

    img.save(args.output, "JPEG", quality=90)
    print(args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
