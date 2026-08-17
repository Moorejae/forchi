// Temp: full discovery + insert test (no scoring, no applying).
require("dotenv").config();
const { discoverJobs } = require("../src/workflows/jobs/sources/index");
const db = require("../src/workflows/jobs/db");

(async () => {
  const t0 = Date.now();
  const jobs = await discoverJobs();
  console.log(`DISCOVERED ${jobs.length} in ${Date.now() - t0}ms`);
  const bySrc = {};
  for (const j of jobs) bySrc[j.source] = (bySrc[j.source] || 0) + 1;
  console.log("by source:", JSON.stringify(bySrc));

  const added = await db.insertJobs(jobs);
  console.log("NEW rows inserted:", added);

  // Re-insert the same list → should add 0 (URL dedup + unique index).
  const added2 = await db.insertJobs(jobs);
  console.log("Re-insert (should be 0):", added2);

  const stats = await db.getStats();
  console.log("stats:", JSON.stringify(stats));
  process.exit(0);
})().catch((e) => { console.error("TEST ERROR:", e.message); process.exit(1); });
