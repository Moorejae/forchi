// Test: fetch a real ATS form schema and see how the agent fills it.
// Usage: node tools/_form_demo.js [jobId]
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const db = require("../src/workflows/jobs/db");
const { buildFormData, fetchFormSchema } = require("../src/workflows/jobs/applyEngine");

(async () => {
  const jobId = Number(process.argv[2] || 2172);
  const jdb = await db.getJobsDB();
  const job = await jdb.get("SELECT * FROM jobs WHERE id = ?", [jobId]);
  if (!job) { console.error("Job not found:", jobId); process.exit(1); }
  console.log(`JOB: ${job.source} | ${job.company} | ${job.title}\n`);

  const schema = await fetchFormSchema(job);
  console.log(`Form schema fields: ${schema ? schema.length : "unknown (fallback)"}`);
  if (schema && schema.length) {
    console.log("Sample schema fields:");
    for (const f of schema.slice(0, 10)) console.log(`  key=${f.key} | label="${f.label}" | req=${f.required}`);
  }

  const app = {
    coverLetter: "",
    answers: [
      { question: "Why are you a good fit for this role?", answer: "I build reliable, production-grade AI infrastructure and multi-agent systems." },
      { question: "What is your salary expectation?", answer: "I am flexible and open to market rate." },
    ],
  };
  const ensure = job.source === "greenhouse"
    ? { email: "email", firstName: "first_name", lastName: "last_name", phone: "phone" }
    : { fullName: "name", email: "email", phone: "phone", location: "org" };
  const fields = await buildFormData(job, app, ensure);
  console.log("\nForm fields the agent would submit:");
  for (const [k, v] of fields) console.log(`  ${k} = ${v}`);
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
