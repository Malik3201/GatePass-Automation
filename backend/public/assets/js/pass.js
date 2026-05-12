import { apiGet } from './api.js';

function qs(name) {
  const u = new URL(window.location.href);
  return u.searchParams.get(name);
}

function showMsg(text, kind) {
  const el = document.getElementById('msg');
  el.style.display = text ? 'block' : 'none';
  el.className = `msg ${kind || ''}`.trim();
  el.textContent = text || '';
}

function setText(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v ?? '';
}

async function init() {
  const id = qs('id');
  if (!id) {
    showMsg('Missing visitor id in URL. Open this page from “Save visitor”.', 'error');
    return;
  }

  try {
    const vRes = await apiGet(`/api/visitors/${encodeURIComponent(id)}`);
    const v = vRes.data;

    const rawVisitorCompany = v.company != null ? String(v.company).trim() : '';
    const visitorCompany = rawVisitorCompany || '-';

    setText('v_name', v.visitor_name);
    setText('v_cnic', v.cnic_no);
    setText('v_company', visitorCompany);

    const ph = v.visitor_photo_path;
    const img = document.getElementById('photoImg');
    const placeholder = document.getElementById('photoPlaceholder');
    if (ph) {
      img.src = ph;
      img.style.display = 'block';
      placeholder.style.display = 'none';
    } else {
      img.style.display = 'none';
      placeholder.style.display = 'block';
    }
  } catch (e) {
    showMsg(e.message || 'Failed to load visitor', 'error');
  }
}

document.getElementById('printBtn').addEventListener('click', () => window.print());

init();
