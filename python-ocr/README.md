# Python OCR microservice (optional)

FastAPI service that runs Tesseract + OpenCV for CNIC OCR. The Node backend calls this when `OCR_PYTHON_ENABLED` is `true`; if the service fails, Node falls back to Tesseract.js.

## Prerequisites

- Python 3.10+ and a virtualenv (see `requirements.txt`)
- [Tesseract OCR](https://github.com/tesseract-ocr/tesseract) installed on the machine
- On Windows, set `TESSERACT_CMD` to the full path to `tesseract.exe`

## Install

```powershell
cd python-ocr
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## 1. Start Python (Windows PowerShell)

```powershell
cd python-ocr
.\venv\Scripts\Activate.ps1
$env:TESSERACT_CMD = "C:\Program Files\Tesseract-OCR\tesseract.exe"
uvicorn app:app --host 127.0.0.1 --port 8001
```

## 2. Test health

Open in a browser or use curl:

`http://127.0.0.1:8001/health`

You should see JSON with `tesseractAvailable: true` when Tesseract is reachable.

## 3. Test OCR with PowerShell

Replace the path with a real JPEG/PNG on disk (use a CNIC front image from your GatePass uploads folder):

```powershell
Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:8001/ocr/cnic `
  -ContentType "application/json" `
  -Body '{"imageAbsPath":"D:\\GatePass-Automation\\backend\\uploads\\cnic-front\\YYYY-MM-DD\\file.jpg"}'
```

The body may use either `imageAbsPath` or `imagePath` (same value).

## Node settings

In app settings (or DB `settings` table):

- `OCR_PYTHON_ENABLED` = `true`
- `OCR_PYTHON_BASE_URL` = `http://127.0.0.1:8001` (or your LAN URL)
- `OCR_PYTHON_TIMEOUT_MS` = `10000` (optional)

## Troubleshooting

- **`/health` shows `tesseractAvailable: false`** — Install Tesseract or set `TESSERACT_CMD` correctly, then restart uvicorn.
- **`Image file not found`** — The path must be readable by the Python process (same machine as Node, or use a path the Python host can access).
- Check the uvicorn terminal: errors print a short traceback for development.
