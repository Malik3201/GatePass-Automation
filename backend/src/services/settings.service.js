const { query } = require('../config/db');

async function getAllSettingsMap() {
  const rows = await query('SELECT setting_key, setting_value FROM settings ORDER BY setting_key ASC');
  const map = {};
  for (const r of rows) {
    map[r.setting_key] = r.setting_value;
  }
  return map;
}

async function getSetting(key) {
  const rows = await query('SELECT setting_value FROM settings WHERE setting_key = ? LIMIT 1', [key]);
  if (!rows.length) return '';
  return rows[0].setting_value ?? '';
}

async function upsertSetting(key, value) {
  const sql = `
    INSERT INTO settings (setting_key, setting_value)
    VALUES (?, ?)
    ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = CURRENT_TIMESTAMP
  `;
  await query(sql, [key, value]);
  return getAllSettingsMap();
}

module.exports = {
  getAllSettingsMap,
  getSetting,
  upsertSetting,
};
