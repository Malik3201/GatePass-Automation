import { apiGet, apiPost, apiUpload } from './api.js';
import { bindAutoCapture, AutoState } from './auto-capture.js';
import {
  startUsbCamera,
  stopUsbCamera,
  captureVideoFrameAsBlob,
  uploadCapturedBlob,
} from './usb-camera.js';

let settingsMap = {};
let ocrEnabled = true;
let isOcrRunning = false;
let cameraUrls = null;
let visitorSnapshotPreviewTimer = null;
let cnicSnapshotPreviewTimer = null;

/** Last OCR confidence for visitor_name ('high' | 'medium' | 'none' | null if no OCR yet). */
let lastOcrNameConfidence = null;
let visitorNameUserEdited = false;
let companyUserEdited = false;
let returningGen = 0;
let returningTimer = null;

function isFullCnicInput(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.length === 13;
}

function isOcrNameConfidenceLow() {
  if (lastOcrNameConfidence == null) return false;
  return lastOcrNameConfidence !== 'high' && lastOcrNameConfidence !== 'medium';
}

function setReturningStatus(text, kindClass) {
  const el = document.getElementById('returningVisitorStatus');
  if (!el) return;
  el.textContent = text || '';
  el.className = `returning-visitor-status${kindClass ? ` ${kindClass}` : ''}`.trim();
}

function scheduleReturningVisitorLookup() {
  returningGen += 1;
  clearTimeout(returningTimer);
  const gen = returningGen;
  returningTimer = setTimeout(() => {
    void runReturningVisitorLookup(gen);
  }, 500);
}

function triggerReturningVisitorLookupNow() {
  returningGen += 1;
  clearTimeout(returningTimer);
  const gen = returningGen;
  void runReturningVisitorLookup(gen);
}

async function runReturningVisitorLookup(expectedGen) {
  const raw = val('cnic_no');
  if (!isFullCnicInput(raw)) {
    if (expectedGen === returningGen) {
      setReturningStatus('New visitor', 'state-new');
    }
    return;
  }

  const norm = normalizeCnic(raw);
  if (expectedGen !== returningGen) return;

  setReturningStatus('Checking previous visits...', 'state-loading');

  try {
    const res = await apiGet(`/api/visitors?cnic_no=${encodeURIComponent(norm)}`);
    if (expectedGen !== returningGen) return;

    const rows = res.data || [];
    if (!rows.length) {
      setReturningStatus('No previous record found.', 'state-none');
      return;
    }

    const latest = rows[0];
    let filled = false;

    const nameEmpty = !val('visitor_name').trim();
    const allowNameFromHistory =
      !visitorNameUserEdited && (nameEmpty || isOcrNameConfidenceLow());
    if (allowNameFromHistory && latest.visitor_name) {
      const n = String(latest.visitor_name).trim();
      if (n) {
        setVal('visitor_name', n);
        filled = true;
      }
    }

    if (!companyUserEdited && !val('company').trim() && latest.company) {
      const c = String(latest.company).trim();
      if (c) {
        setVal('company', c);
        filled = true;
      }
    }

    if (expectedGen !== returningGen) return;

    if (filled) {
      setReturningStatus('Returning visitor found. Details auto-filled from last visit.', 'state-found');
    } else {
      setReturningStatus('Returning visitor on file. Verify name and company.', 'state-found');
    }
    updateSaveDisabled();
  } catch (e) {
    if (expectedGen !== returningGen) return;
    setReturningStatus(e.message || 'Could not check previous visits.', 'state-none');
  }
}

function showMsg(text, kind) {
  const el = document.getElementById('msg');
  el.className = `msg ${kind || ''}`.trim();
  el.textContent = text || '';
}

function val(id) {
  const el = document.getElementById(id);
  return el ? String(el.value || '').trim() : '';
}

function setVal(id, v) {
  const el = document.getElementById(id);
  if (el) el.value = v ?? '';
}

function setHidden(id, v) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = v || '';
}

function setImagePreview(imgId, placeholderId, publicPath) {
  const img = document.getElementById(imgId);
  const ph = document.getElementById(placeholderId);
  if (!img || !ph) return;
  if (publicPath) {
    img.src = publicPath;
    img.style.display = 'block';
    ph.style.display = 'none';
  } else {
    img.removeAttribute('src');
    img.style.display = 'none';
    ph.style.display = 'block';
  }
}

/**
 * Resolve snapshot URL for manual or auto capture.
 * If the operator filled the legacy snapshot field, it wins for all types.
 * Otherwise: visitor → VISITOR then CAMERA; CNIC → CNIC then CAMERA.
 */
