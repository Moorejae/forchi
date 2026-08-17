// Demo: full flow for one job — cover letter + tailored resume rendered to a real PDF.
// Usage: node tools/_pdf_demo.js [jobId]
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const db = require("../src/workflows/jobs/db");
const { tailorResume } = require("../src/workflows/jobs/tailor");
const { writeApplication } = require("../src/workflows/jobs/writer");
const { researchCompany } = require("../src/workflows/jobs/researcher");
const { getResumeBuffer } = require("../src/workflows/jobs/applyEngine");

(async () => {
  const jobId = Number(process.argv[2] || 2172);
  const jdb = await db.getJobsDB();
  const job = await jdb.get("SELECT * FROM jobs WHERE id = ?", [jobId]);
  if (!job) { console.error("Job not found:", jobId); process.exit(1); }
  console.log(`JOB: ${job.company} | ${job.title}\n${job.url}\n`);

  // 1. Cover letter
  const research = await researchCompany(job.company, job.title);
  const app = await writeApplication({ job, companyResearch: research });
  console.log("=".repeat(18), "COVER LETTER", "=".repeat(18));
  console.log(app.coverLetter + "\n");

  // 2. Tailored resume
  const tailored = await tailorResume(job);
  console.log("=".repeat(18), "TAILORED RESUME (text)", "=".repeat(18));
  console.log(tailored + "\n");

  // 3. Render to PDF (same path the apply engine uses)
  const buf = await getResumeBuffer(tailored);
  const out = path.join("C:\\Users\\hp\\Downloads", "ForChi_Tailored_Resume_Demo.pdf");
  fs.writeFileSync(out, buf);
  console.log(`PDF written: ${out} (${(buf.length / 1024).toFixed(1)} KB)`);
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
