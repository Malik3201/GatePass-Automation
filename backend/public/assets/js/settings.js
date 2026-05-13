import { apiGet, apiPost } from './api.js';
import { populateUsbCameraSelect } from './usb-camera.js';

function tickClock() {
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

tickClock();
setInterval(tickClock, 30000);

const KEYS = [
  'COMPANY_NAME',
  'GATE_NAME',
  'VISITOR_CAMERA_TYPE',
  'CNIC_CAMERA_TYPE',
  'VISITOR_USB_DEVICE_ID',
  'CNIC_USB_DEVICE_ID',
  'VISITOR_CAMERA_STREAM_URL',
  'VISITOR_CAMERA_SNAPSHOT_URL',
  'CNIC_CAMERA_STREAM_URL',
  'CNIC_CAMERA_SNAPSHOT_URL',
  'CAMERA_STREAM_URL',
  'CAMERA_SNAPSHOT_URL',
  'AUTO_CAPTURE_ENABLED',
  'AUTO_FACE_COUNTDOWN_SECONDS',
  'AUTO_CNIC_COUNTDOWN_SECONDS',
  'BACKUP_EXPORT_PATH',
  'OCR_ENABLED',
];

function showMsg(text, kind) {
  const el = document.getElementById('msg');
  el.className = `msg ${kind || ''}`.trim();
  el.textContent = text || '';
}

function normCameraType(v) {
  return String(v || 'ip').trim().toLowerCase() === 'usb' ? 'usb' : 'ip';
}

function applyVisitorCameraTypeUi() {
  const sel = document.getElementById('VISITOR_CAMERA_TYPE');
  const t = normCameraType(sel && sel.value);
  const ipB = document.getElementById('visitorIpBlock');
  const usbB = document.getElementById('visitorUsbBlock');
  if (ipB) ipB.style.display = t === 'usb' ? 'none' : 'block';
  if (usbB) usbB.style.display = t === 'usb' ? 'block' : 'none';
}

function applyCnicCameraTypeUi() {
  const sel = document.getElementById('CNIC_CAMERA_TYPE');
  const t = normCameraType(sel && sel.value);
  const ipB = document.getElementById('cnicIpBlock');
  const usbB = document.getElementById('cnicUsbBlock');
  if (ipB) ipB.style.display = t === 'usb' ? 'none' : 'block';
  if (usbB) usbB.style.display = t === 'usb' ? 'block' : 'none';
}

async function maybePopulateUsbFromSettings(data) {
  const vSel = document.getElementById('VISITOR_USB_DEVICE_ID');
  const cSel = document.getElementById('CNIC_USB_DEVICE_ID');
  if (normCameraType(data.VISITOR_CAMERA_TYPE) === 'usb' && vSel) {
    try {
      await populateUsbCameraSelect(vSel, String(data.VISITOR_USB_DEVICE_ID || '').trim());
    } catch (e) {
      showMsg(e.message || 'Could not list visitor USB cameras', 'warn');
    }
  }
  if (normCameraType(data.CNIC_CAMERA_TYPE) === 'usb' && cSel) {
    try {
      await populateUsbCameraSelect(cSel, String(data.CNIC_USB_DEVICE_ID || '').trim());
    } catch (e) {
      showMsg(e.message || 'Could not list CNIC USB cameras', 'warn');
    }
  }
}

async function load() {
  showMsg('Loading…', '');
  const res = await apiGet('/api/settings');
  const data = res.data || {};
  for (const k of KEYS) {
    const input = document.getElementById(k);
    if (!input) continue;
    let v = data[k] ?? '';
    if (k === 'VISITOR_CAMERA_TYPE' || k === 'CNIC_CAMERA_TYPE') {
      v = normCameraType(v);
    }
    input.value = v;
  }
  applyVisitorCameraTypeUi();
  applyCnicCameraTypeUi();
  await maybePopulateUsbFromSettings(data);
  showMsg('', '');
}

async function save() {
  showMsg('Saving…', '');
  try {
    for (const k of KEYS) {
      const input = document.getElementById(k);
      if (!input) continue;
      let v = String(input.value ?? '');
      if (k === 'VISITOR_CAMERA_TYPE' || k === 'CNIC_CAMERA_TYPE') {
        v = normCameraType(v);
      }
      await apiPost('/api/settings', { setting_key: k, setting_value: v });
    }
    showMsg('Saved successfully.', 'success');
  } catch (e) {
    showMsg(e.message || 'Save failed', 'error');
  }
}

document.getElementById('reloadBtn').addEventListener('click', () => load().catch((e) => showMsg(e.message, 'error')));
document.getElementById('saveBtn').addEventListener('click', () => save());

document.getElementById('VISITOR_CAMERA_TYPE')?.addEventListener('change', () => {
  applyVisitorCameraTypeUi();
});

document.getElementById('CNIC_CAMERA_TYPE')?.addEventListener('change', () => {
  applyCnicCameraTypeUi();
});

document.getElementById('btnRefreshVisitorUsb')?.addEventListener('click', async () => {
  const sel = document.getElementById('VISITOR_USB_DEVICE_ID');
  if (!sel) return;
  try {
    showMsg('Refreshing USB cameras…', '');
    await populateUsbCameraSelect(sel, sel.value);
    showMsg('USB camera list updated.', 'success');
  } catch (e) {
    showMsg(e.message || 'Refresh failed', 'error');
  }
});

document.getElementById('btnRefreshCnicUsb')?.addEventListener('click', async () => {
  const sel = document.getElementById('CNIC_USB_DEVICE_ID');
  if (!sel) return;
  try {
    showMsg('Refreshing USB cameras…', '');
    await populateUsbCameraSelect(sel, sel.value);
    showMsg('USB camera list updated.', 'success');
  } catch (e) {
    showMsg(e.message || 'Refresh failed', 'error');
  }
});

load().catch((e) => showMsg(e.message, 'error'));
