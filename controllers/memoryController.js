const Memory = require("../models/Memory");
const { sendSuccess, sendError } = require("../utils/apiResponse");

/** GET /api/memory — list this user's stored memory facts, newest first. */
async function listMemory(req, res) {
  const items = await Memory.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(100);
  return sendSuccess(res, "Memory loaded.", {
    items: items.map((m) => ({ id: m._id, text: m.text, createdAt: m.createdAt })),
  });
}

/** DELETE /api/memory/:id — forget one fact. */
async function deleteMemoryItem(req, res) {
  const deleted = await Memory.findOneAndDelete({ _id: req.params.id, user: req.user._id });
  if (!deleted) return sendError(res, "Memory item not found.", 404);
  return sendSuccess(res, "Forgotten.", null);
}

/** DELETE /api/memory — forget everything. */
async function clearMemory(req, res) {
  await Memory.deleteMany({ user: req.user._id });
  return sendSuccess(res, "All memory cleared.", null);
}

module.exports = { listMemory, deleteMemoryItem, clearMemory };
