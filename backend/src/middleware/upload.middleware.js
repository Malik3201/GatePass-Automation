const multer = require('multer');
const path = require('path');
const { getTodayFolder } = require('../utils/dateFolders');
const { ensureDir, getUploadsRoot } = require('../utils/fileHelpers');

const MAX_SIZE = 8 * 1024 * 1024; // ~8MB

const allowedMimes = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

function extFromOriginalname(originalname) {
  const ext = path.extname(originalname || '').toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return ext === '.jpeg' ? '.jpg' : ext;
  return '.jpg';
}

function fileFilter(req, file, cb) {
  const okMime = allowedMimes.has((file.mimetype || '').toLowerCase());
  const ext = path.extname(file.originalname || '').toLowerCase();
  const okExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);
  if (okMime || okExt) {
    cb(null, true);
  } else {
    cb(new Error('Only jpg, jpeg, png, and webp images are allowed.'));
  }
}

function makeStorage(subFolder) {
  return multer.diskStorage({
    destination(req, file, cb) {
      const folder = path.join(getUploadsRoot(), subFolder, getTodayFolder());
      ensureDir(folder);
      cb(null, folder);
    },
    filename(req, file, cb) {
      const safeExt = extFromOriginalname(file.originalname);
      const name = `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`;
      cb(null, name);
    },
  });
}

const visitorPhotoUpload = multer({
  storage: makeStorage('visitors'),
  limits: { fileSize: MAX_SIZE },
  fileFilter,
});

const cnicFrontUpload = multer({
  storage: makeStorage('cnic-front'),
  limits: { fileSize: MAX_SIZE },
  fileFilter,
});

const cnicBackUpload = multer({
  storage: makeStorage('cnic-back'),
  limits: { fileSize: MAX_SIZE },
  fileFilter,
});

/** For OCR direct file upload (saved under cnic-front date folder for consistency) */
const ocrCnicFileUpload = multer({
  storage: makeStorage('cnic-front'),
  limits: { fileSize: MAX_SIZE },
  fileFilter,
});

module.exports = {
  visitorPhotoUpload,
  cnicFrontUpload,
  cnicBackUpload,
  ocrCnicFileUpload,
  MAX_SIZE,
};
