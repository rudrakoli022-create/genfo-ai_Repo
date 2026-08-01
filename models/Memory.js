const mongoose = require("mongoose");

/**
 * A single durable fact about a user (e.g. "Name is Rudra", "Lives in
 * Mumbai", "Prefers concise answers"), extracted from things they say in
 * chat. Scoped to the user, reused across every conversation — this is
 * what makes it "real" memory rather than per-tab/per-browser state.
 */
const MemorySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    text: { type: String, required: true, trim: true },
    // Which conversation this was first noticed in, for context only.
    sourceConversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Memory", MemorySchema);