function normalizeSettingsData(res) {
  const raw = res && (res.data || res);
  if (!raw) return {};
  if (Array.isArray(raw)) {
    const map = {};
    for (const row of raw) {
      if (row && row.setting_key) map[row.setting_key] = row.setting_value;
    }
    return map;
  }
  return raw;
}

function resolveCameraUrls(map) {
  const m = map || {};
  const visitorStreamUrl = String(
    m.VISITOR_CAMERA_STREAM_URL || m.CAMERA_STREAM_URL || ''
  ).trim();
  const visitorSnapshotUrl = String(
    m.VISITOR_CAMERA_SNAPSHOT_URL || m.CAMERA_SNAPSHOT_URL || ''
  ).trim();
  const cnicStreamUrl = String(
    m.CNIC_CAMERA_STREAM_URL || m.VISITOR_CAMERA_STREAM_URL || m.CAMERA_STREAM_URL || ''
  ).trim();
  const cnicSnapshotUrl = String(
    m.CNIC_CAMERA_SNAPSHOT_URL || m.VISITOR_CAMERA_SNAPSHOT_URL || m.CAMERA_SNAPSHOT_URL || ''
  ).trim();
  return {
    visitorStreamUrl,
    visitorSnapshotUrl,
    cnicStreamUrl,
    cnicSnapshotUrl,
  };
}

export function resolveCameraConfig(settings) {
  const s = settings || {};
  const normType = (v) => (String(v || 'ip').trim().toLowerCase() === 'usb' ? 'usb' : 'ip');
  return {
    visitor: {
      type: normType(s.VISITOR_CAMERA_TYPE),
      streamUrl: String(s.VISITOR_CAMERA_STREAM_URL || s.CAMERA_STREAM_URL || '').trim(),
      snapshotUrl: String(s.VISITOR_CAMERA_SNAPSHOT_URL || s.CAMERA_SNAPSHOT_URL || '').trim(),
      usbDeviceId: String(s.VISITOR_USB_DEVICE_ID || '').trim(),
    },
    cnic: {
      type: normType(s.CNIC_CAMERA_TYPE),
      streamUrl: String(
        s.CNIC_CAMERA_STREAM_URL || s.VISITOR_CAMERA_STREAM_URL || s.CAMERA_STREAM_URL || ''
      ).trim(),
      snapshotUrl: String(
        s.CNIC_CAMERA_SNAPSHOT_URL || s.VISITOR_CAMERA_SNAPSHOT_URL || s.CAMERA_SNAPSHOT_URL || ''
      ).trim(),
      usbDeviceId: String(s.CNIC_USB_DEVICE_ID || '').trim(),
    },
  };
}

function updateCameraModeBadges(map) {
  const cfg = resolveCameraConfig(map);
  const vb = document.getElementById('visitorCameraModeBadge');
  const cb = document.getElementById('cnicCameraModeBadge');
  if (vb) {
    vb.textContent = cfg.visitor.type === 'usb' ? 'USB' : 'IP';
    vb.classList.remove('ip', 'usb');
    vb.classList.add(cfg.visitor.type === 'usb' ? 'usb' : 'ip');
  }
  if (cb) {
    cb.textContent = cfg.cnic.type === 'usb' ? 'USB' : 'IP';
    cb.classList.remove('ip', 'usb');
    cb.classList.add(cfg.cnic.type === 'usb' ? 'usb' : 'ip');
  }
}

function resolvedSnapshotUrl(type) {
  const cfg = resolveCameraConfig(settingsMap);
  if (type === 'visitor' && cfg.visitor.type === 'usb') return '';
  if ((type === 'cnic-front' || type === 'cnic-back') && cfg.cnic.type === 'usb') return '';
  const manual = val('snapshotUrl');
  if (manual) return manual;
  if (cameraUrls) {
    if (type === 'visitor') return cameraUrls.visitorSnapshotUrl || '';
    if (type === 'cnic-front' || type === 'cnic-back') return cameraUrls.cnicSnapshotUrl || '';
  }
  const m = settingsMap || {};
  if (type === 'visitor') {
    return String(m.VISITOR_CAMERA_SNAPSHOT_URL || m.CAMERA_SNAPSHOT_URL || '').trim();
  }
  if (type === 'cnic-front' || type === 'cnic-back') {
    return String(
      m.CNIC_CAMERA_SNAPSHOT_URL || m.VISITOR_CAMERA_SNAPSHOT_URL || m.CAMERA_SNAPSHOT_URL || ''
    ).trim();
  }
  return String(m.CAMERA_SNAPSHOT_URL || '').trim();
}

