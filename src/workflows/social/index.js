const { postToFacebook } = require("./facebook");
const { postToLinkedIn } = require("./linkedin");
const { generateContentAndVisualTopic, generateFacebookPost, generateLinkedInPost, finalizePost } = require("../../llm/contentGen");
const { generate } = require("../../llm/provider");
const { detectImageMime } = require("./imageMime");
const sharp = require("sharp");

// Facebook/LinkedIn accept JPEG + PNG (not WebP). Hosted FLUX returns WebP, so we
// normalize any non-JPEG/PNG image to a high-quality JPEG before posting.
async function normalizeImage(buf) {
  if (!buf || buf.length < 4) return buf;
  try {
    const { mime } = detectImageMime(buf);
    if (mime === "image/jpeg" || mime === "image/png") return buf;
    console.log(`[Image API] Converting ${mime} -> JPEG for platform compatibility...`);
    return await sharp(buf).rotate().jpeg({ quality: 92 }).toBuffer();
  } catch (err) {
    console.warn("[Image API] Image normalize failed, using as-is:", err.message);
    return buf;
  }
}

// ZeroGPU attributes GPU allocation to the caller's HF account via this header.
// Without it, calls land in the anonymous pool (2 min/day, quickly exhausted) and
// fail instantly with "event: error". With it, they use the account's PRO quota.
function hfAuthHeaders(extra = {}) {
  const token = process.env.HF_ACCESS_TOKEN || process.env.HF_TOKEN;
  const h = { ...extra };
  if (token) h["x-hf-authorization"] = `Bearer ${token}`;
  return h;
}

// ── Platform house styles ────────────────────────────────────────────────────
// Derived by Gemini VISION from Victor's two sample art images (2026-08-19):
//   LinkedIn  = the cute chibi/pastel-mech sample (563018699347692.jpeg)
//   Facebook  = the gritty ink/woodblock-print sample (LUCAS ALIGHIERI_.jpeg)
// Each post then gets a UNIQUE topic-tuned variant of its house style via
// buildTopicStylePrompt(), so images stay on-brand but never repeat.
const BASE_STYLES = {
  linkedin:
    "2D digital vector illustration blending modern anime concept art with a clean sticker-graphic aesthetic. " +
    "Desaturated pastel palette: off-white/cream, dusty periwinkle, slate blue, light cool-grey, with warm copper and soft peach accents. " +
    "Clean dark-grey ink outlines, flat cel-shading with gentle smooth gradients, smooth matte non-reflective textures. " +
    "Diffused soft ambient light with a soft-edged drop shadow. Cute chibi-style mechanical characters with oversized blocky heads and compact articulated limbs, centered full-body composition. " +
    "Mood: gentle, retro-futuristic, cute, melancholic, minimalist. Style keywords: chibi, cel-shaded, soft mech, pastel sci-fi vector illustration.",
  facebook:
    "Hand-drawn digital ink illustration blending gritty seinen manga realism with traditional Japanese woodblock print aesthetics. " +
    "Limited desaturated palette: dusty teal background, parchment cream garments, deep indigo-black hair, earth-tone mud brown and slate blue; high contrast but muted. " +
    "Heavy expressive scratchy black ink linework with dense cross-hatching, stippling and pen shading. Distressed speckled paper texture with grit, fiber noise and subtle paint splatters. " +
    "High-contrast graphic lighting with deep ink-black shadows, low-angle centered portrait of a single rugged character against a minimalist textured sky. " +
    "Mood: melancholic, raw, nostalgic, determined. Style keywords: vagabond manga sketch, scratchy ink, distressed woodblock print, cross-hatching.",
};

function buildImagePrompt(topic, destination, styleOverride) {
  const styleSuffix = styleOverride || BASE_STYLES[destination] || "high quality digital illustration";
  return `${topic}, ${styleSuffix}`;
}

