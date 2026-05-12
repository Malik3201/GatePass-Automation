import { apiGet, apiPost } from './api.js';

const KEYS = [
  'COMPANY_NAME',
  'GATE_NAME',
  'CAMERA_STREAM_URL',
  'CAMERA_SNAPSHOT_URL',
  'VISITOR_CAMERA_STREAM_URL',
  'VISITOR_CAMERA_SNAPSHOT_URL',
  'CNIC_CAMERA_STREAM_URL',
  'CNIC_CAMERA_SNAPSHOT_URL',
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

async function load() {
  showMsg('Loading…', '');
  const res = await apiGet('/api/settings');
  const data = res.data || {};
  for (const k of KEYS) {
    const input = document.getElementById(k);
    if (!input) continue;
    input.value = data[k] ?? '';
  }
  showMsg('', '');
}

async function save() {
  showMsg('Saving…', '');
  try {
    for (const k of KEYS) {
      const input = document.getElementById(k);
      if (!input) continue;
      await apiPost('/api/settings', { setting_key: k, setting_value: String(input.value ?? '') });
    }
    showMsg('Saved successfully.', 'success');
  } catch (e) {
    showMsg(e.message || 'Save failed', 'error');
  }
}

document.getElementById('reloadBtn').addEventListener('click', () => load().catch((e) => showMsg(e.message, 'error')));
document.getElementById('saveBtn').addEventListener('click', () => save());

load().catch((e) => showMsg(e.message, 'error'));
