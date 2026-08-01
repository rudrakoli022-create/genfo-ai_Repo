const xss = require("xss");

/**
 * Strips HTML/script tags from user-supplied text. Use on any free-text
 * field that gets stored (name) or forwarded to a model (chat messages),
 * so a malicious payload can't later render as live HTML/script when
 * displayed somewhere that doesn't escape output (or get echoed back
 * into another context).
 */
function sanitizeText(value) {
  if (typeof value !== "string") return value;
  return xss(value, {
    whiteList: {}, // no tags allowed at all — strip everything
    stripIgnoreTag: true,
    stripIgnoreTagBody: ["script", "style"],
  }).trim();
}

module.exports = { sanitizeText };