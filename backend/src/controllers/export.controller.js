const exportService = require('../services/export.service');
const { asyncHandler } = require('../utils/asyncHandler');

exports.daily = asyncHandler(async (req, res) => {
  if (!req.query.date) {
    const err = new Error('date query parameter is required (YYYY-MM-DD)');
    err.status = 400;
    throw err;
  }
  const result = await exportService.exportDaily(req.query.date);
  res.json(result);
});
