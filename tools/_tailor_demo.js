// Demo: tailor the resume (with company research) for a specific job, print it,
// and render it to a PDF in Downloads.
// Usage: node tools/_tailor_demo.js [jobId]
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const db = require("../src/workflows/jobs/db");
const { researchCompany } = require("../src/workflows/jobs/researcher");
const { tailorResume } = require("../src/workflows/jobs/tailor");
const { getResumeBuffer } = require("../src/workflows/jobs/applyEngine");

(async () => {
  const jobId = Number(process.argv[2] || 1443);
  const job = await db.getJobById(jobId);
  if (!job) { console.error("Job not found:", jobId); process.exit(1); }
  console.log(`JOB: ${job.company} | ${job.title} | ${job.source}\n${job.url}\n`);

  console.log("Researching company…");
  const research = await researchCompany(job.company, job.title);
  console.log("research:", String(research).slice(0, 200), "…\n");

  console.log("Tailoring resume (with research)…");
  const t = await tailorResume(job, research);
  console.log("=".repeat(20), "TAILORED RESUME", "=".repeat(20));
  console.log(t);
  console.log("=".repeat(20), "END (len " + t.length + ")", "=".repeat(20));

  try {
    const buf = await getResumeBuffer(t);
    const out = path.join("C:\\Users\\hp\\Downloads", "ForChi_Tailored_Resume_Demo.pdf");
    fs.writeFileSync(out, buf);
    console.log("PDF saved:", out, `(${buf.length} bytes)`);
  } catch (e) {
    console.log("PDF render failed:", e.message);
  }
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
