const multer = require("multer");
const { EXTENSION_MAP } = require("../services/fileProcessingService");

// Images can legitimately be a few MB; documents/code should rarely need
// to be huge. Keeping images smaller than you might expect because they're
// stored as base64 in MongoDB (see models/Attachment.js) — base64 inflates
// size by ~33%, and vision-model APIs have their own payload ceilings.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024; // 15MB
const MAX_UPLOAD_BYTES = Math.max(MAX_IMAGE_BYTES, MAX_DOCUMENT_BYTES);

function extOf(filename) {
  const parts = filename.split(".");
  return parts.length > 1 ? parts.pop().toLowerCase() : "";
}

// Never trust the client-supplied MIME type alone — cross-check against
// the extension allowlist. This blocks the classic "rename a .exe to
// .png" trick and disguised executables in general, since anything not
// in EXTENSION_MAP is rejected outright regardless of what Content-Type
// the browser sent.
const upload = multer({
  storage: multer.memoryStorage(), // never touches disk — no path-traversal surface, nothing to accidentally serve/execute
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 5, // multiple attachments per request, but capped
  },
  fileFilter(req, file, cb) {
    const ext = extOf(file.originalname);

    if (!ext || !EXTENSION_MAP[ext]) {
      return cb(new Error(`Unsupported file type: .${ext || "unknown"}`));
    }

    // Reject anything that looks executable/script-like even if someone
    // manages to smuggle a matching extension in via a crafted filename
    // (defense in depth on top of the allowlist above).
    const DANGEROUS_EXTENSIONS = ["exe", "bat", "cmd", "sh", "msi", "dll", "com", "scr", "ps1", "vbs", "jar", "app"];
    if (DANGEROUS_EXTENSIONS.includes(ext)) {
      return cb(new Error("Executable files are not allowed."));
    }

    cb(null, true);
  },
});

// Post-multer, per-category size check (multer's `limits.fileSize` only
// gives us one global ceiling; images get a stricter one here).
function enforceImageSizeLimit(req, res, next) {
  const { getCategory } = require("../services/fileProcessingService");
  const oversizedImage = (req.files || []).find((f) => {
    const ext = extOf(f.originalname);
    return getCategory(ext) === "image" && f.size > MAX_IMAGE_BYTES;
  });

  if (oversizedImage) {
    return res.status(413).json({
      success: false,
      message: `Image "${oversizedImage.originalname}" is too large. Images must be under ${MAX_IMAGE_BYTES / (1024 * 1024)}MB.`,
      data: null,
    });
  }
  next();
}

module.exports = { upload, enforceImageSizeLimit, extOf, MAX_IMAGE_BYTES, MAX_DOCUMENT_BYTES };
