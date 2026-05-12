/**
 * Auto Capture / Non-Touch Mode — browser-side helpers.
 *
 * Uses backend GET /api/camera/snapshot-proxy (avoids camera CORS for canvas analysis)
 * and POST /api/camera/capture, POST /api/ocr/cnic.
 *
 * Optional CDNs on visitor-entry.html:
 * - face-api.js (visitor face)
 * - OpenCV.js loaded on demand from docs.opencv.org; if it fails, a simple canvas fallback is used for CNIC stability.
 *
 * Manual capture always remains available if libraries or detection fail.
 */

import { apiPost } from './api.js';

export const AutoState = {
  idle: 'idle',
  waiting_face: 'waiting_face',
  face_countdown: 'face_countdown',
  capturing_face: 'capturing_face',
  waiting_cnic: 'waiting_cnic',
  cnic_countdown: 'cnic_countdown',
  capturing_cnic: 'capturing_cnic',
  running_ocr: 'running_ocr',
  ready_for_review: 'ready_for_review',
  stopped: 'stopped',
  error: 'error',
};

const POLL_MS_MIN = 700;
const POLL_MS_MAX = 1000;
const STABLE_MS = 1000;

function randomPollMs() {
  return POLL_MS_MIN + Math.floor(Math.random() * (POLL_MS_MAX - POLL_MS_MIN + 1));
}

export function snapshotProxyUrl(snapshotUrl) {
  return `/api/camera/snapshot-proxy?url=${encodeURIComponent(snapshotUrl)}`;
}

