const provider = require("./provider");

function cleanPostFormatting(text) {
  if (!text) return "";
  let cleaned = text;

  // 1. Remove ALL markdown bold/italic asterisks (* and **)
  cleaned = cleaned.replace(/\*/g, "");

  // 2. Remove markdown header hashes (# Header -> Header)
  cleaned = cleaned.replace(/^#+\s*/gm, "");

  // 3. Remove hashtag clutter or stray hash symbols
  cleaned = cleaned.replace(/#\w+/g, "");
  cleaned = cleaned.replace(/#/g, "");

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
  
  try {
    const rawJson = await provider.generate(prompt, { type: "object" });
    const cleaned = rawJson.replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    const postText = cleanPostFormatting(parsed.postText || topic);
    const visualTopic = parsed.visualTopic || topic;

    return { postText, visualTopic };
  } catch (err) {
    console.warn("[contentGen] Failed to generate structured post content/visual topic:", err.message);
    return {
      postText: cleanPostFormatting(topic),
      visualTopic: topic
    };
  }
}

module.exports = { generateContentAndVisualTopic, cleanPostFormatting };
