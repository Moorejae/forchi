// Jobs pipeline orchestrator: discover → match → research → write → tailor → apply.
const { discoverJobs } = require("./sources/index");
const db = require("./db");
const { scoreJob, isLocationAllowed, isIndianJob } = require("./matcher");
const { researchCompany } = require("./researcher");
const { writeApplication } = require("./writer");
const { tailorResume } = require("./tailor");
const { submitApplication, AUTO_APPLY, DAILY_CAP } = require("./applyEngine");
const { sendMatchEmail } = require("./emailer");

const MAX_PER_RUN = Number(process.env.JOBS_MAX_PER_RUN || 40);
// Cap how many match-emails go out per scan (Gmail pacing + resume PDF cost).
const EMAIL_CAP_PER_RUN = Number(process.env.JOBS_EMAIL_CAP_PER_RUN || 10);
// Per-scan auto-apply budget (user rule: ~10 applications per 30 minutes).
const APPLY_PER_RUN = Number(process.env.JOBS_APPLY_PER_RUN || 10);
let appliesThisRun = 0;
// FRESHNESS GATE: never apply to a role older than this (default 14 days).
// Newly-posted roles (24h–2 weeks) are the target; anything older is stale.
const MAX_AGE_DAYS = Number(process.env.JOBS_MAX_AGE_DAYS || 14);
// Sources with a working auto-apply submitter. Greenhouse is EXCLUDED: it has
// no public application-submission API (its embed form is reCAPTCHA-protected
// and the boards-api .../application endpoint returns 404), so every greenhouse
// auto-apply failed. Those roles now flow through the semi-auto email path
// (apply link + tailored resume) so nothing is lost.
const AUTO_SOURCES = ["lever", "workable", "ashby"];

// Semi-auto matches (no trusted submitter) get emailed — one email per job
// (link + cover letter + tailored resume PDF) for manual tap-through apply.
// Returns true if an email was sent.
async function maybeEmailMatch(job) {
  if (AUTO_SOURCES.includes(job.source)) return false; // these auto-apply instead
  if (await db.hasEmailSent(job.id)) return false; // never double-email this row
  // Cross-source guard: if the SAME company+title was already emailed or
  // applied to via another source, don't email it again.
  if (await db.hasSimilarHandled(job.company, job.title)) {
    await db.markEmailSent(job.id);
    console.log(`[Jobs] dedup: already handled ${job.company} / ${job.title} — skipping email`);
    return false;
  }
  const app = await db.getApplicationForJob(job.id);
  if (!app) return false;
  const ok = await sendMatchEmail(job, {
    coverLetter: app.cover_letter,
    resumeTailored: app.resume_tailored,
  });
  if (ok) await db.markEmailSent(job.id);
  return ok;
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
  if (appliesThisRun >= APPLY_PER_RUN) {
    return "prepared"; // per-scan budget used (~10 per 30 min) — retry next scan
  }
  const res = await submitApplication(job, app);
  if (res.ok) {
    await db.markApplied(job.id, res.response);
    appliesThisRun++;
    console.log(`[Jobs] ✅ applied ${job.company} / ${job.title} — ${res.response} (${appliesThisRun}/${APPLY_PER_RUN} this run)`);
    return "applied";
  }
  if (res.skipped) {
    console.log(`[Jobs] ⏳ queued ${job.company} / ${job.title} — ${res.response}`);
    return "prepared";
  }
  console.warn(`[Jobs] ❌ submit failed ${job.company} / ${job.title} — ${res.response}`);
  await db.markApplyError(job.id, res.response);
  return "failed";
}

async function prepareAndSubmit(job) {
  const research = await researchCompany(job.company, job.title);
  const app = await writeApplication({ job, companyResearch: research });
  // Pass the research so the resume's EXPERIENCE section can relate each real
  // build to THIS company's vision (proof the JD was read).
  const tailored = await tailorResume(job, research);
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
  appliesThisRun = 0; // fresh per-scan apply budget

  // 0. Clean stale queued matches so the queue only holds fresh (≤14d) roles.
  try { await db.expireStaleMatched(MAX_AGE_DAYS); } catch (e) { console.warn("[Jobs] expireStaleMatched:", e.message); }

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
    // REGION BLOCK (user rule): India-located roles are skipped before scoring.
    if (isIndianJob(job)) {
      await db.setJobStatus(job.id, "skipped");
      tally.skipped++;
      console.log(`[Jobs] blocked ${job.company} / ${job.title} — India region`);
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

  // 3. Retry already-prepared (matched) jobs: AUTO sources get re-submitted
  //    when the window/cap opens; SEMI-AUTO sources get emailed (covers both
  //    brand-new matches and any that were matched before email was enabled).
  const queued = await db.getJobsByStatus("matched");
  let emailsThisRun = 0;
  for (const job of queued.slice(0, MAX_PER_RUN * 2)) {
    // Freshness gate also applies to queued jobs — a queued role that has since
    // aged past the window is dropped rather than applied to late.
    if (jobAgeDays(job) > MAX_AGE_DAYS) {
      await db.setJobStatus(job.id, "skipped");
      tally.skipped++;
      console.log(`[Jobs] dropped queued ${job.company} / ${job.title} — stale (> ${MAX_AGE_DAYS}d)`);
      continue;
    }
    // Region block also cleans up any already-matched India roles.
    if (isIndianJob(job)) {
      await db.setJobStatus(job.id, "skipped");
      tally.skipped++;
      console.log(`[Jobs] blocked queued ${job.company} / ${job.title} — India region`);
      continue;
    }
    if (AUTO_SOURCES.includes(job.source)) {
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
    } else if (emailsThisRun < EMAIL_CAP_PER_RUN) {
      const sent = await maybeEmailMatch(job);
      if (sent) { emailsThisRun++; tally.emailed = (tally.emailed || 0) + 1; }
    }
  }

  console.log(`[Jobs] Run complete: applied=${tally.applied} emailed=${tally.emailed || 0} queued=${tally.prepared} skipped=${tally.skipped} failed=${tally.failed}`);
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
