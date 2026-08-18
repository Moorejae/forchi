// Temp: verify the Neon Postgres DSN connects and db.js works in PG mode.
require("dotenv").config();
const db = require("../src/workflows/jobs/db");

(async () => {
  const g = await db.getJobsDB();
  console.log("DB opened. Running reads...");
  const stats = await db.getStats();
  console.log("stats:", JSON.stringify(stats));
  const n = await db.getNewJobs(5);
  console.log("new jobs:", n.length);
  console.log("✅ PG MODE WORKS");
  process.exit(0);
})().catch((e) => { console.error("❌ PG FAILED:", e.message); process.exit(1); });
