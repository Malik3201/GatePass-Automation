const { getTodayFolder } = require('./dateFolders');
const { pool } = require('../config/db');

/**
 * Pass number format: GP-YYYYMMDD-0001
 * Finds the latest pass for "today" and increments the sequence.
 * Good enough for single reception / LAN; not distributed-safe.
 */
function todayPrefix() {
  const [y, m, d] = getTodayFolder().split('-');
  return `GP-${y}${m}${d}`;
}

async function generateNextPassNo() {
  const prefix = todayPrefix();
  const likePattern = `${prefix}-%`;

  const [rows] = await pool.execute(
    `SELECT pass_no FROM visitors WHERE pass_no LIKE ? ORDER BY CAST(SUBSTRING_INDEX(pass_no, '-', -1) AS UNSIGNED) DESC, pass_no DESC LIMIT 1`,
    [likePattern]
  );

  let nextSeq = 1;
  if (rows.length > 0) {
    const last = rows[0].pass_no;
    const parts = last.split('-');
    const seqPart = parts[parts.length - 1];
    const lastNum = parseInt(seqPart, 10);
    if (!Number.isNaN(lastNum)) {
      nextSeq = lastNum + 1;
    }
  }

  const seqStr = String(nextSeq).padStart(4, '0');
  return `${prefix}-${seqStr}`;
}

module.exports = { generateNextPassNo, todayPrefix };
