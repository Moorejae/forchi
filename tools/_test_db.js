// Temp: verify db.js still works on the default SQLite backend after the Postgres refactor.
process.env.JOBS_DB_PATH = "./temp_media/jobs_test.db";
const fs = require("fs");
const db = require("../src/workflows/jobs/db");

(async () => {
  try { fs.rmSync("./temp_media/jobs_test.db", { force: true }); } catch {}

  const sample = [
    { source: "greenhouse", refId: "111", board: "test", company: "ACME", title: "AI Engineer", url: "https://x.example/job/1", location: "Remote", description: "build LLM agents", postedAt: null },
    { source: "lever", refId: "222", board: "test2", company: "Beta", title: "Cloud DevOps Engineer", url: "https://x.example/job/2", location: "Remote", description: "k8s + terraform", postedAt: "2026-08-18T00:00:00Z" },
  ];
  const added1 = await db.insertJobs(sample);
  console.log("first insert added:", added1);
  const added2 = await db.insertJobs(sample);
  console.log("re-insert (should be 0):", added2);
  const stats = await db.getStats();
  console.log("stats:", JSON.stringify(stats));
  const queued = await db.getNewJobs(10);
  console.log("new jobs:", queued.length, "| first:", queued[0].title);
  process.exit(0);
})().catch((e) => { console.error("TEST ERROR:", e.message); process.exit(1); });
