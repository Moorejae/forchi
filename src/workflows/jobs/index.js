// Jobs pipeline orchestrator: discover → match → research → write → tailor → apply.
const { discoverJobs } = require("./sources/index");
const db = require("./db");
const { scoreJob, isLocationAllowed } = require("./matcher");
const { researchCompany } = require("./researcher");
const { writeApplication } = require("./writer");
const { tailorResume } = require("./tailor");
const { submitApplication, AUTO_APPLY, DAILY_CAP } = require("./applyEngine");
const { sendMatchEmail } = require("./emailer");

const MAX_PER_RUN = Number(process.env.JOBS_MAX_PER_RUN || 25);
// FRESHNESS GATE: never apply to a role older than this (default 14 days).
// Newly-posted roles (24h–2 weeks) are the target; anything older is stale.
const MAX_AGE_DAYS = Number(process.env.JOBS_MAX_AGE_DAYS || 14);
// Sources with a trusted auto-apply submitter.
const AUTO_SOURCES = ["greenhouse", "lever", "workable", "ashby"];

// Semi-auto matches (no trusted submitter) get emailed — one email per job
// (link + cover letter + tailored resume PDF) for manual tap-through apply.
async function maybeEmailMatch(job) {
  if (AUTO_SOURCES.includes(job.source)) return; // these auto-apply instead
  if (await db.hasEmailSent(job.id)) return; // never double-email
  const app = await db.getApplicationForJob(job.id);
  if (!app) return;
  const ok = await sendMatchEmail(job, {
    coverLetter: app.cover_letter,
    resumeTailored: app.resume_tailored,
  });
  if (ok) await db.markEmailSent(job.id);
}

// Age of a job in days, using the posting date when the source provides one,
// else the date we first discovered it (created_at) as a proxy. Unknown → 0
// (treated fresh — we can't prove it's stale).
function jobAgeDays(job) {
  const raw = job.posted_at || job.created_at;
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  if (Number.isNaN(t)) return 0;
  return (Date.now() - t) / 86400000;
}

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
    // FRESHNESS GATE: skip stale postings (>MAX_AGE_DAYS old) BEFORE spending
    // a Gemini scoring call. Newly posted roles (24h–2 weeks) are the target.
    const ageDays = jobAgeDays(job);
    if (ageDays > MAX_AGE_DAYS) {
      await db.setJobStatus(job.id, "skipped");
      tally.skipped++;
      console.log(`[Jobs] skipped ${job.company} / ${job.title} — ${Math.round(ageDays)}d old (> ${MAX_AGE_DAYS}d)`);
      continue;
    }
    // HARD LOCATION RULE (backstop, enforced even if the model errs):
    // remote roles only — hybrid/onsite require explicit visa sponsorship.
    if (!isLocationAllowed(job)) {
      await db.setJobStatus(job.id, "skipped");
      tally.skipped++;
      console.log(`[Jobs] skipped ${job.company} / ${job.title} — not remote and no visa sponsorship`);
      continue;
    }
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
    // Semi-auto match (no trusted submitter) → email it (one email per job).
    if (r === "prepared") await maybeEmailMatch(job);
  }

  // 3. Retry already-prepared (matched) jobs when the window/cap opens up.
  //    Only AUTO-APPLIABLE sources are retried; semi-auto sources are emailed
  //    once at match time (maybeEmailMatch) and stay queued as a manual list.
  const queued = (await db.getJobsByStatus("matched")).filter((j) => AUTO_SOURCES.includes(j.source));
  for (const job of queued.slice(0, MAX_PER_RUN)) {
    // Freshness gate also applies to queued jobs — a queued role that has since
    // aged past the window is dropped rather than applied to late.
    if (jobAgeDays(job) > MAX_AGE_DAYS) {
      await db.setJobStatus(job.id, "skipped");
      tally.skipped++;
      console.log(`[Jobs] dropped queued ${job.company} / ${job.title} — stale (> ${MAX_AGE_DAYS}d)`);
      continue;
    }
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

module.exports = { runOnce, statusSummary, maybeSubmit, MAX_AGE_DAYS };