function clearSnapshotPreviewTimers() {
  if (visitorSnapshotPreviewTimer) {
    clearInterval(visitorSnapshotPreviewTimer);
    visitorSnapshotPreviewTimer = null;
  }
  if (cnicSnapshotPreviewTimer) {
    clearInterval(cnicSnapshotPreviewTimer);
    cnicSnapshotPreviewTimer = null;
  }
}

function setCameraPlaceholder(phEl, message) {
  if (!phEl) return;
  phEl.innerHTML = '';
  phEl.style.display = 'flex';
  const wrap = document.createElement('div');
  wrap.style.textAlign = 'center';
  wrap.style.maxWidth = '280px';
  const p = document.createElement('p');
  p.style.margin = '0 0 10px';
  p.textContent = message;
  const a = document.createElement('a');
  a.href = '/settings.html';
  a.className = 'btn btn-sm btn-outline';
  a.textContent = 'Open Settings';
  wrap.appendChild(p);
  wrap.appendChild(a);
  phEl.appendChild(wrap);
}

function setPlaceholderPlain(phEl, message) {
  if (!phEl) return;
  phEl.innerHTML = '';
  phEl.style.display = 'flex';
  const p = document.createElement('p');
  p.style.margin = '0';
  p.style.textAlign = 'center';
  p.style.maxWidth = '320px';
  p.style.lineHeight = '1.45';
  p.textContent = message;
  phEl.appendChild(p);
}

async function setupCameraPreviewsFromSettings(map) {
  const cfg = resolveCameraConfig(map);
  const urls = resolveCameraUrls(map);

  const vImg = document.getElementById('autoStreamVisitor');
  const vVid = document.getElementById('autoUsbVisitor');
  const vPh = document.getElementById('autoVisitorPreviewPlaceholder');
  const cImg = document.getElementById('autoStreamCnic');
  const cVid = document.getElementById('autoUsbCnic');
  const cPh = document.getElementById('autoCnicPreviewPlaceholder');

  clearSnapshotPreviewTimers();
  stopUsbCamera(vVid);
  stopUsbCamera(cVid);

  if (cfg.visitor.type === 'usb') {
    if (vImg) {
      vImg.removeAttribute('src');
      vImg.style.display = 'none';
    }
    if (!cfg.visitor.usbDeviceId) {
      if (vVid) vVid.style.display = 'none';
      setCameraPlaceholder(vPh, 'Select USB camera in Settings.');
    } else {
      if (vVid) vVid.style.display = 'block';
      if (vPh) vPh.style.display = 'none';
      try {
        await startUsbCamera(vVid, cfg.visitor.usbDeviceId);
      } catch (e) {
        if (vVid) vVid.style.display = 'none';
        const name = e && e.name;
        const denied =
          name === 'NotAllowedError' ||
          name === 'PermissionDeniedError' ||
          /permission/i.test(String((e && e.message) || ''));
        if (denied) {
          setPlaceholderPlain(vPh, 'Allow camera permission to preview USB camera.');
        } else {
          setPlaceholderPlain(vPh, (e && e.message) || 'Could not start USB visitor camera.');
        }
      }
    }
  } else {
    if (vVid) {
      vVid.style.display = 'none';
    }
    if (urls.visitorStreamUrl) {
      if (vImg) {
        vImg.src = urls.visitorStreamUrl;
        vImg.style.display = 'block';
      }
      if (vPh) vPh.style.display = 'none';
    } else if (urls.visitorSnapshotUrl) {
      if (vImg) {
        vImg.style.display = 'block';
        visitorSnapshotPreviewTimer = setInterval(() => {
          vImg.src = `/api/camera/snapshot-proxy?url=${encodeURIComponent(
            urls.visitorSnapshotUrl
          )}&t=${Date.now()}`;
        }, 1000);
      }
      if (vPh) vPh.style.display = 'none';
    } else {
      if (vImg) {
        vImg.removeAttribute('src');
        vImg.style.display = 'none';
      }
      setCameraPlaceholder(vPh, 'IP camera URL not configured.');
    }
  }

  if (cfg.cnic.type === 'usb') {
    if (cImg) {
      cImg.removeAttribute('src');
      cImg.style.display = 'none';
    }
    if (!cfg.cnic.usbDeviceId) {
      if (cVid) cVid.style.display = 'none';
      setCameraPlaceholder(cPh, 'Select USB camera in Settings.');
    } else {
      if (cVid) cVid.style.display = 'block';
      if (cPh) cPh.style.display = 'none';
      try {
        await startUsbCamera(cVid, cfg.cnic.usbDeviceId);
      } catch (e) {
        if (cVid) cVid.style.display = 'none';
        const name = e && e.name;
        const denied =
          name === 'NotAllowedError' ||
          name === 'PermissionDeniedError' ||
          /permission/i.test(String((e && e.message) || ''));
        if (denied) {
          setPlaceholderPlain(cPh, 'Allow camera permission to preview USB camera.');
        } else {
          setPlaceholderPlain(cPh, (e && e.message) || 'Could not start USB CNIC camera.');
        }
      }
    }
  } else {
    if (cVid) {
      cVid.style.display = 'none';
    }
    if (urls.cnicStreamUrl) {
      if (cImg) {
        cImg.src = urls.cnicStreamUrl;
        cImg.style.display = 'block';
      }
      if (cPh) cPh.style.display = 'none';
    } else if (urls.cnicSnapshotUrl) {
      if (cImg) {
        cImg.style.display = 'block';
        cnicSnapshotPreviewTimer = setInterval(() => {
          cImg.src = `/api/camera/snapshot-proxy?url=${encodeURIComponent(
            urls.cnicSnapshotUrl
          )}&t=${Date.now()}`;
        }, 1000);
      }
      if (cPh) cPh.style.display = 'none';
    } else {
      if (cImg) {
        cImg.removeAttribute('src');
        cImg.style.display = 'none';
      }
      setCameraPlaceholder(cPh, 'IP camera URL not configured.');
    }
  }
}

