const Conversation = require("../models/Conversation");
const { sendSuccess, sendError } = require("../utils/apiResponse");

const PREVIEW_LENGTH = 60;

/**
 * GET /api/chat/conversations
 * Lists this user's conversations, pinned first then newest-updated, for
 * the sidebar. Deliberately lightweight — no message bodies, just enough
 * to render a clickable history list.
 */
async function listConversations(req, res) {
  const conversations = await Conversation.find({ user: req.user._id })
    .sort({ pinned: -1, updatedAt: -1 })
    .limit(100)
    .select("title pinned updatedAt messages");

  const items = conversations.map((c) => {
    const lastMessage = c.messages[c.messages.length - 1];
    return {
      id: c._id,
      title: c.title || "New Chat",
      pinned: c.pinned,
      updatedAt: c.updatedAt,
      preview: lastMessage ? (lastMessage.content || "").slice(0, PREVIEW_LENGTH) : "",
    };
  });

  return sendSuccess(res, "Conversations loaded.", { conversations: items });
}

/**
 * GET /api/chat/conversations/:id
 * Full message history for one conversation, scoped to req.user — this is
 * what lets a user reopen an old chat and keep going, or reference "the
 * previous PDF" from a session they closed and came back to.
 */
async function getConversation(req, res) {
  const conversation = await Conversation.findOne({ _id: req.params.id, user: req.user._id });
  if (!conversation) return sendError(res, "Conversation not found.", 404);

  return sendSuccess(res, "Conversation loaded.", {
    id: conversation._id,
    title: conversation.title,
    pinned: conversation.pinned,
    messages: conversation.messages.map((m) => ({
      role: m.role,
      content: m.content,
      imageUrl: m.imageUrl,
      prompt: m.prompt,
      attachments: m.attachments,
      createdAt: m.createdAt,
    })),
  });
}

/** DELETE /api/chat/conversations/:id */
async function deleteConversation(req, res) {
  const deleted = await Conversation.findOneAndDelete({ _id: req.params.id, user: req.user._id });
  if (!deleted) return sendError(res, "Conversation not found.", 404);
  return sendSuccess(res, "Conversation deleted.", null);
}

/** PATCH /api/chat/conversations/:id — rename or pin/unpin. */
async function updateConversation(req, res) {
  const { title, pinned } = req.body;
  const update = {};
  if (typeof title === "string" && title.trim()) update.title = title.trim().slice(0, 80);
  if (typeof pinned === "boolean") update.pinned = pinned;

  const conversation = await Conversation.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id },
    update,
    { new: true }
  );
  if (!conversation) return sendError(res, "Conversation not found.", 404);

  return sendSuccess(res, "Conversation updated.", {
    id: conversation._id,
    title: conversation.title,
    pinned: conversation.pinned,
  });
}

module.exports = { listConversations, getConversation, deleteConversation, updateConversation };
