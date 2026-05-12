const visitorService = require('../services/visitor.service');
const { missingVisitorCreate } = require('../utils/validators');
const { getTodayFolder } = require('../utils/dateFolders');
const { asyncHandler } = require('../utils/asyncHandler');

exports.list = asyncHandler(async (req, res) => {
  const rows = await visitorService.listVisitors(req.query);
  res.json({ success: true, data: rows });
});

exports.getById = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    const err = new Error('Invalid id');
    err.status = 400;
    throw err;
  }
  const row = await visitorService.getVisitorById(id);
  if (!row) {
    const err = new Error('Visitor not found');
    err.status = 404;
    throw err;
  }
  res.json({ success: true, data: row });
});

exports.create = asyncHandler(async (req, res) => {
  const errors = missingVisitorCreate(req.body || {});
  if (errors.length) {
    const err = new Error(errors.join('; '));
    err.status = 400;
    throw err;
  }
  const created = await visitorService.createVisitor(req.body || {});
  res.status(201).json({ success: true, data: created });
});

exports.update = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    const err = new Error('Invalid id');
    err.status = 400;
    throw err;
  }
  const existing = await visitorService.getVisitorById(id);
  if (!existing) {
    const err = new Error('Visitor not found');
    err.status = 404;
    throw err;
  }
  const updated = await visitorService.updateVisitor(id, req.body || {});
  res.json({ success: true, data: updated });
});

exports.checkout = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    const err = new Error('Invalid id');
    err.status = 400;
    throw err;
  }
  const existing = await visitorService.getVisitorById(id);
  if (!existing) {
    const err = new Error('Visitor not found');
    err.status = 404;
    throw err;
  }
  const updated = await visitorService.checkoutVisitor(id);
  res.json({ success: true, data: updated });
});

/**
 * WARNING: Permanent delete — see visitor.service.deleteVisitor comment.
 */
exports.remove = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    const err = new Error('Invalid id');
    err.status = 400;
    throw err;
  }
  const existing = await visitorService.getVisitorById(id);
  if (!existing) {
    const err = new Error('Visitor not found');
    err.status = 404;
    throw err;
  }
  await visitorService.deleteVisitor(id);
  res.json({ success: true, message: 'Visitor deleted' });
});

function uploadResponse(req, res, subFolder) {
  if (!req.file) {
    const err = new Error('No file uploaded (field name: image)');
    err.status = 400;
    throw err;
  }
  const dateFolder = getTodayFolder();
  const filename = req.file.filename;
  const publicPath = `/uploads/${subFolder}/${dateFolder}/${filename}`.replace(/\\/g, '/');
  res.status(201).json({
    success: true,
    path: publicPath,
    filename,
  });
}

exports.uploadPhoto = asyncHandler(async (req, res) => {
  uploadResponse(req, res, 'visitors');
});

exports.uploadCnicFront = asyncHandler(async (req, res) => {
  uploadResponse(req, res, 'cnic-front');
});

exports.uploadCnicBack = asyncHandler(async (req, res) => {
  uploadResponse(req, res, 'cnic-back');
});