function setBadge(el, text, variant) {
  if (!el) return;
  el.textContent = text;
  el.className = 'camera-status-badge';
  if (variant) el.classList.add(variant);
}

function applyCameraBadgesFromAutoState(s) {
  const vb = document.getElementById('visitorStatusBadge');
  const cb = document.getElementById('cnicStatusBadge');
  if (!vb || !cb) return;

  if (s === AutoState.waiting_face) {
    setBadge(vb, 'Waiting for face', 'waiting');
    setBadge(cb, 'Waiting', 'waiting');
  } else if (s === AutoState.face_countdown) {
    setBadge(vb, 'Capturing soon', 'capture');
    setBadge(cb, 'Waiting', 'waiting');
  } else if (s === AutoState.capturing_face) {
    setBadge(vb, 'Capturing', 'capture');
    setBadge(cb, 'Waiting', 'waiting');
  } else if (s === AutoState.waiting_cnic) {
    setBadge(vb, 'Captured', 'done');
    setBadge(cb, 'Waiting for CNIC', 'waiting');
  } else if (s === AutoState.cnic_countdown) {
    setBadge(vb, 'Captured', 'done');
    setBadge(cb, 'Card ready', 'active');
  } else if (s === AutoState.capturing_cnic) {
    setBadge(vb, 'Captured', 'done');
    setBadge(cb, 'Capturing', 'capture');
  } else if (s === AutoState.running_ocr) {
    setBadge(vb, 'Captured', 'done');
    setBadge(cb, 'OCR running', 'capture');
  } else if (s === AutoState.ready_for_review) {
    setBadge(vb, 'Captured', 'done');
    setBadge(cb, 'OCR complete', 'done');
  } else if (s === AutoState.stopped || s === AutoState.error || s === AutoState.idle) {
    setBadge(vb, 'Waiting', 'waiting');
    setBadge(cb, 'Waiting', 'waiting');
  } else {
    setBadge(vb, 'Live', 'active');
    setBadge(cb, 'Live', 'active');
  }
}

function clearWorkflowClasses() {
  ['wfStepFace', 'wfStepCnic', 'wfStepOcr', 'wfStepVerify', 'wfStepSave'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active', 'done');
  });
}

function applyWorkflowFromAutoState(s) {
  clearWorkflowClasses();
  const face = document.getElementById('wfStepFace');
  const cnic = document.getElementById('wfStepCnic');
  const ocr = document.getElementById('wfStepOcr');
  const ver = document.getElementById('wfStepVerify');
  const sav = document.getElementById('wfStepSave');

  if (s === AutoState.idle || s === AutoState.stopped || s === AutoState.error) {
    face?.classList.add('active');
    return;
  }

  if (s === AutoState.ready_for_review) {
    face?.classList.add('done');
    cnic?.classList.add('done');
    ocr?.classList.add('done');
    ver?.classList.add('active');
    sav?.classList.add('active');
    return;
  }

  if (s === AutoState.running_ocr) {
    face?.classList.add('done');
    cnic?.classList.add('done');
    ocr?.classList.add('active');
    return;
  }

  if (s === AutoState.waiting_cnic || s === AutoState.cnic_countdown || s === AutoState.capturing_cnic) {
    face?.classList.add('done');
    cnic?.classList.add('active');
    return;
  }

  if (s === AutoState.capturing_face) {
    face?.classList.add('active');
    return;
  }

  if (s === AutoState.waiting_face || s === AutoState.face_countdown) {
    face?.classList.add('active');
  }
}

