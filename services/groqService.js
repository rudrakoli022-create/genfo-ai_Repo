/**
 * OpenRouter chat service.
 * OpenRouter's API is OpenAI-compatible: POST https://openrouter.ai/api/v1/chat/completions
 * with stream: true returns Server-Sent Events, each line prefixed "data: ",
 * containing JSON chunks shaped like OpenAI's streaming format:
 *   { choices: [ { delta: { content: "..." } } ] }
 * terminated by a final line "data: [DONE]".
 *
 * This service re-streams those same SSE chunks to our own Express response,
 * so the frontend never talks to OpenRouter directly (keeping the API key server-side).
 */

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "anthropic/claude-sonnet-4";

const SYSTEM_PROMPT =
  "You are Genfo AI, a helpful, friendly AI assistant inside the Genfo AI app. " +
  "Give clear, well-formatted, concise answers. Use markdown for code blocks.";

/**
 * Streams a chat completion from OpenRouter directly into an Express response
 * using Server-Sent Events, so the frontend can render tokens as they arrive.
 *
 * @param {Array<{role: string, content: string}>} messages - conversation history
 * @param {import('express').Response} res - Express response to stream into
 */
async function streamChatCompletion(messages, res) {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    res.write(`data: ${JSON.stringify({ error: "OPENROUTER_API_KEY is not configured on the server." })}\n\n`);
    res.end();
    return;
  }

  const payload = {
    model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
    messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
    stream: true,
    temperature: 0.7,
    max_completion_tokens: 1024,
  };

  let upstream;
  try {
    upstream = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (networkErr) {
    res.write(`data: ${JSON.stringify({ error: "Could not reach OpenRouter API." })}\n\n`);
    res.end();
    return;
  }

  if (!upstream.ok || !upstream.body) {
    let errorDetail = `OpenRouter API responded with status ${upstream.status}.`;
    try {
      const errBody = await upstream.json();
      if (errBody && errBody.error && errBody.error.message) {
        errorDetail = errBody.error.message;
      }
    } catch (_) {
      // ignore parse failure, fall back to generic message
    }
    res.write(`data: ${JSON.stringify({ error: errorDetail })}\n\n`);
    res.end();
    return;
  }

  // Re-stream OpenRouter's SSE chunks straight through to our client.
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

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
}

module.exports = { streamChatCompletion };