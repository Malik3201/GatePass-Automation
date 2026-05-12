# Gate Pass Automation — Backend

Node.js + Express + MySQL backend for a **LAN** visitor / gate entry pass system. Images are stored on disk; the database stores paths and visitor details only (no BLOBs).

## Prerequisites

- [Node.js](https://nodejs.org/) (LTS recommended)
- [MySQL](https://dev.mysql.com/downloads/mysql/) 8.x (or compatible)

## Install

From the `backend` folder:

```bash
cd backend
npm install
```

## Database setup

1. Log into MySQL (as `root` or a user that can create databases).
2. Run the schema script (creates DB, tables, and default settings):

```bash
mysql -u root -p < database/schema.sql
```

On Windows (PowerShell), you can use:

```bash
Get-Content database/schema.sql | mysql -u root -p
```

## Configure environment

Copy the example env file and edit values:

```bash
copy .env.example .env
```

On macOS/Linux:

```bash
cp .env.example .env
```

Important variables:

| Variable     | Description                          |
|-------------|--------------------------------------|
| `PORT`      | API port (default `5000`)          |
| `DB_*`      | MySQL connection                     |
| `BASE_URL`  | Public base URL for links/docs      |

## Run the server

Development (auto-restart with **nodemon**):

```bash
npm run dev
```

Production-style:

```bash
npm start
```

You should see: `Gate Pass API listening on http://localhost:5000`

## Web UI (plain HTML)

After `npm run dev`, open the dashboard in a browser:

- **Dashboard:** `http://localhost:5000/` (same as `index.html`)
- **New visitor:** `http://localhost:5000/visitor-entry.html`
- **Visitors list:** `http://localhost:5000/visitors.html`
- **Printable pass:** `http://localhost:5000/pass.html?id=123`
- **Settings:** `http://localhost:5000/settings.html`
- **Export / backup:** `http://localhost:5000/export.html`

From a phone on the same Wi‑Fi, use your PC’s LAN IP instead of `localhost` (example: `http://192.168.1.10:5000/`).

Static files live in `public/` (`index.html`, pages, `assets/css`, `assets/js`).

### Typical operator workflow

1. **Settings** — set company name, gate name, camera **stream** URL (preview) and **snapshot** URL (captures). Optionally set **separate visitor and CNIC camera URLs** and **auto capture** options (see below).
2. **New visitor** — load stream preview, **capture** visitor photo and CNIC front/back (or **upload** files if the camera URL fails). Use **Auto Capture Mode** at the top for a guided non-touch flow when cameras and lighting are set up well.
3. **Run OCR** on the CNIC front — verify/correct **name** and **CNIC** manually (OCR is often wrong).
4. **Save visitor** — opens **pass** page; **Print** for a paper badge.
5. **Visitors** — search, **checkout** when the visitor leaves, re-open **pass** if needed.
6. **Export** — pick a date; download **CSV** and **Excel**; image copies are placed under `backups/YYYY-MM-DD/images/...` and are browseable at `/backups/...`.

### Auto Capture (non-touch) mode

The **New visitor** page (`visitor-entry.html`) includes an optional **Auto Capture Mode** panel:

- Polls the visitor snapshot URL through **`GET /api/camera/snapshot-proxy`** (avoids browser CORS when analyzing pixels).
- **face-api.js** and **TinyFaceDetector** weights are bundled under `public/assets/vendor/` (same origin). Auto mode tries those first, then CDNs if you replace or omit vendor files.
- Loads **OpenCV.js** from **docs.opencv.org** (large WASM; first load can take 1–2 minutes). If OpenCV cannot load, a **simple center-box fallback** still allows auto CNIC capture with lower accuracy — use manual capture when in doubt.
- **Company** is never auto-filled; the operator must enter it and verify all fields before **Save**.

**Important:** Auto mode depends on **camera quality, lighting, fixed visitor position, and LAN speed**. For real deployments prefer a **fixed standing mark**, **CNIC tray or holder**, **even lighting**, **no glare**, and **stable IP cameras**. **Manual capture, upload, OCR, and save** remain available if CDN libraries fail to load or detection is unreliable.

**Settings keys** (also in `database/schema.sql` defaults): `VISITOR_CAMERA_STREAM_URL`, `VISITOR_CAMERA_SNAPSHOT_URL`, `CNIC_CAMERA_STREAM_URL`, `CNIC_CAMERA_SNAPSHOT_URL`, `AUTO_CAPTURE_ENABLED`, `AUTO_FACE_COUNTDOWN_SECONDS`, `AUTO_CNIC_COUNTDOWN_SECONDS`. Empty visitor/CNIC URLs fall back to legacy `CAMERA_STREAM_URL` / `CAMERA_SNAPSHOT_URL`.

If you already created the database from an older schema, add missing keys manually, for example:

```sql
INSERT IGNORE INTO settings (setting_key, setting_value) VALUES
  ('VISITOR_CAMERA_STREAM_URL', ''),
  ('VISITOR_CAMERA_SNAPSHOT_URL', ''),
  ('CNIC_CAMERA_STREAM_URL', ''),
  ('CNIC_CAMERA_SNAPSHOT_URL', ''),
  ('AUTO_CAPTURE_ENABLED', 'false'),
  ('AUTO_FACE_COUNTDOWN_SECONDS', '3'),
  ('AUTO_CNIC_COUNTDOWN_SECONDS', '3');
```

## Static files & folders

- **Uploaded images:** `GET /uploads/...`
- **Exports:** `GET /exports/YYYY-MM-DD/visitors.csv` (and `.xlsx`)
- **Backup copies of images:** `GET /backups/YYYY-MM-DD/images/...` (created by **Export**)

## Example API calls

Replace host/port as needed. Use `curl` or any REST client.

### Health / info

`GET /` serves the **HTML dashboard** (best opened in a browser). For a quick JSON check, use any API route, for example:

```bash
curl http://localhost:5000/api/settings
```

### Settings

```bash
curl http://localhost:5000/api/settings
```

```bash
curl -X POST http://localhost:5000/api/settings -H "Content-Type: application/json" -d "{\"setting_key\":\"CAMERA_SNAPSHOT_URL\",\"setting_value\":\"http://192.168.1.25:8080/shot.jpg\"}"
```

```bash
curl -X PUT http://localhost:5000/api/settings/CAMERA_SNAPSHOT_URL -H "Content-Type: application/json" -d "{\"setting_value\":\"http://192.168.1.25:8080/shot.jpg\"}"
```

### Capture from IP camera (mobile as webcam on same Wi‑Fi)

Body: `snapshotUrl` (optional if per-type or `CAMERA_SNAPSHOT_URL` is set in settings), `type` = `visitor` | `cnic-front` | `cnic-back`. The server resolves `snapshotUrl` in this order: body value, then `VISITOR_CAMERA_SNAPSHOT_URL` or `CNIC_CAMERA_SNAPSHOT_URL` by type, then `CAMERA_SNAPSHOT_URL`.

```bash
curl -X POST http://localhost:5000/api/camera/capture -H "Content-Type: application/json" -d "{\"snapshotUrl\":\"http://192.168.1.25:8080/shot.jpg\",\"type\":\"visitor\"}"
```

### Snapshot proxy (for browser auto-capture)

Returns raw **JPEG** bytes so the frontend can run face/card checks without CORS blocking `canvas` reads:

```bash
curl -o snap.jpg "http://localhost:5000/api/camera/snapshot-proxy?url=http%3A%2F%2F192.168.1.25%3A8080%2Fshot.jpg"
```

Test URL without saving:

```bash
curl "http://localhost:5000/api/camera/test?snapshotUrl=http://192.168.1.25:8080/shot.jpg"
```

### Upload visitor photo (multipart)

Field name must be **`image`**:

```bash
curl -X POST http://localhost:5000/api/visitors/upload-photo -F "image=@C:/path/to/photo.jpg"
```

### OCR on existing upload path

```bash
curl -X POST http://localhost:5000/api/ocr/cnic -H "Content-Type: application/json" -d "{\"imagePath\":\"/uploads/cnic-front/2026-05-13/your-file.jpg\"}"
```

### OCR on uploaded file

```bash
curl -X POST http://localhost:5000/api/ocr/cnic-file -F "image=@C:/path/to/cnic.jpg"
```

> **Note:** OCR is not reliable. The operator must always verify and correct CNIC and name in the UI before saving.

OCR responses include `extracted` (`visitor_name`, `father_name`, `cnic_no`), nested `confidence` (`high` / `medium` / `low` / `none` per field), `rawText`, and `cleanedLines`.

### Create visitor

Minimum: `visitor_name`, `cnic_no`. `pass_no` is generated automatically. If `time_in` is omitted, the server sets current time.

```bash
curl -X POST http://localhost:5000/api/visitors -H "Content-Type: application/json" -d "{\"visitor_name\":\"Ali Khan\",\"cnic_no\":\"12345-1234567-1\",\"purpose\":\"Delivery\",\"visitor_photo_path\":\"/uploads/visitors/2026-05-13/photo.jpg\"}"
```

### List / filter visitors

```bash
curl "http://localhost:5000/api/visitors?date=2026-05-13"
curl "http://localhost:5000/api/visitors?cnic_no=12345"
```

### Checkout (set `time_out` to now)

```bash
curl -X PATCH http://localhost:5000/api/visitors/1/checkout
```

### Daily export (CSV + Excel + image backup)

```bash
curl "http://localhost:5000/api/export/daily?date=2026-05-13"
```

The JSON response includes `csvPath`, `xlsxPath`, and `backupFolder` (for example `/backups/2026-05-13`). Files are written under:

- `backend/exports/YYYY-MM-DD/visitors.csv` and `visitors.xlsx`
- `backend/backups/YYYY-MM-DD/images/{visitors,cnic-front,cnic-back}/` (copies of files referenced in the database for that day)

## Testing a mobile phone as an IP camera

1. Connect the **phone** and **laptop** to the **same Wi‑Fi**.
2. Install an IP webcam app (e.g. IP Webcam, DroidCam, or similar).
3. Start the server and note the **snapshot** URL from the app (often something like `http://192.168.x.x:8080/shot.jpg`).
4. Optional: save it in settings (`CAMERA_SNAPSHOT_URL`) or pass it in the body of `POST /api/camera/capture`.
5. Call `POST /api/camera/capture` with `type` set to `visitor`, `cnic-front`, or `cnic-back` as needed.
6. Open the returned `path` in a browser: `http://<laptop-ip>:5000/uploads/...`
7. Or use **New visitor** in the web UI: paste the same snapshot URL, use **Test snapshot**, then **Capture**.

### Example snapshot URL

Many phone apps expose something like: `http://192.168.1.25:8080/shot.jpg` (IP and port depend on your phone and app).

### OCR limitations

- OCR mistakes are common on glare, blur, or low light.
- The **New visitor** page always shows **raw OCR text** for debugging.
- The operator **must** verify CNIC and name before saving.

### Production notes

- Prefer a **fixed IP camera** with stable power and network.
- Use **good, even lighting** at the desk/gate.
- Ask the visitor to stand in a **marked position** for the face photo.
- Keep the **CNIC scan area** flat; avoid **glare** from overhead lights.
- **Always verify** OCR fields against the physical CNIC.

## Project layout (backend)

- `src/app.js` — Express app, middleware, static files, routes
- `src/server.js` — starts HTTP server
- `src/config/` — env + MySQL pool
- `src/routes/`, `src/controllers/`, `src/services/` — layered API logic
- `src/middleware/` — uploads + errors
- `src/utils/` — pass numbers, paths, validation
- `database/schema.sql` — MySQL schema + default settings
- `public/` — operator web UI (HTML, CSS, JS)
- `uploads/`, `exports/`, `backups/` — local files (created automatically)

## Troubleshooting

- **Cannot connect to MySQL:** check `DB_HOST`, `DB_USER`, `DB_PASSWORD`, and that the database `gatepass_automation` exists.
- **Camera capture fails:** confirm the snapshot URL works in a browser on the laptop; some apps need HTTPS off or a specific path; axios timeout is 10 seconds.
- **OCR slow / high CPU:** first run may download Tesseract language data; later runs are faster on the same machine.
