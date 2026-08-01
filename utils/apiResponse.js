/**
 * Sends a consistently shaped JSON response across the entire API.
 * Shape: { success, message, data }
 */
function sendResponse(res, statusCode, success, message, data = null) {
  return res.status(statusCode).json({
    success,
    message,
    data,
  });
}

const sendSuccess = (res, message, data = null, statusCode = 200) =>
  sendResponse(res, statusCode, true, message, data);

const sendError = (res, message, statusCode = 400, data = null) =>
  sendResponse(res, statusCode, false, message, data);

module.exports = { sendResponse, sendSuccess, sendError };
