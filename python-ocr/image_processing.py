"""Image load helpers for CNIC OCR (OpenCV + optional PIL EXIF)."""

from __future__ import annotations

import os

import cv2
import numpy as np
from PIL import Image, ImageOps


def normalize_image_path(image_path: str) -> str:
    """Normalize paths (Windows backslashes, expand user/env)."""
    return os.path.normpath(os.path.expandvars(os.path.expanduser(str(image_path).strip())))


def imread_bgr_cv2(image_path: str) -> np.ndarray:
    """
    Read BGR image with cv2.imread; fallback to imdecode for paths OpenCV mishandles on Windows.
    Raises ValueError if OpenCV cannot decode pixels.
    """
    normalized = normalize_image_path(image_path)
    img = cv2.imread(normalized)
    if img is None:
        try:
            data = np.fromfile(normalized, dtype=np.uint8)
            img = cv2.imdecode(data, cv2.IMREAD_COLOR)
        except OSError:
            img = None
    if img is None:
        raise ValueError(
            "OpenCV could not read image. File may be invalid or path has issue."
        )
    return img


def load_bgr_with_exif(image_path: str) -> np.ndarray:
    """
    Load image as BGR ndarray. Validates readability with OpenCV, then prefers PIL for EXIF orientation.
    """
    normalized = normalize_image_path(image_path)
    if not os.path.exists(normalized):
        raise FileNotFoundError("Image file not found")

    # Part E: ensure OpenCV can read bytes from this path before Tesseract pipeline
    imread_bgr_cv2(normalized)

    try:
        with Image.open(normalized) as im:
            im = ImageOps.exif_transpose(im)
            im_rgb = im.convert("RGB")
            arr = np.array(im_rgb)
        if arr.size == 0:
            raise ValueError(
                "OpenCV could not read image. File may be invalid or path has issue."
            )
        return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
    except ValueError:
        raise
    except Exception:
        # Corrupt TIFF / odd format: fall back to raw OpenCV read (no EXIF fix)
        return imread_bgr_cv2(normalized)
