#!/usr/bin/env python3
"""Split a 2x2 quadrant image into four standalone PNGs.

Usage:
    python3 scripts/split_favicons.py <input.png> [--out-dir <dir>] [--prefix <name>]

Produces <prefix>-tl.png, <prefix>-tr.png, <prefix>-bl.png, <prefix>-br.png
(top-left / top-right / bottom-left / bottom-right) cropped to the
input's exact half-width × half-height.

Assumes the four images are arranged in a perfect 2x2 grid with no
gutters. If the grid has padding, run the script then trim with
ImageMagick or Pillow's .crop() in a second pass.
"""

import argparse
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("error: this script needs Pillow (`pip install pillow`)", file=sys.stderr)
    sys.exit(1)


def split(
    input_path: Path,
    out_dir: Path,
    prefix: str,
    sizes: list[int] | None = None,
) -> list[Path]:
    img = Image.open(input_path)
    w, h = img.size
    if w % 2 or h % 2:
        print(
            f"warning: {input_path.name} is {w}x{h} — not evenly divisible by 2; "
            f"crops will lose 1 pixel on the affected axis",
            file=sys.stderr,
        )
    half_w, half_h = w // 2, h // 2
    out_dir.mkdir(parents=True, exist_ok=True)
    crops = {
        "tl": (0, 0, half_w, half_h),
        "tr": (half_w, 0, w, half_h),
        "bl": (0, half_h, half_w, h),
        "br": (half_w, half_h, w, h),
    }
    written: list[Path] = []
    for tag, box in crops.items():
        quad = img.crop(box)
        if sizes:
            # Emit one file per requested size, suffixed with -{N}.
            # Lanczos resample produces the cleanest downscale.
            for size in sizes:
                resized = quad.resize((size, size), Image.Resampling.LANCZOS)
                out_path = out_dir / f"{prefix}-{tag}-{size}.png"
                resized.save(out_path, format="PNG")
                written.append(out_path)
                print(f"wrote {out_path} ({size}x{size})")
        else:
            out_path = out_dir / f"{prefix}-{tag}.png"
            quad.save(out_path, format="PNG")
            written.append(out_path)
            print(f"wrote {out_path} ({box[2] - box[0]}x{box[3] - box[1]})")
    return written


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("input", type=Path, help="Input image (2x2 grid)")
    p.add_argument(
        "--out-dir",
        type=Path,
        default=None,
        help="Output directory (default: input's directory)",
    )
    p.add_argument(
        "--prefix",
        default=None,
        help="Output filename prefix (default: input's stem)",
    )
    p.add_argument(
        "--sizes",
        default=None,
        help=(
            "Comma-separated pixel sizes for resized output (e.g. '32,48,64,192'). "
            "When omitted, writes one file per quadrant at the source resolution."
        ),
    )
    args = p.parse_args()
    if not args.input.exists():
        print(f"error: {args.input} not found", file=sys.stderr)
        return 1
    out_dir = args.out_dir or args.input.parent
    prefix = args.prefix or args.input.stem
    sizes: list[int] | None = None
    if args.sizes:
        try:
            sizes = [int(s) for s in args.sizes.split(",") if s.strip()]
        except ValueError:
            print(f"error: --sizes must be comma-separated ints, got '{args.sizes}'", file=sys.stderr)
            return 1
    split(args.input, out_dir, prefix, sizes)
    return 0


if __name__ == "__main__":
    sys.exit(main())
