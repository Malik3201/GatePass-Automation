const settingsService = require('../services/settings.service');
const { asyncHandler } = require('../utils/asyncHandler');

exports.getAll = asyncHandler(async (req, res) => {
  const settings = await settingsService.getAllSettingsMap();
  res.json({ success: true, data: settings });
});

exports.createOrUpdate = asyncHandler(async (req, res) => {
  const { setting_key, setting_value } = req.body || {};
  if (!setting_key || typeof setting_key !== 'string') {
    const err = new Error('setting_key is required');
    err.status = 400;
    throw err;
  }
  const map = await settingsService.upsertSetting(setting_key.trim(), setting_value ?? '');
  res.json({ success: true, data: map });
});

exports.updateByKey = asyncHandler(async (req, res) => {
  const key = req.params.key;
  if (!key) {
    const err = new Error('key is required');
    err.status = 400;
    throw err;
  }
  const body = req.body || {};
  const value =
    Object.prototype.hasOwnProperty.call(body, 'setting_value') ? body.setting_value : body.value;
  const map = await settingsService.upsertSetting(key, value ?? '');
  res.json({ success: true, data: map });
});
