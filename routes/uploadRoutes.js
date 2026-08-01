const express = require("express");
const router = express.Router();

const { uploadFiles } = require("../controllers/uploadController");
const { protect } = require("../middleware/authMiddleware");
const { upload, enforceImageSizeLimit } = require("../middleware/uploadMiddleware");

router.post("/", protect, upload.array("files", 5), enforceImageSizeLimit, uploadFiles);

module.exports = router;
