import { apiGet, apiPatch } from './api.js';

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

function dashCell(s) {
  const t = String(s ?? '').trim();
  return t.length ? t : '-';
}

function showMsg(text, kind) {
  const el = document.getElementById('msg');
  el.className = `msg ${kind || ''}`.trim();
  el.textContent = text || '';
}

/** DD/MM/YYYY HH:mm in local time, or "-" if missing */
function fmtDateTime(dt) {
  if (!dt) return '-';
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return dashCell(dt);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

function isCheckedIn(row) {
  const t = row.time_out;
  return t == null || String(t).trim() === '';
}

function buildQuery() {
  const p = new URLSearchParams();
  const date = document.getElementById('fDate').value;
  const cnic = document.getElementById('fCnic').value.trim();
  const name = document.getElementById('fName').value.trim();
  const company = document.getElementById('fCompany').value.trim();
  const status = document.getElementById('fStatus').value;
  if (date) p.set('date', date);
  if (cnic) p.set('cnic_no', cnic);
  if (name) p.set('visitor_name', name);
  if (company) p.set('company', company);
  if (status === 'in' || status === 'out') p.set('status', status);
  const qs = p.toString();
  return qs ? `?${qs}` : '';
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function photoCell(r) {
  const path = r.visitor_photo_path;
  if (path && String(path).trim()) {
    const src = escapeHtml(path);
    return `<img class="photo-id-thumb" src="${src}" alt="" width="48" height="48" loading="lazy" />`;
  }
  return '<span class="photo-id-placeholder" aria-hidden="true">👤</span>';
}

function statusCell(r) {
  if (isCheckedIn(r)) {
    return '<span class="status-badge status-in">Checked In</span>';
  }
  return '<span class="status-badge status-out">Checked Out</span>';
}

function actionsCell(r) {
  const id = encodeURIComponent(r.id);
  const checkedIn = isCheckedIn(r);
  const checkoutBtn = checkedIn
    ? `<button class="btn btn-sm btn-primary" type="button" data-checkout="${r.id}">Checkout</button>`
    : '';
  return `
    <div class="visitor-log-actions">
      <a class="btn btn-sm btn-outline" href="/pass.html?id=${id}">Open Pass</a>
      ${checkoutBtn}
      <button class="btn btn-sm btn-secondary" type="button" data-view="${r.id}">View</button>
    </div>
  `;
}

async function load() {
  showMsg('Loading…', '');
  try {
    const res = await apiGet(`/api/visitors${buildQuery()}`);
    const rows = res.data || [];
    const tb = document.getElementById('tbody');
    tb.innerHTML = '';

    for (const r of rows) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(fmtDateTime(r.time_in))}</td>
        <td>${escapeHtml(dashCell(r.visitor_name))}</td>
        <td>${escapeHtml(dashCell(r.cnic_no))}</td>
        <td>${escapeHtml(dashCell(r.company))}</td>
        <td class="photo-id-cell">${photoCell(r)}</td>
        <td>${statusCell(r)}</td>
        <td class="no-wrap">${actionsCell(r)}</td>
      `;
      tb.appendChild(tr);
    }

    tb.querySelectorAll('button[data-checkout]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-checkout');
        if (!confirm(`Checkout visitor #${id}?`)) return;
        try {
          await apiPatch(`/api/visitors/${id}/checkout`, {});
          showMsg(`Checked out #${id}`, 'success');
          await load();
        } catch (e) {
          showMsg(e.message || 'Checkout failed', 'error');
        }
      });
    });

    tb.querySelectorAll('button[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-view');
        openVisitorDetail(id);
      });
    });

    showMsg(rows.length ? `${rows.length} row(s).` : 'No rows.', rows.length ? 'success' : 'warn');
  } catch (e) {
    showMsg(e.message || 'Failed to load', 'error');
  }
}

const detailDialog = document.getElementById('visitorDetailDialog');
const detailBody = document.getElementById('visitorDetailBody');

async function openVisitorDetail(id) {
  if (!detailDialog || !detailBody) return;
  detailBody.innerHTML = '<p class="help">Loading…</p>';
  if (typeof detailDialog.showModal === 'function') {
    detailDialog.showModal();
  } else {
    detailDialog.setAttribute('open', '');
  }
  try {
    const res = await apiGet(`/api/visitors/${encodeURIComponent(id)}`);
    const v = res.data;
    const photo = v.visitor_photo_path
      ? `<p><img class="visitor-detail-photo" src="${escapeHtml(v.visitor_photo_path)}" alt="Visitor" /></p>`
      : '<p class="help">No visitor photo.</p>';
    const cnicFront = v.cnic_front_path
      ? `<p><strong>CNIC front</strong><br /><img class="visitor-detail-cnic" src="${escapeHtml(
          v.cnic_front_path
        )}" alt="CNIC front" /></p>`
      : '<p class="help">No CNIC front image path.</p>';
    detailBody.innerHTML = `
      <dl class="visitor-detail-dl">
        <dt>Pass no.</dt><dd>${escapeHtml(dashCell(v.pass_no))}</dd>
        <dt>Name</dt><dd>${escapeHtml(dashCell(v.visitor_name))}</dd>
        <dt>CNIC</dt><dd>${escapeHtml(dashCell(v.cnic_no))}</dd>
        <dt>Company</dt><dd>${escapeHtml(dashCell(v.company))}</dd>
        <dt>Time in</dt><dd>${escapeHtml(fmtDateTime(v.time_in))}</dd>
        <dt>Time out</dt><dd>${escapeHtml(fmtDateTime(v.time_out))}</dd>
      </dl>
      ${photo}
      ${cnicFront}
      <p class="help" style="margin-top:8px">Paths are as stored on the server.</p>
    `;
  } catch (e) {
    detailBody.innerHTML = `<p class="msg error">${escapeHtml(e.message || 'Failed to load')}</p>`;
  }
}

function closeVisitorDetail() {
  if (!detailDialog) return;
  if (typeof detailDialog.close === 'function') {
    detailDialog.close();
  } else {
    detailDialog.removeAttribute('open');
  }
}

document.getElementById('visitorDetailClose')?.addEventListener('click', closeVisitorDetail);
detailDialog?.addEventListener('click', (ev) => {
  if (ev.target === detailDialog) closeVisitorDetail();
});

document.getElementById('searchBtn').addEventListener('click', () => load());
document.getElementById('clearBtn').addEventListener('click', () => {
  document.getElementById('fDate').value = '';
  document.getElementById('fCnic').value = '';
  document.getElementById('fName').value = '';
  document.getElementById('fCompany').value = '';
  document.getElementById('fStatus').value = '';
  load();
});

load();
