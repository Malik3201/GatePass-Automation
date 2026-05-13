import { apiGet } from './api.js';

const DEFAULT_COMPANY = 'THE MAGNUM ICE CREAM COMPANY';

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function tickClock() {
  const el = document.getElementById('topbarClock');
  if (!el) return;
  const d = new Date();
  el.textContent = d.toLocaleString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function init() {
  const companyEl = document.getElementById('companyLine');
  tickClock();
  setInterval(tickClock, 30000);

  try {
    const res = await apiGet('/api/settings');
    const map = res.data || {};
    const name = map.COMPANY_NAME || DEFAULT_COMPANY;
    if (companyEl) companyEl.textContent = `Company: ${name}`;
  } catch {
    if (companyEl) companyEl.textContent = `Company: ${DEFAULT_COMPANY}`;
  }

  const today = todayISO();
  const elToday = document.getElementById('metricToday');
  const elInside = document.getElementById('metricInside');
  const elCheckedOut = document.getElementById('metricCheckedOut');
  const elTotal = document.getElementById('metricTotal');

  try {
    const resToday = await apiGet(`/api/visitors?date=${encodeURIComponent(today)}`);
    const rowsToday = resToday.data || [];
    if (elToday) elToday.textContent = String(rowsToday.length);
    const inside = rowsToday.filter((r) => !r.time_out).length;
    if (elInside) elInside.textContent = String(inside);
    const checkedOutToday = rowsToday.filter((r) => r.time_out).length;
    if (elCheckedOut) elCheckedOut.textContent = String(checkedOutToday);
  } catch {
    if (elToday) elToday.textContent = '—';
    if (elInside) elInside.textContent = '—';
    if (elCheckedOut) elCheckedOut.textContent = '—';
  }

  try {
    const resAll = await apiGet('/api/visitors');
    const rows = resAll.data || [];
    if (elTotal) elTotal.textContent = String(rows.length);
  } catch {
    if (elTotal) elTotal.textContent = '—';
  }
}

init();
