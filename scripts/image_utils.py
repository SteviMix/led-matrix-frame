"""Shared image loading/crop/resize helpers.

Used by both process_image.py and pbn_analyze.py so every script that turns
an arbitrary photo into a 128x128 renderer-format image crops and resizes it
identically.
"""

import cv2

TARGET_SIZE = 128


def load_and_prepare(input_path, crop=None):
    """Loads an image with OpenCV, applies the given crop rectangle
    (crop_x, crop_y, crop_w, crop_h) or center-crops to a square (never
    stretches), resizes to 128x128, and returns it as an RGB numpy array
    (OpenCV loads as BGR, so this converts before returning)."""
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
    return cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
