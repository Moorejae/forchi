// Demo: tailored resume + cover letter for a job, for inspection.
// Usage: node tools/_apply_demo.js [jobId]
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const db = require("../src/workflows/jobs/db");
const { tailorResume } = require("../src/workflows/jobs/tailor");
const { writeApplication } = require("../src/workflows/jobs/writer");
const { researchCompany } = require("../src/workflows/jobs/researcher");

(async () => {
  const jobId = Number(process.argv[2] || 2186);
  const jdb = await db.getJobsDB();
  const job = await jdb.get("SELECT * FROM jobs WHERE id = ?", [jobId]);
  if (!job) { console.error("Job not found:", jobId); process.exit(1); }
  console.log(`JOB: ${job.company} | ${job.title}\n${job.url}\n`);

  const research = await researchCompany(job.company, job.title);
  const app = await writeApplication({ job, companyResearch: research });
  console.log("=".repeat(18), "COVER LETTER", "=".repeat(18));
  console.log(app.coverLetter);
  if (app.answers && app.answers.length) {
    console.log("\n--- ANSWERS ---");
    for (const a of app.answers) console.log(`Q: ${a.question}\nA: ${a.answer}\n`);
  }

  const t = await tailorResume(job);
  console.log("=".repeat(18), "TAILORED RESUME", "=".repeat(18));
  console.log(t);
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
