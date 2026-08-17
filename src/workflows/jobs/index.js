// Jobs pipeline orchestrator: discover → match → research → write → tailor → apply.
const { discoverJobs } = require("./sources/index");
const db = require("./db");
const { scoreJob } = require("./matcher");
const { researchCompany } = require("./researcher");
const { writeApplication } = require("./writer");
const { tailorResume } = require("./tailor");
const { submitApplication, AUTO_APPLY, DAILY_CAP } = require("./applyEngine");

const MAX_PER_RUN = Number(process.env.JOBS_MAX_PER_RUN || 25);

// Attempt submission for a prepared job. Returns 'applied' | 'prepared' | 'failed'.
async function maybeSubmit(job, app) {
  // HARD RULE — never apply twice (defensive check; DB UNIQUE index is the backstop).
  if (await db.hasApplied(job.id)) {
    await db.setJobStatus(job.id, "applied");
    return "applied";
  }
  const appliedToday = await db.countAppliedToday();
  if (appliedToday >= DAILY_CAP) {
    return "prepared"; // leave queued (matched) — will retry when cap resets
  }
  const res = await submitApplication(job, app);
  if (res.ok) {
    await db.markApplied(job.id, res.response);
    console.log(`[Jobs] ✅ applied ${job.company} / ${job.title} — ${res.response}`);
    return "applied";
  }
  if (res.skipped) {
    console.log(`[Jobs] ⏳ queued ${job.company} / ${job.title} — ${res.response}`);
    return "prepared";
  }
  console.warn(`[Jobs] ❌ submit failed ${job.company} / ${job.title} — ${res.response}`);
  await db.setJobStatus(job.id, "failed");
  return "failed";
}

async function prepareAndSubmit(job) {
  const research = await researchCompany(job.company, job.title);
  const app = await writeApplication({ job, companyResearch: research });
  const tailored = await tailorResume(job);
  await db.storeApplication({
    jobId: job.id,
    coverLetter: app.coverLetter,
    answers: app.answers,
    resumeTailored: tailored,
    companyResearch: research,
  });
  const r = await maybeSubmit(job, app);
  if (r === "applied") await db.setJobStatus(job.id, "applied");
  else if (r === "prepared") await db.setJobStatus(job.id, "matched");
  return r;
}

async function runOnce() {
  console.log(`[Jobs] Pipeline run @ ${new Date().toISOString()} (auto-apply: ${AUTO_APPLY ? "ON" : "DRY-RUN"})`);

  // 1. Discover + dedupe into DB.
  let added = 0;
  try {
    const jobs = await discoverJobs();
    added = await db.insertJobs(jobs);
  } catch (e) {
    console.error("[Jobs] Discovery error:", e.message);
  }
  console.log(`[Jobs] ${added} new jobs inserted.`);

  // 2. Score + prepare + (maybe) apply each NEW job.
  const newJobs = await db.getNewJobs(MAX_PER_RUN);
  const tally = { applied: 0, prepared: 0, skipped: 0, failed: 0 };
  for (const job of newJobs) {
    const m = await scoreJob(job);
    await db.setJobScore(job.id, m.score);
    if (!m.apply) {
      await db.setJobStatus(job.id, "skipped");
      tally.skipped++;
      console.log(`[Jobs] skipped ${job.company} / ${job.title} (score ${m.score}) — ${m.reason || ""}`);
      continue;
    }
    const r = await prepareAndSubmit(job);
    tally[r] = (tally[r] || 0) + 1;
  }

  // 3. Retry already-prepared (matched) jobs when the window/cap opens up.
  const queued = await db.getJobsByStatus("matched");
  for (const job of queued.slice(0, MAX_PER_RUN)) {
    const appRow = await db.getApplicationForJob(job.id);
    if (!appRow) continue;
    const app = {
      coverLetter: appRow.cover_letter,
      answers: appRow.answers ? JSON.parse(appRow.answers) : [],
      resumeTailored: appRow.resume_tailored,
    };
    const r = await maybeSubmit(job, app);
    if (r === "applied") { await db.setJobStatus(job.id, "applied"); tally.applied++; }
    else if (r === "prepared") { await db.setJobStatus(job.id, "matched"); tally.prepared++; }
    else { tally.failed++; }
  }

  console.log(`[Jobs] Run complete: applied=${tally.applied} queued=${tally.prepared} skipped=${tally.skipped} failed=${tally.failed}`);
  return { added, ...tally };
}

// Lightweight status snapshot for commands/digest.
async function statusSummary() {
  const s = await db.getStats();
  return {
    mode: AUTO_APPLY ? "live" : "dry-run",
    cap: DAILY_CAP,
    ...s,
  };
}

module.exports = { runOnce, statusSummary, maybeSubmit };