function updateSaveDisabled() {
  const btn = document.getElementById('btnSave');
  if (!btn) return;
  const ok = val('visitor_name') && val('cnic_no') && val('company');
  btn.disabled = !ok;
}

function tickEntryClock() {
  const el = document.getElementById('topbarClock');
  if (!el) return;
  const d = new Date();
  el.textContent = d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function loadSettings() {
  const res = await apiGet('/api/settings');
  settingsMap = normalizeSettingsData(res);
  ocrEnabled = String(settingsMap.OCR_ENABLED || 'true').toLowerCase() !== 'false';

  cameraUrls = resolveCameraUrls(settingsMap);
  updateCameraModeBadges(settingsMap);
  await setupCameraPreviewsFromSettings(settingsMap);

  if (!val('streamUrl')) {
    setVal('streamUrl', settingsMap.VISITOR_CAMERA_STREAM_URL || settingsMap.CAMERA_STREAM_URL || '');
  }
  if (!val('snapshotUrl')) {
    setVal('snapshotUrl', settingsMap.VISITOR_CAMERA_SNAPSHOT_URL || settingsMap.CAMERA_SNAPSHOT_URL || '');
  }
  if (!val('company')) setVal('company', settingsMap.COMPANY_NAME || '');
  updateSaveDisabled();
}

function setStreamPreviewVisible(which) {
  const iframe = document.getElementById('streamIframe');
  const img = document.getElementById('streamImg');
  const ph = document.getElementById('streamPlaceholder');
  iframe.style.display = which === 'iframe' ? 'block' : 'none';
  img.style.display = which === 'img' ? 'block' : 'none';
  ph.style.display = which ? 'none' : 'block';
}

document.getElementById('btnLoadStream').addEventListener('click', () => {
  const url = val('streamUrl');
  if (!url) {
    showMsg('Enter a stream URL first.', 'warn');
    return;
  }
  const useIframe = document.getElementById('useIframe').checked;
  const iframe = document.getElementById('streamIframe');
  const img = document.getElementById('streamImg');
  iframe.src = 'about:blank';
  img.removeAttribute('src');

  if (useIframe) {
    iframe.src = url;
    setStreamPreviewVisible('iframe');
  } else {
    img.src = url;
    setStreamPreviewVisible('img');
  }
  showMsg('Stream preview loaded (if the app blocks embedding, try iframe mode).', 'success');
});

document.getElementById('btnTestSnap').addEventListener('click', async () => {
  const u = resolvedSnapshotUrl('visitor');
  if (!u) {
    showMsg('Enter snapshot URL (or save one in Settings).', 'warn');
    return;
  }
  try {
    showMsg('Testing snapshot…', '');
    const res = await apiGet(`/api/camera/test?snapshotUrl=${encodeURIComponent(u)}`);
    if (res.success) {
      showMsg(`Snapshot OK (${res.bytes} bytes).`, 'success');
    } else {
      showMsg(res.message || 'Snapshot test failed', 'error');
    }
  } catch (e) {
    showMsg(e.message || 'Snapshot test failed', 'error');
  }
});

async function capture(type) {
  const snapshotUrl = resolvedSnapshotUrl(type);
  if (!snapshotUrl) {
    showMsg('Snapshot URL is required (field or Settings).', 'warn');
    return null;
  }
  showMsg('Capturing…', '');
  const res = await apiPost('/api/camera/capture', { snapshotUrl, type });
  showMsg('Captured.', 'success');
  return res.path;
}

document.getElementById('btnCapVisitor').addEventListener('click', async () => {
  try {
    const cfg = resolveCameraConfig(settingsMap);
    if (cfg.visitor.type === 'usb') {
      const vid = document.getElementById('autoUsbVisitor');
      if (!vid || !vid.srcObject || vid.readyState < 2) {
        showMsg('Visitor USB camera is not showing live video yet.', 'warn');
        return;
      }
      const blob = await captureVideoFrameAsBlob(vid, { quality: 0.92, mimeType: 'image/jpeg' });
      const up = await uploadCapturedBlob('visitor', blob);
      setHidden('visitor_photo_path', up.path);
      setImagePreview('prevVisitor', 'prevVisitorPh', up.path);
      showMsg('Visitor photo captured.', 'success');
    } else {
      const p = await capture('visitor');
      if (!p) return;
      setHidden('visitor_photo_path', p);
      setImagePreview('prevVisitor', 'prevVisitorPh', p);
    }
  } catch (e) {
    showMsg(e.message || 'Capture failed', 'error');
  }
});

document.getElementById('btnCapFront').addEventListener('click', async () => {
  try {
    const cfg = resolveCameraConfig(settingsMap);
    if (cfg.cnic.type === 'usb') {
      const vid = document.getElementById('autoUsbCnic');
      if (!vid || !vid.srcObject || vid.readyState < 2) {
        showMsg('CNIC USB camera is not showing live video yet.', 'warn');
        return;
      }
      const blob = await captureVideoFrameAsBlob(vid, { quality: 0.92, mimeType: 'image/jpeg' });
      const up = await uploadCapturedBlob('cnic-front', blob);
      setHidden('cnic_front_path', up.path);
      setImagePreview('prevFront', 'prevFrontPh', up.path);
      if (ocrEnabled) {
        if (isOcrRunning) return;
        try {
          isOcrRunning = true;
          showMsg('Running OCR… (may take a while first time)', '');
          const res = await apiPost('/api/ocr/cnic', { imagePath: up.path });
          applyOcrFromResponse(res);
          showMsg('OCR finished. Check the debug section and verify Name and CNIC.', 'success');
        } finally {
          isOcrRunning = false;
        }
      } else {
        showMsg('CNIC front saved. OCR is disabled in Settings; use Run OCR if you need extraction.', 'warn');
      }
    } else {
      const p = await capture('cnic-front');
      if (!p) return;
      setHidden('cnic_front_path', p);
      setImagePreview('prevFront', 'prevFrontPh', p);
    }
  } catch (e) {
    showMsg(e.message || 'Capture failed', 'error');
  }
});

document.getElementById('btnCapBack').addEventListener('click', async () => {
  try {
    const cfg = resolveCameraConfig(settingsMap);
    if (cfg.cnic.type === 'usb') {
      const vid = document.getElementById('autoUsbCnic');
      if (!vid || !vid.srcObject || vid.readyState < 2) {
        showMsg('CNIC USB camera is not showing live video yet.', 'warn');
        return;
      }
      const blob = await captureVideoFrameAsBlob(vid, { quality: 0.92, mimeType: 'image/jpeg' });
      const up = await uploadCapturedBlob('cnic-back', blob);
      setHidden('cnic_back_path', up.path);
      setImagePreview('prevBack', 'prevBackPh', up.path);
      showMsg('CNIC back captured.', 'success');
    } else {
      const p = await capture('cnic-back');
      if (!p) return;
      setHidden('cnic_back_path', p);
      setImagePreview('prevBack', 'prevBackPh', p);
    }
  } catch (e) {
    showMsg(e.message || 'Capture failed', 'error');
  }
});

/** Apply OCR API response to the form and debug fields (shared by manual OCR button and auto flow). */
function applyOcrFromResponse(res) {
  const ex = res.extracted || {};
  const conf = res.confidence || {};

  const ocrName = (ex.visitor_name || '').trim();
  const nameConf = conf.visitor_name || 'none';
  lastOcrNameConfidence = nameConf;
  const alphaWords = countAlphaWords(ocrName);
  const longestWord = Math.max(
    0,
    ...String(ocrName)
      .split(/\s+/)
      .map((w) => w.replace(/[^A-Za-z]/g, '').length)
  );
  const allowAutoName =
    ocrName &&
    (nameConf === 'high' ||
      nameConf === 'medium' ||
      alphaWords >= 2 ||
      (alphaWords === 1 && longestWord >= 5));

  if (allowAutoName) {
    setVal('visitor_name', ocrName);
  }

  if (ex.cnic_no) setVal('cnic_no', ex.cnic_no);

  document.getElementById('ocrRaw').value = res.rawText || '';
  const cleaned = Array.isArray(res.cleanedLines) ? res.cleanedLines.join('\n') : '';
  document.getElementById('ocrCleaned').value = cleaned;
  setHidden('ocr_raw_text', res.rawText || '');

  const diag = {
    extracted_visitor_name: ex.visitor_name || '',
    extracted_cnic_no: ex.cnic_no || '',
    confidence: conf,
  };
  document.getElementById('ocrDiag').textContent = JSON.stringify(diag, null, 2);
  updateSaveDisabled();
  triggerReturningVisitorLookupNow();
  document.getElementById('company')?.focus();
}

/** Count alphabetic words (length ≥ 2) for OCR auto-fill safety. */
function countAlphaWords(s) {
  return String(s || '')
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z]/g, ''))
    .filter((w) => w.length >= 2).length;
}