// Make each post's art UNIQUE: Gemini fuses the platform's house style with the
// post's topic into a fresh, topic-specific style prompt. Falls back to the
// house style if the model is unavailable.
async function buildTopicStylePrompt(topic, destination) {
  const base = BASE_STYLES[destination];
  if (!base || !topic) return base;
  const prompt =
    `We generate one AI image per social post and want each to have a UNIQUE art style that fits BOTH the platform's house style and the post's topic.\n\n` +
    `HOUSE STYLE (${destination}): ${base}\n\n` +
    `POST TOPIC: "${topic}"\n\n` +
    `Write ONE concise image-generation style prompt (50-80 words) that keeps the house style's medium, palette and technique but adapts the subject matter, mood and details to the topic, so the image clearly conveys "${topic}" while still looking like the house style. Output ONLY the style prompt, no preamble.`;
  try {
    const out = await generate(prompt, { maxTokens: 200 });
    let t = String(out || "").trim();
    // The model sometimes wraps the answer as {"prompt": "..."} — unwrap it.
    const jsonWrap = t.match(/^\s*\{[\s\S]*?"(?:prompt|style|text|output)"\s*:\s*"([\s\S]*?)"\s*\}\s*$/);
    if (jsonWrap) t = jsonWrap[1].replace(/\\n/g, " ").replace(/\\"/g, '"').trim();
    if (t.length > 20 && !/having a moment/i.test(t)) return t;
  } catch (err) {
    console.warn(`[Image API] Topic-style generation failed for ${destination}: ${err.message}`);
  }
  return base;
}

// ── High-quality hosted Space (radames SDXL-Lightning, 24/7, 1024x1024, ~6s) ──
// No GPU hosting/maintenance needed — we call its public Gradio API directly.
async function generateHostedImage(prompt) {
  const base = (process.env.HOSTED_IMG_ENDPOINT || "https://radames-real-time-text-to-image-sdxl-lightning.hf.space").trim().replace(/\/+$/, "");
  const apiName = process.env.HOSTED_IMG_API || "predict";
  console.log(`[Image API] Generating via hosted SDXL-Lightning: "${prompt}"...`);

  // 1. Start the gradio job (predict = [prompt, guidance, seed])
  const startRes = await fetch(`${base}/gradio_api/call/${apiName}`, {
    method: "POST",
    headers: hfAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ data: [prompt, 0.0, Math.floor(Math.random() * 1e8)] }),
    signal: AbortSignal.timeout(60000),
  });
  if (!startRes.ok) throw new Error(`Hosted start failed: HTTP ${startRes.status}`);
  const { event_id: eventId } = await startRes.json();
  if (!eventId) throw new Error("Hosted: no event_id in response");

  // 2. Read the SSE stream (blocks until the job completes)
  const sseRes = await fetch(`${base}/gradio_api/call/${apiName}/${eventId}`, { headers: hfAuthHeaders(), signal: AbortSignal.timeout(90000) });
  if (!sseRes.ok) throw new Error(`Hosted SSE failed: HTTP ${sseRes.status}`);
  const text = await sseRes.text();

  // 3. Extract the image URL
  const urlMatches = [...text.matchAll(/"url"\s*:\s*"(https?:[^"\\]+)"/g)].map((m) => m[1].replace(/\\u0026/g, "&"));
  const imageUrl = urlMatches.find((u) => u.includes("/file=")) || urlMatches[urlMatches.length - 1];
  if (!imageUrl) throw new Error("Hosted: could not find image URL in response");

  // 4. Download the image bytes
  const imgRes = await fetch(imageUrl, { headers: hfAuthHeaders(), signal: AbortSignal.timeout(60000) });
  if (!imgRes.ok) throw new Error(`Hosted: image download failed HTTP ${imgRes.status}`);
  return Buffer.from(await imgRes.arrayBuffer());
}

// ── Hosted FLUX.1-dev (KingNish/Realtime-FLUX, 24/7) — FLUX quality via Gradio API ──
async function generateHostedFLUXImage(prompt) {
  const base = (process.env.HOSTED_FLUX_ENDPOINT || "https://kingnish-realtime-flux.hf.space").trim().replace(/\/+$/, "");
  console.log(`[Image API] Generating via hosted FLUX: "${prompt}"...`);

  // generate_image = [prompt, seed, width, height]
  const startRes = await fetch(`${base}/gradio_api/call/generate_image`, {
    method: "POST",
    headers: hfAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ data: [prompt, Math.floor(Math.random() * 1e8), 1024, 1024] }),
    signal: AbortSignal.timeout(60000),
  });
  if (!startRes.ok) throw new Error(`Hosted FLUX start failed: HTTP ${startRes.status}`);
  const { event_id: eventId } = await startRes.json();
  if (!eventId) throw new Error("Hosted FLUX: no event_id in response");

  const sseRes = await fetch(`${base}/gradio_api/call/generate_image/${eventId}`, {
    headers: hfAuthHeaders(),
    signal: AbortSignal.timeout(120000),
  });
  if (!sseRes.ok) throw new Error(`Hosted FLUX SSE failed: HTTP ${sseRes.status}`);
  const text = await sseRes.text();

  const urlMatches = [...text.matchAll(/"url"\s*:\s*"(https?:[^"\\]+)"/g)].map((m) => m[1].replace(/\\u0026/g, "&"));
  const imageUrl = urlMatches.find((u) => u.includes("/file=")) || urlMatches[urlMatches.length - 1];
  if (!imageUrl) throw new Error("Hosted FLUX: could not find image URL in response");

  const imgRes = await fetch(imageUrl, { headers: hfAuthHeaders(), signal: AbortSignal.timeout(60000) });
  if (!imgRes.ok) throw new Error(`Hosted FLUX download failed HTTP ${imgRes.status}`);
  return Buffer.from(await imgRes.arrayBuffer());
}

// ── Free fallback image generation (Pollinations.ai — no API key, no HF credits) ──
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

