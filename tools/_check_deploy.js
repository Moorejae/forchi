// Temp: check recent Render deploys for the forchi service.
require("dotenv").config();
(async () => {
  const key = process.env.RENDER_API_KEY;
  const svc = process.env.RENDER_SERVICE_ID || "srv-d9ub5hqd0e5s73aump8g";
  const res = await fetch(`https://api.render.com/v1/services/${svc}/deploys?limit=4`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20000),
  });
  console.log("status:", res.status);
  const data = await res.json();
  const list = Array.isArray(data) ? data : (data.deploys || data.data || []);
  console.log("count:", list.length);
  for (const entry of list) {
    const d = entry.deploy || entry;
    const id = d.id || "";
    const st = d.status || d.state || "";
    const msg = (d.commit && d.commit.message) || "";
    const at = d.createdAt || "";
    const finished = d.finishedAt || "";
    console.log(String(id).slice(0, 12), "|", st, "|", String(msg).slice(0, 55), "|", at, "| done:", finished);
  }
})();
