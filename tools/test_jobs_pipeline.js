// End-to-end dry-run of the jobs pipeline (never submits).
// Usage: node tools/test_jobs_pipeline.js
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const db = require("../src/workflows/jobs/db");
const { discoverJobs } = require("../src/workflows/jobs/sources/index");
const { scoreJob } = require("../src/workflows/jobs/matcher");
const { researchCompany } = require("../src/workflows/jobs/researcher");
const { writeApplication } = require("../src/workflows/jobs/writer");
const { tailorResume } = require("../src/workflows/jobs/tailor");
const { AUTO_APPLY } = require("../src/workflows/jobs/applyEngine");

(async () => {
  console.log("AUTO_APPLY:", AUTO_APPLY, "(must be false for dry-run)");
  await db.getJobsDB();

  const jobs = await discoverJobs();
  console.log("Raw jobs discovered:", jobs.length);

  const added = await db.insertJobs(jobs);
  console.log("New jobs inserted:", added);

  const newJobs = await db.getNewJobs(2);
  console.log("Processing (dry-run):", newJobs.length, "jobs\n");

  for (const job of newJobs) {
    console.log(`=== JOB: ${job.company} | ${job.title} | ${job.source} | board=${job.board} | ref=${job.ref_id}`);
    const m = await scoreJob(job);
    console.log(`score=${m.score} apply=${m.apply}`);
    console.log(`matched: ${m.matched_skills.join(", ")}`);
    console.log(`missing: ${m.missing_skills.join(", ")}`);
    console.log(`reason: ${m.reason}`);

    const research = await researchCompany(job.company, job.title);
    console.log(`company research chars: ${(research || "").length}`);

    const app = await writeApplication({ job, companyResearch: research });
    console.log("--- COVER LETTER ---");
    console.log(app.coverLetter.slice(0, 1100));
    if (app.answers && app.answers.length) {
      console.log(`--- ANSWERS (${app.answers.length}) ---`);
      console.log(JSON.stringify(app.answers).slice(0, 500));
    }

    const tailored = await tailorResume(job);
    console.log("--- TAILORED RESUME (first 600) ---");
    console.log(tailored.slice(0, 600));

    await db.setJobScore(job.id, m.score);
    await db.storeApplication({
      jobId: job.id,
      coverLetter: app.coverLetter,
      answers: app.answers,
      resumeTailored: tailored,
      companyResearch: research,
    });
    await db.setJobStatus(job.id, m.apply ? "matched" : "skipped");
    console.log("stored application (NOT submitted)\n");
  }

  console.log("Stats:", JSON.stringify(await db.getStats()));
  process.exit(0);
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
