const { postToFacebook } = require("./facebook");
const { postToLinkedIn } = require("./linkedin");
const { generateContentAndVisualTopic, generateFacebookPost, generateLinkedInPost, cleanPostFormatting } = require("../../llm/contentGen");

function buildImagePrompt(topic, destination) {
  const styleSuffix = {
    facebook: "ethereal dreamy cinematic digital painting, warm golden hour light, painterly brushstrokes, Lucas Alighieri style, emotional surreal atmosphere, luminous floating particles, rich amber and rose tones, ultra detailed",
    linkedin: "high-end photorealistic cyberpunk mecha, futuristic robotics, neon cyberpunk city, reflective wet streets, cinematic rim lighting, holographic glow, ultra detailed"
  }[destination] || "high quality digital illustration";

  return `${topic}, ${styleSuffix}`;
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: [prompt, 0.0, Math.floor(Math.random() * 1e8)] }),
    signal: AbortSignal.timeout(60000),
  });
  if (!startRes.ok) throw new Error(`Hosted start failed: HTTP ${startRes.status}`);
  const { event_id: eventId } = await startRes.json();
  if (!eventId) throw new Error("Hosted: no event_id in response");

  // 2. Read the SSE stream (blocks until the job completes)
  const sseRes = await fetch(`${base}/gradio_api/call/${apiName}/${eventId}`, { signal: AbortSignal.timeout(90000) });
  if (!sseRes.ok) throw new Error(`Hosted SSE failed: HTTP ${sseRes.status}`);
  const text = await sseRes.text();

  // 3. Extract the image URL
  const urlMatches = [...text.matchAll(/"url"\s*:\s*"(https?:[^"\\]+)"/g)].map((m) => m[1].replace(/\\u0026/g, "&"));
  const imageUrl = urlMatches.find((u) => u.includes("/file=")) || urlMatches[urlMatches.length - 1];
  if (!imageUrl) throw new Error("Hosted: could not find image URL in response");

  // 4. Download the image bytes
  const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(60000) });
  if (!imgRes.ok) throw new Error(`Hosted: image download failed HTTP ${imgRes.status}`);
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: [prompt] }),
  });
  if (!startRes.ok) throw new Error(`ZeroGPU start failed: HTTP ${startRes.status}`);
  const startData = await startRes.json();
  const eventId = startData.event_id;
  if (!eventId) throw new Error("ZeroGPU: no event_id in response");

  // 2. Poll the SSE stream until completion (gradio streams result events)
  const sseRes = await fetch(`${base}/gradio_api/call/generate/${eventId}`);
  if (!sseRes.ok) throw new Error(`ZeroGPU SSE failed: HTTP ${sseRes.status}`);
  const text = await sseRes.text();

  // 3. Extract the generated image URL from the completed output
  // Gradio returns the image as {"path": ..., "url": "https://.../file=..."} in the result.
  const urlMatches = [...text.matchAll(/"url"\s*:\s*"(https?:[^"\\]+)"/g)].map((m) => m[1].replace(/\\u0026/g, "&"));
  // Prefer the file= URLs (gradio serves the output image from the file server).
  const imageUrl = urlMatches.find((u) => u.includes("/file=")) || urlMatches[urlMatches.length - 1];
  if (!imageUrl) throw new Error("ZeroGPU: could not find image URL in response");

  // 4. Download the image bytes
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`ZeroGPU: image download failed HTTP ${imgRes.status}`);
  const buf = await imgRes.arrayBuffer();
  return Buffer.from(buf);
}

async function generateImageWithFallback(prompt) {
  // Tier 1: Hosted SDXL-Lightning (24/7, reliable, 1024x1024) — no GPU hosting needed
  try {
    return await generateHostedImage(prompt);
  } catch (err) {
    console.warn(`[Image API] Hosted SDXL-Lightning failed: ${err.message} — trying our ZeroGPU Space...`);
  }

  // Tier 2: Our own ZeroGPU Space (FLUX/DreamShaper, when its GPU allocation is healthy)
  try {
    return await generateZeroGPUImage(prompt);
  } catch (err) {
    console.warn(`[Image API] ZeroGPU failed: ${err.message} — falling back to Pollinations...`);
  }

  // Tier 3: Pollinations (free, always available)
  try {
    return await generateImageFree(prompt);
  } catch (err) {
    console.warn(`[Image API] Pollinations failed: ${err.message} — trying FLUX router...`);
  }

  // Tier 4: FLUX via HF router (requires HF Inference credits)
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

  // Safety net: every Facebook post ends with "Fickle youth", no matter the source.
  if (destinations.includes("facebook")) {
    const sig = "Fickle youth";
    if (!finalContent.trim().toLowerCase().endsWith(sig.toLowerCase())) {
      finalContent = `${finalContent.replace(/\s+$/g, "")}\n\n${sig}`;
    }
  }

  // Final sanity check to guarantee no asterisks or hashtags
  finalContent = cleanPostFormatting(finalContent);

  // 2. Parallel destination execution using Promise.allSettled (Section 4 Latency Budget & Independence)
  const tasks = destinations.map(async (dest) => {
    try {
      const imagePrompt = buildImagePrompt(finalVisualTopic, dest);
      const imageBuffer = await generateImageWithFallback(imagePrompt);

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
  generateImageWithFallback,
  generateHostedImage,
  generateImageFree,
  generateZeroGPUImage
};
