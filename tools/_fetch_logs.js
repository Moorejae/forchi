// Temp: fetch recent Render logs for the ForChi service and filter job/workflow lines.
require("dotenv").config();

(async () => {
  const key = process.env.RENDER_API_KEY;
  const owner = process.env.RENDER_OWNER_ID || "tea-d9djf0v41pts73d9d2mg";
  const res = process.env.RENDER_SERVICE_ID || "srv-d9ub5hqd0e5s73aump8g";
  const start = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const url = `https://api.render.com/v1/logs?ownerId=${owner}&resource=${res}&limit=400&startTime=${encodeURIComponent(start)}`;
  const r = await fetch(url, { headers: { Accept: "application/json", Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) { console.log("HTTP", r.status, (await r.text()).slice(0, 300)); process.exit(1); }
  const data = await r.json();
  const lines = Array.isArray(data) ? data : (data.logs || data.items || []);
  console.log("log entries:", lines.length);
  const interesting = lines
    .map((l) => (typeof l === "string" ? l : (l.message || l.text || JSON.stringify(l))))
    .filter((t) => /\[Jobs\]|JobsScheduler|JobsDB|applied|skipped|failed|Discovery|Pipeline run|Run complete/.test(t));
  console.log("interesting:", interesting.length);
  for (const t of interesting.slice(-60)) console.log(t.slice(0, 240));
})();
