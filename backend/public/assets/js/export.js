import { apiGet } from './api.js';

function tickClock() {
  const el = document.getElementById('topbarClock');
  if (!el) return;
  const d = new Date();
  el.textContent = d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

tickClock();
setInterval(tickClock, 30000);

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
  const countEl = document.getElementById('exportCount');

  csv.href = result.csvPath;
  csv.textContent = 'Download CSV';
  csv.title = result.csvPath || '';
  xlsx.href = result.xlsxPath;
  xlsx.textContent = 'Download Excel';
  xlsx.title = result.xlsxPath || '';

  if (countEl) {
    countEl.textContent = result.count != null ? String(result.count) : '—';
  }

  const bf = result.backupFolder || '';
  if (bf) {
    backup.href = `${bf}/images/visitors/`;
    backup.textContent = bf;
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
    const countEl = document.getElementById('exportCount');
    if (countEl) countEl.textContent = '—';
  }
}

document.getElementById('exportDate').value = todayISO();
document.getElementById('exportBtn').addEventListener('click', () => runExport());
