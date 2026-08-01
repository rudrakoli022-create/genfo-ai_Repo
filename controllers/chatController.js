const Conversation = require("../models/Conversation");
const Attachment = require("../models/Attachment");
const Memory = require("../models/Memory");
const { extractMemoryFacts } = require("../services/memoryExtractor");
const { streamChatCompletion } = require("../services/openrouterService");
const { sendError } = require("../utils/apiResponse");

const MAX_MESSAGE_LENGTH = 8000;
const MAX_HISTORY_MESSAGES = 20;
const MAX_ATTACHMENTS_PER_TURN = 5;
const MAX_MEMORY_FACTS_PER_USER = 60;
const MAX_MEMORY_FACTS_IN_CONTEXT = 15;
const TITLE_LENGTH = 60;

// Text-only chat models the user can pick between.
const ALLOWED_MODELS = [
  "meta-llama/llama-3.3-70b-instruct",
  "meta-llama/llama-3.1-8b-instruct",
  "mistralai/mixtral-8x7b-instruct",
  "google/gemma-2-9b-it",
];
const DEFAULT_MODEL = "meta-llama/llama-3.3-70b-instruct";

// Any of the above are text-only and can't see images. When the user
// attaches an image, we transparently switch to a vision-capable model
// for that turn instead — the user never has to pick a "vision mode".
//
// NOTE: OpenRouter's free-tier model roster rotates fairly often (models
// get pulled/repriced with little notice). If you start seeing
// "No endpoints found for <model>" errors, check
// https://openrouter.ai/collections/free-models for the current list of
// vision-capable ":free" models and update VISION_MODEL_CANDIDATES below —
// nothing else in the app needs to change.
const VISION_MODEL_CANDIDATES = [
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
];

function titleFromMessage(text) {
  const clean = text.trim().replace(/\s+/g, " ");
  if (clean.length <= TITLE_LENGTH) return clean;
  const cut = clean.slice(0, TITLE_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut) + "…";
}

/**
 * Saves any newly-noticed durable facts from this message as Memory docs
 * (skipping exact duplicates of what's already stored), then returns the
 * user's most recent facts to fold into this turn's prompt. This is what
 * makes memory persist across conversations, not just within one chat.
 */
async function updateAndLoadMemory(userId, conversationId, messageText) {
  const newFacts = extractMemoryFacts(messageText);

  if (newFacts.length) {
    const existing = await Memory.find({ user: userId, text: { $in: newFacts } }).select("text");
    const existingTexts = new Set(existing.map((m) => m.text));
    const toInsert = newFacts.filter((f) => !existingTexts.has(f));

    if (toInsert.length) {
      await Memory.insertMany(
        toInsert.map((text) => ({ user: userId, text, sourceConversationId: conversationId || null }))
      );

      // Cap total stored facts per user — trim the oldest ones beyond the cap.
      const count = await Memory.countDocuments({ user: userId });
      if (count > MAX_MEMORY_FACTS_PER_USER) {
        const excess = count - MAX_MEMORY_FACTS_PER_USER;
        const oldest = await Memory.find({ user: userId }).sort({ createdAt: 1 }).limit(excess).select("_id");
        await Memory.deleteMany({ _id: { $in: oldest.map((m) => m._id) } });
      }
    }
  }

  return Memory.find({ user: userId }).sort({ createdAt: -1 }).limit(MAX_MEMORY_FACTS_IN_CONTEXT);
}

/**
 * POST /api/chat
 * Protected route. Accepts the user's new message plus optional prior
 * conversation history and attached files, and streams the AI's reply back
 * as Server-Sent Events.
 *
 * Request body: {
 *   message: string,
 *   history?: Array<{role, content}>,
 *   conversationId?: string,
 *   model?: string,
 *   attachmentIds?: string[]   // ids returned by POST /api/upload
 * }
 *
 * Response is NOT the usual { success, message, data } envelope — it's a
 * text/event-stream of SSE frames, since this endpoint streams incrementally
 * rather than returning one JSON payload. Each frame is one of:
 *   data: {"conversationId": "...", "title": "..."} — sent once, first —
 *                                  lets the sidebar track/create this chat
 *   data: {"token": "..."}      — a piece of the reply
 *   data: {"done": true}        — stream finished successfully
 *   data: {"error": "..."}      — something went wrong, stream ends after this
 */
