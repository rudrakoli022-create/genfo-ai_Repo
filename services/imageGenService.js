/**
 * Image generation via Pollinations.ai — a free, open, no-API-key image
 * generation service (Flux model under the hood). No signup, no billing,
 * which is exactly the right fit for getting this feature live with zero
 * starting budget. If you later want higher quality/reliability, this is
 * the one function to swap for a paid provider (Stability, OpenAI, etc.)
 * — nothing else in the app needs to change.
 *
 * Docs: https://github.com/pollinations/pollinations (legacy no-auth endpoint)
 */

const POLLINATIONS_BASE_URL = "https://image.pollinations.ai/prompt";

const ALLOWED_ASPECT_RATIOS = {
  square: { width: 1024, height: 1024 },
  portrait: { width: 832, height: 1216 },
  landscape: { width: 1216, height: 832 },
};

/**
 * Generates an image from a text prompt via Pollinations.ai.
 * Returns the raw image bytes (Buffer) and the content-type, so the
 * controller can stream it straight back to the client without needing
 * any file storage.
 *
 * @param {string} prompt - the text description of the desired image
 * @param {string} aspect - one of 'square' | 'portrait' | 'landscape'
 */
async function generateImage(prompt, aspect = "square") {
  const { width, height } = ALLOWED_ASPECT_RATIOS[aspect] || ALLOWED_ASPECT_RATIOS.square;

  const seed = Math.floor(Math.random() * 1_000_000_000); // randomize so repeat prompts don't return a cached identical image
  const encodedPrompt = encodeURIComponent(prompt);

  const url =
    `${POLLINATIONS_BASE_URL}/${encodedPrompt}` +
    `?width=${width}&height=${height}&seed=${seed}&model=flux&nologo=true&safe=true&private=true`;

  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: "image/*" },
      // Image generation can take a while on a free shared service —
      // give it real room before giving up.
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      throw new Error("Image generation timed out. Please try again.");
    }
    throw new Error("Could not reach the image generation service.");
  }

  if (!response.ok) {
    throw new Error(`Image generation failed (status ${response.status}). Please try again.`);
  }

  const contentType = response.headers.get("content-type") || "image/jpeg";
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.length === 0) {
    throw new Error("Image generation returned an empty result. Please try a different prompt.");
  }

  return { buffer, contentType, url };
}

module.exports = { generateImage, ALLOWED_ASPECT_RATIOS };