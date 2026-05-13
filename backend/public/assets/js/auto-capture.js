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
import { captureVideoFrameAsBlob, uploadCapturedBlob, videoFrameToAnalysisImage } from './usb-camera.js';

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
const FACE_DETECTION_INTERVAL_MS = 700;
const CNIC_DETECTION_INTERVAL_MS = 600;
const MAX_DETECTION_IMAGE_WIDTH = 640;
const CNIC_REQUIRED_STABLE_MS = 800;
const CNIC_CONSECUTIVE_VALID_FRAMES = 2;
const CNIC_POSITION_TOLERANCE = 0.2;
const CNIC_MISSING_CANCEL_FRAMES = 2;
const CNIC_MIN_ASPECT = 1.4;
const CNIC_MAX_ASPECT = 1.9;
const CNIC_MIN_AREA = 0.08;
const CNIC_MAX_AREA = 0.9;
const CNIC_MAX_TILT_DEG = 15;
const CNIC_EXTREME_BLUR = 12;
const MAX_PROXY_FAILS = 5;
const FAST_CNIC_CAPTURE = true;
const DEBUG_AUTO_MODE = false;

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
    let code = null;
    try {
      const j = await res.json();
      if (j && j.message) msg = j.message;
      if (j && j.code) code = j.code;
    } catch {
      /* ignore */
    }
    const err = new Error(msg);
    err.status = res.status;
    err.code = code;
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

