const mongoose = require("mongoose");

/**
 * Stores revoked JWTs (e.g. from explicit logout) so they can be rejected
 * even though the token itself hasn't naturally expired yet.
 *
 * Without this, "logout" only clears the browser's copy of the token —
 * the token itself stays valid server-side until JWT_EXPIRES_IN runs out
 * (currently up to 10 days), so a token copied out of browser storage/cache
 * before logout would keep working. This collection closes that gap.
 *
 * TTL index automatically deletes entries once the token would have expired
 * anyway, so this collection never grows unbounded.
 */
const revokedTokenSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  expiresAt: {
    type: Date,
    required: true,
  },
});

// MongoDB TTL index: documents are auto-deleted once `expiresAt` is in the past.
revokedTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("RevokedToken", revokedTokenSchema);