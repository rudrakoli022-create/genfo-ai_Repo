const rateLimit = require("express-rate-limit");

/**
 * General-purpose limiter applied to every request as a baseline guard
 * against basic flooding/scraping.
 */
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // 300 requests per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests. Please slow down and try again shortly.",
    data: null,
  },
});

/**
 * Strict limiter for login/signup — the most important one. Without this,
 * an attacker can script unlimited password guesses against an account.
 * 10 attempts per 15 minutes per IP is generous for a real user, punishing
 * for a brute-force script.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // only counts failed attempts toward the limit
  message: {
    success: false,
    message: "Too many login attempts. Please wait 15 minutes and try again.",
    data: null,
  },
});

/**
 * Chat limiter — protects your OpenRouter API key/quota from being burned through
 * by a single account hammering the endpoint (scripted abuse, or just an
 * accidental infinite loop on the frontend).
 */
const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 messages per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "You're sending messages too quickly. Please wait a moment.",
    data: null,
  },
});

/**
 * Payment limiter — order creation should never be hammered; a few attempts
 * per minute is more than enough for a real checkout flow.
 */
const paymentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many payment requests. Please wait a moment and try again.",
    data: null,
  },
});

/**
 * Image generation limiter — image gen is slower and heavier than chat,
 * so a tighter per-minute cap here on top of the per-account daily quota
 * in the User model.
 */
const imageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "You're generating images too quickly. Please wait a moment.",
    data: null,
  },
});

/**
 * Upload limiter — file processing (PDF/docx/xlsx parsing) is CPU-heavier
 * than a normal JSON request, so this is capped tighter than chat.
 */
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "You're uploading files too quickly. Please wait a moment.",
    data: null,
  },
});

module.exports = { generalLimiter, authLimiter, chatLimiter, paymentLimiter, imageLimiter, uploadLimiter };