// TEMP diagnostic/fix: restore env vars wiped from the forchi Render service.
// Root cause: setRenderEnvVar GETs env-vars then PUTs the list back — but the API
// GET excludes SECRET vars (TELEGRAM_BOT_TOKEN, GEMINI_KEYS, HF_TOKEN...), so the
// PUT silently deleted them from the service config. Every new deploy then boots
// without them and exits 1 ("TELEGRAM_BOT_TOKEN is missing").
//
// Fix: PUT the COMPLETE desired list = current API vars (Render wins on conflict,
// so prod values like JOBS_DATABASE_URL are preserved) + every local .env var that
// is missing + a few render.yaml non-secrets.
require("dotenv").config({ path: ".env" });

const API = "https://api.render.com/v1";
const key = process.env.RENDER_API_KEY;
const id = process.env.RENDER_SERVICE_ID || "srv-d9ub5hqd0e5s73aump8g";

(async () => {
  const got = await (await fetch(`${API}/services/${id}/env-vars`, { headers: { Authorization: `Bearer ${key}` } })).json();
  const current = new Map((Array.isArray(got) ? got : []).map((x) => [x.envVar ? x.envVar.key : x.key, x.envVar ? x.envVar.value : x.value]));

  const out = new Map(current); // Render value wins on conflict
  const localKeys = Object.keys(process.env).filter((k) => k.startsWith("YOUTUBE") || /^(TELEGRAM|GEMINI|HF_|FACEBOOK|LLM_|ZEROGPU|SMTP_|EMAIL_|RESEND|GROQ|SERPER|EXA_|FIRECRAWL|TAVILY|LINKEDIN|DATABASE|AUTO_MODE|CHAT_PROVIDER|NODE_ENV|JOBS_)/.test(k));
  for (const k of localKeys) {
    const v = process.env[k];
    if (v && !out.has(k)) out.set(k, v);
  }
  // HF_TOKEN alias (bot checks HF_TOKEN || HF_ACCESS_TOKEN)
  if (!out.has("HF_TOKEN") && process.env.HF_ACCESS_TOKEN) out.set("HF_TOKEN", process.env.HF_ACCESS_TOKEN);
  // render.yaml non-secrets the app expects
  if (!out.has("DATABASE_PATH")) out.set("DATABASE_PATH", "./data/forchi.db");
  if (!out.has("AUTO_MODE_DEFAULT")) out.set("AUTO_MODE_DEFAULT", "true");
  if (!out.has("CHAT_PROVIDER")) out.set("CHAT_PROVIDER", "gemini");

  const list = [...out.entries()].map(([k, v]) => ({ key: k, value: String(v) }));
  const put = await fetch(`${API}/services/${id}/env-vars`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(list),
  });
  console.log("PUT", put.status);
  if (!put.ok) { console.log((await put.text()).slice(0, 300)); process.exit(1); }
  console.log("total env vars now:", list.length);
  for (const want of ["TELEGRAM_BOT_TOKEN", "GEMINI_KEYS", "HF_TOKEN", "FACEBOOK_PAGE_ID", "YOUTUBE_API_KEY", "YOUTUBE_CALLBACK_URL", "LLM_ENDPOINT", "ZEROGPU_ENDPOINT", "JOBS_DATABASE_URL", "RENDER_API_KEY"]) {
    console.log(`  has ${want}:`, out.has(want));
  }
})();
