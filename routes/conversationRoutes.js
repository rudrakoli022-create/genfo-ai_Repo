const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/authMiddleware");
const {
  listConversations,
  getConversation,
  deleteConversation,
  updateConversation,
} = require("../controllers/conversationController");

router.get("/", protect, listConversations);
router.get("/:id", protect, getConversation);
router.patch("/:id", protect, updateConversation);
router.delete("/:id", protect, deleteConversation);

module.exports = router;
