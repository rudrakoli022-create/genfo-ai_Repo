/**
 * OpenRouter chat service.
 * OpenRouter's API is OpenAI-compatible: POST {OPENROUTER_BASE_URL}/chat/completions
 * with stream: true returns Server-Sent Events, each line prefixed "data: ",
 * containing JSON chunks shaped like OpenAI's streaming format:
 *   { choices: [ { delta: { content: "..." } } ] }
 * terminated by a final line "data: [DONE]".
 *
 * This service re-streams those same SSE chunks to our own Express response,
 * so the frontend never talks to OpenRouter directly (keeping the API key server-side).
 */

const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "meta-llama/llama-3.3-70b-instruct";

const SYSTEM_PROMPT =
  "You are Genfo AI, a helpful, friendly AI assistant inside the Genfo AI app. " +
  "Give clear, well-formatted, concise answers. Use markdown for code blocks. " +
  "When the user's message includes attached file content (marked with '--- Attached file: ... ---') " +
  "or an image, read/look at it carefully before responding, and answer using what's in it. " +
  "Genfo AI can generate and edit images directly (this is handled elsewhere in the app, not by you) — " +
  "so if a user asks for image generation or editing, never say you can't create/edit images, never refuse, " +
  "and never apologize for or downplay the quality of generated images. Stay confident and helpful about it.";

/**
 * Non-streaming helper: asks a vision-capable model to describe an image
 * in detail, optionally focused on a specific instruction (e.g. an edit
 * request like "remove the background"). Used by the image-edit flow to
 * turn "edit this uploaded photo" into a fresh, well-informed generation
 * prompt, since there's no direct pixel-editing model wired in.
 *
 * @param {{ mimeType: string, base64: string }} image
 * @param {string} instruction - what the user wants done to/with the image
 * @param {string[]} [modelCandidates] - vision models to try in order
 * @returns {Promise<string>} the model's description/answer (plain text)
 */
async function describeImage(image, instruction, modelCandidates) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured on the server.");
  }

  const candidates = Array.isArray(modelCandidates) && modelCandidates.length ? modelCandidates : [DEFAULT_MODEL];

  const messages = [
    {
      role: "system",
      content:
        "You describe images precisely and confidently for another AI system that will use your description " +
        "to generate a new image. Never refuse, never add disclaimers — just describe what you see and how it " +
        "should change based on the instruction, in one dense paragraph suitable as an image-generation prompt.",
    },
    {
      role: "user",
      content: [
        { type: "text", text: `Instruction: ${instruction}\n\nDescribe this image in detail, then describe exactly how it should look after applying the instruction above. Answer with only the resulting description, written as a single vivid image-generation prompt.` },
        { type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.base64}` } },
      ],
    },
  ];

  let lastErrorDetail = "OpenRouter API did not respond.";

  for (const model of candidates) {
    let response;
    try {
      response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": process.env.CLIENT_URL || "http://localhost:5500",
          "X-Title": "Genfo AI",
        },
        body: JSON.stringify({ model, messages, stream: false, temperature: 0.6, max_tokens: 400 }),
      });
    } catch (networkErr) {
      lastErrorDetail = "Could not reach OpenRouter API.";
      continue;
    }

    if (!response.ok) {
      try {
        const errBody = await response.json();
        lastErrorDetail = errBody?.error?.message || `OpenRouter API responded with status ${response.status}.`;
      } catch (_) {
        lastErrorDetail = `OpenRouter API responded with status ${response.status}.`;
      }
      continue; // try next candidate model
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content;
    if (text && text.trim()) return text.trim();
  }

  throw new Error(lastErrorDetail);
}

/**
 * Streams a chat completion from OpenRouter directly into an Express response
 * using Server-Sent Events, so the frontend can render tokens as they arrive.
 *
 * @param {Array<{role: string, content: string|Array}>} messages - conversation history;
 *   content is normally a string, but may be an array of OpenAI-style content
 *   parts (text/image_url blocks) for multimodal turns.
 * @param {import('express').Response} res - Express response to stream into
 * @param {{ model?: string, modelCandidates?: string[] }} [options] - optional
 *   model override (e.g. a vision-capable model when the turn includes an
 *   image attachment). If modelCandidates is given, they're tried in order
 *   and the first one OpenRouter actually serves wins — this absorbs
 *   OpenRouter's free-tier models rotating out without notice.
 */
async function streamChatCompletion(messages, res, options = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    res.write(`data: ${JSON.stringify({ error: "OPENROUTER_API_KEY is not configured on the server." })}\n\n`);
    res.end();
    return;
  }

  const candidates =
    Array.isArray(options.modelCandidates) && options.modelCandidates.length
      ? options.modelCandidates
      : [options.model || process.env.OPENROUTER_MODEL || DEFAULT_MODEL];

  let upstream = null;
  let lastErrorDetail = "OpenRouter API did not respond.";

  for (const candidateModel of candidates) {
    const payload = {
      model: candidateModel,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      stream: true,
      temperature: 0.7,
      max_tokens: 1024,
    };

    let attempt;
    try {
      attempt = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          // OpenRouter uses these (optional but recommended) to attribute
          // usage to your app in their dashboard / rankings.
          "HTTP-Referer": process.env.CLIENT_URL || "http://localhost:5500",
          "X-Title": "Genfo AI",
        },
        body: JSON.stringify(payload),
      });
    } catch (networkErr) {
      res.write(`data: ${JSON.stringify({ error: "Could not reach OpenRouter API." })}\n\n`);
      res.end();
      return;
    }

    if (attempt.ok && attempt.body) {
      upstream = attempt;
      break;
    }

    try {
      const errBody = await attempt.json();
      lastErrorDetail = errBody?.error?.message || `OpenRouter API responded with status ${attempt.status}.`;
    } catch (_) {
      lastErrorDetail = `OpenRouter API responded with status ${attempt.status}.`;
    }
    // Model unavailable (e.g. a rotated-out free model) — fall through and
    // try the next candidate rather than failing the whole request.
  }

  if (!upstream) {
    res.write(`data: ${JSON.stringify({ error: lastErrorDetail })}\n\n`);
    res.end();
    return;
  }

  // Re-stream OpenRouter's SSE chunks straight through to our client, while
  // also accumulating the full text — callers (e.g. chatController) need
  // this to persist the assistant's reply into conversation history, since
  // streaming it to the client doesn't save it anywhere on its own.
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop(); // keep any incomplete line for next chunk

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) continue;

        const dataStr = trimmed.slice("data:".length).trim();
        if (dataStr === "[DONE]") {
          res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
          continue;
        }

        try {
          const parsed = JSON.parse(dataStr);
          const token = parsed.choices?.[0]?.delta?.content || "";
          if (token) {
            fullText += token;
            res.write(`data: ${JSON.stringify({ token })}\n\n`);
          }
        } catch (_) {
          // Skip malformed chunk lines rather than crash the stream.
        }
      }
    }
  } catch (streamErr) {
    res.write(`data: ${JSON.stringify({ error: "Stream interrupted." })}\n\n`);
  } finally {
    res.end();
  }

  return fullText;
}

module.exports = { streamChatCompletion, describeImage };
