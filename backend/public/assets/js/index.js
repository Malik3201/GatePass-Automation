import { apiGet } from './api.js';

const DEFAULT_COMPANY = 'THE MAGNUM ICE CREAM COMPANY';

async function init() {
  const el = document.getElementById('companyLine');
  try {
    const res = await apiGet('/api/settings');
    const map = res.data || {};
    const name = map.COMPANY_NAME || DEFAULT_COMPANY;
    el.textContent = `Company: ${name}`;
  } catch {
    el.textContent = `Company: ${DEFAULT_COMPANY}`;
  }
}

init();
