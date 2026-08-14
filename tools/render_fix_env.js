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
  // 1. Build the env map from local .env
  const envVars = {};
  const missing = [];
  for (const key of REQUIRED) {
    const src = SRC_ALIAS[key] || key;
    const val = (process.env[src] || "").trim();
    if (!val) { missing.push(key); continue; }
    envVars[key] = val;
  }
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

  // 3. Upsert env vars (Render API PUT is an upsert)
  await api(`/services/${svcId}/env-vars`, { method: "PUT", body: JSON.stringify({ envVars }) });
  console.log(`Set ${Object.keys(envVars).length} env vars:`, Object.keys(envVars).map((k) => `${k}=${mask(envVars[k])}`).join("\n  "));

  // 4. Trigger a deploy
  const deploy = await api(`/services/${svcId}/deploys`, { method: "POST", body: JSON.stringify({}) });
  console.log("Deploy triggered:", deploy && (deploy.id || deploy.status || "ok"));

  console.log("\nDone. Wait ~2 min then check https://forchi.onrender.com/status");
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
