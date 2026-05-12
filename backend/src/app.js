const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const { errorMiddleware } = require('./middleware/error.middleware');
const { ensureDir, getUploadsRoot, getExportsRoot, getBackupsRoot } = require('./utils/fileHelpers');

/**
 * Make sure upload/export folders exist so multer and exports never crash on missing dirs.
 */
function ensureProjectDirs() {
  const uploadsRoot = getUploadsRoot();
  ensureDir(uploadsRoot);
  ensureDir(path.join(uploadsRoot, 'visitors'));
  ensureDir(path.join(uploadsRoot, 'cnic-front'));
  ensureDir(path.join(uploadsRoot, 'cnic-back'));
  ensureDir(getExportsRoot());
  ensureDir(getBackupsRoot());
}

ensureProjectDirs();

const app = express();

app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

const publicDir = path.join(__dirname, '..', 'public');

// API first so paths like /api/* are never shadowed by static files
app.use('/api/visitors', require('./routes/visitor.routes'));
app.use('/api/camera', require('./routes/camera.routes'));
app.use('/api/ocr', require('./routes/ocr.routes'));
app.use('/api/export', require('./routes/export.routes'));
app.use('/api/settings', require('./routes/settings.routes'));

// Public URLs: /uploads, /exports, /backups, and plain HTML/CSS/JS under /
app.use('/uploads', express.static(getUploadsRoot()));
app.use('/exports', express.static(getExportsRoot()));
app.use('/backups', express.static(getBackupsRoot()));

app.use(
  express.static(publicDir, {
    index: 'index.html',
    extensions: ['html'],
  })
);

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Not found' });
});

app.use(errorMiddleware);

module.exports = app;
