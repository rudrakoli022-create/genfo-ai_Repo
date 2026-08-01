const Attachment = require("../models/Attachment");
const { processFile } = require("../services/fileProcessingService");
const { extOf } = require("../middleware/uploadMiddleware");
const { sendSuccess, sendError } = require("../utils/apiResponse");

const MAX_FILENAME_LENGTH = 180;

/**
 * POST /api/upload
 * Protected. Accepts one or more files (multipart/form-data, field name
 * "files"), extracts text (or base64 for images), and stores each as an
 * Attachment scoped to req.user. Returns lightweight metadata the frontend
 * can render immediately (name, category, preview) plus the attachment id
 * to reference in a later /api/chat call.
 *
 * Never returns raw extracted text/image data in the response — those stay
 * server-side and are only pulled in by chatController when the attachment
 * id is referenced in a chat turn.
 */
async function uploadFiles(req, res) {
  try {
    const files = req.files || [];

    if (!files.length) {
      return sendError(res, "No files were uploaded.", 400);
    }

    const { conversationId } = req.body;

    const results = [];
    const failures = [];

    for (const file of files) {
      const ext = extOf(file.originalname);
      const safeName = file.originalname.slice(0, MAX_FILENAME_LENGTH);

      try {
        const processed = await processFile(file.buffer, ext, safeName);

        const attachment = await Attachment.create({
          user: req.user._id,
          conversationId: conversationId || null,
          originalName: safeName,
          ext,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          category: processed.category,
          imageBase64: processed.imageBase64 || null,
          extractedText: processed.extractedText || null,
          truncated: Boolean(processed.truncated),
          preview: processed.preview,
        });

        results.push({
          id: attachment._id,
          name: attachment.originalName,
          ext: attachment.ext,
          category: attachment.category,
          sizeBytes: attachment.sizeBytes,
          preview: attachment.preview,
          truncated: attachment.truncated,
          // For images only: a data URI so the frontend can show a thumbnail
          // immediately without a second round trip.
          thumbnailUrl:
            attachment.category === "image" ? `data:${attachment.mimeType};base64,${processed.imageBase64}` : null,
        });
      } catch (fileErr) {
        failures.push({ name: safeName, error: fileErr.message || "Failed to process file." });
      }
    }

    if (!results.length) {
      return sendError(res, "None of the uploaded files could be processed.", 400, { failures });
    }

    return sendSuccess(res, "Files processed.", { attachments: results, failures });
  } catch (err) {
    console.error("Upload error:", err);
    return sendError(res, "Something went wrong while processing your upload.", 500);
  }
}

module.exports = { uploadFiles };
