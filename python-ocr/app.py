from __future__ import annotations

import os
import traceback
from contextlib import asynccontextmanager
from typing import Any

import cv2
import numpy as np
import pytesseract
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from image_processing import load_bgr_with_exif, normalize_image_path


def _configure_tesseract_from_env() -> None:
    cmd = os.environ.get("TESSERACT_CMD", "").strip()
    if cmd:
        pytesseract.pytesseract.tesseract_cmd = cmd
        print(f"[python-ocr] TESSERACT_CMD -> {cmd}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    _configure_tesseract_from_env()
    yield


app = FastAPI(title="GatePass OCR (Python)", lifespan=lifespan)


def _tesseract_cmd_display() -> str:
    return str(getattr(pytesseract.pytesseract, "tesseract_cmd", "") or "")


def _tesseract_available() -> bool:
    try:
        pytesseract.get_tesseract_version()
        return True
    except Exception:
        return False


@app.get("/health")
def health() -> dict[str, Any]:
    cmd = os.environ.get("TESSERACT_CMD", "").strip()
    configured = bool(cmd)
    available = _tesseract_available()
    return {
        "success": True,
        "service": "python-ocr",
        "tesseractConfigured": configured,
        "tesseractCmd": _tesseract_cmd_display(),
        "tesseractAvailable": available,
    }


def preprocess_image(image_bgr: np.ndarray, target_width: int) -> np.ndarray:
    h, w = image_bgr.shape[:2]
    if w > 0 and target_width > 0 and w != target_width:
        scale = target_width / float(w)
        new_h = max(1, int(h * scale))
        image_bgr = cv2.resize(image_bgr, (target_width, new_h), interpolation=cv2.INTER_AREA)

    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    gray = cv2.normalize(gray, None, 0, 255, cv2.NORM_MINMAX)
    blur = cv2.GaussianBlur(gray, (0, 0), 1.2)
    sharp = cv2.addWeighted(gray, 1.4, blur, -0.4, 0)
    return sharp


def _err_400(message: str) -> JSONResponse:
    return JSONResponse(
        status_code=400,
        content={
            "success": False,
            "engine": "python",
            "message": message,
        },
    )


def _err_500_tesseract() -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "engine": "python",
            "message": "Tesseract OCR executable not found. Install Tesseract or set TESSERACT_CMD.",
        },
    )


def _err_500_ocr_failed(short: str) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "engine": "python",
            "message": "Python OCR failed",
            "error": short[:500],
        },
    )


@app.post("/ocr/cnic")
async def ocr_cnic(request: Request) -> JSONResponse:
    try:
        try:
            body = await request.json()
        except Exception:
            return _err_400("Invalid JSON body.")

        if not isinstance(body, dict):
            return _err_400("Request body must be a JSON object.")

        raw_abs = body.get("imageAbsPath")
        raw_path = body.get("imagePath")
        image_path = ""
        if isinstance(raw_abs, str) and raw_abs.strip():
            image_path = raw_abs.strip()
        if not image_path and isinstance(raw_path, str) and raw_path.strip():
            image_path = raw_path.strip()
        if not image_path:
            return _err_400("Missing image path. Expected imageAbsPath or imagePath.")

        print(f"[python-ocr] /ocr/cnic image path (raw): {image_path!r}")

        normalized = normalize_image_path(image_path)
        print(f"[python-ocr] /ocr/cnic image path (normalized): {normalized!r}")

        if not os.path.exists(normalized):
            return JSONResponse(
                status_code=400,
                content={
                    "success": False,
                    "engine": "python",
                    "message": "Image file not found",
                    "imagePath": normalized,
                },
            )

        if not _tesseract_available():
            return _err_500_tesseract()

        fast_mode = body.get("fastMode", True)
        if isinstance(fast_mode, str):
            fast_mode = fast_mode.lower() not in ("false", "0", "no")

        target_width = 1350 if fast_mode else 2000

        image_bgr = load_bgr_with_exif(normalized)
        processed = preprocess_image(image_bgr, target_width=target_width)

        config = "--oem 3 --psm 6 -l eng"
        raw_text = pytesseract.image_to_string(processed, config=config)

        return JSONResponse(
            status_code=200,
            content={
                "success": True,
                "rawText": raw_text or "",
            },
        )
    except Exception as e:
        traceback.print_exc()
        short = str(e).strip() or type(e).__name__
        return _err_500_ocr_failed(short)
