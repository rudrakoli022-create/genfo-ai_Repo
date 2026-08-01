const mongoose = require("mongoose");

const MessageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ["user", "assistant", "image"],
    required: true,
  },

  content: {
    type: String,
    default: "",
  },

  imageUrl: {
    type: String,
    default: "",
  },

  prompt: {
    type: String,
    default: "",
  },

  // Lightweight references to files attached to this message (full content
  // lives in the Attachment collection — see models/Attachment.js).
  attachments: [
    {
      _id: false,
      id: { type: mongoose.Schema.Types.ObjectId, ref: "Attachment" },
      name: String,
      category: String,
    },
  ],

  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const ConversationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    title: {
      type: String,
      default: "New Chat",
    },

    pinned: {
      type: Boolean,
      default: false,
    },

    messages: [MessageSchema],
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model(
  "Conversation",
  ConversationSchema
);