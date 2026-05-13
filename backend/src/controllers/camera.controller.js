const cameraService = require('../services/camera.service');
const { asyncHandler } = require('../utils/asyncHandler');

exports.capture = asyncHandler(async (req, res) => {
  const { snapshotUrl, type } = req.body || {};
  const result = await cameraService.captureAndSave({ snapshotUrl, type });
  res.status(201).json(result);
});

exports.test = asyncHandler(async (req, res) => {
  const snapshotUrl = req.query.snapshotUrl;
  const info = await cameraService.testSnapshot(snapshotUrl);
  res.json(info);
});

/**
 * Proxy snapshot through backend so the browser can read pixels without CORS issues.
 * Returns raw image/jpeg (not JSON).
 */
exports.snapshotProxy = async (req, res) => {
  try {
    const raw = req.query.url;
    if (!raw) {
      return res.status(400).json({
        success: false,
        message: 'Missing url query parameter',
        hint: 'Use /api/camera/snapshot-proxy?url=' + encodeURIComponent('http://.../shot.jpg'),
      });
    }
    const decoded = decodeURIComponent(String(raw));
    const buffer = await cameraService.fetchSnapshotProxyBuffer(decoded);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(buffer);
  } catch (e) {
    if (res.headersSent) return;
    const status = e.status || 500;
    const snapshotUrl = req.query && req.query.url ? decodeURIComponent(String(req.query.url)) : null;
    return res.status(status).json({
      success: false,
      message: 'Unable to fetch camera snapshot',
      hint: 'Open the snapshot URL directly in browser and confirm it shows an image.',
      url: e.url || snapshotUrl,
      code: e.code || null,
      detail: e.message || 'Proxy failed',
    });
  }
};

