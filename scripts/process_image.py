#!/usr/bin/env python3
"""Processes an image into a renderer-ready 128x128 raw RGB file.

CLI: python3 process_image.py <input_path> <output_path>

Loads the input with OpenCV, center-crops to a square (never stretches),
resizes to exactly 128x128, and writes raw RGB bytes (row-major, R then G
then B per pixel, no header) - byte-identical to what the renderer expects
over the socket. Prints a JSON result to stdout so callers can parse it
instead of guessing.

Phase 2 scope only: plain resize. No dithering, colour quantisation, or
LAB conversion - those are Phase 3.
"""

import json
import sys

import cv2

TARGET_SIZE = 128


def process_image(input_path, output_path):
    image = cv2.imread(input_path, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"Could not read image at {input_path}")

    height, width = image.shape[:2]

    # Center-crop to a square before resizing, so the result is never
    # stretched - a stretched face is immediately obvious on the panel.
    side = min(height, width)
    top = (height - side) // 2
    left = (width - side) // 2
    cropped = image[top:top + side, left:left + side]

    resized = cv2.resize(cropped, (TARGET_SIZE, TARGET_SIZE), interpolation=cv2.INTER_AREA)

    # OpenCV loads as BGR; the renderer protocol expects RGB.
    rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)

    raw_bytes = rgb.tobytes()
    expected_bytes = TARGET_SIZE * TARGET_SIZE * 3
    if len(raw_bytes) != expected_bytes:
        raise ValueError(f"Unexpected output size: {len(raw_bytes)} bytes, expected {expected_bytes}")

    with open(output_path, "wb") as f:
        f.write(raw_bytes)

    return {"ok": True, "width": TARGET_SIZE, "height": TARGET_SIZE, "bytes": len(raw_bytes)}


def main():
    if len(sys.argv) != 3:
        print(json.dumps({"ok": False, "error": "Usage: process_image.py <input_path> <output_path>"}))
        sys.exit(1)

    input_path, output_path = sys.argv[1], sys.argv[2]

    try:
        result = process_image(input_path, output_path)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()