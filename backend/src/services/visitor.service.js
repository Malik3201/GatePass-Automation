const { query } = require('../config/db');
const { generateNextPassNo } = require('../utils/passNumber');

const VISITOR_COLUMNS = [
  'pass_no',
  'visitor_name',
  'cnic_no',
  'father_name',
  'mobile_no',
  'company',
  'person_to_meet',
  'department',
  'purpose',
  'vehicle_no',
  'gate_no',
  'time_in',
  'time_out',
  'remarks',
  'visitor_photo_path',
  'cnic_front_path',
  'cnic_back_path',
  'ocr_raw_text',
  'created_by',
];

function buildListFilters(q) {
  const conditions = [];
  const params = [];

  if (q.date) {
    conditions.push('DATE(COALESCE(time_in, created_at)) = ?');
    params.push(q.date);
  }
  if (q.cnic_no) {
    conditions.push('cnic_no LIKE ?');
    params.push(`%${q.cnic_no}%`);
  }
  if (q.visitor_name) {
    conditions.push('visitor_name LIKE ?');
    params.push(`%${q.visitor_name}%`);
  }
  if (q.person_to_meet) {
    conditions.push('person_to_meet LIKE ?');
    params.push(`%${q.person_to_meet}%`);
  }
  if (q.pass_no) {
    conditions.push('pass_no = ?');
    params.push(q.pass_no);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return { where, params };
}

async function listVisitors(queryParams) {
  const { where, params } = buildListFilters(queryParams);
  const sql = `SELECT * FROM visitors ${where} ORDER BY id DESC LIMIT 500`;
  return query(sql, params);
}

async function getVisitorById(id) {
  const rows = await query('SELECT * FROM visitors WHERE id = ? LIMIT 1', [id]);
  return rows[0] || null;
}

async function createVisitor(body) {
  const pass_no = await generateNextPassNo();
  const time_in = body.time_in || new Date();

  const values = {
    pass_no,
    visitor_name: body.visitor_name,
    cnic_no: body.cnic_no,
    father_name: body.father_name || null,
    mobile_no: body.mobile_no || null,
    company: body.company || null,
    person_to_meet: body.person_to_meet || null,
    department: body.department || null,
    purpose: body.purpose || null,
    vehicle_no: body.vehicle_no || null,
    gate_no: body.gate_no || null,
    time_in,
    time_out: body.time_out || null,
    remarks: body.remarks || null,
    visitor_photo_path: body.visitor_photo_path || null,
    cnic_front_path: body.cnic_front_path || null,
    cnic_back_path: body.cnic_back_path || null,
    ocr_raw_text: body.ocr_raw_text || null,
    created_by: body.created_by || null,
  };

  const cols = Object.keys(values);
  const placeholders = cols.map(() => '?').join(', ');
  const sql = `INSERT INTO visitors (${cols.join(', ')}) VALUES (${placeholders})`;
  const params = cols.map((c) => values[c]);

  await query(sql, params);
  const inserted = await query('SELECT * FROM visitors WHERE pass_no = ? LIMIT 1', [pass_no]);
  return inserted[0];
}

async function updateVisitor(id, body) {
  const allowed = VISITOR_COLUMNS.filter((c) => c !== 'pass_no');
  const sets = [];
  const params = [];

  for (const col of allowed) {
    if (Object.prototype.hasOwnProperty.call(body, col)) {
      sets.push(`${col} = ?`);
      params.push(body[col]);
    }
  }

  if (!sets.length) {
    return getVisitorById(id);
  }

  params.push(id);
  await query(`UPDATE visitors SET ${sets.join(', ')} WHERE id = ?`, params);
  return getVisitorById(id);
}

async function checkoutVisitor(id) {
  await query('UPDATE visitors SET time_out = NOW() WHERE id = ?', [id]);
  return getVisitorById(id);
}

/**
 * WARNING: Hard delete — row and DB references to files are removed.
 * Files on disk are NOT auto-deleted (you may add cleanup later).
 */
async function deleteVisitor(id) {
  await query('DELETE FROM visitors WHERE id = ?', [id]);
}

async function listVisitorsForExportDate(dateStr) {
  return query(
    `SELECT * FROM visitors WHERE DATE(COALESCE(time_in, created_at)) = ? ORDER BY id ASC`,
    [dateStr]
  );
}

module.exports = {
  listVisitors,
  getVisitorById,
  createVisitor,
  updateVisitor,
  checkoutVisitor,
  deleteVisitor,
  listVisitorsForExportDate,
};
