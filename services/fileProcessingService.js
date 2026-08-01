/**
 * Turns an uploaded file's raw buffer into either extracted text (documents,
 * code, data) or a base64 payload (images) that the rest of the app can use.
 *
 * Adding a new file type later is a two-line change: add it to EXTENSION_MAP
 * below and, if it needs special parsing (like PDF/DOCX/XLSX), a branch in
 * extractText().
 */

const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const XLSX = require("xlsx");

const MAX_EXTRACTED_CHARS = 12000; // keep injected file context within a sane token budget

// Maps a lowercase extension (no dot) -> category. Anything not listed here
// is rejected by the upload middleware before it ever reaches this service.
const EXTENSION_MAP = {
  // Images — handled as base64, sent to a vision model
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  gif: "image",

  // Documents needing special parsing
  pdf: "document",
  docx: "document",
  xlsx: "document",

  // Plain-text-readable documents
  txt: "document",
  md: "document",
  csv: "document",
  json: "document",
  xml: "document",
  yaml: "document",
  yml: "document",

  // Source code — read as plain text, just labeled distinctly for the model
  js: "code",
  ts: "code",
  jsx: "code",
  tsx: "code",
  html: "code",
  css: "code",
  py: "code",
  java: "code",
  c: "code",
  cpp: "code",
  cs: "code",
  php: "code",
  go: "code",
  rs: "code",
  sql: "code",
};

function getCategory(ext) {
  return EXTENSION_MAP[ext.toLowerCase()] || null;
}

function truncate(text) {
  if (text.length <= MAX_EXTRACTED_CHARS) return { text, truncated: false };
  return {
    text: text.slice(0, MAX_EXTRACTED_CHARS) + "\n\n[...truncated — file was longer than the context budget...]",
    truncated: true,
  };
}

/**
 * @param {Buffer} buffer - raw file bytes
 * @param {string} ext - lowercase extension, no dot
 * @param {string} originalName
 * @returns {Promise<{ category: string, extractedText?: string, truncated?: boolean, imageBase64?: string, preview: string }>}
 */
async function processFile(buffer, ext, originalName) {
  const category = getCategory(ext);
  if (!category) {
    throw new Error(`Unsupported file type: .${ext}`);
  }

  if (category === "image") {
    return {
      category: "image",
      imageBase64: buffer.toString("base64"),
      preview: `Image (${originalName})`,
    };
  }

  let rawText;

  try {
    if (ext === "pdf") {
      const parsed = await pdfParse(buffer);
      rawText = parsed.text || "";
    } else if (ext === "docx") {
      const result = await mammoth.extractRawText({ buffer });
      rawText = result.value || "";
    } else if (ext === "xlsx") {
      const workbook = XLSX.read(buffer, { type: "buffer" });
      rawText = workbook.SheetNames.map((sheetName) => {
        const sheet = workbook.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        return `--- Sheet: ${sheetName} ---\n${csv}`;
      }).join("\n\n");
    } else {
      // Plain-text-readable: txt, md, csv, json, xml, yaml/yml, and every
      // code extension in EXTENSION_MAP.
      rawText = buffer.toString("utf-8");
    }
  } catch (err) {
    throw new Error(`Could not read ${originalName}: ${err.message || "parsing failed"}`);
  }

  const { text, truncated } = truncate(rawText.trim());

  return {
    category,
    extractedText: text,
    truncated,
    preview: text.slice(0, 140).replace(/\s+/g, " ").trim() || `(empty file: ${originalName})`,
  };
}

module.exports = { processFile, getCategory, EXTENSION_MAP };
