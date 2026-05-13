const axios = require('axios');
const { getSetting } = require('./settings.service');

let pythonClientCache = null;

async function getPythonClientConfig() {
  if (pythonClientCache) return pythonClientCache;
  const enabledRaw = await getSetting('OCR_PYTHON_ENABLED');
  const baseUrlRaw = await getSetting('OCR_PYTHON_BASE_URL');
  const timeoutRaw = await getSetting('OCR_PYTHON_TIMEOUT_MS');

  const enabled = String(enabledRaw || 'false').toLowerCase() === 'true';
  const baseUrl = String(baseUrlRaw || 'http://localhost:8001').trim().replace(/\/+$/, '');
  const timeoutMs = parseInt(String(timeoutRaw || '10000'), 10) || 10000;

  pythonClientCache = { enabled, baseUrl, timeoutMs };
  return pythonClientCache;
}

function logPythonOcrFailure(context) {
  const { status, message, error, imagePath } = context;
  console.warn('[python-ocr]', {
    status: status ?? null,
    message: message ?? null,
    error: error ?? null,
    imagePath: imagePath ?? null,
  });
}

/**
 * Try OCR via Python microservice.
 * Returns raw OCR text (string) or '' on failure.
 */
async function tryOcrWithPython(imageAbsPath, cfg = {}) {
  const { enabled, baseUrl, timeoutMs } = await getPythonClientConfig();
  if (!enabled || !baseUrl) return '';

  const payload = {
    imageAbsPath,
    imagePath: imageAbsPath,
    fastMode: !!cfg.fastMode,
    secondPassEnabled: !!cfg.secondPassEnabled,
  };

  try {
    const res = await axios.post(`${baseUrl}/ocr/cnic`, payload, {
      timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json' },
      validateStatus: () => true,
    });

    if (!res || res.data == null) {
      logPythonOcrFailure({
        status: res && res.status,
        message: 'Empty response body',
        error: null,
        imagePath: imageAbsPath,
      });
      return '';
    }

    const data = res.data;
    if (res.status !== 200 || !data.success) {
      logPythonOcrFailure({
        status: res.status,
        message: typeof data.message === 'string' ? data.message : null,
        error: typeof data.error === 'string' ? data.error : null,
        imagePath: imageAbsPath,
      });
      return '';
    }

    if (typeof data.rawText === 'string') return data.rawText;
    return '';
  } catch (err) {
    const msg = err && err.message ? String(err.message) : 'request failed';
    logPythonOcrFailure({
      status: err && err.response && err.response.status,
      message: msg,
      error: null,
      imagePath: imageAbsPath,
    });
    // Python is optional; never break the system.
    return '';
  }
}

module.exports = {
  tryOcrWithPython,
};
