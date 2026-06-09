#!/usr/bin/env python3
"""Generate the AI HOT extension logo and icon PNGs.

This reproduces the transparent geometric Ai mark currently used by the
extension icons. It can also reproduce the earlier compact source mark from
/tmp/logo_transparent.png. It requires Pillow:

  python3 -m pip install Pillow

Usage:

  python3 scripts/generate-logo.py

By default it writes icons/icon16.png, icons/icon32.png, icons/icon48.png,
and icons/icon128.png using the current mark. Pass --variant original to
recreate the earlier compact mark. Pass --source-out to also save the 128px
transparent source logo.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw


ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_OUT_DIR = ROOT_DIR / "icons"
ICON_SIZES = (16, 32, 48, 128)
ORANGE = (232, 85, 0)  # #e85500
RED = (228, 0, 18)  # #e40012

VARIANTS = {
    "current": {
        "top": 0.40,
        "bottom": 0.40,
        "stroke_left": 0.055,
        "stroke_left_min": 4,
        "left_bottom_x": 0.22,
        "left_top_x": 0.01,
        "foot_width": 0.05,
        "foot_height": 0.025,
        "foot_height_min": 2,
        "i_x": 0.20,
        "i_top": 0.14,
        "stroke_i": 0.038,
        "stroke_i_min": 3,
        "bar_left": 0.12,
        "bar_right_gap": 0.06,
        "bar_width": None,
        "dot_radius": 0.065,
        "dot_gap": 0.12,
    },
    "original": {
        "top": 0.28,
        "bottom": 0.28,
        "stroke_left": 0.042,
        "stroke_left_min": 3,
        "left_bottom_x": 0.16,
        "left_top_x": 0.01,
        "foot_width": 0.04,
        "foot_height": 0.02,
        "foot_height_min": 1,
        "i_x": 0.15,
        "i_top": 0.10,
        "stroke_i": 0.028,
        "stroke_i_min": 2,
        "bar_left": 0.08,
        "bar_right_gap": 0.05,
        "bar_width": 2,
        "dot_radius": 0.048,
        "dot_gap": 0.11,
    },
}


def draw_logo(size: int = 128, variant: str = "current") -> Image.Image:
  spec = VARIANTS[variant]
  img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
  draw = ImageDraw.Draw(img)

  cx = size // 2
  cy = size // 2

  top = cy - size * spec["top"]
  bottom = cy + size * spec["bottom"]

  stroke_left = max(int(size * spec["stroke_left"]), spec["stroke_left_min"])
  left_bottom_x = cx - size * spec["left_bottom_x"]
  left_top_x = cx - size * spec["left_top_x"]
  draw.line(
      [(left_bottom_x, bottom), (left_top_x, top)],
      fill=ORANGE,
      width=stroke_left,
  )

  foot_width = size * spec["foot_width"]
  foot_height = max(int(size * spec["foot_height"]), spec["foot_height_min"])
  draw.line(
      [(left_bottom_x - foot_width, bottom), (left_bottom_x + foot_width, bottom)],
      fill=ORANGE,
      width=foot_height,
  )

  i_x = cx + size * spec["i_x"]
  i_top = top + size * spec["i_top"]
  stroke_i = max(int(size * spec["stroke_i"]), spec["stroke_i_min"])
  draw.line([(i_x, bottom), (i_x, i_top)], fill=ORANGE, width=stroke_i)
  draw.line(
      [(i_x - foot_width * 0.6, bottom), (i_x + foot_width * 0.6, bottom)],
      fill=ORANGE,
      width=foot_height,
  )

  bar_y = cy + size * 0.02
  bar_right = i_x - size * spec["bar_right_gap"]
  bar_width = spec["bar_width"] or max(int(size * 0.02), 2)
  draw.line(
      [(cx - size * spec["bar_left"], bar_y), (bar_right, bar_y)],
      fill=ORANGE,
      width=bar_width,
  )

  dot_radius = int(size * spec["dot_radius"])
  dot_cx = int(i_x)
  dot_cy = int(i_top - size * spec["dot_gap"])
  draw.ellipse(
      [
          dot_cx - dot_radius,
          dot_cy - dot_radius,
          dot_cx + dot_radius,
          dot_cy + dot_radius,
      ],
      fill=RED,
  )

  return img


def parse_args() -> argparse.Namespace:
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument(
      "--out-dir",
      type=Path,
      default=DEFAULT_OUT_DIR,
      help="Directory for generated icon PNGs. Defaults to ./icons.",
  )
  parser.add_argument(
      "--source-out",
      type=Path,
      help="Optional path for the 128px transparent source logo.",
  )
  parser.add_argument(
      "--variant",
      choices=sorted(VARIANTS),
      default="current",
      help="Logo geometry to generate. Defaults to current.",
  )
  return parser.parse_args()


def main() -> None:
  args = parse_args()
  args.out_dir.mkdir(parents=True, exist_ok=True)

  source = draw_logo(128, args.variant)
  if args.source_out:
    args.source_out.parent.mkdir(parents=True, exist_ok=True)
    source.save(args.source_out)

  for size in ICON_SIZES:
    icon = source if size == 128 else source.resize((size, size), Image.LANCZOS)
    icon.save(args.out_dir / f"icon{size}.png")

  print(f"Wrote icons to {args.out_dir}")


if __name__ == "__main__":
  main()
