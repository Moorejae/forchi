// Temp: live jobs summary from the Neon Postgres (applied/emailed/matched/recent).
require("dotenv").config();
const db = require("../src/workflows/jobs/db");

(async () => {
  const s = await db.getStats();
  console.log("TOTAL jobs:", s.totalJobs);
  console.log("APPLIED:", s.applied);
  console.log("EMailed:", await db.countEmailsSent());
  console.log("byStatus:", JSON.stringify(s.byStatus));
  console.log("bySource:", JSON.stringify(s.bySource));

  const applied = await db.getApplied();
  console.log("\nRECENT APPLIED:", applied.length);
  for (const a of applied.slice(0, 10)) console.log(`  ✅ ${a.company} — ${a.title} (${(a.applied_at || "").slice(0, 19)})`);

  const matched = await db.getJobsByStatus("matched", 15);
  console.log("\nRECENT MATCHED (semi-auto email candidates):", matched.length);
  for (const m of matched.slice(0, 10)) console.log(`  📌 ${m.company} — ${m.title} (${m.source}, score ${m.match_score})`);
  process.exit(0);
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
