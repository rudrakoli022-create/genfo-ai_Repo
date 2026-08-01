/**
 * Pulls durable, reusable facts out of a chat message — the kind of thing
 * worth remembering in the *next* conversation, not just this one. Kept
 * deliberately simple (regex, not a model call) so it's fast and free to
 * run on every message.
 *
 * This is intentionally conservative: it only fires on clear, direct
 * statements ("my name is X", "I live in Y", "remember that Z"), not on
 * every message, to avoid cluttering memory with noise.
 */

const MAX_FACT_LENGTH = 200;

const PATTERNS = [
  { re: /\bmy name is ([a-z][a-z .'-]{1,40})/i, format: (m) => `Name: ${titleCase(m[1].trim())}` },
  { re: /\bcall me ([a-z][a-z .'-]{1,40})/i, format: (m) => `Prefers to be called: ${titleCase(m[1].trim())}` },
  { re: /\bi(?:'m| am) (?:a|an) ([a-z][a-z0-9 .'-]{2,60}?)(?:\.|,|$)/i, format: (m) => `Is a/an: ${m[1].trim()}` },
  { re: /\bi live in ([a-z][a-z0-9 .'-]{2,50}?)(?:\.|,|$)/i, format: (m) => `Lives in: ${titleCase(m[1].trim())}` },
  { re: /\bi work (?:as|at) ([a-z][a-z0-9 .'-]{2,60}?)(?:\.|,|$)/i, format: (m) => `Works: ${m[1].trim()}` },
  { re: /\bi(?:'m| am) building ([a-z0-9][a-z0-9 .'-]{2,80}?)(?:\.|,|$)/i, format: (m) => `Building: ${m[1].trim()}` },
  { re: /\bi (?:like|love|prefer) ([a-z0-9][a-z0-9 .'-]{2,60}?)(?:\.|,|$)/i, format: (m) => `Likes: ${m[1].trim()}` },
  { re: /\bremember (?:that )?(.{3,150}?)(?:\.|$)/i, format: (m) => m[1].trim() },
];

function titleCase(str) {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * @param {string} text - the raw user message
 * @returns {string[]} zero or more short fact strings worth persisting
 */
function extractMemoryFacts(text) {
  if (!text || typeof text !== "string") return [];

  const facts = [];
  for (const { re, format } of PATTERNS) {
    const match = text.match(re);
    if (match) {
      const fact = format(match).slice(0, MAX_FACT_LENGTH).trim();
      if (fact && fact.length > 3) facts.push(fact);
    }
  }

  // De-dupe within this single message (e.g. both a "my name is" and a
  // "remember" pattern firing on overlapping text).
  return [...new Set(facts)];
}

module.exports = { extractMemoryFacts };
