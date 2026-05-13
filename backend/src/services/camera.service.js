const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { getTodayFolder } = require('../utils/dateFolders');
const { ensureDir, getUploadsRoot } = require('../utils/fileHelpers');
const { getSetting } = require('./settings.service');

const CAPTURE_TIMEOUT_MS = 10000;
const SNAPSHOT_PROXY_TIMEOUT_MS = 5000;

const typeToFolder = {
  visitor: 'visitors',
  'cnic-front': 'cnic-front',
  'cnic-back': 'cnic-back',
};

function publicPathFor(subFolder, dateFolder, filename) {
  return `/uploads/${subFolder}/${dateFolder}/${filename}`.replace(/\\/g, '/');
}

function validateHttpUrl(url) {
  const s = String(url || '').trim();
  if (!/^https?:\/\//i.test(s)) {
    const err = new Error('URL must start with http:// or https://');
    err.status = 400;
    err.hint = 'Paste the full URL from your IP camera app (including http:// or https://).';
    throw err;
  }
  return s;
}

/**
 * Download snapshot bytes from camera (used by capture and proxy).
 * Keeps errors small — do not attach full axios response to logs.
 */
async function downloadSnapshotBuffer(snapshotUrl, timeoutMs = CAPTURE_TIMEOUT_MS) {
  const url = validateHttpUrl(snapshotUrl);
  try {
    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: timeoutMs,
      maxContentLength: 15 * 1024 * 1024,
      validateStatus: () => true,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Accept: 'image/jpeg,image/*,*/*',
        'Cache-Control': 'no-cache',
      },
    });

    if (res.status < 200 || res.status >= 300) {
      const err = new Error(`Camera returned HTTP ${res.status}`);
      err.status = 502;
      err.hint = 'Open the snapshot URL in a browser on this PC to confirm it works.';
      err.code = `HTTP_${res.status}`;
      err.url = url;
      throw err;
    }

    return Buffer.from(res.data);
  } catch (e) {
    if (e.status && e.hint) throw e;
    const msg = e.code === 'ECONNABORTED' ? 'Camera request timed out' : e.message || 'Could not download snapshot';
    const err = new Error(msg);
    err.status = 502;
    err.hint = 'Check LAN/Wi-Fi, firewall, and that the phone/camera app is running.';
    err.code = e.code || null;
    err.url = url;
    throw err;
  }
}

/** Short-timeout fetch for GET /api/camera/snapshot-proxy (browser analysis, no disk write). */
async function fetchSnapshotProxyBuffer(snapshotUrl) {
  return downloadSnapshotBuffer(snapshotUrl, SNAPSHOT_PROXY_TIMEOUT_MS);
}

/**
 * Resolve snapshot URL: explicit body first, then per-type settings, then legacy CAMERA_SNAPSHOT_URL.
 */
async function resolveSnapshotUrlForType(type, snapshotUrl) {
  let url = snapshotUrl && String(snapshotUrl).trim();
  if (url) return url;

  if (type === 'visitor') {
    url = await getSetting('VISITOR_CAMERA_SNAPSHOT_URL');
    if (!url || !String(url).trim()) url = await getSetting('CAMERA_SNAPSHOT_URL');
  } else if (type === 'cnic-front' || type === 'cnic-back') {
    url = await getSetting('CNIC_CAMERA_SNAPSHOT_URL');
    if (!url || !String(url).trim()) url = await getSetting('CAMERA_SNAPSHOT_URL');
  } else {
    url = await getSetting('CAMERA_SNAPSHOT_URL');
  }

  return url && String(url).trim() ? String(url).trim() : '';
}

/**
 * Download image from IP camera snapshot URL and save under uploads/{type}/YYYY-MM-DD/
 */
async function captureAndSave({ snapshotUrl, type }) {
  if (!typeToFolder[type]) {
    const err = new Error('type must be visitor, cnic-front, or cnic-back');
    err.status = 400;
    err.hint = 'Send JSON: { "snapshotUrl": "...", "type": "visitor" | "cnic-front" | "cnic-back" }';
    throw err;
  }

  const url = await resolveSnapshotUrlForType(type, snapshotUrl);
  if (!url) {
    const err = new Error(
      'snapshotUrl is required, or set VISITOR_CAMERA_SNAPSHOT_URL / CNIC_CAMERA_SNAPSHOT_URL / CAMERA_SNAPSHOT_URL in settings'
    );
    err.status = 400;
    err.hint = 'Configure camera URLs in Settings or pass snapshotUrl in the request body.';
    throw err;
  }

  const buffer = await downloadSnapshotBuffer(url);
  const subFolder = typeToFolder[type];
  const dateFolder = getTodayFolder();
  const dir = path.join(getUploadsRoot(), subFolder, dateFolder);
  ensureDir(dir);

  const ext = '.jpg';
  const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
  const absPath = path.join(dir, filename);
  fs.writeFileSync(absPath, buffer);

  return {
    success: true,
    path: publicPathFor(subFolder, dateFolder, filename),
    filename,
  };
}

/**
 * Quick connectivity check — downloads bytes, does not persist.
 */
async function testSnapshot(snapshotUrl) {
  if (!snapshotUrl || !String(snapshotUrl).trim()) {
    return {
      success: false,
      message: 'snapshotUrl query parameter is required',
      hint: 'Example: /api/camera/test?snapshotUrl=http://192.168.1.25:8080/shot.jpg',
    };
  }
  try {
    const buffer = await downloadSnapshotBuffer(String(snapshotUrl).trim());
    return {
      success: true,
      bytes: buffer.length,
      message: 'Snapshot URL responded with an image body.',
    };
  } catch (e) {
    return {
      success: false,
      message: e.message || 'Failed to download snapshot',
      hint: e.hint,
    };
  }
}

module.exports = {
  captureAndSave,
  testSnapshot,
  downloadSnapshotBuffer,
  fetchSnapshotProxyBuffer,
  validateHttpUrl,
};
