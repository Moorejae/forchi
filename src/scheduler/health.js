// src/scheduler/health.js
// Self-healing + diagnostics for ForChi's workflows.
//
// Two capabilities:
//   1. getHealthSnapshot() — a real, current status report ForChi can send the
//      user (covers the SOCIAL auto-post scheduler + the JOBS workflow + DBs).
//   2. repairWorkflows() — deterministic recovery: re-register the social
//      scheduler if missing, clear stuck flags, re-enable auto mode, reconnect
//      the jobs DB, restart the jobs loop. This is what "fix the workflows"
//      / /fix runs, so ForChi can actually repair failures instead of just
//      promising to.
//
// This prevents the class of failure seen on 2026-08-19: a dropped Postgres
// connection crashed the whole process (unhandled 'error'), which took the
// social auto-poster down with it. The crash itself is fixed in jobs/db.js;
// this module makes ForChi able to SEE and REPAIR the workflow state live.

const autoMode = require("./autoMode");
const socialScheduler = require("./jobs"); // the 5x/day social scheduler
const jobsMode = require("../workflows/jobs/jobsMode");
const jobsScheduler = require("../workflows/jobs/scheduler");
const jobsDb = require("../workflows/jobs/db");

const bootTime = Date.now();

// ── Health snapshot ─────────────────────────────────────────────────────────
async function getHealthSnapshot() {
  const social = socialScheduler.getSchedulerState();
  const out = {
    utc: new Date().toISOString(),
    uptimeSec: Math.round(process.uptime()),
    autoMode: autoMode.isEnabled() ? "on" : "off",
    jobsMode: jobsMode.isEnabled() ? "on" : "off",
    social: {
      registered: social.registered,
      running: social.running,
      schedule: social.schedule,
      lastRun: social.lastRun || null,
    },
    jobs: {
      schedulerRunning: jobsScheduler.isJobsSchedulerRunning(),
    },
    db: { jobsDb: "unknown" },
  };

  // Jobs DB probe (uses the reconnect-hardened client; never throws the snapshot).
  try {
    const s = await jobsDb.getStats();
    out.db.jobsDb = "ok";
    out.jobs.totalJobs = s.totalJobs;
    out.jobs.applied = s.applied;
    out.jobs.pendingApply = s.pendingApply;
  } catch (err) {
    out.db.jobsDb = `error: ${err.message}`;
  }
  return out;
}

// ── Repair ──────────────────────────────────────────────────────────────────
// Deterministic recovery actions. Reports what was found + what it fixed.
async function repairWorkflows({ bot } = {}) {
  const actions = [];

  // 1. Auto mode: /fix is an explicit "make it work again" intent → force ON.
  if (!autoMode.isEnabled()) {
    autoMode.setEnabled(true);
    actions.push("auto mode was OFF → turned back ON");
  } else {
    actions.push("auto mode already ON");
  }

  // 2. Social scheduler: clear a stuck flag, then re-register if missing.
  socialScheduler.resetRunning();
  const social = socialScheduler.getSchedulerState();
  if (!social.registered) {
    socialScheduler.reRegister();
    actions.push("social auto-post scheduler was NOT registered → re-registered");
  } else {
    actions.push(`social scheduler registered (last run: ${social.lastRun ? social.lastRun.at : "never"})`);
  }

  // 3. Jobs scheduler: restart it (idempotent) so the loop + daily report recover.
  jobsScheduler.startJobsScheduler({ bot });
  actions.push("jobs scheduler restarted");

  // 4. Jobs DB: force a reconnect-aware health check.
  try {
    const s = await jobsDb.getStats();
    actions.push(`jobs DB ok (applied=${s.applied}, queued=${s.pendingApply})`);
  } catch (err) {
    actions.push(`jobs DB still failing: ${err.message}`);
  }

  return actions;
}

// ── Telegram commands ───────────────────────────────────────────────────────
function registerHealthCommands(bot) {
  // /diag — real health report ForChi can quote.
  bot.command("diag", async (ctx) => {
    const snap = await getHealthSnapshot();
    const s = snap.social;
    const last = s.lastRun;
    const lines = [
      `🩺 *ForChi diagnostics* — ${snap.utc} UTC`,
      `Uptime: ${Math.floor(snap.uptimeSec / 60)}m ${snap.uptimeSec % 60}s`,
      `Auto mode: ${snap.autoMode === "on" ? "ON ✅" : "OFF ⛔"}`,
      `Social scheduler: ${s.registered ? "registered ✅" : "MISSING ⛔"}${s.running ? " (run in progress)" : ""}`,
      `Last auto post: ${last ? `${last.at} · FB ${last.fb} · LI ${last.li}` : "never yet"}`,
      `Jobs mode: ${snap.jobsMode === "on" ? "ON ✅" : "OFF ⛔"}`,
      `Jobs scheduler: ${snap.jobs.schedulerRunning ? "running ✅" : "NOT RUNNING ⛔"}`,
      `Jobs DB: ${snap.db.jobsDb}`,
    ];
    if (snap.jobs.totalJobs != null) lines.push(`Jobs totals: seen ${snap.jobs.totalJobs} · applied ${snap.jobs.applied} · queued ${snap.jobs.pendingApply}`);
    lines.push(`\nSay "fix the workflows" (or /fix) if anything looks broken.`);
    return ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
  });

  // /fix — run the deterministic repair and report what it did.
  bot.command("fix", async (ctx) => {
    const actions = await repairWorkflows({ bot });
    const snap = await getHealthSnapshot();
    return ctx.reply(
      `🔧 *ForChi repair run:*\n` +
      actions.map((a) => `• ${a}`).join("\n") +
      `\n\nNow: auto mode ${snap.autoMode} · social ${snap.social.registered ? "registered ✅" : "MISSING ⛔"} · jobs ${snap.jobs.schedulerRunning ? "running ✅" : "NOT RUNNING ⛔"}`,
      { parse_mode: "Markdown" }
    );
  });
}

module.exports = { getHealthSnapshot, repairWorkflows, registerHealthCommands, bootTime };
