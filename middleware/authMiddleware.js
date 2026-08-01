const { verifyToken } = require("../services/tokenService");
const User = require("../models/User");
const RevokedToken = require("../models/RevokedToken");
const { sendError } = require("../utils/apiResponse");

/**
 * Protects routes by requiring a valid JWT in the Authorization header.
 * Expected header format: "Authorization: Bearer <token>"
 *
 * On success, attaches the authenticated user document to req.user
 * (password field excluded) and calls next().
 */
async function protect(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return sendError(res, "Not authorized. No token provided.", 401);
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
      return sendError(res, "Not authorized. Token missing.", 401);
    }

    let decoded;
    try {
      decoded = verifyToken(token);
    } catch (err) {
      if (err.name === "TokenExpiredError") {
        return sendError(res, "Session expired. Please log in again.", 401);
      }
      return sendError(res, "Invalid token.", 401);
    }

    // Reject tokens that were explicitly revoked via logout, even if they
    // haven't naturally expired yet.
    const isRevoked = await RevokedToken.findOne({ token });
    if (isRevoked) {
      return sendError(res, "This session has been logged out. Please log in again.", 401);
    }

    const user = await User.findById(decoded.id).select(
      "+chatUsage.count +chatUsage.windowStart +imageUsage.count +imageUsage.windowStart"
    );

    if (!user) {
      return sendError(res, "User belonging to this token no longer exists.", 401);
    }

    req.user = user;
    req.rawToken = token;
    req.tokenExp = decoded.exp;
    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    return sendError(res, "Authentication failed.", 500);
  }
}

module.exports = { protect };

