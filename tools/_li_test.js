// Temp: verify LinkedIn guest parsing with 24h filter + date regex.
const { fetchLinkedInJobs } = require("../src/workflows/jobs/sources/linkedin");

(async () => {
  const t0 = Date.now();
  const jobs = await fetchLinkedInJobs();
  console.log(`LINKEDIN: ${jobs.length} jobs in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  const withDate = jobs.filter((j) => j.postedAt).length;
  console.log("with postedAt:", withDate);
  for (const j of jobs.slice(0, 8)) {
    console.log(`  • ${j.company} — ${j.title} | ${j.location} | posted ${j.postedAt || "?"}`);
  }
  process.exit(0);
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
