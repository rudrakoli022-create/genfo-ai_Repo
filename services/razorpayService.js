const Razorpay = require("razorpay");
const crypto = require("crypto");

// Lazily instantiated so that simply requiring this module (which happens
// when server.js loads routes/controllers) never throws before
// config/validateEnv.js has had a chance to run and report missing vars
// with a clear message.
let razorpayInstance = null;

function getRazorpayInstance() {
  if (!razorpayInstance) {
    razorpayInstance = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return razorpayInstance;
}

/**
 * Creates a Razorpay order.
 * @param {number} amountInRupees - Amount in rupees (e.g. 499 for ₹499).
 * @param {string} currency - Defaults to INR.
 * @param {string} receipt - A unique receipt identifier for this order.
 */
async function createOrder(amountInRupees, currency = "INR", receipt) {
  // Razorpay expects amount in the smallest currency unit (paise for INR)
  const amountInPaise = Math.round(amountInRupees * 100);

  const options = {
    amount: amountInPaise,
    currency,
    receipt,
    payment_capture: 1, // auto-capture payment after authorization
  };

  const order = await getRazorpayInstance().orders.create(options);
  return order;
}

/**
 * Verifies the Razorpay payment signature using HMAC SHA256.
 * This confirms the payment response actually came from Razorpay and
 * was not tampered with.
 *
 * Formula per Razorpay docs:
 *   expectedSignature = HMAC_SHA256(order_id + "|" + payment_id, key_secret)
 */
function verifySignature({ razorpay_order_id, razorpay_payment_id, razorpay_signature }) {
  const body = `${razorpay_order_id}|${razorpay_payment_id}`;

  const expectedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest("hex");

  // Use timing-safe comparison to avoid timing attacks
  const expectedBuffer = Buffer.from(expectedSignature, "utf-8");
  const actualBuffer = Buffer.from(razorpay_signature, "utf-8");

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

module.exports = { getRazorpayInstance, createOrder, verifySignature };