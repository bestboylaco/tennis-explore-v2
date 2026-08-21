// T-04: matches connection-string-shaped credentials (mongodb://user:pass@...,
// postgres://user:pass@...) so a driver error that surfaces one in its own
// message never reaches a plaintext log un-redacted.
const CREDENTIAL_PATTERN = /(:\/\/)[^\s:@/]+:[^\s:@/]+@/g;

function redact(text) {
  return String(text).replace(CREDENTIAL_PATTERN, "$1[redacted]:[redacted]@");
}

export function errorHandler(error, req, res, next) {
  // Logs the message and stack only, redacted -- never the raw error object
  // (which may carry arbitrary extra fields on a custom Error subclass) and
  // never req.body (which may carry a chat question or evidence text). This
  // is the one place in the codebase T-04 flagged as still leaking whatever
  // an error happened to be holding.
  console.error(redact(error?.stack || error?.message || String(error)));

  const statusCode = error.statusCode || 500;

  res.status(statusCode).json({
    success: false,
    error: {
      code: error.code || "INTERNAL_SERVER_ERROR",
      message:
        statusCode === 500
          ? "An unexpected server error occurred."
          : error.message,
    },
  });
}