// src/workflows/video/renderEnv.js
// Persist an env var on the forchi Render service (survives redeploys).
// Used by the OAuth callback so YOUTUBE_REFRESH_TOKEN is never lost on deploy.
const API = "https://api.render.com/v1";

async function api(path, opts = {}) {
  const key = (process.env.RENDER_API_KEY || "").trim();
  const res = await fetch(API + path, {
    ...opts,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(`${opts.method || "GET"} ${path} -> ${res.status} ${text.slice(0, 200)}`);
  return json;
}

let serviceIdPromise = null;
function findServiceId() {
  if (!serviceIdPromise) {
    serviceIdPromise = (async () => {
      const services = await api("/services");
      const svc = services.find((s) => (s.name === "forchi" || (s.service && s.service.name === "forchi")));
      const id = svc ? (svc.id || svc.service.id) : null;
      if (!id) throw new Error("forchi Render service not found");
      return id;
    })();
  }
  return serviceIdPromise;
}

// Upsert ONE env var, preserving all existing vars.
async function setRenderEnvVar(key, value) {
  // DANGER — DISABLED. The Render env-var API is a bulk-PUT (GET all -> PUT back),
  // but the GET omits SECRET vars (TELEGRAM_BOT_TOKEN, GEMINI_KEYS, HF_TOKEN...),
  // so writing the list back silently DELETED them from the service config and
  // crashed every deploy ("TELEGRAM_BOT_TOKEN is missing"). On 2026-08-21 this
  // wiped the secrets; they were restored and the YouTube token is now persisted
  // durably in the jobs DB kv store (src/workflows/video/tokenStore.js).
  // NEVER bulk-PUT Render env vars again.
  console.warn(`[renderEnv] setRenderEnvVar("${key}") DISABLED — bulk env-var PUT wipes secrets. Use tokenStore (jobs DB kv) instead.`);
  return false;
}

module.exports = { setRenderEnvVar };
