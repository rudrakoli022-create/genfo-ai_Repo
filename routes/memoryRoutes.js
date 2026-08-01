const express = require("express");
const router = express.Router();

const { listMemory, deleteMemoryItem, clearMemory } = require("../controllers/memoryController");
const { protect } = require("../middleware/authMiddleware");

router.get("/", protect, listMemory);
router.delete("/:id", protect, deleteMemoryItem);
router.delete("/", protect, clearMemory);

module.exports = router;
