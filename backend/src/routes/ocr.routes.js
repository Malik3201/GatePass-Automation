const express = require('express');
const ocrController = require('../controllers/ocr.controller');
const { ocrCnicFileUpload } = require('../middleware/upload.middleware');

const router = express.Router();

router.post('/cnic', ocrController.cnicFromPath);

function handleUpload(mw) {
  return (req, res, next) => {
    mw.single('image')(req, res, (err) => {
      if (err) {
        err.status = 400;
        return next(err);
      }
      next();
    });
  };
}

router.post('/cnic-file', handleUpload(ocrCnicFileUpload), ocrController.cnicFromFile);

module.exports = router;
