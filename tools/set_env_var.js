// Upsert env vars on the forchi Render service, PRESERVING all existing vars.
// Usage: node tools/set_env_var.js KEY=VALUE KEY2=VALUE2
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const API = "https://api.render.com/v1";
const KEY = (process.env.RENDER_API_KEY || "").trim();
if (!KEY) { console.error("RENDER_API_KEY missing in .env"); process.exit(1); }

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* noop */ }
  if (!res.ok) throw new Error(`${opts.method || "GET"} ${path} -> ${res.status} ${text.slice(0, 200)}`);
  return json;
}

(async () => {
  const upserts = {};
  for (const arg of process.argv.slice(2)) {
    const i = arg.indexOf("=");
    if (i < 1) continue;
    upserts[arg.slice(0, i)] = arg.slice(i + 1);
  }
  const keys = Object.keys(upserts);
  if (!keys.length) { console.error("usage: node tools/set_env_var.js KEY=VALUE ..."); process.exit(1); }

  // find service
  const services = await api("/services");
  const svc = services.find((s) => (s.name === "forchi" || (s.service && s.service.name === "forchi")));
  const svcId = svc ? (svc.id || svc.service.id) : null;
  if (!svcId) { console.error("forchi service not found"); process.exit(1); }
  console.log("service:", svcId);

  // read current env, preserve everything
  const got = await api(`/services/${svcId}/env-vars`);
  const current = (Array.isArray(got) ? got : []).map((x) => ({ key: x.envVar ? x.envVar.key : x.key, value: x.envVar ? x.envVar.value : x.value }));
  const map = new Map(current.map((e) => [e.key, e.value]));
  for (const k of keys) map.set(k, upserts[k]);
  const list = [...map.entries()].map(([key, value]) => ({ key, value }));
  console.log(`current vars: ${current.length} -> final: ${list.length}`);

  // PUT replaces ALL — bare array body
  await api(`/services/${svcId}/env-vars`, { method: "PUT", body: JSON.stringify(list) });
  console.log("Set:", keys.join(", "));
  console.log("Done (env updated; no auto-deploy).");
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
