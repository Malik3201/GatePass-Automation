const fs = require('fs');
const path = require('path');
const fastcsv = require('fast-csv');
const ExcelJS = require('exceljs');
const { ensureDir, getExportsRoot, getBackupsRoot, resolvePublicUploadPath } = require('../utils/fileHelpers');
const { listVisitorsForExportDate } = require('./visitor.service');

const EXPORT_COLUMNS = [
  { header: 'id', key: 'id' },
  { header: 'pass_no', key: 'pass_no' },
  { header: 'visitor_name', key: 'visitor_name' },
  { header: 'cnic_no', key: 'cnic_no' },
  { header: 'father_name', key: 'father_name' },
  { header: 'mobile_no', key: 'mobile_no' },
  { header: 'company', key: 'company' },
  { header: 'person_to_meet', key: 'person_to_meet' },
  { header: 'department', key: 'department' },
  { header: 'purpose', key: 'purpose' },
  { header: 'vehicle_no', key: 'vehicle_no' },
  { header: 'gate_no', key: 'gate_no' },
  { header: 'time_in', key: 'time_in' },
  { header: 'time_out', key: 'time_out' },
  { header: 'remarks', key: 'remarks' },
  { header: 'visitor_photo_path', key: 'visitor_photo_path' },
  { header: 'cnic_front_path', key: 'cnic_front_path' },
  { header: 'cnic_back_path', key: 'cnic_back_path' },
  { header: 'created_by', key: 'created_by' },
  { header: 'created_at', key: 'created_at' },
  { header: 'updated_at', key: 'updated_at' },
];

function isValidDateParam(d) {
  return /^\d{4}-\d{2}-\d{2}$/.test(d);
}

function rowToObject(row) {
  const o = {};
  for (const { key } of EXPORT_COLUMNS) {
    const v = row[key];
    if (v instanceof Date) {
      o[key] = v.toISOString();
    } else if (v === null || v === undefined) {
      o[key] = '';
    } else {
      o[key] = v;
    }
  }
  return o;
}

/**
 * Copy one public /uploads/... file into a backup subfolder with a stable name.
 * Skips missing files silently (LAN export should still complete).
 */
function copyUploadIntoBackup(publicPath, destDir, destBaseName) {
  if (!publicPath || typeof publicPath !== 'string') return false;
  const abs = resolvePublicUploadPath(publicPath);
  if (!abs || !fs.existsSync(abs)) return false;

  ensureDir(destDir);
  const ext = path.extname(abs) || '.jpg';
  const safeBase = String(destBaseName).replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 120);
  let dest = path.join(destDir, `${safeBase}${ext}`);
  let i = 1;
  while (fs.existsSync(dest)) {
    dest = path.join(destDir, `${safeBase}-${i}${ext}`);
    i += 1;
  }
  fs.copyFileSync(abs, dest);
  return true;
}

/**
 * Copy visitor / CNIC images for that day into backups/YYYY-MM-DD/images/...
 */
function backupVisitorImagesForDate(dateStr, rows) {
  const root = path.join(getBackupsRoot(), dateStr, 'images');
  const dirVisitors = path.join(root, 'visitors');
  const dirFront = path.join(root, 'cnic-front');
  const dirBack = path.join(root, 'cnic-back');

  ensureDir(dirVisitors);
  ensureDir(dirFront);
  ensureDir(dirBack);

  for (const row of rows) {
    const passPart = (row.pass_no || `id${row.id}`).replace(/[^a-zA-Z0-9-_]/g, '_');
    const base = `id${row.id}_${passPart}`;

    if (row.visitor_photo_path) {
      copyUploadIntoBackup(row.visitor_photo_path, dirVisitors, `${base}_visitor`);
    }
    if (row.cnic_front_path) {
      copyUploadIntoBackup(row.cnic_front_path, dirFront, `${base}_cnic_front`);
    }
    if (row.cnic_back_path) {
      copyUploadIntoBackup(row.cnic_back_path, dirBack, `${base}_cnic_back`);
    }
  }

  return `/backups/${dateStr}`.replace(/\\/g, '/');
}

/**
 * Write visitors.csv and visitors.xlsx for the given calendar day under exports/YYYY-MM-DD/
 * and copy related images into backups/YYYY-MM-DD/images/...
 */
async function exportDaily(dateStr) {
  if (!isValidDateParam(dateStr)) {
    const err = new Error('Invalid date. Use YYYY-MM-DD');
    err.status = 400;
    throw err;
  }

  const rows = await listVisitorsForExportDate(dateStr);
  const outDir = path.join(getExportsRoot(), dateStr);
  ensureDir(outDir);

  const csvPath = path.join(outDir, 'visitors.csv');
  const xlsxPath = path.join(outDir, 'visitors.xlsx');

  const dataObjects = rows.map(rowToObject);

  await new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(csvPath);
    fastcsv
      .write(dataObjects, { headers: true })
      .on('error', reject)
      .pipe(ws)
      .on('error', reject)
      .on('finish', resolve);
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Visitors');
  sheet.columns = EXPORT_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: 18 }));
  dataObjects.forEach((r) => sheet.addRow(r));
  await workbook.xlsx.writeFile(xlsxPath);

  const csvPublic = `/exports/${dateStr}/visitors.csv`.replace(/\\/g, '/');
  const xlsxPublic = `/exports/${dateStr}/visitors.xlsx`.replace(/\\/g, '/');

  const backupFolder = backupVisitorImagesForDate(dateStr, rows);

  return {
    success: true,
    date: dateStr,
    count: rows.length,
    csvPath: csvPublic,
    xlsxPath: xlsxPublic,
    backupFolder,
  };
}

module.exports = { exportDaily, isValidDateParam };