// ── High-quality image generation (HF ZeroGPU Gradio Space, SDXL base 1.0) ─────
async function generateZeroGPUImage(prompt) {
  const base = (process.env.ZEROGPU_ENDPOINT || "https://slymun-forchi-img.hf.space").trim().replace(/\/+$/, "");
  console.log(`[Image API] Generating image via ZeroGPU (SDXL): "${prompt}"...`);

  // 1. Start the gradio job
  const startRes = await fetch(`${base}/gradio_api/call/generate`, {
    method: "POST",
    headers: hfAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ data: [prompt] }),
  });
  if (!startRes.ok) throw new Error(`ZeroGPU start failed: HTTP ${startRes.status}`);
  const startData = await startRes.json();
  const eventId = startData.event_id;
  if (!eventId) throw new Error("ZeroGPU: no event_id in response");

  // 2. Poll the SSE stream until completion (gradio streams result events)
  const sseRes = await fetch(`${base}/gradio_api/call/generate/${eventId}`, { headers: hfAuthHeaders() });
  if (!sseRes.ok) throw new Error(`ZeroGPU SSE failed: HTTP ${sseRes.status}`);
  const text = await sseRes.text();

  // 3. Extract the generated image URL from the completed output
  // Gradio returns the image as {"path": ..., "url": "https://.../file=..."} in the result.
  const urlMatches = [...text.matchAll(/"url"\s*:\s*"(https?:[^"\\]+)"/g)].map((m) => m[1].replace(/\\u0026/g, "&"));
  // Prefer the file= URLs (gradio serves the output image from the file server).
  const imageUrl = urlMatches.find((u) => u.includes("/file=")) || urlMatches[urlMatches.length - 1];
  if (!imageUrl) throw new Error("ZeroGPU: could not find image URL in response");

  // 4. Download the image bytes
  const imgRes = await fetch(imageUrl, { headers: hfAuthHeaders() });
  if (!imgRes.ok) throw new Error(`ZeroGPU: image download failed HTTP ${imgRes.status}`);
  const buf = await imgRes.arrayBuffer();
  return Buffer.from(buf);
}

async function generateImageWithFallback(prompt) {
  // Tier 1: Hosted FLUX.1-dev (KingNish, 24/7) — best quality, uses the account's
  // PRO ZeroGPU quota via the x-hf-authorization header.
  try {
    return await generateHostedFLUXImage(prompt);
  } catch (err) {
    console.warn(`[Image API] Hosted FLUX failed: ${err.message} — trying hosted SDXL-Lightning...`);
  }

  // Tier 2: Hosted SDXL-Lightning (radames, 24/7, reliable, 1024x1024)
  try {
    return await generateHostedImage(prompt);
  } catch (err) {
    console.warn(`[Image API] Hosted SDXL-Lightning failed: ${err.message} — trying our ZeroGPU Space...`);
  }

  // Tier 3: Our own ZeroGPU Space (fp8 FLUX / DreamShaper)
  try {
    return await generateZeroGPUImage(prompt);
  } catch (err) {
    console.warn(`[Image API] ZeroGPU failed: ${err.message} — falling back to Pollinations...`);
  }

  // Tier 4: Pollinations (free, always available)
  try {
    return await generateImageFree(prompt);
  } catch (err) {
    console.warn(`[Image API] Pollinations failed: ${err.message} — trying FLUX router...`);
  }

  // Tier 5: FLUX via HF router (requires HF Inference credits)
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
  let finalContent = (content || "").trim();
  let finalVisualTopic = visualTopic;

  if (!finalVisualTopic) {
    // Use the destination-specific generator so manual posts match auto-mode:
    // FB = Victor's poetic style + guaranteed "Fickle youth", LI = in-depth + hashtags.
    let gen;
    if (destinations.length === 1) {
      gen = destinations[0] === "facebook"
        ? await generateFacebookPost(finalContent)
        : await generateLinkedInPost(finalContent);
    } else {
      gen = await generateContentAndVisualTopic(finalContent);
    }
    finalContent = gen.postText || finalContent;
    finalVisualTopic = gen.visualTopic || content;
  }

  // Final formatting for every post: no markdown asterisks or header hashes, keep
  // real hashtags on the bottom (adding sensible ones when none exist), and for
  // Facebook guarantee the "Fickle youth" signature right above the hashtags.
  const fb = destinations.includes("facebook");
  finalContent = finalizePost(finalContent, {
    facebook: fb,
    fallbackTags: fb ? "#FickleYouth #Healing #LettingGo" : "#AI #ArtificialIntelligence #TechNews",
  });

  // 2. Parallel destination execution using Promise.allSettled (Section 4 Latency Budget & Independence)
  const tasks = destinations.map(async (dest) => {
    try {
      // Each post gets a UNIQUE topic-tuned variant of the platform house style.
      const topicStyle = await buildTopicStylePrompt(finalVisualTopic, dest);
      const imagePrompt = buildImagePrompt(finalVisualTopic, dest, topicStyle);
      const rawImage = await generateImageWithFallback(imagePrompt);
      const imageBuffer = await normalizeImage(rawImage);

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
  buildTopicStylePrompt,
  BASE_STYLES,
  generateImageWithFallback,
  generateHostedFLUXImage,
  generateHostedImage,
  generateImageFree,
  generateZeroGPUImage,
  normalizeImage
};
