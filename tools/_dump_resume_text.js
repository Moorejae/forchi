// Temp: dump the tailored resume text for a job to a file for inspection.
require("dotenv").config();
const fs = require("fs");
const db = require("../src/workflows/jobs/db");
const { researchCompany } = require("../src/workflows/jobs/researcher");
const { tailorResume } = require("../src/workflows/jobs/tailor");

(async () => {
  const job = await db.getJobById(Number(process.argv[2] || 1443));
  const research = await researchCompany(job.company, job.title);
  const t = await tailorResume(job, research);
  fs.writeFileSync("temp_media/resume_dump.txt", t, "utf8");
  console.log("len:", t.length, "| lines:", t.split("\n").length);
  process.exit(0);
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