async function chat(req, res, next) {
  try {
    const { message, history, conversationId, model, attachmentIds } = req.body;

    const selectedModel = ALLOWED_MODELS.includes(model) ? model : DEFAULT_MODEL;

    if (!message || typeof message !== "string" || !message.trim()) {
      return sendError(res, "A non-empty 'message' field is required.", 400);
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      return sendError(res, `Message is too long (max ${MAX_MESSAGE_LENGTH} characters).`, 400);
    }

    // Per-account daily quota — this is the backstop against API-cost abuse
    // that survives an attacker switching IPs/networks to dodge the
    // IP-based rate limiter, since it's tied to the authenticated account.
    const usage = await req.user.checkAndIncrementChatUsage();
    if (!usage.allowed) {
      return sendError(
        res,
        `You've reached your daily message limit (${usage.limit}). ${
          req.user.subscriptionStatus === "pro" ? "Try again tomorrow." : "Upgrade to Pro for a higher limit, or try again tomorrow."
        }`,
        429
      );
    }

    // ---- Load & validate attachments (always scoped to req.user — never
    // trust an attachment id belonging to someone else's upload) ----
    let attachments = [];
    if (Array.isArray(attachmentIds) && attachmentIds.length) {
      const ids = attachmentIds.slice(0, MAX_ATTACHMENTS_PER_TURN);
      attachments = await Attachment.find({ _id: { $in: ids }, user: req.user._id }).select(
        "+imageBase64 +extractedText"
      );
    }

    const imageAttachments = attachments.filter((a) => a.category === "image");
    const textAttachments = attachments.filter((a) => a.category !== "image");

    // Documents/code get folded into the visible message as labeled context
    // blocks so the model reads them before answering.
    let contextBlock = "";
    for (const att of textAttachments) {
      contextBlock += `\n\n--- Attached file: ${att.originalName} ---\n${att.extractedText || "(no readable text extracted)"}${
        att.truncated ? "\n[file truncated to fit context]" : ""
      }`;
    }

    const userText = message.trim() + contextBlock;

    let conversation;

    if (conversationId) {
      conversation = await Conversation.findOne({
        _id: conversationId,
        user: req.user._id,
      });
    }

    const isNewConversation = !conversation;

    if (!conversation) {
      conversation = await Conversation.create({
        user: req.user._id,
        title: titleFromMessage(message),
        messages: [],
      });
    }

    conversation.messages.push({
      role: "user",
      content: message.trim(), // stored history stays concise — file text isn't duplicated into every future turn
      attachments: attachments.map((a) => ({ id: a._id, name: a.originalName, category: a.category })),
    });

    await conversation.save();

    // ---- Real cross-conversation memory: persist any new durable facts
    // from this message, then pull the user's known facts into this turn
    // so the model has continuity across separate chats, not just within
    // this one. ----
    const memoryFacts = await updateAndLoadMemory(req.user._id, conversation._id, message.trim());
    const memoryContext = memoryFacts.length
      ? `What you already know about this user from earlier conversations:\n${memoryFacts
          .map((m) => `- ${m.text}`)
          .join("\n")}\nUse this naturally where relevant — don't just recite it back.`
      : "";

    // Build the message list sent to the model. History + prior turns are
    // plain strings; only the *current* turn's content becomes a multimodal
    // array (text + image blocks) when images are attached.
    const priorMessages = conversation.messages.slice(0, -1).map((m) => ({
      role: m.role,
      content: m.content,
    })).slice(-MAX_HISTORY_MESSAGES);

    let currentContent;
    if (imageAttachments.length) {
      currentContent = [
        { type: "text", text: userText },
        ...imageAttachments.map((att) => ({
          type: "image_url",
          image_url: { url: `data:${att.mimeType};base64,${att.imageBase64}` },
        })),
      ];
    } else {
      currentContent = userText;
    }

    const messages = [
      ...(memoryContext ? [{ role: "system", content: memoryContext }] : []),
      ...priorMessages,
      { role: "user", content: currentContent },
    ];

    // Transparently switch to a vision-capable model for this turn if the
    // user attached an image — no manual "mode" required. Multiple
    // candidates are passed so the request survives a free vision model
    // getting rotated out on OpenRouter's end.
    const streamOptions = imageAttachments.length
      ? { modelCandidates: VISION_MODEL_CANDIDATES }
      : { model: selectedModel };

    // Set up SSE headers before streaming begins.
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // disable proxy buffering (e.g. nginx) for real-time streaming
    });

    // First frame: tell the frontend which conversation this is (new or
    // existing) so the sidebar can track/create it without a second request.
    res.write(
      `data: ${JSON.stringify({
        conversationId: conversation._id,
        title: conversation.title,
        isNew: isNewConversation,
      })}\n\n`
    );

    const fullReply = await streamChatCompletion(messages, res, streamOptions);

    // Persist the assistant's reply so reopening this conversation later
    // (from the sidebar) shows the full back-and-forth, not just your
    // messages. If the stream errored out with nothing generated, skip
    // saving an empty assistant turn.
    if (fullReply && fullReply.trim()) {
      conversation.messages.push({ role: "assistant", content: fullReply });
      await conversation.save();
    }
  } catch (error) {
    // If headers haven't been sent yet, fall back to the normal JSON error shape.
    if (!res.headersSent) {
      return next(error);
    }
    console.error("Chat stream error:", error);
    try {
      res.write(`data: ${JSON.stringify({ error: "Something went wrong." })}\n\n`);
      res.end();
    } catch (_) {
      // response may already be closed
    }
  }
}

module.exports = { chat };
