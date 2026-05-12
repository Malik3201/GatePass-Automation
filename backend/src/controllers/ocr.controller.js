const ocrService = require('../services/ocr.service');
const { asyncHandler } = require('../utils/asyncHandler');

/**
 * OCR is a helper only — operators MUST verify CNIC and name before saving.
 */
exports.cnicFromPath = asyncHandler(async (req, res) => {
  const { imagePath } = req.body || {};
  if (!imagePath) {
    const err = new Error('imagePath is required');
    err.status = 400;
    throw err;
  }
  const result = await ocrService.ocrFromPublicPath(imagePath);
  res.json(result);
});

exports.cnicFromFile = asyncHandler(async (req, res) => {
  const result = await ocrService.ocrFromUploadedFile(req.file);
  res.json(result);
});
