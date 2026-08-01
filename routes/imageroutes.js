const express = require("express");
const router = express.Router();

const { generateImageHandler, editImageHandler } = require("../controllers/imageController");
const { protect } = require("../middleware/authMiddleware");

router.post("/generate", protect, generateImageHandler);
router.post("/edit", protect, editImageHandler);

module.exports = router;