// Temp: check stored cover letters for matched jobs being emailed.
require("dotenv").config();
const db = require("../src/workflows/jobs/db");
const { jobNeedsCoverLetter } = require("../src/workflows/jobs/writer");

(async () => {
  const dbh = await db.getJobsDB();
  const rows = await dbh.all(
    `SELECT a.job_id, a.cover_letter, j.company, j.title, j.description, j.source
     FROM applications a JOIN jobs j ON j.id = a.job_id
     WHERE a.submitted = 0 AND j.status = 'matched' LIMIT 20`
  );
  let empty = 0;
  for (const r of rows) {
    const needs = jobNeedsCoverLetter({ description: r.description });
    const len = (r.cover_letter || "").length;
    if (len < 10) empty++;
    if (needs && len < 10) {
      console.log(`EMPTY-listed: ${r.company} — ${r.title} | needs: ${needs} | len: ${len}`);
    }
  }
  console.log(`checked: ${rows.length} | near-empty letters: ${empty}`);
  process.exit(0);
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
