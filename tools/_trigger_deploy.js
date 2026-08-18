// Temp: trigger a fresh deploy of the forchi service via the Render API.
require("dotenv").config();

(async () => {
  const key = (process.env.RENDER_API_KEY || "").trim();
  const svc = process.env.RENDER_SERVICE_ID || "srv-d9ub5hqd0e5s73aump8g";
  const res = await fetch(`https://api.render.com/v1/services/${svc}/deploys`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(30000),
  });
  const txt = await res.text();
  console.log("trigger:", res.status, txt.slice(0, 200));
})();
