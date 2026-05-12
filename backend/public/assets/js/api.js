/**
 * All requests use relative URLs so the same UI works on localhost or LAN IP.
 */
const API_BASE = '';

function getErrorMessage(data, res) {
  if (data && typeof data.message === 'string' && data.message) return data.message;
  return res.statusText || 'Request failed';
}

async function apiFetch(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.headers || {}),
    },
  });

  const ct = res.headers.get('content-type') || '';
  let data = null;
  if (ct.includes('application/json')) {
    data = await res.json();
  } else {
    const text = await res.text();
    data = { message: text || res.statusText };
  }

  if (!res.ok) {
    const err = new Error(getErrorMessage(data, res));
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

async function apiGet(path) {
  return apiFetch(path, { method: 'GET' });
}

async function apiPost(path, jsonBody) {
  return apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(jsonBody ?? {}),
  });
}

async function apiPut(path, jsonBody) {
  return apiFetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(jsonBody ?? {}),
  });
}

async function apiPatch(path, jsonBody) {
  return apiFetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(jsonBody ?? {}),
  });
}

/**
 * Multipart upload (field name must be "image" for visitor/CNIC routes).
 */
async function apiUpload(path, file) {
  if (!file) {
    throw new Error('Please choose a file first.');
  }
  const fd = new FormData();
  fd.append('image', file);

  const res = await fetch(API_BASE + path, {
    method: 'POST',
    body: fd,
  });

  const ct = res.headers.get('content-type') || '';
  let data = null;
  if (ct.includes('application/json')) {
    data = await res.json();
  } else {
    const text = await res.text();
    data = { message: text || res.statusText };
  }

  if (!res.ok) {
    throw new Error(getErrorMessage(data, res));
  }
  return data;
}

export { API_BASE, apiGet, apiPost, apiPut, apiPatch, apiUpload, apiFetch };