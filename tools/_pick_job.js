// Helper: list relevant ATS jobs in the local DB (for inspecting tailored resumes).
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const db = require("../src/workflows/jobs/db");

(async () => {
  const jdb = await db.getJobsDB();
  const rows = await jdb.all(
    `SELECT id, source, company, title, url, location FROM jobs
     WHERE status = 'new'
       AND (title LIKE '%AI%' OR title LIKE '%cloud%' OR title LIKE '%automation%'
            OR title LIKE '%backend%' OR title LIKE '%devops%' OR title LIKE '%engineer%'
            OR title LIKE '%LLM%' OR title LIKE '%ML%' OR title LIKE '%machine learning%')
       AND source IN ('greenhouse','lever','ashby','workable')
     ORDER BY id DESC LIMIT 15`
  );
  for (const r of rows) console.log(`${r.id} | ${r.company} | ${r.title} | ${r.source}`);
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
