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
  const svcId = await findServiceId();
  const got = await api(`/services/${svcId}/env-vars`);
  const current = (Array.isArray(got) ? got : []).map((x) => ({
    key: x.envVar ? x.envVar.key : x.key,
    value: x.envVar ? x.envVar.value : x.value,
  }));
  const map = new Map(current.map((e) => [e.key, e.value]));
  map.set(key, value);
  const list = [...map.entries()].map(([k, v]) => ({ key: k, value: v }));
  await api(`/services/${svcId}/env-vars`, { method: "PUT", body: JSON.stringify(list) });
  return true;
}

module.exports = { setRenderEnvVar };
