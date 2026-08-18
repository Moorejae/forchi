// Temp: confirm writeApplication now always produces a non-empty cover letter.
require("dotenv").config();
const db = require("../src/workflows/jobs/db");
const { writeApplication } = require("../src/workflows/jobs/writer");

(async () => {
  const job = await db.getJobById(Number(process.argv[2] || 1443));
  if (!job) { console.log("job not found"); process.exit(1); }
  console.log(`JOB: ${job.company} — ${job.title}`);
  const app = await writeApplication({ job, companyResearch: "Acme builds AI infrastructure for enterprise." });
  console.log("coverLetter len:", (app.coverLetter || "").length);
  console.log("answers count:", (app.answers || []).length);
  console.log("\n--- LETTER (first 600 chars) ---");
  console.log(String(app.coverLetter || "").slice(0, 600));
  process.exit(0);
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
