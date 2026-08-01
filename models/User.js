const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const SALT_ROUNDS = 10;

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      maxlength: 100,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Please provide a valid email address"],
    },
    password: {
      type: String,
      // Not required because Google-only users won't have a password
      required: false,
      minlength: 6,
      select: false, // never return password by default in queries
    },
    googleId: {
      type: String,
      default: null,
      index: true,
      sparse: true, // allows multiple null values while keeping uniqueness for real values
      unique: true,
    },
    avatar: {
      type: String,
      default: null,
    },
    isPremium: {
      type: Boolean,
      default: false,
    },
    subscriptionStatus: {
      type: String,
      enum: ["free", "pro"],
      default: "free",
    },
    failedLoginAttempts: {
      type: Number,
      default: 0,
      select: false,
    },
    lockUntil: {
      type: Date,
      default: null,
      select: false,
    },
    chatUsage: {
      count: { type: Number, default: 0, select: false },
      windowStart: { type: Date, default: null, select: false },
    },
    imageUsage: {
      count: { type: Number, default: 0, select: false },
      windowStart: { type: Date, default: null, select: false },
    },
  },
  {
    timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" },
  }
);

// Hash password before saving, only if it was modified
userSchema.pre("save", async function (next) {
  if (!this.isModified("password") || !this.password) {
    return next();
  }
  try {
    const salt = await bcrypt.genSalt(SALT_ROUNDS);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

// Instance method to compare a plaintext password against the stored hash
userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) return false; // Google-only account has no password
  return bcrypt.compare(candidatePassword, this.password);
};

const FREE_DAILY_CHAT_LIMIT = 50;
const PRO_DAILY_CHAT_LIMIT = 500;
const CHAT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Checks and increments this user's daily chat usage. Returns
 * { allowed: boolean, remaining: number, limit: number }.
 * This is the per-account backstop against API-cost abuse — unlike the
 * IP-based rate limiter, this can't be dodged by switching networks/VPNs,
 * since it's tied to the authenticated account itself.
 */
userSchema.methods.checkAndIncrementChatUsage = async function () {
  const limit = this.subscriptionStatus === "pro" ? PRO_DAILY_CHAT_LIMIT : FREE_DAILY_CHAT_LIMIT;
  const now = Date.now();

  const windowExpired =
    !this.chatUsage || !this.chatUsage.windowStart || now - this.chatUsage.windowStart.getTime() > CHAT_WINDOW_MS;

  if (windowExpired) {
    this.chatUsage = { count: 1, windowStart: new Date(now) };
    await this.save({ validateBeforeSave: false });
    return { allowed: true, remaining: limit - 1, limit };
  }

  if (this.chatUsage.count >= limit) {
    return { allowed: false, remaining: 0, limit };
  }

  this.chatUsage.count += 1;
  await this.save({ validateBeforeSave: false });
  return { allowed: true, remaining: limit - this.chatUsage.count, limit };
};

const FREE_DAILY_IMAGE_LIMIT = 50; // Free plan: capped daily image generations
const PRO_DAILY_IMAGE_LIMIT = null; // Pro plan: unlimited (null = no cap)

/**
 * Same pattern as checkAndIncrementChatUsage, for image generation.
 * Pro users are unlimited; Free users get a configurable daily cap.
 * Usage is still tracked for Pro (for analytics/history), it's just
 * never enforced against a limit.
 */
userSchema.methods.checkAndIncrementImageUsage = async function () {
  const isPro = this.subscriptionStatus === "pro";
  const limit = isPro ? PRO_DAILY_IMAGE_LIMIT : FREE_DAILY_IMAGE_LIMIT;
  const now = Date.now();

  const windowExpired =
    !this.imageUsage || !this.imageUsage.windowStart || now - this.imageUsage.windowStart.getTime() > CHAT_WINDOW_MS;

  if (windowExpired) {
    this.imageUsage = { count: 1, windowStart: new Date(now) };
    await this.save({ validateBeforeSave: false });
    return { allowed: true, remaining: isPro ? null : limit - 1, limit, unlimited: isPro };
  }

  if (!isPro && this.imageUsage.count >= limit) {
    return { allowed: false, remaining: 0, limit, unlimited: false };
  }

  this.imageUsage.count += 1;
  await this.save({ validateBeforeSave: false });
  return {
    allowed: true,
    remaining: isPro ? null : limit - this.imageUsage.count,
    limit,
    unlimited: isPro,
  };
};

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

// True if the account is currently locked out due to repeated failed logins.
userSchema.methods.isLocked = function () {
  return Boolean(this.lockUntil && this.lockUntil > Date.now());
};

// Called after a failed password attempt. Locks the account for
// LOCK_DURATION_MS once MAX_FAILED_ATTEMPTS is reached. This protects
// against credential-stuffing/brute-force even if an attacker rotates
// IPs to dodge the request-level rate limiter.
userSchema.methods.recordFailedLogin = async function () {
  this.failedLoginAttempts = (this.failedLoginAttempts || 0) + 1;
  if (this.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
    this.lockUntil = new Date(Date.now() + LOCK_DURATION_MS);
  }
  await this.save({ validateBeforeSave: false });
};

// Called after a successful login. Clears any lockout state.
userSchema.methods.resetLoginAttempts = async function () {
  if (this.failedLoginAttempts || this.lockUntil) {
    this.failedLoginAttempts = 0;
    this.lockUntil = null;
    await this.save({ validateBeforeSave: false });
  }
};

// Strip sensitive fields whenever a user document is serialized to JSON
userSchema.methods.toSafeObject = function () {
  return {
    id: this._id,
    name: this.name,
    email: this.email,
    avatar: this.avatar,
    isPremium: this.isPremium,
    subscriptionStatus: this.subscriptionStatus,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model("User", userSchema);