const { postToFacebook } = require("./facebook");
const { postToLinkedIn } = require("./linkedin");
const { generateContentAndVisualTopic, cleanPostFormatting } = require("../../llm/contentGen");

function buildImagePrompt(topic, destination) {
  const styleSuffix = {
    facebook: "oil painting style, rich brushstrokes, painterly",
    linkedin: "futuristic tech illustration, clean digital art, AI and robotics aesthetic, not painterly"
  }[destination] || "high quality digital illustration";

  return `${topic}, ${styleSuffix}`;
}

// ── Free image generation (Pollinations.ai — no API key, no HF credits) ──────
async function generateImageFree(prompt) {
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`;
  console.log(`[Image API] Generating image via Pollinations (free): "${prompt}"...`);

  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Pollinations error (${res.status}): ${errText.substring(0, 150)}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function generateFLUXImage(prompt) {
  // Tier 1: Pollinations (free) — works without HF credits
  try {
    return await generateImageFree(prompt);
  } catch (err) {
    console.warn(`[Image API] Pollinations failed: ${err.message} — trying FLUX...`);
  }

  // Tier 2: FLUX via HF router (requires HF Inference credits)
  const hfToken = process.env.HF_TOKEN || process.env.HF_ACCESS_TOKEN;
  if (!hfToken) {
    console.warn("[Image API] No HF token — skipping FLUX fallback.");
    return null;
  }

  console.log(`[FLUX Image API] Generating image with prompt: "${prompt}"...`);
  try {
    const res = await fetch("https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-dev", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${hfToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ inputs: prompt })
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[FLUX Image API] Error (${res.status}): ${errText}`);
      return null;
    }

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    console.error("[FLUX Image API] Image generation request failed:", err.message);
    return null;
  }
}

async function run({ destinations = [], content = "", visualTopic = null }) {
  if (!destinations.length) {
    throw new Error("No destinations specified for social workflow");
  }

  console.log(`[Social Workflow] Initiating post for destinations: ${JSON.stringify(destinations)}`);

  // 1. Generate text and visual topic if needed
  let finalContent = cleanPostFormatting(content);
  let finalVisualTopic = visualTopic;

  if (!finalVisualTopic) {
    const gen = await generateContentAndVisualTopic(content);
    finalContent = gen.postText || finalContent;
    finalVisualTopic = gen.visualTopic || content;
  }

  // Final sanity check to guarantee no asterisks or hashtags
  finalContent = cleanPostFormatting(finalContent);

  // 2. Parallel destination execution using Promise.allSettled (Section 4 Latency Budget & Independence)
  const tasks = destinations.map(async (dest) => {
    try {
      const imagePrompt = buildImagePrompt(finalVisualTopic, dest);
      const imageBuffer = await generateFLUXImage(imagePrompt);

      const postFn = dest === "facebook" ? postToFacebook : postToLinkedIn;
      const res = await postFn({ content: finalContent, imageBuffer });
      return { destination: dest, ...res };
    } catch (err) {
      console.error(`[Social Workflow] Destination ${dest} failed:`, err.message);
      return Promise.reject({ destination: dest, error: err.message });
    }
  });

  const settled = await Promise.allSettled(tasks);

  const results = [];
  const failedPlatforms = [];
  const errors = [];

  for (const outcome of settled) {
    if (outcome.status === "fulfilled") {
      results.push(outcome.value);
    } else {
      const reason = outcome.reason || {};
      failedPlatforms.push(reason.destination || "unknown");
      errors.push(reason.error || "Execution failed");
    }
  }

  const allSucceeded = failedPlatforms.length === 0;

  return {
    success: allSucceeded,
    results,
    failedPlatforms,
    errorSummary: errors.join("; ")
  };
}

module.exports = {
  run,
  buildImagePrompt,
  generateFLUXImage,
  generateImageFree
};
