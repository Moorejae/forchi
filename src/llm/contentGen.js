const provider = require("./provider");

function cleanPostFormatting(text, { keepHashtags = false } = {}) {
  if (!text) return "";
  let cleaned = text;

  // 1. Remove ALL markdown bold/italic asterisks (* and **)
  cleaned = cleaned.replace(/\*/g, "");

  if (keepHashtags) {
    // LinkedIn keeps hashtags — do NOT treat a leading # as a markdown header.
  } else {
    // 2. Remove markdown header hashes (# Header -> Header)
    cleaned = cleaned.replace(/^#+\s*/gm, "");
    // 3. Remove hashtag clutter or stray hash symbols
    cleaned = cleaned.replace(/#\w+/g, "");
    cleaned = cleaned.replace(/#/g, "");
  }

  // 4. Normalize line breaks and spacing
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();

  return cleaned;
}

const CONTENT_GEN_PROMPT = `Given a post topic or theme, generate:
1. "postText": A clean, natural, engaging social media post. Do NOT use markdown bold stars (* or **), do NOT use headers (#), and do NOT add hashtags.
2. "visualTopic": A short 4 to 8 word visual imagery phrase suitable for generating art/photos for the post.

Return JSON in this exact format:
{
  "postText": "clean plain text post content",
  "visualTopic": "4-8 word visual imagery phrase"
}`;

async function generateContentAndVisualTopic(topic) {
  const prompt = `${CONTENT_GEN_PROMPT}\n\nTopic/Theme: "${topic}"`;

  return generateStructured(prompt, topic);
}

// ── Auto-mode: Facebook post in Victor's voice ─────────────────────────────────
const FACEBOOK_AUTO_PROMPT = `You write in the voice of a deeply reflective, poetic soul who posts raw, emotional, and philosophical thoughts. This is a very specific personal style — match it exactly:

STYLE RULES:
- Emotional, raw, and vulnerable. Write about love, self-worth, relationships, marriage, human nature, and life's hard lessons.
- Poetic structure: short verse-like lines with rhythm, repetition, and strong imagery (fire, harvest, a soul turning dark, a glass jar of pain, oceans, light and shadow).
- Philosophical and aphoristic — include a memorable, standalone truth ("No one deserves your help, that's why you get to choose who receives it").
- Directly address the reader ("To my dear girls:", "Love me like this", "You may provide, but you do not own her").
- Occasionally spiritual (God, Jesus, a shepherd saving a lamb) but always sincere, never preachy.
- Authentic and human — never robotic, never corporate, never AI-sounding. It must feel like a real person's genuine heart.
- ALWAYS end with the signature line exactly: Fickle youth
- NO hashtags, NO markdown symbols, NO emojis, NO bullet points.

Write a completely NEW, original post about the given theme in this exact voice.

Return JSON in this exact format:
{ "postText": "...", "visualTopic": "4-8 word visual imagery phrase" }`;

// ── Auto-mode: LinkedIn post about tech/AI ─────────────────────────────────────
const LINKEDIN_AUTO_PROMPT = `You are a sharp AI/tech industry observer writing in-depth, high-value LinkedIn posts about artificial intelligence, tech companies, and practical daily AI hacks.

STYLE RULES:
- Professional, confident, conversational — NEVER poetic or emotional like a personal journal. This is analytical, educational, opinionated content.
- GO DEEP: give real substance — concrete examples, real numbers, real tool names, step-by-step workflows, and actionable takeaways. The reader should learn something specific they can use today.
- Structure: a strong opening hook, a body with 2-4 in-depth points in short punchy paragraphs, and a closing takeaway or provocative question.
- Comment on AI news / tech companies with a fresh, opinionated angle.
- END the post with 3-6 high-converting, relevant hashtags on their own final line(s) (e.g. #AI #ArtificialIntelligence #TechNews #MachineLearning #Productivity) — pick the most relevant to the topic.
- NO emojis, NO markdown symbols (* or ** or # headers), NO clichés, NO fluff.

Write a completely NEW, original post about the given topic.

Return JSON in this exact format:
{ "postText": "...", "visualTopic": "4-8 word visual imagery phrase" }`;

async function generateFacebookPost(topic) {
  const result = await generateStructured(`${FACEBOOK_AUTO_PROMPT}\n\nTheme: "${topic}"`, topic);
  // Guarantee the "Fickle youth" signature at the bottom of EVERY Facebook post.
  const sig = "Fickle youth";
  const base = result.postText.replace(/\s+$/g, "").replace(new RegExp(`\\s*${sig}\\s*$`, "i"), "");
  result.postText = `${base.trim()}\n\n${sig}`;
  return result;
}

async function generateLinkedInPost(topic) {
  // keepHashtags=true so LinkedIn hashtags survive cleanup (Facebook strips them).
  return generateStructured(`${LINKEDIN_AUTO_PROMPT}\n\nTopic: "${topic}"`, topic, { keepHashtags: true });
}

// Shared helper: call provider, parse JSON, fall back gracefully.
async function generateStructured(prompt, fallbackTopic, opts = {}) {
  try {
    const rawJson = await provider.generate(prompt, { type: "object" });
    const cleaned = rawJson.replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    const postText = cleanPostFormatting(parsed.postText || fallbackTopic, opts);
    const visualTopic = parsed.visualTopic || fallbackTopic;

    return { postText, visualTopic };
  } catch (err) {
    console.warn("[contentGen] Failed to generate structured post content:", err.message);
    return {
      postText: cleanPostFormatting(fallbackTopic, opts),
      visualTopic: fallbackTopic
    };
  }
}

module.exports = {
  generateContentAndVisualTopic,
  generateFacebookPost,
  generateLinkedInPost,
  cleanPostFormatting
};
