const express = require("express");
const router = express.Router();

const { createPaymentOrder, verifyPayment } = require("../controllers/paymentController");
const { protect } = require("../middleware/authMiddleware");

// All payment routes require authentication
router.use(protect);

router.post("/create-order", createPaymentOrder);
router.post("/verify", verifyPayment);

module.exports = router;
