// Temp: authenticated FLUX generation against the ForChi ZeroGPU img Space.
// Auth: x-hf-authorization: Bearer <HF_ACCESS_TOKEN> on POST, poll, and download.
require("dotenv").config();
const fs = require("fs");

const BASE = "https://slymun-forchi-img.hf.space";
const TOKEN = (process.env.HF_ACCESS_TOKEN || process.env.HF_TOKEN || "").trim();
const PROMPT = process.argv[2] || "somber anime character with short hair looking down, glowing cyan-teal rim light, dark moody background, wind in hair, high-end anime art, cinematic, emotional, detailed";
const OUT = process.argv[3] || "temp_media/flux_auth_test.png";

const H = { "Content-Type": "application/json", "x-hf-authorization": `Bearer ${TOKEN}`, "User-Agent": "Mozilla/5.0" };
const HGET = { "x-hf-authorization": `Bearer ${TOKEN}`, "User-Agent": "Mozilla/5.0" };

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  if (!TOKEN) { console.log("NO HF TOKEN"); process.exit(1); }
  console.log("POST /generate ...");
  const post = await fetch(`${BASE}/gradio_api/call/generate`, {
    method: "POST", headers: H, body: JSON.stringify({ data: [PROMPT] }), signal: AbortSignal.timeout(120000),
  });
  if (!post.ok) { console.log("POST", post.status, (await post.text()).slice(0, 300)); process.exit(1); }
  const { event_id } = await post.json();
  console.log("event_id:", event_id);

  const t0 = Date.now();
  for (let i = 0; i < 200; i++) {
    try {
      const s = await fetch(`${BASE}/gradio_api/call/generate/${event_id}`, { headers: HGET, signal: AbortSignal.timeout(120000) });
      if (!s.ok) { console.log(`poll ${i}: HTTP ${s.status} — retry`); await sleep(4000); continue; }
      const text = await s.text();
      let found = null;
      for (const line of text.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === "[DONE]") continue;
        try {
          const arr = JSON.parse(raw);
          for (const item of Array.isArray(arr) ? arr : [arr]) {
            if (item && typeof item === "object") {
              const u = item.url || (item.path && item.path.startsWith("http") ? item.path : null);
              if (u) found = u;
            }
          }
        } catch { /* partial json */ }
      }
      if (found) {
        const img = await fetch(found.startsWith("http") ? found : `${BASE}${found}`, { headers: HGET, signal: AbortSignal.timeout(120000) });
        if (!img.ok) { console.log("img dl HTTP", img.status); process.exit(1); }
        fs.writeFileSync(OUT, Buffer.from(await img.arrayBuffer()));
        console.log(`DONE in ${((Date.now() - t0) / 1000).toFixed(0)}s -> ${OUT}`);
        process.exit(0);
      }
      if (text.includes("error")) console.log(`poll ${i}: ${text.slice(0, 150)}`);
    } catch (e) {
      console.log(`poll ${i} err (retry): ${e.message.slice(0, 80)}`);
    }
    await sleep(4000);
  }
  console.log("FAILED: no image within budget");
  process.exit(1);
})();
