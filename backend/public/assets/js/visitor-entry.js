import { apiGet, apiPost, apiUpload } from './api.js';
import { bindAutoCapture } from './auto-capture.js';

let settingsMap = {};
let ocrEnabled = true;

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
function resolvedSnapshotUrl(type) {
  const manual = val('snapshotUrl');
  if (manual) return manual;
  const m = settingsMap;
  if (type === 'visitor') {
    return String(m.VISITOR_CAMERA_SNAPSHOT_URL || m.CAMERA_SNAPSHOT_URL || '').trim();
  }
  if (type === 'cnic-front' || type === 'cnic-back') {
    return String(m.CNIC_CAMERA_SNAPSHOT_URL || m.CAMERA_SNAPSHOT_URL || '').trim();
  }
  return String(m.CAMERA_SNAPSHOT_URL || '').trim();
}

async function loadSettings() {
  const res = await apiGet('/api/settings');
  settingsMap = res.data || {};
  ocrEnabled = String(settingsMap.OCR_ENABLED || 'true').toLowerCase() !== 'false';

  if (!val('streamUrl')) {
    setVal('streamUrl', settingsMap.VISITOR_CAMERA_STREAM_URL || settingsMap.CAMERA_STREAM_URL || '');
  }
  if (!val('snapshotUrl')) {
    setVal('snapshotUrl', settingsMap.VISITOR_CAMERA_SNAPSHOT_URL || settingsMap.CAMERA_SNAPSHOT_URL || '');
  }
  if (!val('company')) setVal('company', settingsMap.COMPANY_NAME || '');
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
    const p = await capture('visitor');
    if (!p) return;
    setHidden('visitor_photo_path', p);
    setImagePreview('prevVisitor', 'prevVisitorPh', p);
  } catch (e) {
    showMsg(e.message || 'Capture failed', 'error');
  }
});

document.getElementById('btnCapFront').addEventListener('click', async () => {
  try {
    const p = await capture('cnic-front');
    if (!p) return;
    setHidden('cnic_front_path', p);
    setImagePreview('prevFront', 'prevFrontPh', p);
  } catch (e) {
    showMsg(e.message || 'Capture failed', 'error');
  }
});

document.getElementById('btnCapBack').addEventListener('click', async () => {
  try {
    const p = await capture('cnic-back');
    if (!p) return;
    setHidden('cnic_back_path', p);
    setImagePreview('prevBack', 'prevBackPh', p);
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
  const imagePath = val('cnic_front_path');
  if (!imagePath) {
    showMsg('Capture or upload CNIC front first.', 'warn');
    return;
  }
  try {
    showMsg('Running OCR… (may take a while first time)', '');
    const res = await apiPost('/api/ocr/cnic', { imagePath });
    applyOcrFromResponse(res);
    showMsg('OCR finished. Check the debug section and verify Name and CNIC.', 'success');
  } catch (e) {
    showMsg(e.message || 'OCR failed', 'error');
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
    window.location.href = `/pass.html?id=${encodeURIComponent(id)}`;
  } catch (err) {
    showMsg(err.message || 'Save failed', 'error');
  }
});

function resetAll() {
  if (autoCaptureControl) autoCaptureControl.stopAutoFlow();
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
  const iframe = document.getElementById('streamIframe');
  const img = document.getElementById('streamImg');
  iframe.src = 'about:blank';
  img.removeAttribute('src');
  setStreamPreviewVisible('');
  showMsg('Form reset.', 'success');
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
  applyOcrFromResponse,
  onVisitorPhotoPath: (p) => {
    setHidden('visitor_photo_path', p);
    setImagePreview('prevVisitor', 'prevVisitorPh', p);
  },
  onCnicFrontPath: (p) => {
    setHidden('cnic_front_path', p);
    setImagePreview('prevFront', 'prevFrontPh', p);
  },
});

loadSettings()
  .then(() => {
    autoCaptureControl.syncEnableFromSettings();
    showMsg('Loaded settings.', 'success');
  })
  .catch((e) => showMsg(e.message || 'Failed to load settings', 'error'));
