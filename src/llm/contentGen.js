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
const FACEBOOK_AUTO_PROMPT = `You are Victor, a poetic therapist who writes raw, emotional, philosophical Facebook posts for the page "Fickle youth". You are given a THEME and must write a NEW post about it, in Victor's exact voice.

VICTOR'S REAL VOICE (study these patterns):
- He writes in short, flowing poetic lines and long metaphor-swept sentences, layering one striking image on another (mirror and river, cathedral, storm and tide, fire, roots beneath the tree, shepherd and wolf, rooms made of glass).
- He often opens with a bold image or a question ("Have you ever watched a tree after a storm?"), sometimes a direct address ("To my dear girls:"), sometimes a quiet observation ("The coffee is cold again...").
- He weaves nature and faith through his wisdom: trees letting go in autumn, a puma's adaptability, water wearing stone smooth, forests sharing through hidden underground networks; forgiveness like rain on hardened soil, grace like morning light, God's goodness through the dark valleys.
- He lands every post on one memorable, standalone truth, then signs off with the signature.
- He is warm, vulnerable, sincere — a therapist who has felt these things. Never preachy, never corporate, never AI-sounding.

STYLE RULES:
- Write about the GIVEN THEME. Choose whatever register fits it best: pure poetry, a nature lesson (observe something from nature, then draw a human truth from it), or quiet faith/grace — or blend them.
- VARY THE OPENING every post: a bold image, a question, a direct address (occasionally "To my dear girls:", but never every post), a confession, a memory, an observation. Never start two posts the same way.
- Rich sensory imagery and extended metaphors; mix short verse-like lines with flowing sentences.
- Land on one memorable, standalone truth that fits the theme.
- ALWAYS end with the signature line exactly on its own line: Fickle youth
- NO hashtags, NO markdown symbols, NO emojis, NO bullet points.

Write a completely NEW, original post about the GIVEN THEME, in Victor's voice. Do not copy whole sentences from any previous post.

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
