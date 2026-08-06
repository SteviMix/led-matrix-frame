#!/usr/bin/env python3
"""Analyzes an image for paint-by-number mode: builds a colour palette via
K-means, divides the 128x128 canvas into a difficulty-sized block grid, and
determines each block's correct palette colour (its "number").

CLI: python3 pbn_analyze.py <input_path> <difficulty> <output_json_path>

difficulty -> grid size (block size over the 128x128 canvas):
  easy   -> 16x16 blocks (8x8 px each)  ->  256 blocks
  medium -> 32x32 blocks (4x4 px each)  -> 1024 blocks
  hard   -> 64x64 blocks (2x2 px each)  -> 4096 blocks
Each step doubles both grid dimensions, so block area quarters each time.
"hard" at 2x2 px is close to per-pixel painting, which is appropriate as
the top difficulty - there's nowhere higher to go on a 128x128 panel
without painting individual pixels.

Writes two files:
  - <output_json_path> - the analysis result (see below)
  - the full-res 128x128 original as a raw RGB file (same basename, .rgb
    extension) - used for the paint-by-number reveal effect. This is the
    plain resized image, NOT dithered: the reveal should show genuine
    photo detail, not a display-adapted approximation of it. Its path is
    reported in the JSON as full_res_path.

JSON output: {"ok": true, "grid_width", "grid_height",
"palette": [[r,g,b], ...] (index IS the number shown to the user),
"block_colors": [paletteIndex, ...] (row-major, length grid_width*grid_height),
"full_res_path": "..."}
"""

import json
import sys

import cv2
import numpy as np
from sklearn.cluster import KMeans

from image_utils import load_and_prepare

DIFFICULTY_GRID_SIZES = {
    "easy": 16,
    "medium": 32,
    "hard": 64,
}

# "e.g. 12-16" per the project plan; fixed for now, could become a
# user-facing choice later.
PALETTE_SIZE = 16


def build_palette(rgb, n_colors, use_lab=False):
    """K-means over the image's pixels. Clusters in RGB by default; pass
    use_lab=True to cluster in LAB instead - distances in LAB approximate
    how different two colours *look* to the human eye, which RGB distance
    doesn't (see docs/project-summary.md, Future Improvements). Same
    algorithm either way, only the colour space (and converting back) differs.

    Returns (labels, palette): labels is an (H, W) array of palette indices
    per pixel; palette is an (n_colors, 3) uint8 RGB array, indexed the same
    way the block colours reference it.
    """
    work = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB) if use_lab else rgb

    height, width = work.shape[:2]
    pixels = work.reshape(-1, 3).astype(np.float32)

    kmeans = KMeans(n_clusters=n_colors, n_init=10, random_state=42)
    flat_labels = kmeans.fit_predict(pixels)
    centers = kmeans.cluster_centers_.astype(np.uint8)

    if use_lab:
        palette = cv2.cvtColor(centers.reshape(1, -1, 3), cv2.COLOR_LAB2RGB).reshape(-1, 3)
    else:
        palette = centers

    labels = flat_labels.reshape(height, width)
    return labels, palette


def compute_block_colors(labels, grid_size):
    """For each grid_size x grid_size block, the block's colour is the most
    common (dominant) palette index among its pixels - not the average
    colour, which can turn muddy where a block straddles two regions."""
    height, width = labels.shape
    block_h = height // grid_size
    block_w = width // grid_size

    block_colors = []
    for by in range(grid_size):
        for bx in range(grid_size):
            block = labels[by * block_h:(by + 1) * block_h, bx * block_w:(bx + 1) * block_w]
            counts = np.bincount(block.flatten())
            block_colors.append(int(np.argmax(counts)))

    return block_colors


def analyze(input_path, difficulty, output_json_path):
    if difficulty not in DIFFICULTY_GRID_SIZES:
        raise ValueError(f"difficulty must be one of: {', '.join(DIFFICULTY_GRID_SIZES)}")

    grid_size = DIFFICULTY_GRID_SIZES[difficulty]

    rgb = load_and_prepare(input_path)

    labels, palette = build_palette(rgb, PALETTE_SIZE, use_lab=False)
    block_colors = compute_block_colors(labels, grid_size)

    full_res_path = output_json_path.rsplit(".", 1)[0] + ".rgb"
    with open(full_res_path, "wb") as f:
        f.write(rgb.tobytes())

    result = {
        "ok": True,
        "grid_width": grid_size,
        "grid_height": grid_size,
        "palette": palette.tolist(),
        "block_colors": block_colors,
        "full_res_path": full_res_path,
    }

    with open(output_json_path, "w") as f:
        json.dump(result, f)

    return result


def main():
    if len(sys.argv) != 4:
        print(json.dumps({"ok": False, "error": "Usage: pbn_analyze.py <input_path> <difficulty> <output_json_path>"}))
        sys.exit(1)

    input_path, difficulty, output_json_path = sys.argv[1], sys.argv[2], sys.argv[3]

    try:
        result = analyze(input_path, difficulty, output_json_path)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
