#!/usr/bin/env python3
"""Converts a raw 128x128 RGB file (the renderer/canvas wire format) into a
viewable PNG.

Used when saving a live-drawing canvas: the canvas is already in the exact
raw format the renderer expects (no crop/resize needed), but original_path
needs to be a real, decodable image file - e.g. so /api/images/:id/crop can
later cv2.imread() it like any other image, and so it can be shown in a
browser <img> tag.

CLI: python3 raw_to_png.py <raw_rgb_path> <png_output_path>
"""

import json
import sys

import numpy as np
from PIL import Image

WIDTH = 128
HEIGHT = 128
EXPECTED_BYTES = WIDTH * HEIGHT * 3


def raw_to_png(raw_path, png_path):
    with open(raw_path, "rb") as f:
        raw_bytes = f.read()

    if len(raw_bytes) != EXPECTED_BYTES:
        raise ValueError(f"Expected {EXPECTED_BYTES} bytes, got {len(raw_bytes)}")

    arr = np.frombuffer(raw_bytes, dtype=np.uint8).reshape(HEIGHT, WIDTH, 3)
    Image.fromarray(arr, "RGB").save(png_path)

    return {"ok": True, "width": WIDTH, "height": HEIGHT}


def main():
    if len(sys.argv) != 3:
        print(json.dumps({"ok": False, "error": "Usage: raw_to_png.py <raw_rgb_path> <png_output_path>"}))
        sys.exit(1)

    raw_path, png_path = sys.argv[1], sys.argv[2]

    try:
        result = raw_to_png(raw_path, png_path)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
