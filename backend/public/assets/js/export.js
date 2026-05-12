import { apiGet } from './api.js';

function showMsg(text, kind) {
  const el = document.getElementById('msg');
  el.className = `msg ${kind || ''}`.trim();
  el.textContent = text || '';
}

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function setLinks(result) {
  const wrap = document.getElementById('links');
  const csv = document.getElementById('csvLink');
  const xlsx = document.getElementById('xlsxLink');
  const backup = document.getElementById('backupLink');

  csv.href = result.csvPath;
  csv.textContent = result.csvPath;
  xlsx.href = result.xlsxPath;
  xlsx.textContent = result.xlsxPath;

  const bf = result.backupFolder || '';
  if (bf) {
    backup.href = `${bf}/images/visitors/`;
    backup.textContent = `${bf} (try visitors subfolder)`;
  } else {
    backup.href = '#';
    backup.textContent = '(none)';
  }

  wrap.style.display = 'block';
}

async function runExport() {
  const date = document.getElementById('exportDate').value;
  if (!date) {
    showMsg('Pick a date first.', 'warn');
    return;
  }
  showMsg('Exporting… (may take a moment if many images)', '');
  try {
    const res = await apiGet(`/api/export/daily?date=${encodeURIComponent(date)}`);
    showMsg(`Done. Rows: ${res.count ?? 0}`, 'success');
    setLinks(res);
  } catch (e) {
    showMsg(e.message || 'Export failed', 'error');
    document.getElementById('links').style.display = 'none';
  }
}

document.getElementById('exportDate').value = todayISO();
document.getElementById('exportBtn').addEventListener('click', () => runExport());
