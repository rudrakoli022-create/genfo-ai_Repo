const crypto = require("crypto");
const Payment = require("../models/Payment");
const User = require("../models/User");
const { createOrder, verifySignature } = require("../services/razorpayService");
const { sendSuccess, sendError } = require("../utils/apiResponse");

// The Pro plan price is fixed here, server-side — never trust a client-
// supplied amount for what the user actually gets charged/upgraded for.
// If you ever offer multiple plans, map each to a fixed price here rather
// than accepting an arbitrary number from the request body.
const PRO_PLAN_PRICE_INR = 99;

/**
 * POST /api/payment/create-order
 * Protected route. Creates a Razorpay order for the fixed Pro plan price.
 * The amount in the request body (if present) is intentionally ignored —
 * accepting a client-supplied amount would let someone request a $0.01
 * order, pay it, and still pass signature verification for an upgrade.
 */
async function createPaymentOrder(req, res, next) {
  try {
    const orderCurrency = "INR";
    // Razorpay caps the receipt field at 40 characters. A full Mongo
    // ObjectId (24 chars) + full timestamp would overflow that, so use a
    // short hash of the user ID + the timestamp in base36 to stay unique
    // and well under the limit.
    const shortUserId = req.user._id.toString().slice(-8);
    const receipt = `rcpt_${shortUserId}_${Date.now().toString(36)}`;

    const order = await createOrder(PRO_PLAN_PRICE_INR, orderCurrency, receipt);

    await Payment.create({
      user: req.user._id,
      razorpayOrderId: order.id,
      amount: order.amount, // in paise, as returned by Razorpay
      currency: order.currency,
      status: "created",
    });

    return sendSuccess(res, "Razorpay order created successfully.", {
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: process.env.RAZORPAY_KEY_ID, // frontend needs this to open Razorpay checkout
    });
  } catch (error) {
    console.error("Razorpay order creation failed:", error);
    next(error);
  }
}

/**
 * POST /api/payment/verify
 * Protected route. Frontend sends back the Razorpay response after
 * checkout completes. Backend verifies the HMAC signature using crypto,
 * and if valid, marks the user as premium/pro.
 */
async function verifyPayment(req, res, next) {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return sendError(
        res,
        "razorpay_order_id, razorpay_payment_id, and razorpay_signature are all required.",
        400
      );
    }

    const payment = await Payment.findOne({ razorpayOrderId: razorpay_order_id });

    if (!payment) {
      return sendError(res, "No matching order found for this payment.", 404);
    }

    // Ensure the order belongs to the requesting user
    if (payment.user.toString() !== req.user._id.toString()) {
      return sendError(res, "This order does not belong to the authenticated user.", 403);
    }

    // Idempotency guard: if this exact order was already verified and paid,
    // don't re-process it — just confirm success without re-running the
    // upgrade logic. Prevents duplicate processing from retried requests.
    if (payment.status === "paid") {
      const existingUser = await User.findById(req.user._id);
      return sendSuccess(res, "Payment already verified.", {
        success: true,
        orderId: razorpay_order_id,
        paymentId: payment.razorpayPaymentId,
        amount: payment.amount,
        currency: payment.currency,
        user: existingUser.toSafeObject(),
      });
    }

    const isValid = verifySignature({
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    });

    if (!isValid) {
      payment.status = "failed";
      await payment.save();
      return sendError(res, "Payment verification failed. Invalid signature.", 400);
    }

    // Signature is valid — payment is genuine. Update payment record.
    payment.status = "paid";
    payment.razorpayPaymentId = razorpay_payment_id;
    payment.razorpaySignature = razorpay_signature;
    await payment.save();

    // Upgrade the user to premium/pro
    const user = await User.findById(req.user._id);
    user.isPremium = true;
    user.subscriptionStatus = "pro";
    await user.save();

    return sendSuccess(res, "Payment verified successfully. Account upgraded to Pro.", {
      success: true,
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      amount: payment.amount,
      currency: payment.currency,
      user: user.toSafeObject(),
    });
  } catch (error) {
    console.error("Payment verification error:", error);
    next(error);
  }
}

module.exports = { createPaymentOrder, verifyPayment };