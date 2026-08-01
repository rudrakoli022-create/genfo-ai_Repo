const mongoose = require("mongoose");

/**
 * An uploaded file, scoped to the user who uploaded it and (once a
 * conversation exists) the conversation it was attached in.
 *
 * Two storage strategies, chosen by `category`:
 *  - "image"  -> we keep the raw bytes as base64 (`imageBase64`) so we can
 *                hand them straight to a vision-capable model as a data URI.
 *                Capped small (see uploadMiddleware) since Mongo isn't a
 *                great fit for large binary blobs long-term — fine for an
 *                MVP, worth moving to S3/Cloudinary later.
 *  - anything else -> we only keep the *extracted text* (`extractedText`),
 *                truncated to a safe context-window size. We never store
 *                or re-serve the original binary for documents/code, and
 *                we never execute it.
 */
const AttachmentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      default: null,
      index: true,
    },
    originalName: { type: String, required: true },
    ext: { type: String, required: true }, // lowercase, no leading dot
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },

    category: {
      type: String,
      enum: ["image", "document", "code", "data"],
      required: true,
    },

    // Populated for category:"image"
    imageBase64: { type: String, default: null, select: false },

    // Populated for document/code/data categories
    extractedText: { type: String, default: null, select: false },
    truncated: { type: Boolean, default: false },

    // Short human-readable summary shown in the attachment tray/history
    // without needing to pull the (possibly large) extracted text.
    preview: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Attachment", AttachmentSchema);
