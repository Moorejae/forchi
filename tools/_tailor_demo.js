// Demo: tailor the resume for a specific job and print it for inspection.
// Usage: node tools/_tailor_demo.js [jobId]
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const db = require("../src/workflows/jobs/db");
const { tailorResume } = require("../src/workflows/jobs/tailor");

(async () => {
  const jobId = Number(process.argv[2] || 2186);
  const jdb = await db.getJobsDB();
  const job = await jdb.get("SELECT * FROM jobs WHERE id = ?", [jobId]);
  if (!job) { console.error("Job not found:", jobId); process.exit(1); }
  console.log(`JOB: ${job.company} | ${job.title}\n${job.url}\n`);
  const t = await tailorResume(job);
  console.log("=".repeat(20), "TAILORED RESUME", "=".repeat(20));
  console.log(t);
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
