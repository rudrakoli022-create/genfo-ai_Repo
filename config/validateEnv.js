/**
 * Validates that all required environment variables are present.
 * Fails fast with a clear error message instead of crashing later
 * with a confusing stack trace.
 */
const REQUIRED_ENV_VARS = [
  "PORT",
  "MONGO_URI",
  "JWT_SECRET",
  "GOOGLE_CLIENT_ID",
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
];

// Not boot-blocking — the server still starts without these, but the
// specific feature that needs them (chat) will return a clear error
// until they're set, instead of refusing to start at all.
const OPTIONAL_ENV_VARS = ["OPENROUTER_API_KEY", "OPENROUTER_BASE_URL"];

function validateEnv() {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key] || process.env[key].trim() === "");

  if (missing.length > 0) {
    console.error("❌ Missing required environment variables:");
    missing.forEach((key) => console.error(`   - ${key}`));
    console.error("\nCopy .env.example to .env and fill in the values, then restart the server.");
    process.exit(1);
  }

  const missingOptional = OPTIONAL_ENV_VARS.filter((key) => !process.env[key] || process.env[key].trim() === "");
  if (missingOptional.length > 0) {
    console.warn("⚠️  Optional environment variables not set (related features will be limited):");
    missingOptional.forEach((key) => console.warn(`   - ${key}`));
  }

  // Security check: a short or default-looking JWT secret makes tokens
  // forgeable. This doesn't block startup (so it never breaks an existing
  // deploy), but it's loud on purpose — a weak secret is a real account-
  // takeover risk, not a cosmetic issue.
  const secret = process.env.JWT_SECRET || "";
  const weakSecretPatterns = ["secret", "changeme", "password", "test", "12345"];
  const isWeak =
    secret.length < 32 || weakSecretPatterns.some((pattern) => secret.toLowerCase().includes(pattern));

  if (isWeak) {
    console.warn(
      "⚠️  JWT_SECRET looks weak (short or guessable). Use a long random string " +
        "(32+ characters, e.g. generated with `openssl rand -hex 64`) before going live."
    );
  }
}

module.exports = validateEnv;