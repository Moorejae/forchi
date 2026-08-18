// Temp: list the env var KEYS actually on the Render service (values masked).
require("dotenv").config();

(async () => {
  const key = (process.env.RENDER_API_KEY || "").trim();
  const svc = process.env.RENDER_SERVICE_ID || "srv-d9ub5hqd0e5s73aump8g";
  const res = await fetch(`https://api.render.com/v1/services/${svc}/env-vars`, {
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) { console.log("HTTP", res.status, (await res.text()).slice(0, 200)); process.exit(1); }
  const body = await res.json();
  const list = (Array.isArray(body) ? body : []).map((x) => ({
    key: x.envVar ? x.envVar.key : x.key,
    value: x.envVar ? x.envVar.value : x.value,
  }));
  console.log("env var count:", list.length);
  for (const e of list) {
    const v = e.value || "";
    const masked = v.length > 8 ? v.slice(0, 4) + "..." + v.slice(-4) : (v ? "***" : "(empty)");
    console.log(`  ${e.key}=${masked}`);
  }
})();
