const {
  generateImage,
  ALLOWED_ASPECT_RATIOS,
} = require("../services/imageGenService");
const { describeImage } = require("../services/openrouterService");
const Attachment = require("../models/Attachment");
const Conversation = require("../models/Conversation");

const { sendError } = require("../utils/apiResponse");
const { sanitizeText } = require("../utils/sanitize");

const MAX_PROMPT_LENGTH = 600;
const MAX_INSTRUCTION_LENGTH = 400;
const TITLE_LENGTH = 60;

// Same vision candidates as chatController — kept in sync so both flows
// degrade the same way if a free OpenRouter model gets rotated out.
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
 * Finds the given conversationId (scoped to req.user) or creates a new
 * conversation, so generated images show up in the sidebar and survive
 * reopening a chat later — same as text turns.
 */
async function loadOrCreateConversation(userId, conversationId, titleSeed) {
  if (conversationId) {
    const existing = await Conversation.findOne({ _id: conversationId, user: userId });
    if (existing) return existing;
  }
  return Conversation.create({ user: userId, title: titleFromMessage(titleSeed), messages: [] });
}

async function generateImageHandler(req, res) {
  try {
    const { prompt, aspect = "square", conversationId } = req.body;

    if (!prompt || typeof prompt !== "string") {
      return sendError(res, "Prompt is required.", 400);
    }

    const cleanPrompt = sanitizeText(prompt.trim());

    if (!cleanPrompt) {
      return sendError(res, "Prompt is empty after sanitization.", 400);
    }

    if (cleanPrompt.length > MAX_PROMPT_LENGTH) {
      return sendError(res, `Prompt cannot exceed ${MAX_PROMPT_LENGTH} characters.`, 400);
    }

    const selectedAspect = ALLOWED_ASPECT_RATIOS[aspect] ? aspect : "square";

    // Check daily image usage according to user's plan (Pro = unlimited)
    const usage = await req.user.checkAndIncrementImageUsage();

    if (!usage.allowed) {
      return sendError(
        res,
        `You've reached today's free-plan image limit (${usage.limit}/day). Upgrade to Pro for unlimited image generation, or try again tomorrow.`,
        429,
        { upgrade: true }
      );
    }

    const { buffer, contentType, url } = await generateImage(cleanPrompt, selectedAspect);

    // Persist so this generation shows up when the conversation is reopened
    // from the sidebar. We store the Pollinations URL, not the image bytes
    // — cheap, and the URL is stable for this seed/prompt.
    const conversation = await loadOrCreateConversation(req.user._id, conversationId, cleanPrompt);
    conversation.messages.push({ role: "image", imageUrl: url, prompt: cleanPrompt });
    await conversation.save();

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Images-Remaining", usage.unlimited ? "unlimited" : String(usage.remaining));
    res.setHeader("X-Image-Limit", usage.unlimited ? "unlimited" : String(usage.limit));
    res.setHeader("X-User-Plan", req.user.subscriptionStatus === "pro" ? "pro" : "free");
    res.setHeader("X-Conversation-Id", String(conversation._id));
    res.setHeader("Access-Control-Expose-Headers", "X-Images-Remaining, X-Image-Limit, X-User-Plan, X-Conversation-Id");

    return res.send(buffer);
  } catch (err) {
    console.error("Image Generation Error:", err);
    return sendError(res, err.message || "Failed to generate image.", 500);
  }
}

/**
 * POST /api/image/edit
 * Protected. Body: { attachmentId, instruction, aspect?, conversationId? }
 *
 * There's no direct pixel-editing model wired in, so this approximates
 * editing by: (1) having a vision model describe the uploaded image plus
 * how it should change per the instruction, then (2) generating a fresh
 * image from that description. The result is a new image that reflects
 * the edit, not a precise pixel-level edit of the original — but the user
 * gets a confident, working result rather than a refusal.
 *
 * Subject to the same plan/usage checks as normal generation.
 */
async function editImageHandler(req, res) {
  try {
    const { attachmentId, instruction, aspect = "square", conversationId } = req.body;

    if (!attachmentId || typeof attachmentId !== "string") {
      return sendError(res, "attachmentId is required.", 400);
    }
    if (!instruction || typeof instruction !== "string" || !instruction.trim()) {
      return sendError(res, "An edit instruction is required.", 400);
    }

    const cleanInstruction = sanitizeText(instruction.trim()).slice(0, MAX_INSTRUCTION_LENGTH);

    // Always scoped to req.user — never trust an attachment id belonging
    // to someone else's upload.
    const attachment = await Attachment.findOne({
      _id: attachmentId,
      user: req.user._id,
      category: "image",
    }).select("+imageBase64");

    if (!attachment) {
      return sendError(res, "Attached image not found. Please re-upload it.", 404);
    }

    const selectedAspect = ALLOWED_ASPECT_RATIOS[aspect] ? aspect : "square";

    // Check daily image usage according to user's plan (Pro = unlimited) —
    // edits count the same as generations, since both call the same
    // underlying image service.
    const usage = await req.user.checkAndIncrementImageUsage();

    if (!usage.allowed) {
      return sendError(
        res,
        `You've reached today's free-plan image limit (${usage.limit}/day). Upgrade to Pro for unlimited image generation, or try again tomorrow.`,
        429,
        { upgrade: true }
      );
    }

    let generationPrompt;
    try {
      generationPrompt = await describeImage(
        { mimeType: attachment.mimeType, base64: attachment.imageBase64 },
        cleanInstruction,
        VISION_MODEL_CANDIDATES
      );
    } catch (visionErr) {
      console.error("Image edit — vision description failed:", visionErr);
      // Fall back to just the raw instruction rather than failing the
      // whole request — still produces a confident result, just less
      // informed by the original image's specifics.
      generationPrompt = cleanInstruction;
    }

    const cleanPrompt = sanitizeText(generationPrompt).slice(0, MAX_PROMPT_LENGTH);

    const { buffer, contentType, url } = await generateImage(cleanPrompt, selectedAspect);

    const conversation = await loadOrCreateConversation(req.user._id, conversationId, cleanInstruction);
    conversation.messages.push({ role: "image", imageUrl: url, prompt: cleanInstruction });
    await conversation.save();

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Images-Remaining", usage.unlimited ? "unlimited" : String(usage.remaining));
    res.setHeader("X-Image-Limit", usage.unlimited ? "unlimited" : String(usage.limit));
    res.setHeader("X-User-Plan", req.user.subscriptionStatus === "pro" ? "pro" : "free");
    res.setHeader("X-Conversation-Id", String(conversation._id));
    res.setHeader("Access-Control-Expose-Headers", "X-Images-Remaining, X-Image-Limit, X-User-Plan, X-Conversation-Id");

    return res.send(buffer);
  } catch (err) {
    console.error("Image Edit Error:", err);
    return sendError(res, err.message || "Failed to edit image.", 500);
  }
}

module.exports = {
  generateImageHandler,
  editImageHandler,
};
