const { sendError } = require("../utils/apiResponse");

/**
 * Catches errors thrown/passed via next(err) anywhere in the app
 * and returns a consistently shaped error response.
 */
function errorHandler(err, req, res, next) {
  console.error("🔥 Error:", err.message);
  if (process.env.NODE_ENV !== "production") {
    console.error(err.stack);
  }

  // Multer upload errors (file too large, too many files, fileFilter rejection)
  if (err.name === "MulterError" || /^Unsupported file type|^Executable files/.test(err.message || "")) {
    const statusCode = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return sendError(res, err.message || "File upload failed.", statusCode);
  }

  // Mongoose duplicate key error (e.g. duplicate email)
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || "field";
    return sendError(res, `${field} already in use.`, 409);
  }

  // Mongoose validation error
  if (err.name === "ValidationError") {
    const messages = Object.values(err.errors).map((e) => e.message);
    return sendError(res, messages.join(", "), 400);
  }

  const statusCode = err.statusCode || 500;
  return sendError(res, err.message || "Internal server error.", statusCode);
}

/**
 * Catches requests to undefined routes.
 */
function notFound(req, res) {
  return sendError(res, `Route not found: ${req.method} ${req.originalUrl}`, 404);
}

module.exports = { errorHandler, notFound };
