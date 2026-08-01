const User = require("../models/User");
const RevokedToken = require("../models/RevokedToken");
const { generateToken } = require("../services/tokenService");
const { verifyGoogleToken } = require("../services/googleAuthService");
const { sendSuccess, sendError } = require("../utils/apiResponse");
const { sanitizeText } = require("../utils/sanitize");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254; // RFC 5321 max
const MAX_PASSWORD_LENGTH = 128;

/**
 * POST /api/auth/signup
 * Creates a new user with email + password.
 */
async function signup(req, res, next) {
  try {
    const { name, email, password } = req.body;

    if (typeof name !== "string" || typeof email !== "string" || typeof password !== "string") {
      return sendError(res, "Name, email, and password must all be text values.", 400);
    }

    if (!name.trim() || !email.trim() || !password) {
      return sendError(res, "Name, email, and password are all required.", 400);
    }

    if (name.length > MAX_NAME_LENGTH) {
      return sendError(res, `Name must be under ${MAX_NAME_LENGTH} characters.`, 400);
    }

    if (email.length > MAX_EMAIL_LENGTH || !EMAIL_REGEX.test(email.trim())) {
      return sendError(res, "Please provide a valid email address.", 400);
    }

    if (password.length < 6) {
      return sendError(res, "Password must be at least 6 characters long.", 400);
    }

    if (password.length > MAX_PASSWORD_LENGTH) {
      return sendError(res, `Password must be under ${MAX_PASSWORD_LENGTH} characters.`, 400);
    }

    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return sendError(res, "An account with this email already exists.", 409);
    }

    const user = await User.create({
      name: sanitizeText(name),
      email: email.toLowerCase().trim(),
      password,
    });

    const token = generateToken(user._id);

    return sendSuccess(
      res,
      "Account created successfully.",
      {
        token,
        user: user.toSafeObject(),
      },
      201
    );
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/auth/login
 * Logs in a user with email + password and returns a JWT.
 */
async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    if (typeof email !== "string" || typeof password !== "string") {
      return sendError(res, "Email and password must be text values.", 400);
    }

    if (!email.trim() || !password) {
      return sendError(res, "Email and password are required.", 400);
    }

    // Explicitly select password + lockout fields since the schema excludes them by default
    const user = await User.findOne({ email: email.toLowerCase().trim() }).select(
      "+password +failedLoginAttempts +lockUntil"
    );

    if (!user) {
      return sendError(res, "Invalid email or password.", 401);
    }

    if (user.isLocked()) {
      const minutesLeft = Math.ceil((user.lockUntil - Date.now()) / 60000);
      return sendError(
        res,
        `Too many failed attempts. This account is temporarily locked. Try again in ${minutesLeft} minute(s).`,
        423 // 423 Locked
      );
    }

    if (!user.password) {
      return sendError(
        res,
        "This account was created using Google Sign-In. Please log in with Google.",
        400
      );
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      await user.recordFailedLogin();
      return sendError(res, "Invalid email or password.", 401);
    }

    await user.resetLoginAttempts();

    const token = generateToken(user._id);

    return sendSuccess(res, "Login successful.", {
      token,
      user: user.toSafeObject(),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/auth/google
 * Accepts a Google ID token from the frontend (Google Identity Services),
 * verifies it, then creates or logs in the corresponding user.
 */
async function googleAuth(req, res, next) {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return sendError(res, "Google idToken is required.", 400);
    }

    let googlePayload;
    try {
      googlePayload = await verifyGoogleToken(idToken);
    } catch (err) {
      console.error("Google token verification failed:", err.message);
      return sendError(res, "Invalid or expired Google token.", 401);
    }

    const { googleId, email, name, avatar } = googlePayload;

    // Look for an existing user by googleId first, then by email
    // (in case they previously signed up with email/password using the same address).
    let user = await User.findOne({ $or: [{ googleId }, { email }] });

    if (user) {
      // Link Google account if not already linked, and keep profile info fresh.
      let modified = false;
      if (!user.googleId) {
        user.googleId = googleId;
        modified = true;
      }
      if (!user.avatar && avatar) {
        user.avatar = avatar;
        modified = true;
      }
      if (modified) await user.save();
    } else {
      user = await User.create({
        name,
        email,
        googleId,
        avatar,
        // no password field — Google-only account
      });
    }

    const token = generateToken(user._id);

    return sendSuccess(res, "Google login successful.", {
      token,
      user: user.toSafeObject(),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/auth/me
 * Returns the currently authenticated user's profile.
 * Protected route — requires valid JWT.
 */
async function getMe(req, res, next) {
  try {
    return sendSuccess(res, "User fetched successfully.", {
      user: req.user.toSafeObject(),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/auth/logout
 * Protected route. Revokes the current token server-side so it can't be
 * reused even if it's copied out of browser storage/cache before the
 * client clears it — without this, "logout" only affects the browser's
 * local copy and the token itself stays valid until natural expiry.
 */
async function logout(req, res, next) {
  try {
    // req.tokenExp and req.rawToken are attached by the protect middleware.
    if (req.rawToken && req.tokenExp) {
      await RevokedToken.create({
        token: req.rawToken,
        expiresAt: new Date(req.tokenExp * 1000), // jwt exp is in seconds
      }).catch((err) => {
        // Duplicate-key (already revoked) is fine to ignore; anything else, log it.
        if (err.code !== 11000) console.error("Failed to record revoked token:", err);
      });
    }
    return sendSuccess(res, "Logged out successfully.", null);
  } catch (error) {
    next(error);
  }
}

module.exports = { signup, login, googleAuth, getMe, logout };