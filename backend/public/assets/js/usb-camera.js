/**
 * USB / local camera helpers (getUserMedia). Optional; IP camera flow does not use this module.
 */

import { apiUpload } from './api.js';

/**
 * Request permission once if needed, then list video input devices.
 * @returns {Promise<MediaDeviceInfo[]>}
 */
export async function listUsbCameras() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
    throw new Error('Camera enumeration is not supported in this browser.');
  }
  let devices = await navigator.mediaDevices.enumerateDevices();
  let videoInputs = devices.filter((d) => d.kind === 'videoinput');
  const needsPermission = videoInputs.length === 0 || videoInputs.some((d) => !d.label);
  if (needsPermission) {
    try {
      await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    } catch (e) {
      const name = e && e.name;
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        throw new Error('Camera permission denied. Allow camera access to list USB cameras.');
      }
      throw new Error(e && e.message ? String(e.message) : 'Could not access camera.');
    }
    devices = await navigator.mediaDevices.enumerateDevices();
    videoInputs = devices.filter((d) => d.kind === 'videoinput');
  }
  return videoInputs;
}

/**
 * @param {HTMLSelectElement|null} selectElement
 * @param {string} [selectedDeviceId]
 */
export async function populateUsbCameraSelect(selectElement, selectedDeviceId) {
  if (!selectElement) return;
  const list = await listUsbCameras();
  const keep = String(selectedDeviceId || selectElement.value || '').trim();
  selectElement.innerHTML = '';
  const z = document.createElement('option');
  z.value = '';
  z.textContent = '— Select camera —';
  selectElement.appendChild(z);
  list.forEach((d, i) => {
    const o = document.createElement('option');
    o.value = d.deviceId;
    o.textContent = d.label && d.label.trim() ? d.label.trim() : `Camera ${i + 1}`;
    selectElement.appendChild(o);
  });
  if (keep && [...selectElement.options].some((o) => o.value === keep)) {
    selectElement.value = keep;
  }
}

/**
 * @param {HTMLVideoElement} videoElement
 * @param {string} [deviceId]
 * @returns {Promise<MediaStream>}
 */
export async function startUsbCamera(videoElement, deviceId) {
  if (!videoElement) throw new Error('Missing video element.');
  stopUsbCamera(videoElement);
  const constraints = {
    video: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  videoElement.srcObject = stream;
  videoElement._stream = stream;
  await videoElement.play().catch(() => {});
  return stream;
}

/** @param {HTMLVideoElement|null} videoElement */
export function stopUsbCamera(videoElement) {
  if (!videoElement) return;
  const s = videoElement._stream || videoElement.srcObject;
  if (s && typeof s.getTracks === 'function') {
    s.getTracks().forEach((t) => t.stop());
  }
  videoElement.srcObject = null;
  videoElement._stream = null;
}

/**
 * @param {HTMLVideoElement} videoElement
 * @param {{ quality?: number, mimeType?: string }} [options]
 * @returns {Promise<Blob>}
 */
export async function captureVideoFrameAsBlob(videoElement, options = {}) {
  const quality = options.quality ?? 0.9;
  const mimeType = options.mimeType || 'image/jpeg';
  if (!videoElement) throw new Error('Missing video element.');
  if (videoElement.readyState < 2) throw new Error('Video not ready for capture.');
  const w = videoElement.videoWidth;
  const h = videoElement.videoHeight;
  if (!(w > 2) || !(h > 2)) throw new Error('Video has no valid frame size yet.');
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not available.');
  ctx.drawImage(videoElement, 0, 0, w, h);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Could not encode video frame.'));
      },
      mimeType,
      quality
    );
  });
}

/**
 * @param {'visitor'|'cnic-front'|'cnic-back'} type
 * @param {Blob} blob
 */
export async function uploadCapturedBlob(type, blob) {
  const map = {
    visitor: '/api/visitors/upload-photo',
    'cnic-front': '/api/visitors/upload-cnic-front',
    'cnic-back': '/api/visitors/upload-cnic-back',
  };
  const path = map[type];
  if (!path) throw new Error('Invalid upload type.');
  const file = new File([blob], 'capture.jpg', { type: 'image/jpeg' });
  return apiUpload(path, file);
}

/**
 * @param {HTMLVideoElement} videoElement
 * @param {number} [maxWidth]
 * @returns {HTMLCanvasElement}
 */
export function getVideoFrameCanvas(videoElement, maxWidth = 640) {
  if (!videoElement) throw new Error('Missing video element.');
  if (videoElement.readyState < 2) throw new Error('Video not ready.');
  const vw = videoElement.videoWidth;
  const vh = videoElement.videoHeight;
  if (!(vw > 2) || !(vh > 2)) throw new Error('Video has no valid frame size.');
  let tw = vw;
  let th = vh;
  if (vw > maxWidth) {
    tw = maxWidth;
    th = Math.max(1, Math.round((vh / vw) * maxWidth));
  }
  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not available.');
  ctx.drawImage(videoElement, 0, 0, tw, th);
  return canvas;
}

/**
 * Snapshot current frame to a temporary HTMLImageElement for face/CNIC detectors.
 * @returns {Promise<{ img: HTMLImageElement, revoke: () => void }>}
 */
export async function videoFrameToAnalysisImage(videoElement, maxWidth = 640) {
  const canvas = getVideoFrameCanvas(videoElement, maxWidth);
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not encode analysis frame.'))),
      'image/jpeg',
      0.88
    );
  });
  const objUrl = URL.createObjectURL(blob);
  const img = new Image();
  img.decoding = 'async';
  await new Promise((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Could not decode analysis frame.'));
    img.src = objUrl;
  });
  if (typeof img.decode === 'function') {
    try {
      await img.decode();
    } catch {
      /* ignore */
    }
  }
  return {
    img,
    revoke: () => URL.revokeObjectURL(objUrl),
  };
}
