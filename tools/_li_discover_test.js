// Temp: end-to-end test of new LinkedIn + aggregator sources.
require("dotenv").config();
const { fetchLinkedInJobs } = require("../src/workflows/jobs/sources/linkedin");
const { fetchAggregators } = require("../src/workflows/jobs/sources/aggregators");

(async () => {
  const t0 = Date.now();
  const agg = await fetchAggregators();
  const bySrc = {};
  for (const j of agg) bySrc[j.source] = (bySrc[j.source] || 0) + 1;
  console.log(`AGGREGATORS: ${agg.length} in ${Date.now() - t0}ms`, JSON.stringify(bySrc));

  const t1 = Date.now();
  const li = await fetchLinkedInJobs();
  console.log(`LINKEDIN: ${li.length} in ${Date.now() - t1}ms`);
  for (const j of li.slice(0, 6)) {
    console.log("  •", j.company, "—", j.title, "|", j.location, "|", j.postedAt);
    console.log("     ", j.url, "| desc:", (j.description || "").slice(0, 70).replace(/\s+/g, " "));
  }
})();
