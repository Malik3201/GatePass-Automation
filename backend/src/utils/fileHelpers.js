const fs = require('fs');
const path = require('path');

/**
 * Create a directory (and parents) if it does not exist.
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Backend root = folder that contains package.json (parent of src/).
 */
function getBackendRoot() {
  return path.join(__dirname, '..', '..');
}

function getUploadsRoot() {
  return path.join(getBackendRoot(), 'uploads');
}

function getExportsRoot() {
  return path.join(getBackendRoot(), 'exports');
}

function getBackupsRoot() {
  return path.join(getBackendRoot(), 'backups');
}

/**
 * Turn a public path like /uploads/cnic-front/2026-05-13/x.jpg into absolute path.
 * Returns null if path is outside uploads (path traversal safe).
 */
function resolvePublicUploadPath(publicPath) {
  if (!publicPath || typeof publicPath !== 'string') return null;
  const normalized = publicPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized.startsWith('uploads/')) return null;

  const uploadsRoot = getUploadsRoot();
  const abs = path.normalize(path.join(getBackendRoot(), normalized));

  const uploadsRootNorm = path.normalize(uploadsRoot);
  if (!abs.startsWith(uploadsRootNorm)) return null;
  return abs;
}

module.exports = {
  ensureDir,
  getBackendRoot,
  getUploadsRoot,
  getExportsRoot,
  getBackupsRoot,
  resolvePublicUploadPath,
};
