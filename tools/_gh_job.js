// Pick a greenhouse job from the local DB.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const db = require("../src/workflows/jobs/db");
(async () => {
  const jdb = await db.getJobsDB();
  const rows = await jdb.all(`SELECT id, company, title FROM jobs WHERE source = 'greenhouse' ORDER BY id DESC LIMIT 8`);
  for (const r of rows) console.log(`${r.id} | ${r.company} | ${r.title}`);
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