document.getElementById('btnOcr').addEventListener('click', async () => {
  if (!ocrEnabled) {
    if (!confirm('OCR is disabled in settings. Run anyway?')) return;
  }
  if (isOcrRunning) return;
  const imagePath = val('cnic_front_path');
  if (!imagePath) {
    showMsg('Capture or upload CNIC front first.', 'warn');
    return;
  }
  try {
    isOcrRunning = true;
    showMsg('Running OCR… (may take a while first time)', '');
    const res = await apiPost('/api/ocr/cnic', { imagePath });
    applyOcrFromResponse(res);
    showMsg('OCR finished. Check the debug section and verify Name and CNIC.', 'success');
  } catch (e) {
    showMsg(e.message || 'OCR failed', 'error');
  } finally {
    isOcrRunning = false;
  }
});

async function uploadVisitorPhoto() {
  const input = document.getElementById('upVisitor');
  const file = input.files && input.files[0];
  const res = await apiUpload('/api/visitors/upload-photo', file);
  return res.path;
}

document.getElementById('btnUpVisitor').addEventListener('click', async () => {
  try {
    const p = await uploadVisitorPhoto();
    setHidden('visitor_photo_path', p);
    setImagePreview('prevVisitor', 'prevVisitorPh', p);
    showMsg('Visitor photo uploaded.', 'success');
  } catch (e) {
    showMsg(e.message || 'Upload failed', 'error');
  }
});