/** Fetch snapshot via proxy; returns Image and revoke() for the object URL. */
export async function fetchSnapshotAsImage(snapshotUrl) {
  const url = snapshotProxyUrl(snapshotUrl);
  const res = await fetch(url);
  if (!res.ok) {
    let msg = `Snapshot proxy HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j && j.message) msg = j.message;
    } catch {
      /* ignore */
    }
    const err = new Error(msg);
    err.hint = 'Check camera snapshot URLs in Settings and LAN connectivity.';
    throw err;
  }
  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  const img = new Image();
  img.decoding = 'async';
  await new Promise((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Could not decode snapshot image'));
    img.src = objUrl;
  });
  if (typeof img.decode === 'function') {
    try {
      await img.decode();
    } catch {
      /* optional; natural dimensions usually set after onload */
    }
  }
  return { img, revoke: () => URL.revokeObjectURL(objUrl) };
}

export async function captureImage(snapshotUrl, type) {
  const res = await apiPost('/api/camera/capture', { snapshotUrl, type });
  if (!res || !res.path) throw new Error('Capture did not return a path');
  return res.path;
}

// --- face-api.js (optional) ---
// Prefer same-origin files under /assets/vendor/ (works when CDNs are blocked on LAN).
// Fallback: jsDelivr / unpkg. TinyFaceDetector weights: local folder then GitHub via jsDelivr.
const FACE_SCRIPT_URLS = [
  '/assets/vendor/face-api.min.js',
  'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js',
  'https://unpkg.com/face-api.js@0.22.2/dist/face-api.min.js',
];

const FACE_MODEL_URIS = [
  '/assets/vendor/face-api-weights',
  'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@v0.22.2/weights',
];

let faceScriptLoadPromise = null;
let faceModelsLoaded = false;
let faceModelsLoadPromise = null;
/** Last load error (short string) for operator hints when models fail over the network. */
let lastFaceModelLoadError = '';

/**
 * Inject face-api.min.js from local vendor first, then public CDNs.
 * Call before ensureFaceModels() when the page does not include a face-api script tag.
 */
export function loadFaceApiScript() {
  if (typeof window !== 'undefined' && window.faceapi) return Promise.resolve(true);
  if (faceScriptLoadPromise) return faceScriptLoadPromise;
  faceScriptLoadPromise = (async () => {
    for (const url of FACE_SCRIPT_URLS) {
      if (window.faceapi) return true;
      const ok = await new Promise((resolve) => {
        const s = document.createElement('script');
        s.async = true;
        s.src = url;
        s.onload = () => {
          if (window.faceapi) {
            resolve(true);
            return;
          }
          s.remove();
          resolve(false);
        };
        s.onerror = () => {
          s.remove();
          resolve(false);
        };
        document.head.appendChild(s);
      });
      if (ok) return true;
    }
    faceScriptLoadPromise = null;
    return false;
  })();
  return faceScriptLoadPromise;
}

/** Wait until `window.faceapi` exists (e.g. after loadFaceApiScript). */
export function waitForFaceApiGlobal(timeoutMs = 60000) {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.faceapi) return Promise.resolve(true);
  return new Promise((resolve) => {
    const t0 = Date.now();
    const id = setInterval(() => {
      if (window.faceapi) {
        clearInterval(id);
        resolve(true);
      } else if (Date.now() - t0 > timeoutMs) {
        clearInterval(id);
        resolve(false);
      }
    }, 80);
  });
}

async function ensureFaceModels() {
  if (!window.faceapi) return false;
  if (faceModelsLoaded) return true;
  if (faceModelsLoadPromise) return faceModelsLoadPromise;
  faceModelsLoadPromise = (async () => {
    for (const uri of FACE_MODEL_URIS) {
      try {
        await faceapi.nets.tinyFaceDetector.loadFromUri(uri);
        lastFaceModelLoadError = '';
        faceModelsLoaded = true;
        return true;
      } catch (e) {
        lastFaceModelLoadError = e && e.message ? String(e.message) : String(e);
      }
    }
    faceModelsLoaded = false;
    faceModelsLoadPromise = null;
    return false;
  })();
  return faceModelsLoadPromise;
}

export async function analyzeFace(imgEl) {
  const ready = await ensureFaceModels();
  if (!ready || !window.faceapi) {
    return { ok: false, reason: 'library', message: 'Face detection models not available.' };
  }
  const w = imgEl.naturalWidth || imgEl.width;
  const h = imgEl.naturalHeight || imgEl.height;
  if (w < 80 || h < 80) {
    return { ok: false, reason: 'small', message: 'Image too small.' };
  }

  const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.45 });
  const dets = await faceapi.detectAllFaces(imgEl, opts);
  if (!dets || !dets.length) {
    return { ok: false, reason: 'none', message: 'No face detected' };
  }

  const det = dets.sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height)[0];
  const box = det.box;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const faceArea = box.width * box.height;
  const imgArea = w * h;
  const frac = faceArea / imgArea;

  if (frac < 0.018) return { ok: false, reason: 'far', message: 'Move closer to camera' };
  if (frac > 0.52) return { ok: false, reason: 'close', message: 'Move back — face too large' };
  if (Math.abs(cx - w / 2) > w * 0.24) return { ok: false, reason: 'center', message: 'Keep face centered' };
  if (Math.abs(cy - h / 2) > h * 0.3) return { ok: false, reason: 'center', message: 'Keep face centered' };
  const m = Math.min(w, h) * 0.04;
  if (box.x < m || box.y < m || box.x + box.width > w - m || box.y + box.height > h - m) {
    return { ok: false, reason: 'edge', message: 'Keep face centered' };
  }

  return { ok: true, box, det };
}

/** Simple whole-frame sharpness hint (larger = sharper). */
function quickLumaVariance(imgEl, sx = 48) {
  const c = document.createElement('canvas');
  const w = imgEl.naturalWidth || imgEl.width;
  const h = imgEl.naturalHeight || imgEl.height;
  const sw = Math.min(sx, w);
  const sh = Math.max(1, Math.round((h / w) * sw));
  c.width = sw;
  c.height = sh;
  const ctx = c.getContext('2d');
  if (!ctx) return 999;
  ctx.drawImage(imgEl, 0, 0, sw, sh);
  const data = ctx.getImageData(0, 0, sw, sh).data;
  let sum = 0;
  const pixels = sw * sh;
  const lumas = new Float32Array(pixels);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const L = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    lumas[p] = L;
    sum += L;
  }
  const mean = sum / pixels;
  let v = 0;
  for (let p = 0; p < pixels; p++) {
    const d = lumas[p] - mean;
    v += d * d;
  }
  return v / pixels;
}

// --- OpenCV.js (optional) ---
// Official OpenCV.js build (large file; first load can take ~30–90s on slow links).
// Old npm paths like @techstark/opencv-js@4.5.0-build/build/opencv.js often 404 or break.
const OPENCV_JS_URL = 'https://docs.opencv.org/4.10.0/opencv.js';

let opencvLoadPromise = null;

/** Wait until WASM runtime exposed `cv.Mat` (handles races where onRuntimeInitialized already ran). */
function waitForCvMatReady(timeoutMs = 120000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const id = setInterval(() => {
      try {
        if (typeof cv !== 'undefined' && cv && typeof cv.Mat === 'function') {
          clearInterval(id);
          resolve(true);
          return;
        }
      } catch {
        /* partial init */
      }
      if (Date.now() - t0 >= timeoutMs) {
        clearInterval(id);
        resolve(false);
      }
    }, 80);
  });
}

function loadOpenCvOnce() {
  try {
    if (typeof cv !== 'undefined' && cv && typeof cv.Mat === 'function') {
      return Promise.resolve(true);
    }
  } catch {
    /* ignore */
  }
  if (opencvLoadPromise) return opencvLoadPromise;

  opencvLoadPromise = (async () => {
    try {
      let existing = document.querySelector('script[data-opencv-auto="1"]');
      if (!existing) {
        const scriptOk = await new Promise((resolve) => {
          const s = document.createElement('script');
          s.async = true;
          s.dataset.opencvAuto = '1';
          s.src = OPENCV_JS_URL;
          s.onload = () => resolve(true);
          s.onerror = () => resolve(false);
          document.head.appendChild(s);
        });
        if (!scriptOk) {
          opencvLoadPromise = null;
          return false;
        }
      }
      const ready = await waitForCvMatReady(120000);
      if (!ready) {
        opencvLoadPromise = null;
        return false;
      }
      return true;
    } catch {
      opencvLoadPromise = null;
      return false;
    }
  })();

  return opencvLoadPromise;
}

/**
 * When OpenCV cannot load (CDN blocked, timeout, etc.), use a weak heuristic so auto flow can continue.
 * Operator should still verify CNIC framing; prefer fixing OpenCV load for better card detection.
 */
function analyzeCnicCardFallback(imgEl) {
  const w0 = imgEl.naturalWidth || imgEl.width;
  const h0 = imgEl.naturalHeight || imgEl.height;
  if (w0 < 120 || h0 < 120) {
    return { ok: false, reason: 'nocard', message: 'Full CNIC not visible' };
  }
  const v = quickLumaVariance(imgEl, 72);
  if (v < 10) {
    return { ok: false, reason: 'blur', message: 'Image blurry, hold CNIC steady' };
  }
  const aspectFrame = Math.max(w0, h0) / Math.min(w0, h0);
  if (aspectFrame < 1.2) {
    return { ok: false, reason: 'nocard', message: 'Place CNIC front side in the frame' };
  }
  const targetAspect = 1.58;
  let boxH = Math.min(h0 * 0.88, w0 * targetAspect * 0.92);
  let boxW = boxH / targetAspect;
  if (boxW > w0 * 0.92) {
    boxW = w0 * 0.92;
    boxH = boxW * targetAspect;
  }
  const x = Math.round((w0 - boxW) / 2);
  const y = Math.round((h0 - boxH) / 2);
  const rect = { x, y, width: Math.round(boxW), height: Math.round(boxH) };
  return {
    ok: true,
    rect,
    aspect: targetAspect,
    areaRatio: (rect.width * rect.height) / (w0 * h0),
    angleDeg: 0,
    blurVar: v,
    _fallback: true,
    _naturalW: w0,
    _naturalH: h0,
  };
}

export async function analyzeCnicCard(imgEl) {
  const loaded = await loadOpenCvOnce();
  if (!loaded || typeof cv === 'undefined' || !cv || typeof cv.Mat !== 'function') {
    return analyzeCnicCardFallback(imgEl);
  }

  const canvas = document.createElement('canvas');
  let w0 = imgEl.naturalWidth || imgEl.width;
  let h0 = imgEl.naturalHeight || imgEl.height;
  if (!(w0 > 16) || !(h0 > 16)) {
    return analyzeCnicCardFallback(imgEl);
  }
  const maxDim = 480;
  let w = w0;
  let h = h0;
  if (w0 > maxDim) {
    const scale = maxDim / w0;
    w = maxDim;
    h = Math.round(h0 * scale);
  }
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { ok: false, reason: 'canvas', message: 'Canvas error' };
  ctx.drawImage(imgEl, 0, 0, w, h);

  let src = null;
  let gray = null;
  let blurred = null;
  let edges = null;
  let contours = null;
  let hierarchy = null;

  try {
    try {
      src = cv.imread(canvas);
      gray = new cv.Mat();
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    blurred = new cv.Mat();
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

    const lap = new cv.Mat();
    cv.Laplacian(blurred, lap, cv.CV_64F);
    const mean = new cv.Mat();
    const stddev = new cv.Mat();
    cv.meanStdDev(lap, mean, stddev);
    const blurVar = (stddev.data64F[0] || 0) ** 2;
    lap.delete();
    mean.delete();
    stddev.delete();
    if (blurVar < 35) {
      return { ok: false, reason: 'blur', message: 'Image blurry, hold steady', blurVar };
    }

    edges = new cv.Mat();
    cv.Canny(blurred, edges, 40, 120);
    contours = new cv.MatVector();
    hierarchy = new cv.Mat();
    cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    let best = null;
    let bestScore = 0;

    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const peri = cv.arcLength(c, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(c, approx, 0.02 * peri, true);

      if (approx.rows >= 4) {
        const rect = cv.boundingRect(approx);
        const rw = rect.width;
        const rh = rect.height;
        if (rw < 30 || rh < 30) {
          approx.delete();
          c.delete();
          continue;
        }
        const longSide = Math.max(rw, rh);
        const shortSide = Math.min(rw, rh);
        const aspect = longSide / shortSide;
        if (aspect < 1.45 || aspect > 2.05) {
          approx.delete();
          c.delete();
          continue;
        }
        const area = rw * rh;
        const ar = area / (w * h);
        if (ar < 0.14 || ar > 0.92) {
          approx.delete();
          c.delete();
          continue;
        }

        const rectObj = cv.minAreaRect(approx);
        let ang = Math.abs(rectObj.angle || 0);
        const tilt = ang > 45 ? Math.abs(90 - ang) : ang;
        if (tilt > 22) {
          approx.delete();
          c.delete();
          continue;
        }

        const score = area;
        if (score > bestScore) {
          bestScore = score;
          best = {
            rect: { x: rect.x, y: rect.y, width: rw, height: rh },
            aspect,
            areaRatio: ar,
            angleDeg: tilt,
            blurVar,
          };
        }
      }
      approx.delete();
      c.delete();
    }

    if (!best) {
      return { ok: false, reason: 'nocard', message: 'Full CNIC not visible', blurVar: 0 };
    }

    // OpenCV ran on a downscaled canvas (w×h); rect is in that space. Overlay + stability use natural image (w0×h0).
    const scaleXN = w0 / w;
    const scaleYN = h0 / h;
    const rectNat = {
      x: Math.round(best.rect.x * scaleXN),
      y: Math.round(best.rect.y * scaleYN),
      width: Math.round(best.rect.width * scaleXN),
      height: Math.round(best.rect.height * scaleYN),
    };
    const areaRatioNat = (rectNat.width * rectNat.height) / (w0 * h0);
    const minSideFrac = 0.24;
    const minAreaFrac = 0.14;
    if (
      areaRatioNat < minAreaFrac ||
      rectNat.width < w0 * minSideFrac ||
      rectNat.height < h0 * minSideFrac
    ) {
      return analyzeCnicCardFallback(imgEl);
    }

    return {
      ok: true,
      ...best,
      rect: rectNat,
      areaRatio: areaRatioNat,
      _naturalW: w0,
      _naturalH: h0,
    };
    } finally {
      if (src) src.delete();
      if (gray) gray.delete();
      if (blurred) blurred.delete();
      if (edges) edges.delete();
      if (contours) contours.delete();
      if (hierarchy) hierarchy.delete();
    }
  } catch {
    return analyzeCnicCardFallback(imgEl);
  }
}

function stepLabel(s) {
  switch (s) {
    case AutoState.waiting_face:
    case AutoState.face_countdown:
      return 'Step 1: Waiting for visitor face';
    case AutoState.capturing_face:
      return 'Step 2: Capturing visitor photo';
    case AutoState.waiting_cnic:
    case AutoState.cnic_countdown:
      return 'Step 3: Waiting for CNIC front';
    case AutoState.capturing_cnic:
      return 'Step 4: Capturing CNIC';
    case AutoState.running_ocr:
      return 'Step 5: Running OCR';
    case AutoState.ready_for_review:
      return 'Step 6: Ready for verification';
    case AutoState.stopped:
      return 'Auto flow stopped';
    case AutoState.error:
      return 'Error';
    default:
      return 'Auto Capture Mode (idle)';
  }
}

/**
 * @param {object} opts
 * @param {() => object} opts.getSettingsMap
 * @param {(text: string, kind?: string) => void} opts.showMainMsg
 * @param {() => string} opts.resolveVisitorSnapshotUrl
 * @param {() => string} opts.resolveCnicSnapshotUrl
 * @param {(res: object) => void} opts.applyOcrFromResponse
 * @param {(path: string) => void} opts.onVisitorPhotoPath
 * @param {(path: string) => void} opts.onCnicFrontPath
 */
export function bindAutoCapture(opts) {
  const {
    getSettingsMap,
    showMainMsg,
    resolveVisitorSnapshotUrl,
    resolveCnicSnapshotUrl,
    applyOcrFromResponse,
    onVisitorPhotoPath,
    onCnicFrontPath,
  } = opts;

  const el = (id) => document.getElementById(id);
  const btnStart = el('btnAutoStart');
  const btnStop = el('btnAutoStop');
  const chkEnable = el('autoEnableMode');
  const statusEl = el('autoStatus');
  const countdownEl = el('autoCountdown');
  const stepEl = el('autoStep');
  const imgVisitor = el('autoStreamVisitor');
  const imgCnic = el('autoStreamCnic');
  const canvasVisitor = el('autoOverlayVisitor');
  const canvasCnic = el('autoOverlayCnic');

  let state = AutoState.idle;
  /** @type {ReturnType<typeof setInterval> | null} */
  let pollTimer = null;
  /** @type {ReturnType<typeof setInterval> | ReturnType<typeof setTimeout> | null} */
  let countdownTimer = null;
  let stopped = false;
  let faceStableSince = 0;
  let cnicStableSince = 0;
  let lastCnicSig = '';

  let prevVisitorBlobUrl = null;
  let prevCnicBlobUrl = null;

  function setVisitorPreviewFromBlobUrl(url) {
    if (prevVisitorBlobUrl) URL.revokeObjectURL(prevVisitorBlobUrl);
    prevVisitorBlobUrl = url;
    if (imgVisitor) {
      imgVisitor.src = url;
      imgVisitor.style.display = 'block';
    }
  }

  function setCnicPreviewFromBlobUrl(url) {
    if (prevCnicBlobUrl) URL.revokeObjectURL(prevCnicBlobUrl);
    prevCnicBlobUrl = url;
    if (imgCnic) {
      imgCnic.src = url;
      imgCnic.style.display = 'block';
    }
  }

  function clearPoll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function clearCountdownTimer() {
    if (countdownTimer != null) {
      clearTimeout(countdownTimer);
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  }

  function setAutoStatus(message) {
    if (statusEl) statusEl.textContent = message || '';
  }

  function setAutoStep(s) {
    if (stepEl) stepEl.textContent = stepLabel(s);
  }

  function setCountdownDisplay(n) {
    if (countdownEl) countdownEl.textContent = n > 0 ? String(n) : '';
  }

  function setState(s) {
    state = s;
    setAutoStep(s);
  }

  function drawFaceOverlay(img, analysis) {
    if (!canvasVisitor || !img) return;
    const cw = img.naturalWidth || img.width;
    const ch = img.naturalHeight || img.height;
    const dispW = img.clientWidth || cw;
    const dispH = img.clientHeight || ch;
    canvasVisitor.width = dispW;
    canvasVisitor.height = dispH;
    const ctx = canvasVisitor.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, dispW, dispH);
    if (!analysis || !analysis.ok || !analysis.box) return;
    const sx = dispW / cw;
    const sy = dispH / ch;
    const b = analysis.box;
    ctx.strokeStyle = 'rgba(0, 180, 100, 0.95)';
    ctx.lineWidth = 3;
    ctx.strokeRect(b.x * sx, b.y * sy, b.width * sx, b.height * sy);
  }

  function drawCnicOverlay(img, analysis) {
    if (!canvasCnic || !img) return;
    const cw = (analysis && analysis._naturalW) || img.naturalWidth || img.width;
    const ch = (analysis && analysis._naturalH) || img.naturalHeight || img.height;
    if (!(cw > 0) || !(ch > 0)) return;
    const dispW = img.clientWidth || cw;
    const dispH = img.clientHeight || ch;
    canvasCnic.width = dispW;
    canvasCnic.height = dispH;
    const ctx = canvasCnic.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, dispW, dispH);
    if (!analysis || !analysis.ok || !analysis.rect) return;
    const sx = dispW / cw;
    const sy = dispH / ch;
    const r = analysis.rect;
    ctx.strokeStyle = 'rgba(30, 90, 150, 0.95)';
    ctx.lineWidth = 3;
    ctx.strokeRect(r.x * sx, r.y * sy, r.width * sx, r.height * sy);
  }

  function faceStatusFromAnalysis(a) {
    if (!a.ok) {
      if (a.reason === 'far') return 'Move closer to camera';
      if (a.reason === 'close') return 'Move back — face too large';
      if (a.reason === 'center' || a.reason === 'edge') return 'Keep face centered';
      return 'Waiting for visitor face...';
    }
    return 'Hold still';
  }

  function cnicStatusFromAnalysis(a) {
    if (!a.ok) {
      if (a.reason === 'library') return 'Auto CNIC detection unavailable. Use manual capture.';
      if (a.reason === 'blur') return 'Image blurry, hold CNIC steady';
      if (a.reason === 'nocard') return 'Full CNIC not visible';
      return 'Place CNIC front side in the frame';
    }
    if (a._fallback) return 'Hold CNIC steady (simple detection — frame CNIC in the center)';
    return 'Hold CNIC steady';
  }

  function cnicSig(a) {
    if (!a || !a.ok || !a.rect) return '';
    return `${Math.round(a.rect.x / 4)}:${Math.round(a.rect.y / 4)}:${Math.round(a.rect.width / 4)}:${Math.round(a.rect.height / 4)}:${Math.round((a.angleDeg || 0) * 3)}`;
  }

  async function runOcrAfterCnicCapture(imagePath) {
    setState(AutoState.running_ocr);
    setAutoStatus('Running OCR...');
    const res = await apiPost('/api/ocr/cnic', { imagePath });
    applyOcrFromResponse(res);
    setAutoStatus('OCR complete. Please verify details.');
    showMainMsg('Please enter visitor company and verify details, then save.', 'warn');
    const companyInput = document.getElementById('company');
    if (companyInput) companyInput.focus();
    setState(AutoState.ready_for_review);
  }

  function stopAutoFlow() {
    stopped = true;
    clearPoll();
    clearCountdownTimer();
    setCountdownDisplay(0);
    if (prevVisitorBlobUrl) URL.revokeObjectURL(prevVisitorBlobUrl);
    if (prevCnicBlobUrl) URL.revokeObjectURL(prevCnicBlobUrl);
    prevVisitorBlobUrl = null;
    prevCnicBlobUrl = null;
    setState(AutoState.stopped);
    setAutoStatus('Auto flow stopped.');
  }

  /** Compare card boxes with tolerance (snapshot noise / OpenCV jitter between frames). */
  function cnicRectNear(ra, rr, naturalW) {
    if (!ra || !rr) return false;
    const tol = Math.max(20, Math.floor((naturalW || 640) * 0.04));
    return (
      Math.abs(ra.x - rr.x) <= tol &&
      Math.abs(ra.y - rr.y) <= tol &&
      Math.abs(ra.width - rr.width) <= tol &&
      Math.abs(ra.height - rr.height) <= tol
    );
  }

  /**
   * Countdown: wait 1s between steps. Uses chained timeouts (not setInterval) so slow validateFn
   * (e.g. OpenCV per frame) cannot be skipped by a 1s "busy" race.
   */
  function startValidatedCountdown(seconds, validateFn) {
    return new Promise((resolve) => {
      let left = Math.max(1, Math.floor(seconds));
      setCountdownDisplay(left);

      const finish = (out) => {
        clearCountdownTimer();
        setCountdownDisplay(0);
        resolve(out);
      };

      const step = async () => {
        if (stopped) {
          finish('stopped');
          return;
        }
        try {
          const v = await validateFn();
          if (!v.ok) {
            finish('cancel');
            return;
          }
        } catch {
          finish('cancel');
          return;
        }
        left -= 1;
        if (left <= 0) {
          finish('done');
          return;
        }
        setCountdownDisplay(left);
        countdownTimer = setTimeout(step, 1000);
      };

      countdownTimer = setTimeout(step, 1000);
    });
  }

  async function startCnicPhase(cnicUrl) {
    setState(AutoState.waiting_cnic);
    setAutoStatus(
      'Place CNIC front side in the frame. If this is your first CNIC auto-capture, OpenCV may load for up to 1–2 minutes.'
    );
    faceStableSince = 0;
    cnicStableSince = 0;
    lastCnicSig = '';

    const tick = async () => {
      if (stopped) return;
      let handle = null;
      try {
        handle = await fetchSnapshotAsImage(cnicUrl);
        const img = handle.img;
        setCnicPreviewFromBlobUrl(img.src);
        const analysis = await analyzeCnicCard(img);
        drawCnicOverlay(imgCnic, analysis);

        if (!analysis.ok) {
          setAutoStatus(cnicStatusFromAnalysis(analysis));
          cnicStableSince = 0;
          lastCnicSig = '';
          return;
        }

        const sig = cnicSig(analysis);
        const now = Date.now();
        if (sig !== lastCnicSig) {
          lastCnicSig = sig;
          cnicStableSince = now;
        }
        setAutoStatus(cnicStatusFromAnalysis(analysis));
        if (now - cnicStableSince < STABLE_MS) return;

        clearPoll();
        setState(AutoState.cnic_countdown);
        const secs = parseInt(String(getSettingsMap().AUTO_CNIC_COUNTDOWN_SECONDS || '3'), 10) || 3;
        setAutoStatus(`Capturing CNIC in ${secs}...`);

        const refRect = { ...analysis.rect };
        const refNw = analysis._naturalW || img.naturalWidth || img.width;
        const cd = await startValidatedCountdown(secs, async () => {
          const h = await fetchSnapshotAsImage(cnicUrl);
          try {
            const a = await analyzeCnicCard(h.img);
            drawCnicOverlay(imgCnic, a);
            if (!a.ok) return { ok: false };
            const nw = a._naturalW || refNw;
            if (!cnicRectNear(a.rect, refRect, nw)) return { ok: false };
            return { ok: true };
          } finally {
            h.revoke();
          }
        });

        if (cd === 'cancel') {
          setAutoStatus('CNIC moved, countdown cancelled');
          setState(AutoState.waiting_cnic);
          pollTimer = setInterval(() => {
            tick().catch(() => {});
          }, randomPollMs());
          return;
        }
        if (cd === 'stopped') return;

        setState(AutoState.capturing_cnic);
        setAutoStatus('Capturing CNIC...');
        const path = await captureImage(cnicUrl, 'cnic-front');
        onCnicFrontPath(path);
        setAutoStatus('CNIC captured');
        await runOcrAfterCnicCapture(path);
      } catch (e) {
        setAutoStatus(e.message || 'CNIC snapshot failed');
      }
      // Preview blob URL is managed by setCnicPreviewFromBlobUrl / stopAutoFlow.
    };

    pollTimer = setInterval(() => {
      tick().catch(() => {});
    }, randomPollMs());
  }

  async function startFacePhase(visitorUrl) {
    setState(AutoState.waiting_face);
    setAutoStatus('Waiting for visitor face...');
    faceStableSince = 0;

    const tick = async () => {
      if (stopped) return;
      let handle = null;
      try {
        handle = await fetchSnapshotAsImage(visitorUrl);
        const blobUrl = handle.img.src;
        setVisitorPreviewFromBlobUrl(blobUrl);
        const img = handle.img;

        const blurV = quickLumaVariance(img);
        if (blurV < 10) {
          setAutoStatus('Image blurry, hold steady');
          faceStableSince = 0;
          drawFaceOverlay(imgVisitor, { ok: false });
          return;
        }

        const analysis = await analyzeFace(img);
        drawFaceOverlay(imgVisitor, analysis);

        if (!analysis.ok) {
          setAutoStatus(faceStatusFromAnalysis(analysis));
          faceStableSince = 0;
          return;
        }

        const now = Date.now();
        if (!faceStableSince) faceStableSince = now;
        setAutoStatus(faceStatusFromAnalysis(analysis));
        if (now - faceStableSince < STABLE_MS) return;

        clearPoll();
        setState(AutoState.face_countdown);
        const secs = parseInt(String(getSettingsMap().AUTO_FACE_COUNTDOWN_SECONDS || '3'), 10) || 3;
        setAutoStatus(`Capturing in ${secs}...`);

        const stableRef = { ...analysis.box };

        const cd = await startValidatedCountdown(secs, async () => {
          const h = await fetchSnapshotAsImage(visitorUrl);
          try {
            const a = await analyzeFace(h.img);
            drawFaceOverlay(imgVisitor, a);
            if (!a.ok) return { ok: false };
            const b = a.box;
            const drift =
              Math.abs(b.x - stableRef.x) +
              Math.abs(b.y - stableRef.y) +
              Math.abs(b.width - stableRef.width) * 0.5 +
              Math.abs(b.height - stableRef.height) * 0.5;
            const w = h.img.naturalWidth || h.img.width;
            if (drift > w * 0.12) return { ok: false };
            return { ok: true };
          } finally {
            h.revoke();
          }
        });

        if (cd === 'cancel') {
          setAutoStatus('Face moved, countdown cancelled');
          setState(AutoState.waiting_face);
          faceStableSince = 0;
          pollTimer = setInterval(() => {
            tick().catch(() => {});
          }, randomPollMs());
          return;
        }
        if (cd === 'stopped') return;

        setState(AutoState.capturing_face);
        setAutoStatus('Capturing visitor photo...');
        const path = await captureImage(visitorUrl, 'visitor');
        onVisitorPhotoPath(path);
        setAutoStatus('Visitor photo captured');

        const cnicUrl = resolveCnicSnapshotUrl();
        if (!cnicUrl) {
          setState(AutoState.error);
          setAutoStatus('CNIC snapshot URL missing. Set CNIC or legacy camera snapshot in Settings.');
          showMainMsg('CNIC snapshot URL missing.', 'error');
          return;
        }
        await startCnicPhase(cnicUrl);
      } catch (e) {
        setAutoStatus(e.message || 'Snapshot failed');
      }
      // handle.img uses the same blob URL as the preview; do not revoke here.
    };

    pollTimer = setInterval(() => {
      tick().catch(() => {});
    }, randomPollMs());
  }

  async function startAutoFlow() {
    if (!chkEnable || !chkEnable.checked) {
      showMainMsg('Enable Auto Mode first.', 'warn');
      return;
    }
    stopped = false;
    clearPoll();
    clearCountdownTimer();
    setCountdownDisplay(0);
    if (prevVisitorBlobUrl) URL.revokeObjectURL(prevVisitorBlobUrl);
    if (prevCnicBlobUrl) URL.revokeObjectURL(prevCnicBlobUrl);
    prevVisitorBlobUrl = null;
    prevCnicBlobUrl = null;

    const visitorUrl = resolveVisitorSnapshotUrl();
    if (!visitorUrl) {
      setState(AutoState.error);
      setAutoStatus('Visitor snapshot URL missing. Set visitor or legacy camera snapshot in Settings.');
      showMainMsg('Visitor snapshot URL missing.', 'error');
      return;
    }

    setAutoStatus('Loading face detection library…');
    let libOk = await loadFaceApiScript();
    if (!libOk || !window.faceapi) {
      libOk = await waitForFaceApiGlobal(5000);
    }
    if (!libOk || !window.faceapi) {
      faceScriptLoadPromise = null;
      setState(AutoState.error);
      setAutoStatus(
        'face-api.js did not load. Ensure /assets/vendor/face-api.min.js exists on this server, or allow CDN access.'
      );
      showMainMsg(
        'face-api.js failed to load (local /assets/vendor/face-api.min.js and CDNs). Use manual capture, or ask IT to allow scripts from your gate server.',
        'warn'
      );
      return;
    }

    setAutoStatus('Loading face detection models…');
    const faceOk = await ensureFaceModels();
    if (!faceOk) {
      setState(AutoState.error);
      const detail = lastFaceModelLoadError ? ` Details: ${lastFaceModelLoadError}` : '';
      setAutoStatus(`Face models could not load.${detail} Use manual capture or try again.`);
      showMainMsg(
        `Face detection models failed to download (CDN / network).${detail} Use manual capture or retry.`,
        'warn'
      );
      return;
    }

    await startFacePhase(visitorUrl);
  }

  if (btnStart) btnStart.addEventListener('click', () => startAutoFlow().catch((e) => showMainMsg(e.message, 'error')));
  if (btnStop) btnStop.addEventListener('click', () => stopAutoFlow());

  function syncEnableFromSettings() {
    const m = getSettingsMap() || {};
    if (chkEnable) {
      chkEnable.checked = String(m.AUTO_CAPTURE_ENABLED || '').toLowerCase() === 'true';
    }
  }

  return { syncEnableFromSettings, stopAutoFlow };
}
