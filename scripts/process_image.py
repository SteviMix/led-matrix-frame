#!/usr/bin/env python3
"""Processes an image into a renderer-ready 128x128 raw RGB file.

CLI: python3 process_image.py <input_path> <output_path>
                               [--crop-x X --crop-y Y --crop-w W --crop-h H]
                               [--dither | --no-dither]

Loads the input with OpenCV. If a crop rectangle is given, crops exactly that
region from the original; otherwise center-crops to a square (never
stretches). Resizes to 128x128, applies Floyd-Steinberg dithering (on by
default), and writes raw RGB bytes (row-major, R then G then B per pixel, no
header) - byte-identical to what the renderer expects over the socket.
Prints a JSON result to stdout so callers can parse it instead of guessing.
"""

import argparse
import json
import sys

import cv2
import numpy as np

TARGET_SIZE = 128

# Approximates the panel's real bit depth: LED matrices don't have full
# 8-bit-per-channel output in practice, and at 128x128 there are too few
# pixels to hide the resulting banding without dithering. 64 levels (6 bits)
# is a reasonable placeholder - see docs/project-summary.md, actual panel
# depth is unconfirmed until real hardware arrives.
DITHER_LEVELS = 64


def floyd_steinberg_dither(rgb, levels=DITHER_LEVELS):
    """Applies Floyd-Steinberg error-diffusion dithering, quantizing each
    channel to `levels` steps and spreading the rounding error to
    not-yet-processed neighbours so the eye blends it back in.

    Uses plain Python lists rather than repeated numpy scalar indexing -
    per-element numpy access in a tight loop is roughly 10x slower than
    this for an image this small (128x128), since each `img[y, x]` access
    carries numpy's array-object overhead rather than being a cheap list
    lookup.
    """
    height, width = rgb.shape[:2]
    pixels = rgb.astype(np.float64).tolist()
    step = 255.0 / (levels - 1)

    for y in range(height):
        row = pixels[y]
        next_row = pixels[y + 1] if y + 1 < height else None
        for x in range(width):
            old = row[x]
            new = [min(255.0, max(0.0, round(c / step) * step)) for c in old]
            row[x] = new
            error = [old[i] - new[i] for i in range(3)]

            if x + 1 < width:
                nb = row[x + 1]
                row[x + 1] = [nb[i] + error[i] * 7 / 16 for i in range(3)]
            if next_row is not None:
                if x - 1 >= 0:
                    nb = next_row[x - 1]
                    next_row[x - 1] = [nb[i] + error[i] * 3 / 16 for i in range(3)]
                nb = next_row[x]
                next_row[x] = [nb[i] + error[i] * 5 / 16 for i in range(3)]
                if x + 1 < width:
                    nb = next_row[x + 1]
                    next_row[x + 1] = [nb[i] + error[i] * 1 / 16 for i in range(3)]

    return np.clip(np.array(pixels), 0, 255).astype(np.uint8)


def process_image(input_path, output_path, crop=None, dither=True):
    image = cv2.imread(input_path, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"Could not read image at {input_path}")

    height, width = image.shape[:2]

    if crop is not None:
        crop_x, crop_y, crop_w, crop_h = crop
        if crop_w <= 0 or crop_h <= 0 or crop_x < 0 or crop_y < 0 or crop_x + crop_w > width or crop_y + crop_h > height:
            raise ValueError(
                f"Crop rectangle ({crop_x},{crop_y},{crop_w},{crop_h}) is out of bounds for {width}x{height} image"
            )
        cropped = image[crop_y:crop_y + crop_h, crop_x:crop_x + crop_w]
    else:
        # Center-crop to a square before resizing, so the result is never
        # stretched - a stretched face is immediately obvious on the panel.
        side = min(height, width)
        top = (height - side) // 2
        left = (width - side) // 2
        cropped = image[top:top + side, left:left + side]

    resized = cv2.resize(cropped, (TARGET_SIZE, TARGET_SIZE), interpolation=cv2.INTER_AREA)

    # OpenCV loads as BGR; the renderer protocol expects RGB.
    rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)

    if dither:
        rgb = floyd_steinberg_dither(rgb)

    raw_bytes = rgb.tobytes()
    expected_bytes = TARGET_SIZE * TARGET_SIZE * 3
    if len(raw_bytes) != expected_bytes:
        raise ValueError(f"Unexpected output size: {len(raw_bytes)} bytes, expected {expected_bytes}")

    with open(output_path, "wb") as f:
        f.write(raw_bytes)

    return {"ok": True, "width": TARGET_SIZE, "height": TARGET_SIZE, "bytes": len(raw_bytes)}


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("input_path")
    parser.add_argument("output_path")
    parser.add_argument("--crop-x", type=int)
    parser.add_argument("--crop-y", type=int)
    parser.add_argument("--crop-w", type=int)
    parser.add_argument("--crop-h", type=int)
    parser.add_argument("--dither", action=argparse.BooleanOptionalAction, default=True)
    return parser.parse_args()


def main():
    args = parse_args()

    crop_values = [args.crop_x, args.crop_y, args.crop_w, args.crop_h]
    if any(v is not None for v in crop_values) and any(v is None for v in crop_values):
        print(json.dumps({"ok": False, "error": "--crop-x/y/w/h must all be given together."}))
        sys.exit(1)
    crop = tuple(crop_values) if crop_values[0] is not None else None

    try:
        result = process_image(args.input_path, args.output_path, crop=crop, dither=args.dither)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