document.getElementById('btnUpFront').addEventListener('click', async () => {
  try {
    const input = document.getElementById('upFront');
    const file = input.files && input.files[0];
    const res = await apiUpload('/api/visitors/upload-cnic-front', file);
    setHidden('cnic_front_path', res.path);
    setImagePreview('prevFront', 'prevFrontPh', res.path);
    showMsg('CNIC front uploaded.', 'success');
  } catch (e) {
    showMsg(e.message || 'Upload failed', 'error');
  }
});

document.getElementById('btnUpBack').addEventListener('click', async () => {
  try {
    const input = document.getElementById('upBack');
    const file = input.files && input.files[0];
    const res = await apiUpload('/api/visitors/upload-cnic-back', file);
    setHidden('cnic_back_path', res.path);
    setImagePreview('prevBack', 'prevBackPh', res.path);
    showMsg('CNIC back uploaded.', 'success');
  } catch (e) {
    showMsg(e.message || 'Upload failed', 'error');
  }
});

function normalizeCnic(input) {
  const digits = String(input || '').replace(/\D/g, '');
  if (digits.length === 13) {
    return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
  }
  return String(input || '').trim();
}

function isLikelyCnic(s) {
  return /^\d{5}-\d{7}-\d$/.test(String(s || '').trim());
}

function collectPayload() {
  const emptyToNull = (x) => {
    const t = String(x ?? '').trim();
    return t.length ? t : null;
  };

  return {
    visitor_name: val('visitor_name'),
    cnic_no: normalizeCnic(val('cnic_no')),
    company: emptyToNull(val('company')),
    visitor_photo_path: emptyToNull(val('visitor_photo_path')),
    cnic_front_path: emptyToNull(val('cnic_front_path')),
    cnic_back_path: emptyToNull(val('cnic_back_path')),
    ocr_raw_text: (() => {
      const t = document.getElementById('ocrRaw').value;
      return t.trim().length ? t : null;
    })(),
  };
}

document.getElementById('visitorForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const payload = collectPayload();
  if (!payload.visitor_name) {
    showMsg('Visitor name is required.', 'warn');
    return;
  }
  if (!payload.cnic_no) {
    showMsg('CNIC is required.', 'warn');
    return;
  }
  if (!payload.company) {
    showMsg('Company is required.', 'warn');
    return;
  }

  if (!isLikelyCnic(payload.cnic_no)) {
    const ok = confirm(
      'CNIC does not match the usual format 12345-1234567-1.\n\nSave anyway? (Click Cancel to edit.)'
    );
    if (!ok) return;
  }

  if (!payload.visitor_photo_path) {
    const ok = confirm(
      'No visitor photo is attached yet.\n\nSave anyway? (You can add a photo later in a future version.)'
    );
    if (!ok) return;
  }

  try {
    showMsg('Saving…', '');
    const res = await apiPost('/api/visitors', payload);
    const id = res.data && res.data.id;
    if (!id) throw new Error('Saved, but server did not return visitor id.');
    showMsg('Saved. Opening printable pass…', 'success');
    try {
      window.open(`/pass.html?id=${encodeURIComponent(id)}`, '_blank');
    } catch {
      window.location.href = `/pass.html?id=${encodeURIComponent(id)}`;
      return;
    }
    resetForNextVisitor();
  } catch (err) {
    showMsg(err.message || 'Save failed', 'error');
  }
});

