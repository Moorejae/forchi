require("dotenv").config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Blueprint Section 3b: Three-tier waterfall
// Tier 1: Gemini (15 keys × model tiers, cheapest/highest-quota first)
// Tier 2: Gemma 3 27B via HF router (when all Gemini exhausted)
// Tier 3: Llama 3.3 70B via HF router (final fallback)

const GEMINI_MODEL_TIERS = [
  "gemini-2.0-flash-lite",   // highest quota, cheapest
  "gemini-2.0-flash",        // second tier
  "gemini-1.5-flash",        // third tier
];

const HF_FALLBACK_MODELS = [
  "google/gemma-4-26B-A4B-it",          // Gemma 4 26B (latest, via HF router)
  "google/gemma-3-27b-it",              // Gemma 3 27B (primary HF fallback)
  "google/gemma-3n-E4B-it",             // Gemma 3n 4B (fast/cheap)
  "google/gemma-3-12b-it",              // Gemma 3 12B (middle tier)
  "meta-llama/Llama-3.3-70B-Instruct",  // Llama final fallback
  "meta-llama/Llama-3.1-8B-Instruct",   // Llama smaller fallback
];

function getGeminiKeys() {
  const raw = process.env.GEMINI_KEYS || "";
  return raw.split(",").map((k) => k.trim()).filter(Boolean);
}

function getHFToken() {
  return (process.env.HF_TOKEN || process.env.HF_ACCESS_TOKEN || "").trim();
}

// ── Gemini single-key attempt ─────────────────────────────────────────────────
async function callGeminiKey(apiKey, prompt, isJson = false) {
  const genAI = new GoogleGenerativeAI(apiKey);

  for (const modelId of GEMINI_MODEL_TIERS) {
    try {
      console.log(`[Provider] Trying Gemini model "${modelId}"...`);
      const model = genAI.getGenerativeModel({ model: modelId });

      const systemInstruction = isJson
        ? "You are an expert AI parser. Output ONLY raw valid JSON — no markdown, no explanation."
        : "You are ForChi, Victor's intelligent, direct, and friendly workflow agent.";

      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: { temperature: isJson ? 0.0 : 0.7, maxOutputTokens: 600 },
      });

      const text = result.response.text().trim();
      if (!text) throw new Error("Empty response from Gemini");

      console.log(`[Provider] ✅ Gemini "${modelId}" succeeded`);
      return text;
    } catch (err) {
      console.warn(`[Provider] Gemini "${modelId}" error (${err.message}) — rotating...`);
      // Rotate on ANY error (403, 429, 404, network) so the waterfall never freezes
      continue;
    }
  }

  return null; // all tiers on this key exhausted or failed
}

// ── Full Gemini waterfall across configured keys ──────────────────────────────
async function callGemini(prompt, isJson = false) {
  const keys = getGeminiKeys();
  if (!keys.length) {
    console.warn("[Provider] No GEMINI_KEYS configured — skipping Gemini tier");
    return null;
  }

  for (let i = 0; i < keys.length; i++) {
    try {
      const result = await callGeminiKey(keys[i], prompt, isJson);
      if (result !== null) {
        console.log(`[Provider] ✅ Gemini succeeded on key ${i + 1}/${keys.length}`);
        return result;
      }
      console.warn(`[Provider] Gemini key ${i + 1}/${keys.length} exhausted — rotating...`);
    } catch (err) {
      console.warn(`[Provider] Gemini key ${i + 1}/${keys.length} error: ${err.message} — rotating...`);
    }
  }

  console.warn("[Provider] All Gemini keys exhausted — falling back to HF open-weight models");
  return null;
}

// ── HF open-weight fallback (Gemma → Llama) ──────────────────────────────────
async function callHFModel(modelId, prompt, isJson = false) {
  const token = getHFToken();
  const url = "https://router.huggingface.co/v1/chat/completions";

  const systemContent = isJson
    ? "You are an expert AI parser. Output ONLY raw valid JSON — no markdown, no explanation."
    : "You are ForChi, Victor's intelligent, direct, and friendly workflow agent. Speak authentically and directly.";

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: prompt },
      ],
      max_tokens: 600,
      temperature: isJson ? 0.0 : 0.7,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`HF model "${modelId}" HTTP ${res.status}: ${errText.substring(0, 200)}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error(`HF model "${modelId}" returned empty content`);

  return content.trim();
}

async function callHFFallback(prompt, isJson = false) {
  for (const modelId of HF_FALLBACK_MODELS) {
    try {
      console.log(`[Provider] Trying HF fallback model "${modelId}"...`);
      const result = await callHFModel(modelId, prompt, isJson);
      console.log(`[Provider] ✅ HF model "${modelId}" succeeded`);
      return result;
    } catch (err) {
      console.warn(`[Provider] HF model "${modelId}" failed: ${err.message} — trying next...`);
    }
  }
  return null;
}

// ── Main generate() — full three-tier waterfall ───────────────────────────────
async function generate(prompt, responseJsonSchema = null) {
  const isJson = !!responseJsonSchema;

  // Tier 1: Gemini key waterfall
  let result = await callGemini(prompt, isJson);
  if (result) return cleanResponse(result, isJson);

  // Tier 2 + 3: HF open-weight (Gemma → Llama)
  result = await callHFFallback(prompt, isJson);
  if (result) return cleanResponse(result, isJson);

  // All exhausted — return safe defaults, never crash
  console.error("[Provider] ❌ All tiers exhausted.");
  if (isJson) {
    return JSON.stringify({ isPostTrigger: false, destinations: [], content: "" });
  }
  return "I'm having a moment — give me a few seconds and try again.";
}

// ── Gemma direct call — for chatChain.js ONLY (blueprint Section 3b) ─────────
async function callGemmaForChat(prompt) {
  const gemmaModels = [
    "google/gemma-4-26B-A4B-it",
    "google/gemma-3-27b-it",
    "google/gemma-3n-E4B-it",
    "meta-llama/Llama-3.3-70B-Instruct",
  ];

  for (const modelId of gemmaModels) {
    try {
      console.log(`[Chat Provider] Trying "${modelId}"...`);
      const result = await callHFModel(modelId, prompt, false);
      console.log(`[Chat Provider] ✅ "${modelId}" succeeded`);
      return result;
    } catch (err) {
      console.warn(`[Chat Provider] "${modelId}" failed: ${err.message}`);
    }
  }

  return "I'm having a moment — give me a few seconds and try again.";
}

function cleanResponse(text, isJson) {
  if (isJson) {
    return text.replace(/```json\n?/gi, "").replace(/```/g, "").trim();
  }
  return text;
}

module.exports = { generate, callGemmaForChat };
