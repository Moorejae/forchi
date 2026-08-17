// Auto-fix: set all ForChi env vars on Render via the Render API, then trigger a deploy.
// Requires RENDER_API_KEY (rnd_...) in .env (create at https://dashboard.render.com/api).
// Usage: node tools/render_fix_env.js
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const API = "https://api.render.com/v1";
const KEY = (process.env.RENDER_API_KEY || "").trim();
if (!KEY) {
  console.error("RENDER_API_KEY not found in .env");
  console.error('Add a line like  RENDER_API_KEY=rnd_xxxx  to your .env and re-run.');
  process.exit(1);
}

const REQUIRED = [
  "TELEGRAM_BOT_TOKEN",
  "GEMINI_KEYS",
  "HF_TOKEN",
  "FACEBOOK_PAGE_ID",
  "FACEBOOK_PAGE_ACCESS_TOKEN",
  "LINKEDIN_ACCESS_TOKEN",
  "LINKEDIN_AUTHOR_URN",
  "GROQ_API_KEY",
  "SERPER_API_KEY",
  "EXA_API_KEY",
  "FIRECRAWL_API_KEY",
  "TAVILY_API_KEY",
];
const SRC_ALIAS = { HF_TOKEN: "HF_ACCESS_TOKEN" };

// Non-secret service vars — MUST be re-sent because the bulk PUT replaces the
// entire list (any var not included is deleted from the service).
const PLAIN = [
  ["NODE_ENV", "production"],
  ["DATABASE_PATH", "./data/forchi.db"],
  ["AUTO_MODE_DEFAULT", "true"],
  ["CHAT_PROVIDER", "gemini"],
  ["LLM_ENDPOINT", process.env.LLM_ENDPOINT || "https://slymun-forchi.hf.space"],
  ["ZEROGPU_ENDPOINT", process.env.ZEROGPU_ENDPOINT || "https://slymun-forchi-img.hf.space"],
  // Jobs workflow: OFF by default until tests pass; never auto-apply by default.
  ["JOBS_MODE_DEFAULT", "false"],
  ["JOBS_AUTO_APPLY", "false"],
];

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  if (!res.ok) throw new Error(`${opts.method || "GET"} ${path} -> ${res.status} ${text.slice(0, 200)}`);
  return json;
}

function mask(v) {
  if (!v) return "";
  return v.length <= 8 ? "***" : v.slice(0, 4) + "..." + v.slice(-4);
}

(async () => {
  // 1. Build the full list from local .env (secrets) + non-secret service vars
  const list = [];
  const missing = [];
  for (const key of REQUIRED) {
    const src = SRC_ALIAS[key] || key;
    const val = (process.env[src] || "").trim();
    if (!val) { missing.push(key); continue; }
    list.push({ key, value: val });
  }
  for (const [key, val] of PLAIN) list.push({ key, value: val });
  if (missing.length) {
    console.error(`MISSING from .env: ${missing.join(", ")}`);
    process.exit(1);
  }

  // 2. Find the forchi service
  const services = await api("/services");
  const svc = services.find((s) => s.name === "forchi" || (s.service && s.service.name === "forchi"));
  const svcId = svc ? (svc.id || svc.service.id) : null;
  if (!svcId) {
    console.error("Could not find a Render service named 'forchi'. Services:", services.map((s) => s.id || s.service.id).join(", "));
    process.exit(1);
  }
  console.log("Found service:", svcId);

  // 3. Replace ALL env vars — Render API expects a BARE array as the JSON body
  await api(`/services/${svcId}/env-vars`, { method: "PUT", body: JSON.stringify(list) });
  console.log(`Set ${list.length} env vars:`);
  for (const e of list) console.log(`  ${e.key}=${mask(e.value)}`);

  // 4. Verify what's actually on the service now
  const got = await api(`/services/${svcId}/env-vars`);
  const keys = (Array.isArray(got) ? got : []).map((x) => (x.envVar ? x.envVar.key : x.key));
  console.log("Verified on Render:", keys.join(", "));

  // 5. Trigger a deploy
  const deploy = await api(`/services/${svcId}/deploys`, { method: "POST", body: JSON.stringify({}) });
  console.log("Deploy triggered:", deploy && (deploy.id || deploy.status || "ok"));

  console.log("\nDone. Wait ~2 min then check https://forchi.onrender.com/status");
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
