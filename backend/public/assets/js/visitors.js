import { apiGet, apiPatch } from './api.js';

function showMsg(text, kind) {
  const el = document.getElementById('msg');
  el.className = `msg ${kind || ''}`.trim();
  el.textContent = text || '';
}

function fmt(dt) {
  if (!dt) return '';
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return String(dt);
  return d.toLocaleString();
}

function buildQuery() {
  const p = new URLSearchParams();
  const date = document.getElementById('fDate').value;
  const cnic = document.getElementById('fCnic').value.trim();
  const name = document.getElementById('fName').value.trim();
  const meet = document.getElementById('fMeet').value.trim();
  if (date) p.set('date', date);
  if (cnic) p.set('cnic_no', cnic);
  if (name) p.set('visitor_name', name);
  if (meet) p.set('person_to_meet', meet);
  const qs = p.toString();
  return qs ? `?${qs}` : '';
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
        <td>${escapeHtml(r.pass_no)}</td>
        <td>${escapeHtml(r.visitor_name)}</td>
        <td>${escapeHtml(r.cnic_no)}</td>
        <td>${escapeHtml(r.company || '')}</td>
        <td>${escapeHtml(r.person_to_meet || '')}</td>
        <td>${escapeHtml(fmt(r.time_in))}</td>
        <td>${escapeHtml(fmt(r.time_out))}</td>
        <td class="no-wrap">
          <a class="btn small secondary" href="/pass.html?id=${encodeURIComponent(r.id)}">Pass</a>
          <button class="btn small" type="button" data-checkout="${r.id}">Checkout</button>
        </td>
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

    showMsg(rows.length ? `${rows.length} row(s).` : 'No rows.', rows.length ? 'success' : 'warn');
  } catch (e) {
    showMsg(e.message || 'Failed to load', 'error');
  }
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

document.getElementById('searchBtn').addEventListener('click', () => load());
document.getElementById('clearBtn').addEventListener('click', () => {
  document.getElementById('fDate').value = '';
  document.getElementById('fCnic').value = '';
  document.getElementById('fName').value = '';
  document.getElementById('fMeet').value = '';
  load();
});

load();
