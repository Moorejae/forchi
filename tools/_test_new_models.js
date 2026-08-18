// Temp: confirm gemini-3.7-flash and gemma-4 models actually respond via the key.
require("dotenv").config();
const fs = require("fs");

const MODELS = ["gemini-3.7-flash", "gemma-4-31b-it", "gemma-4-26b-a4b-it", "gemini-3.6-flash"];

(async () => {
  const env = fs.readFileSync(".env", "utf8");
  const m = env.match(/^GEMINI_KEYS=(.+)$/m);
  const key = (m ? m[1] : "").split(",").map((k) => k.trim()).find((k) => k.startsWith("AQ."));

  for (const model of MODELS) {
    const t0 = Date.now();
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: "Reply with exactly: OK" }] }],
            generationConfig: { maxOutputTokens: 20, temperature: 0 },
          }),
          signal: AbortSignal.timeout(30000),
        }
      );
      const d = await res.json();
      const text = (d.candidates?.[0]?.content?.parts || []).map((p) => p.text).join("").trim();
      if (res.ok && text) {
        console.log(`✅ ${model}  → "${text.slice(0, 30)}"  (${Date.now() - t0}ms)`);
      } else {
        const err = (d.error && d.error.message) || res.statusText || JSON.stringify(d).slice(0, 200);
        console.log(`❌ ${model}  → ${err.slice(0, 140)}`);
      }
    } catch (e) {
      console.log(`❌ ${model}  → network error: ${e.message.slice(0, 120)}`);
    }
  }
})();
