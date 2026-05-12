/**
 * Central Express error handler — always JSON for the API.
 */
// eslint-disable-next-line no-unused-vars
function errorMiddleware(err, req, res, next) {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      success: false,
      message: 'File too large. Maximum upload size is 8MB.',
    });
  }

  const status = err.status || err.statusCode || 500;
  const message =
    err.message ||
    (status === 500 ? 'Something went wrong on the server.' : 'Request failed.');

  if (process.env.NODE_ENV !== 'test') {
    // eslint-disable-next-line no-console
    if (err.isAxiosError) {
      const st = err.response && err.response.status;
      console.error('[API]', err.message, err.code || '', st != null ? `HTTP ${st}` : '');
    } else {
      console.error('[API]', message, err.stack || '');
    }
  }

  const body = { success: false, message };
  if (err.hint) body.hint = err.hint;

  res.status(status).json(body);
}

module.exports = { errorMiddleware };