function resetCore() {
  returningGen += 1;
  clearTimeout(returningTimer);
  lastOcrNameConfidence = null;
  visitorNameUserEdited = false;
  companyUserEdited = false;
  document.getElementById('visitorForm').reset();
  setHidden('visitor_photo_path', '');
  setHidden('cnic_front_path', '');
  setHidden('cnic_back_path', '');
  setHidden('ocr_raw_text', '');
  document.getElementById('ocrRaw').value = '';
  document.getElementById('ocrCleaned').value = '';
  document.getElementById('ocrDiag').textContent = '';
  setImagePreview('prevVisitor', 'prevVisitorPh', '');
  setImagePreview('prevFront', 'prevFrontPh', '');
  setImagePreview('prevBack', 'prevBackPh', '');
  setReturningStatus('New visitor', 'state-new');
  updateSaveDisabled();
}

function resetAll() {
  if (autoCaptureControl) autoCaptureControl.stopAutoFlow();
  resetCore();
  const iframe = document.getElementById('streamIframe');
  const img = document.getElementById('streamImg');
  iframe.src = 'about:blank';
  img.removeAttribute('src');
  setStreamPreviewVisible('');
  showMsg('Form reset.', 'success');
  updateSaveDisabled();
}

function resetForNextVisitor() {
  resetCore();
  showMsg('Ready for next visitor.', 'success');
  if (autoCaptureControl && typeof autoCaptureControl.restartForNextVisitor === 'function') {
    autoCaptureControl.restartForNextVisitor().catch(() => {});
  }
}

document.getElementById('btnReset').addEventListener('click', () => {
  if (!confirm('Reset the whole form?')) return;
  resetAll();
  loadSettings()
    .then(() => autoCaptureControl.syncEnableFromSettings())
    .catch(() => {});
});

document.getElementById('ocrRaw').addEventListener('input', () => {
  setHidden('ocr_raw_text', document.getElementById('ocrRaw').value);
});

const autoCaptureControl = bindAutoCapture({
  getSettingsMap: () => settingsMap,
  showMainMsg: showMsg,
  resolveVisitorSnapshotUrl: () => resolvedSnapshotUrl('visitor'),
  resolveCnicSnapshotUrl: () => resolvedSnapshotUrl('cnic-front'),
  getCameraConfig: () => resolveCameraConfig(settingsMap),
  getVisitorUsbVideoEl: () => document.getElementById('autoUsbVisitor'),
  getCnicUsbVideoEl: () => document.getElementById('autoUsbCnic'),
  applyOcrFromResponse,
  onAutoStateChange: (s) => {
    applyWorkflowFromAutoState(s);
    applyCameraBadgesFromAutoState(s);
  },
  onVisitorPhotoPath: (p) => {
    setHidden('visitor_photo_path', p);
    setImagePreview('prevVisitor', 'prevVisitorPh', p);
  },
  onCnicFrontPath: (p) => {
    setHidden('cnic_front_path', p);
    setImagePreview('prevFront', 'prevFrontPh', p);
  },
});

applyWorkflowFromAutoState(AutoState.idle);
applyCameraBadgesFromAutoState(AutoState.idle);

tickEntryClock();
setInterval(tickEntryClock, 30000);
document.getElementById('visitor_name')?.addEventListener('input', () => {
  visitorNameUserEdited = true;
  updateSaveDisabled();
});
document.getElementById('company')?.addEventListener('input', () => {
  companyUserEdited = true;
  updateSaveDisabled();
});
document.getElementById('cnic_no')?.addEventListener('input', () => {
  updateSaveDisabled();
  scheduleReturningVisitorLookup();
});

loadSettings()
  .then(() => {
    autoCaptureControl.syncEnableFromSettings();
    showMsg('Loaded settings.', 'success');
  })
  .catch((e) => showMsg(e.message || 'Failed to load settings', 'error'));
