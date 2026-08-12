const { z } = require("zod");
const provider = require("../llm/provider");

// Zod schema for structured extraction
const PostIntentSchema = z.object({
  isPostTrigger: z.boolean(),
  destinations: z.array(z.enum(["facebook", "linkedin"])).optional().default([]),
  content: z.string().optional().default(""),
});

const SYSTEM_PROMPT = `Extract a social media post request.
isPostTrigger is true ONLY if the user explicitly asks to make, schedule, or publish a post AND names at least one target destination (facebook, linkedin, or both) AND provides specific topic/content to post about.
If any part is missing (e.g. no destination specified, or no topic/content specified, or it's just a general question/thought), isPostTrigger MUST be false.

Return JSON format:
{
  "isPostTrigger": boolean,
  "destinations": ["facebook" | "linkedin"],
  "content": "extracted post content or topic"
}`;

function fallbackDeterministicExtractor(message) {
  if (!message || typeof message !== "string") return { isPostTrigger: false, destinations: [], content: "" };
  const lower = message.toLowerCase().trim();

  // Check action verb
  const hasAction = /\b(make|create|publish|send|share|schedule|post)\b/i.test(lower);
  if (!hasAction) return { isPostTrigger: false, destinations: [], content: "" };

  // Check destinations explicitly
  const destinations = [];
  if (lower.includes("facebook") || lower.includes("fb")) destinations.push("facebook");
  if (lower.includes("linkedin")) destinations.push("linkedin");

  // If no target platform is explicitly specified, return isPostTrigger: false
  if (!destinations.length) return { isPostTrigger: false, destinations: [], content: "" };

  // Extract topic content
  let content = "";
  const matchAbout = lower.match(/\b(about|for|on|regarding)\s+(.+)/i);
  if (matchAbout && matchAbout[2]) {
    content = matchAbout[2].trim();
  } else {
    content = lower
      .replace(/\b(make|create|publish|send|share|schedule|post|a|the|to|on|facebook|fb|linkedin)\b/gi, "")
      .trim();
  }

  if (!content || content.length < 2) {
    return { isPostTrigger: false, destinations: [], content: "" };
  }

  return {
    isPostTrigger: true,
    destinations,
    content
  };
}

async function extractPostIntent(message) {
  const prompt = `${SYSTEM_PROMPT}\n\nUser message: "${message}"`;
  
  try {
    const rawJson = await provider.generate(prompt, PostIntentSchema);
    let parsed;
    try {
      const cleaned = rawJson.replace(/```json\n?|\n?```/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.warn("[Extractor] Failed to parse LLM JSON output, using deterministic fallback...");
      return fallbackDeterministicExtractor(message);
    }

    const validated = PostIntentSchema.safeParse(parsed);
    if (!validated.success) {
      console.warn("[Extractor] Zod validation failed, using deterministic fallback...");
      return fallbackDeterministicExtractor(message);
    }

    const result = validated.data;

    // Hard validation on top of model output (Blueprint Section 3)
    if (!result.destinations || !result.destinations.length || !result.content || !result.content.trim()) {
      const detRes = fallbackDeterministicExtractor(message);
      if (detRes.isPostTrigger) return detRes;
      return { ...result, isPostTrigger: false };
    }

    return result;
  } catch (err) {
    console.error("[Extractor] Intent extraction error:", err.message, "- Using deterministic fallback...");
    return fallbackDeterministicExtractor(message);
  }
}

module.exports = { extractPostIntent, PostIntentSchema, fallbackDeterministicExtractor };
