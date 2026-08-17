// Find a good demo job: relevant title at a named ATS company.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const db = require("../src/workflows/jobs/db");

(async () => {
  const jdb = await db.getJobsDB();
  const rows = await jdb.all(
    `SELECT id, company, title, source FROM jobs
     WHERE status = 'new'
       AND (title LIKE '%AI Engineer%' OR title LIKE '%Cloud Engineer%' OR title LIKE '%DevOps%'
            OR title LIKE '%Automation%' OR title LIKE '%ML Engineer%' OR title LIKE '%Backend%'
            OR title LIKE '%LLM%' OR title LIKE '%Machine Learning%')
       AND source IN ('greenhouse','lever')
     ORDER BY id DESC LIMIT 12`
  );
  for (const r of rows) console.log(`${r.id} | ${r.company} | ${r.title} | ${r.source}`);
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
