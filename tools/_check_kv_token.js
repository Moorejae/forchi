// Temp check: confirm the YouTube token persisted to the durable kv table (Postgres).
require("dotenv").config({ path: ".env" });
const { Client } = require("pg");
(async () => {
  const dsn = process.env.JOBS_DATABASE_URL || process.env.JOBS_DATABASE_UR || "";
  if (!dsn) { console.log("no DSN"); return; }
  const c = new Client({ connectionString: dsn, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const r = await c.query("SELECT k, LENGTH(v) AS len, updated_at FROM kv WHERE k LIKE 'youtube%' ORDER BY k");
  console.log("kv rows:", JSON.stringify(r.rows));
  await c.end();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