/** Natural pixel size for <img> or <video> (for overlays / analysis). */
function mediaNaturalSize(el) {
  if (!el) return { w: 0, h: 0 };
  if (el.tagName === 'VIDEO') {
    return {
      w: el.videoWidth || el.clientWidth || 0,
      h: el.videoHeight || el.clientHeight || 0,
    };
  }
  return {
    w: el.naturalWidth || el.width || 0,
    h: el.naturalHeight || el.height || 0,
  };
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
  const { w, h } = mediaNaturalSize(imgEl);
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
  const { w, h } = mediaNaturalSize(imgEl);
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
  const { w: w0, h: h0 } = mediaNaturalSize(imgEl);
  if (w0 < 120 || h0 < 120) {
    return { ok: false, reason: 'nocard', message: 'Full CNIC not visible' };
  }
  const v = quickLumaVariance(imgEl, 72);
  if (v < CNIC_EXTREME_BLUR) {
    return { ok: false, reason: 'blur-extreme', message: 'Too blurry, hold CNIC steady', blurVar: v };
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
  const { w: w0, h: h0 } = mediaNaturalSize(imgEl);
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
    const blurWarn = blurVar < 22;
    lap.delete();
    mean.delete();
    stddev.delete();
    if (blurVar < CNIC_EXTREME_BLUR) {
      return { ok: false, reason: 'blur-extreme', message: 'Too blurry, hold steady', blurVar };
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
        if (aspect < CNIC_MIN_ASPECT || aspect > CNIC_MAX_ASPECT) {
          approx.delete();
          c.delete();
          continue;
        }
        const area = rw * rh;
        const ar = area / (w * h);
        if (ar < CNIC_MIN_AREA || ar > CNIC_MAX_AREA) {
          approx.delete();
          c.delete();
          continue;
        }

        const rectObj = cv.minAreaRect(approx);
        let ang = Math.abs(rectObj.angle || 0);
        const tilt = ang > 45 ? Math.abs(90 - ang) : ang;
        if (tilt > CNIC_MAX_TILT_DEG) {
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
            blurWarn,
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
    const minSideFrac = 0.2;
    const minAreaFrac = CNIC_MIN_AREA;
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
 * @param {(state: string) => void} [opts.onAutoStateChange]
 * @param {() => { visitor: object, cnic: object }} [opts.getCameraConfig]
 * @param {() => HTMLVideoElement | null} [opts.getVisitorUsbVideoEl]
 * @param {() => HTMLVideoElement | null} [opts.getCnicUsbVideoEl]
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
    onAutoStateChange,
    getCameraConfig = () => ({
      visitor: { type: 'ip', streamUrl: '', snapshotUrl: '', usbDeviceId: '' },
      cnic: { type: 'ip', streamUrl: '', snapshotUrl: '', usbDeviceId: '' },
    }),
    getVisitorUsbVideoEl = () => document.getElementById('autoUsbVisitor'),
    getCnicUsbVideoEl = () => document.getElementById('autoUsbCnic'),
  } = opts;

  const el = (id) => document.getElementById(id);
  const btnStart = el('btnAutoStart');
  const btnStop = el('btnAutoStop');
  const chkEnable = el('autoEnableMode');
  const statusEl = el('autoStatus');
  const countdownEl = el('autoCountdown');
  const stepEl = el('autoStep');
  const cnicDebugEl = el('autoCnicDebug');
  const imgVisitor = el('autoStreamVisitor');
  const imgCnic = el('autoStreamCnic');
  const canvasVisitor = el('autoOverlayVisitor');
  const canvasCnic = el('autoOverlayCnic');
  const autoModeBanner = el('autoModeBanner');

  let state = AutoState.idle;
  /** @type {ReturnType<typeof setInterval> | null} */
  let pollTimer = null;
  /** @type {ReturnType<typeof setInterval> | ReturnType<typeof setTimeout> | null} */
  let countdownTimer = null;
  let stopped = false;
  let faceStableSince = 0;
  let cnicStableSince = 0;
  let lastCnicSig = '';
  let lastCnicRect = null;
  let cnicConsecutiveValid = 0;
  let cnicProxyFailCount = 0;
  let cnicNoCardCount = 0;
  let cnicCountdownMissCount = 0;
  let isCapturingCnic = false;
  let cnicCountdownRunning = false;
  let lastCnicDebug = null;
  let isAutoRunning = false;
  let isCapturingFace = false;
  let isOcrRunning = false;
  let currentVisitorSessionId = 0;

  if (cnicDebugEl && !DEBUG_AUTO_MODE) {
    cnicDebugEl.style.display = 'none';
  }

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

  function setCnicDebug(info = {}) {
    if (!DEBUG_AUTO_MODE || !cnicDebugEl) return;
    const cardDetected = info.cardDetected ? 'yes' : 'no';
    const ratio = Number.isFinite(info.ratio) ? info.ratio.toFixed(2) : '-';
    const area = Number.isFinite(info.area) ? `${Math.round(info.area * 100)}%` : '-';
    const angle = Number.isFinite(info.angle) ? `${Math.round(info.angle)}°` : '-';
    const blur = Number.isFinite(info.blur) ? Math.round(info.blur) : '-';
    const stableMs = Number.isFinite(info.stableMs) ? `${Math.max(0, Math.round(info.stableMs))}ms` : '0ms';
    const countdown = info.countdown || '-';
    const failCount = Number.isFinite(info.proxyFails) ? info.proxyFails : 0;
    cnicDebugEl.textContent =
      `Card detected: ${cardDetected} | ratio ${ratio} | area ${area} | angle ${angle} | blur ${blur} | stable ${stableMs} | countdown ${countdown} | proxy fails ${failCount}`;
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
    if (typeof onAutoStateChange === 'function') {
      try {
        onAutoStateChange(s);
      } catch {
        /* UI only */
      }
    }
  }

  function visitorSnapshotMissingMessage() {
    const cfg = getCameraConfig().visitor;
    if (cfg.type === 'usb') {
      const v = getVisitorUsbVideoEl();
      if (!cfg.usbDeviceId) return 'Visitor USB camera not selected in Settings.';
      if (!v || !v.srcObject) return 'Visitor USB camera is not active. Reload the page or open Settings.';
      if (v.readyState < 2) return 'Visitor USB camera is starting… wait for live video.';
      return 'Visitor USB camera is not ready. Allow camera permission (try http://localhost:5000).';
    }
    const m = getSettingsMap() || {};
    const stream = String(m.VISITOR_CAMERA_STREAM_URL || m.CAMERA_STREAM_URL || '').trim();
    const legacySnap = String(m.CAMERA_SNAPSHOT_URL || '').trim();
    const visSnap = String(m.VISITOR_CAMERA_SNAPSHOT_URL || '').trim();
    if (legacySnap || visSnap) {
      return 'Visitor snapshot URL missing. Set visitor or legacy camera snapshot in Settings.';
    }
    if (stream) {
      return 'Preview active from stream, but auto capture needs a snapshot URL. Set snapshot in Settings.';
    }
    return 'Camera URLs not configured. Open Settings and set stream/snapshot URLs.';
  }

  function cnicSnapshotMissingMessage() {
    const cfg = getCameraConfig().cnic;
    if (cfg.type === 'usb') {
      const v = getCnicUsbVideoEl();
      if (!cfg.usbDeviceId) return 'CNIC USB camera not selected in Settings.';
      if (!v || !v.srcObject) return 'CNIC USB camera is not active. Reload the page or open Settings.';
      if (v.readyState < 2) return 'CNIC USB camera is starting… wait for live video.';
      return 'CNIC USB camera is not ready. Allow camera permission (try http://localhost:5000).';
    }
    const m = getSettingsMap() || {};
    const stream = String(
      m.CNIC_CAMERA_STREAM_URL || m.VISITOR_CAMERA_STREAM_URL || m.CAMERA_STREAM_URL || ''
    ).trim();
    const snap = String(
      m.CNIC_CAMERA_SNAPSHOT_URL || m.VISITOR_CAMERA_SNAPSHOT_URL || m.CAMERA_SNAPSHOT_URL || ''
    ).trim();
    if (!snap) return 'CNIC snapshot URL missing. Set CNIC or legacy camera snapshot in Settings.';
    if (stream) {
      return 'CNIC preview may use stream, but auto capture needs a snapshot URL. Set snapshot in Settings.';
    }
    return 'CNIC camera URLs not configured. Open Settings.';
  }

  function drawFaceOverlay(img, analysis) {
    if (!canvasVisitor || !img) return;
    const { w: cw, h: ch } = mediaNaturalSize(img);
    if (!(cw > 0) || !(ch > 0)) return;
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
    const ms = mediaNaturalSize(img);
    const cw = (analysis && analysis._naturalW) || ms.w;
    const ch = (analysis && analysis._naturalH) || ms.h;
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
      if (a.reason === 'blur' || a.reason === 'blur-extreme') return 'Too blurry. Hold CNIC steady';
      if (a.reason === 'nocard') return 'Full CNIC not visible';
      return 'Place CNIC front side in the frame';
    }
    if (a.blurWarn) return 'CNIC visible. Slight blur detected, hold a bit steadier';
    if (a._fallback) return 'Hold CNIC steady (simple detection — frame CNIC in the center)';
    return 'Hold CNIC steady';
  }

  function cnicSig(a) {
    if (!a || !a.ok || !a.rect) return '';
    return `${Math.round(a.rect.x / 4)}:${Math.round(a.rect.y / 4)}:${Math.round(a.rect.width / 4)}:${Math.round(a.rect.height / 4)}:${Math.round((a.angleDeg || 0) * 3)}`;
  }

  function isCardCentered(a) {
    if (!a || !a.ok || !a.rect) return false;
    const nw = a._naturalW || 1;
    const nh = a._naturalH || 1;
    const cx = a.rect.x + a.rect.width / 2;
    const cy = a.rect.y + a.rect.height / 2;
    return Math.abs(cx - nw / 2) <= nw * 0.24 && Math.abs(cy - nh / 2) <= nh * 0.24;
  }

  async function runOcrAfterCnicCapture(imagePath) {
    if (isOcrRunning) return;
    isOcrRunning = true;
    setState(AutoState.running_ocr);
    setAutoStatus('Running OCR...');
    const res = await apiPost('/api/ocr/cnic', { imagePath });
    applyOcrFromResponse(res);
    setAutoStatus('OCR complete. Please verify details.');
    showMainMsg('Please enter visitor company and verify details, then save.', 'warn');
    const companyInput = document.getElementById('company');
    if (companyInput) companyInput.focus();
    setState(AutoState.ready_for_review);
    isOcrRunning = false;
  }

  function stopAutoFlow() {
    isAutoRunning = false;
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
    if (autoModeBanner) autoModeBanner.style.display = chkEnable && chkEnable.checked ? 'block' : 'none';
  }

  /** Compare card boxes with tolerance (snapshot noise / OpenCV jitter between frames). */
  function cnicRectNear(ra, rr, naturalW) {
    if (!ra || !rr) return false;
    const baseTol = Math.max(12, Math.floor((naturalW || 640) * 0.02));
    const tolX = Math.max(baseTol, Math.floor(Math.max(ra.width, rr.width) * CNIC_POSITION_TOLERANCE));
    const tolY = Math.max(baseTol, Math.floor(Math.max(ra.height, rr.height) * CNIC_POSITION_TOLERANCE));
    return (
      Math.abs(ra.x - rr.x) <= tolX &&
      Math.abs(ra.y - rr.y) <= tolY &&
      Math.abs(ra.width - rr.width) <= tolX &&
      Math.abs(ra.height - rr.height) <= tolY
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
    clearPoll();
    const cnicCfg = getCameraConfig().cnic;
    const isUsbCnic = cnicCfg.type === 'usb';
    const cnicVideo = getCnicUsbVideoEl();

    setState(AutoState.waiting_cnic);
    setAutoStatus(
      'Place CNIC front side in the frame. If this is your first CNIC auto-capture, OpenCV may load for up to 1–2 minutes.'
    );
    faceStableSince = 0;
    cnicStableSince = 0;
    lastCnicSig = '';
    lastCnicRect = null;
    cnicConsecutiveValid = 0;
    cnicProxyFailCount = 0;
    cnicNoCardCount = 0;
    cnicCountdownMissCount = 0;
    isCapturingCnic = false;
    cnicCountdownRunning = false;
    lastCnicDebug = null;
    setCnicDebug({
      cardDetected: false,
      ratio: 0,
      area: 0,
      angle: 0,
      blur: 0,
      stableMs: 0,
      countdown: 'idle',
      proxyFails: 0,
    });

    const tick = async () => {
      if (stopped || isCapturingCnic || cnicCountdownRunning) return;
      let handle = null;
      try {
        try {
          if (isUsbCnic) {
            if (!cnicVideo || cnicVideo.readyState < 2) return;
            handle = await videoFrameToAnalysisImage(cnicVideo, MAX_DETECTION_IMAGE_WIDTH);
          } else {
            handle = await fetchSnapshotAsImage(cnicUrl);
          }
          cnicProxyFailCount = 0;
        } catch (fetchErr) {
          cnicProxyFailCount += 1;
          setAutoStatus(
            cnicProxyFailCount >= MAX_PROXY_FAILS
              ? 'CNIC camera snapshot failed. Check camera URL/Wi-Fi. You can use manual capture.'
              : 'Camera frame missed, retrying...'
          );
          setCnicDebug({
            ...(lastCnicDebug || {}),
            countdown: cnicCountdownRunning ? 'running' : 'waiting',
            proxyFails: cnicProxyFailCount,
          });
          if (cnicProxyFailCount >= MAX_PROXY_FAILS) {
            clearPoll();
            setState(AutoState.error);
          }
          return;
        }

        const img = handle.img;
        if (!isUsbCnic) setCnicPreviewFromBlobUrl(img.src);
        const analysis = await analyzeCnicCard(img);
        drawCnicOverlay(isUsbCnic && cnicVideo ? cnicVideo : imgCnic, analysis);
        const now = Date.now();
        const stableMs = cnicStableSince ? now - cnicStableSince : 0;
        lastCnicDebug = {
          cardDetected: analysis.ok,
          ratio: analysis.aspect,
          area: analysis.areaRatio,
          angle: analysis.angleDeg,
          blur: analysis.blurVar,
          stableMs,
          countdown: cnicCountdownRunning ? 'running' : 'waiting',
          proxyFails: cnicProxyFailCount,
        };
        setCnicDebug(lastCnicDebug);

        if (!analysis.ok) {
          cnicNoCardCount += 1;
          if (!cnicCountdownRunning && cnicNoCardCount >= CNIC_MISSING_CANCEL_FRAMES) {
            cnicStableSince = 0;
            cnicConsecutiveValid = 0;
            lastCnicSig = '';
            lastCnicRect = null;
          }
          setAutoStatus(cnicStatusFromAnalysis(analysis));
          if (isUsbCnic && handle) handle.revoke();
          return;
        }

        cnicNoCardCount = 0;
        const sig = cnicSig(analysis);
        if (!cnicStableSince) cnicStableSince = now;
        const imgNw = mediaNaturalSize(img).w;
        const rectNear = lastCnicRect
          ? cnicRectNear(
              analysis.rect,
              lastCnicRect,
              analysis._naturalW || imgNw
            )
          : true;
        if (sig !== lastCnicSig && !rectNear) {
          lastCnicSig = sig;
          cnicStableSince = now;
          cnicConsecutiveValid = 1;
        } else {
          cnicConsecutiveValid += 1;
          if (!lastCnicSig) lastCnicSig = sig;
        }
        lastCnicRect = analysis.rect ? { ...analysis.rect } : null;
        setAutoStatus(cnicStatusFromAnalysis(analysis));

        const isStableByFrames = cnicConsecutiveValid >= CNIC_CONSECUTIVE_VALID_FRAMES;
        const isStableByTime = now - cnicStableSince >= CNIC_REQUIRED_STABLE_MS;
        const centered = isCardCentered(analysis);
        if (!centered || (!isStableByFrames && !isStableByTime)) {
          if (isUsbCnic && handle) handle.revoke();
          return;
        }

        if (isUsbCnic && handle) handle.revoke();

        clearPoll();
        cnicCountdownRunning = true;
        setState(AutoState.cnic_countdown);
        const secs = parseInt(String(getSettingsMap().AUTO_CNIC_COUNTDOWN_SECONDS || '2'), 10) || 2;
        const countdownSecs = FAST_CNIC_CAPTURE ? Math.min(secs, 2) : secs;
        setAutoStatus(`Capturing CNIC in ${countdownSecs}...`);
        setCnicDebug({
          ...lastCnicDebug,
          stableMs: now - cnicStableSince,
          countdown: `in ${countdownSecs}s`,
          proxyFails: cnicProxyFailCount,
        });

        const refRect = { ...analysis.rect };
        const refNw = analysis._naturalW || imgNw;
        const cd = await startValidatedCountdown(Math.max(1, countdownSecs), async () => {
          let h = null;
          try {
            if (isUsbCnic) {
              if (!cnicVideo || cnicVideo.readyState < 2) return { ok: false };
              h = await videoFrameToAnalysisImage(cnicVideo, MAX_DETECTION_IMAGE_WIDTH);
            } else {
              h = await fetchSnapshotAsImage(cnicUrl);
            }
            cnicProxyFailCount = 0;
            const a = await analyzeCnicCard(h.img);
            drawCnicOverlay(isUsbCnic && cnicVideo ? cnicVideo : imgCnic, a);
            if (!a.ok) {
              cnicCountdownMissCount += 1;
              return { ok: cnicCountdownMissCount < CNIC_MISSING_CANCEL_FRAMES };
            }
            cnicCountdownMissCount = 0;
            const nw = a._naturalW || refNw;
            if (!cnicRectNear(a.rect, refRect, nw)) return { ok: true };
            if ((a.areaRatio || 0) < CNIC_MIN_AREA * 0.8) return { ok: false };
            setCnicDebug({
              cardDetected: true,
              ratio: a.aspect,
              area: a.areaRatio,
              angle: a.angleDeg,
              blur: a.blurVar,
              stableMs: Date.now() - cnicStableSince,
              countdown: 'running',
              proxyFails: cnicProxyFailCount,
            });
            return { ok: true };
          } catch {
            cnicProxyFailCount += 1;
            if (cnicProxyFailCount >= MAX_PROXY_FAILS) return { ok: false };
            return { ok: true };
          } finally {
            if (h) h.revoke();
          }
        });
        cnicCountdownRunning = false;

        if (cd === 'cancel') {
          setAutoStatus('CNIC lost, countdown cancelled');
          setState(AutoState.waiting_cnic);
          cnicConsecutiveValid = 0;
          cnicNoCardCount = 0;
          cnicCountdownMissCount = 0;
          pollTimer = setInterval(() => {
            tick().catch(() => {});
          }, randomPollMs());
          return;
        }
        if (cd === 'stopped') return;

        isCapturingCnic = true;
        setState(AutoState.capturing_cnic);
        setAutoStatus('Capturing CNIC...');
        let path;
        if (isUsbCnic) {
          if (!cnicVideo || cnicVideo.readyState < 2) throw new Error('CNIC USB video not ready.');
          const blob = await captureVideoFrameAsBlob(cnicVideo, { quality: 0.92, mimeType: 'image/jpeg' });
          const up = await uploadCapturedBlob('cnic-front', blob);
          path = up.path;
        } else {
          path = await captureImage(cnicUrl, 'cnic-front');
        }
        onCnicFrontPath(path);
        setAutoStatus('CNIC captured');
        await runOcrAfterCnicCapture(path);
        isCapturingCnic = false;
      } catch (e) {
        isCapturingCnic = false;
        cnicCountdownRunning = false;
        setAutoStatus(e.message || 'CNIC snapshot failed');
      }
      // Preview blob URL is managed by setCnicPreviewFromBlobUrl / stopAutoFlow.
    };

    pollTimer = setInterval(() => {
      tick().catch(() => {});
    }, CNIC_DETECTION_INTERVAL_MS);
  }

  async function startFacePhaseUsb(visitorVideo) {
    setState(AutoState.waiting_face);
    setAutoStatus('Waiting for visitor face...');
    faceStableSince = 0;

    const tick = async () => {
      if (stopped || !isAutoRunning || isCapturingFace) return;
      try {
        if (!visitorVideo || visitorVideo.readyState < 2) return;

        const blurV = quickLumaVariance(visitorVideo);
        if (blurV < 10) {
          setAutoStatus('Image blurry, hold steady');
          faceStableSince = 0;
          drawFaceOverlay(visitorVideo, { ok: false });
          return;
        }

        const analysis = await analyzeFace(visitorVideo);
        drawFaceOverlay(visitorVideo, analysis);

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
        const secs = parseInt(String(getSettingsMap().AUTO_FACE_COUNTDOWN_SECONDS || '2'), 10) || 2;
        setAutoStatus(`Hold still — capturing in ${secs}...`);

        const stableRef = { ...analysis.box };

        const cd = await startValidatedCountdown(secs, async () => {
          const a = await analyzeFace(visitorVideo);
          drawFaceOverlay(visitorVideo, a);
          if (!a.ok) return { ok: false };
          const b = a.box;
          const drift =
            Math.abs(b.x - stableRef.x) +
            Math.abs(b.y - stableRef.y) +
            Math.abs(b.width - stableRef.width) * 0.5 +
            Math.abs(b.height - stableRef.height) * 0.5;
          const w = visitorVideo.videoWidth || visitorVideo.clientWidth;
          if (drift > w * 0.18) return { ok: false };
          return { ok: true };
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
        isCapturingFace = true;
        setAutoStatus('Capturing visitor photo...');
        const blob = await captureVideoFrameAsBlob(visitorVideo, { quality: 0.92, mimeType: 'image/jpeg' });
        const up = await uploadCapturedBlob('visitor', blob);
        onVisitorPhotoPath(up.path);
        setAutoStatus('Visitor photo captured');
        isCapturingFace = false;

        const cCfg = getCameraConfig().cnic;
        if (cCfg.type === 'usb') {
          if (!cCfg.usbDeviceId) {
            setState(AutoState.error);
            const msg = cnicSnapshotMissingMessage();
            setAutoStatus(msg);
            showMainMsg(msg, 'error');
            return;
          }
          const cv = getCnicUsbVideoEl();
          if (!cv || !cv.srcObject || cv.readyState < 2) {
            setState(AutoState.error);
            setAutoStatus('CNIC USB preview not ready.');
            showMainMsg('CNIC USB camera is not previewing. Check Settings and camera permission.', 'error');
            return;
          }
          await startCnicPhase('');
        } else {
          const cnicUrl = resolveCnicSnapshotUrl();
          if (!cnicUrl) {
            setState(AutoState.error);
            const msg = cnicSnapshotMissingMessage();
            setAutoStatus(msg);
            showMainMsg(msg, 'error');
            return;
          }
          await startCnicPhase(cnicUrl);
        }
      } catch (e) {
        isCapturingFace = false;
        setAutoStatus(e.message || 'USB face capture failed');
      }
    };

    pollTimer = setInterval(() => {
      tick().catch(() => {});
    }, FACE_DETECTION_INTERVAL_MS);
  }

  async function startFacePhaseIp(visitorUrl) {
    setState(AutoState.waiting_face);
    setAutoStatus('Waiting for visitor face...');
    faceStableSince = 0;

    const tick = async () => {
      if (stopped || !isAutoRunning || isCapturingFace) return;
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
        const secs = parseInt(String(getSettingsMap().AUTO_FACE_COUNTDOWN_SECONDS || '2'), 10) || 2;
        setAutoStatus(`Hold still — capturing in ${secs}...`);

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
            if (drift > w * 0.18) return { ok: false };
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
        isCapturingFace = true;
        setAutoStatus('Capturing visitor photo...');
        const path = await captureImage(visitorUrl, 'visitor');
        onVisitorPhotoPath(path);
        setAutoStatus('Visitor photo captured');
        isCapturingFace = false;

        const cCfg = getCameraConfig().cnic;
        if (cCfg.type === 'usb') {
          if (!cCfg.usbDeviceId) {
            setState(AutoState.error);
            const msg = cnicSnapshotMissingMessage();
            setAutoStatus(msg);
            showMainMsg(msg, 'error');
            return;
          }
          const cv = getCnicUsbVideoEl();
          if (!cv || !cv.srcObject || cv.readyState < 2) {
            setState(AutoState.error);
            setAutoStatus('CNIC USB preview not ready.');
            showMainMsg('CNIC USB camera is not previewing. Check Settings and camera permission.', 'error');
            return;
          }
          await startCnicPhase('');
        } else {
          const cnicUrl = resolveCnicSnapshotUrl();
          if (!cnicUrl) {
            setState(AutoState.error);
            const msg = cnicSnapshotMissingMessage();
            setAutoStatus(msg);
            showMainMsg(msg, 'error');
            return;
          }
          await startCnicPhase(cnicUrl);
        }
      } catch (e) {
        setAutoStatus(e.message || 'Snapshot failed');
      }
      // handle.img uses the same blob URL as the preview; do not revoke here.
    };

    pollTimer = setInterval(() => {
      tick().catch(() => {});
    }, FACE_DETECTION_INTERVAL_MS);
  }

  async function startAutoFlow() {
    if (!chkEnable || !chkEnable.checked) {
      showMainMsg('Enable Auto Mode first.', 'warn');
      return;
    }
    if (isAutoRunning) return;
    currentVisitorSessionId += 1;
    isAutoRunning = true;
    stopped = false;
    clearPoll();
    clearCountdownTimer();
    setCountdownDisplay(0);
    if (prevVisitorBlobUrl) URL.revokeObjectURL(prevVisitorBlobUrl);
    if (prevCnicBlobUrl) URL.revokeObjectURL(prevCnicBlobUrl);
    prevVisitorBlobUrl = null;
    prevCnicBlobUrl = null;

    const cam = getCameraConfig();
    if (cam.visitor.type === 'usb') {
      const vv = getVisitorUsbVideoEl();
      if (!cam.visitor.usbDeviceId) {
        setState(AutoState.error);
        const msg = visitorSnapshotMissingMessage();
        setAutoStatus(msg);
        showMainMsg(msg, 'error');
        return;
      }
      if (!vv || !vv.srcObject || vv.readyState < 2) {
        setState(AutoState.error);
        setAutoStatus('Visitor USB preview is not ready. Wait for live video or allow camera permission.');
        showMainMsg(
          'Visitor USB camera must show live video before auto capture. Use http://localhost:5000 or allow camera access.',
          'error'
        );
        return;
      }
    } else {
      const visitorUrl = resolveVisitorSnapshotUrl();
      if (!visitorUrl) {
        setState(AutoState.error);
        const msg = visitorSnapshotMissingMessage();
        setAutoStatus(msg);
        showMainMsg(msg, 'error');
        return;
      }
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

    const cam3 = getCameraConfig();
    if (cam3.visitor.type === 'usb') {
      await startFacePhaseUsb(getVisitorUsbVideoEl());
    } else {
      await startFacePhaseIp(resolveVisitorSnapshotUrl());
    }
  }

  if (btnStart)
    btnStart.addEventListener('click', () => startAutoFlow().catch((e) => showMainMsg(e.message, 'error')));
  if (btnStop) btnStop.addEventListener('click', () => stopAutoFlow());

  if (chkEnable) {
    chkEnable.addEventListener('change', () => {
      if (chkEnable.checked) {
        if (autoModeBanner) autoModeBanner.style.display = 'block';
        startAutoFlow().catch((e) => showMainMsg(e.message, 'error'));
      } else {
        if (autoModeBanner) autoModeBanner.style.display = 'none';
        stopAutoFlow();
      }
    });
  }

  function syncEnableFromSettings() {
    const m = getSettingsMap() || {};
    if (chkEnable) {
      chkEnable.checked = String(m.AUTO_CAPTURE_ENABLED || '').toLowerCase() === 'true';
    }
    if (autoModeBanner) {
      autoModeBanner.style.display = chkEnable && chkEnable.checked ? 'block' : 'none';
    }
    const alwaysOn = String(m.AUTO_MODE_ALWAYS_ON || 'true').toLowerCase() === 'true';
    if (chkEnable && chkEnable.checked && alwaysOn) {
      setAutoStatus('Auto mode active — waiting for visitor');
      startAutoFlow().catch((e) => showMainMsg(e.message, 'error'));
    }
  }

  async function restartForNextVisitor() {
    const m = getSettingsMap() || {};
    const alwaysOn = String(m.AUTO_MODE_ALWAYS_ON || 'true').toLowerCase() === 'true';
    if (!chkEnable || !chkEnable.checked || !alwaysOn) return;
    stopAutoFlow();
    stopped = false;
    isAutoRunning = true;
    faceStableSince = 0;
    cnicStableSince = 0;
    lastCnicSig = '';
    lastCnicRect = null;
    cnicConsecutiveValid = 0;
    cnicProxyFailCount = 0;
    cnicNoCardCount = 0;
    cnicCountdownMissCount = 0;
    isCapturingFace = false;
    isCapturingCnic = false;
    isOcrRunning = false;
    setCountdownDisplay(0);
    const camR = getCameraConfig();
    if (camR.visitor.type === 'usb') {
      const vv = getVisitorUsbVideoEl();
      if (!camR.visitor.usbDeviceId || !vv || !vv.srcObject || vv.readyState < 2) {
        setState(AutoState.error);
        const msg = visitorSnapshotMissingMessage();
        setAutoStatus(msg);
        showMainMsg(msg, 'error');
        return;
      }
      setAutoStatus('Auto mode active — waiting for visitor');
      await startFacePhaseUsb(vv);
      return;
    }
    const visitorUrl = resolveVisitorSnapshotUrl();
    if (!visitorUrl) {
      setState(AutoState.error);
      const msg = visitorSnapshotMissingMessage();
      setAutoStatus(msg);
      showMainMsg(msg, 'error');
      return;
    }
    setAutoStatus('Auto mode active — waiting for visitor');
    await startFacePhaseIp(visitorUrl);
  }

  return { syncEnableFromSettings, stopAutoFlow, restartForNextVisitor };
}
