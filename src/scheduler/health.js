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
const socialScheduler = require("./jobs"); // the 2x/day social scheduler (FB + LI)
const jobsMode = require("../workflows/jobs/jobsMode");
const jobsScheduler = require("../workflows/jobs/scheduler");
const jobsDb = require("../workflows/jobs/db");
const videoWorkflow = require("../workflows/video/index");
const videoScheduler = require("../workflows/video/scheduler");
const vps = require("./vps"); // REAL VPS service health + repair

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
    video: {
      enabled: videoWorkflow.getVideoState().enabled,
      registered: videoScheduler.getSchedulerState().registered,
      lastPost: videoWorkflow.getVideoState().lastPost,
      lastError: videoWorkflow.getVideoState().lastError,
      nextScheduled: videoWorkflow.getVideoState().nextScheduled,
      totalPosts: videoWorkflow.getVideoState().totalPosts,
      consecutiveFailures: videoWorkflow.getVideoState().consecutiveFailures,
    },
    db: { jobsDb: "unknown" },
    vps: { services: {}, qwenPort: false },
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

  // REAL VPS services (qwen LLM, v61 prediction bot) — never throws.
  try {
    out.vps = await vps.getVpsHealth();
  } catch (err) {
    out.vps = { services: {}, qwenPort: false, error: err.message };
  }
  return out;
}

// ── Repair ──────────────────────────────────────────────────────────────────
// Deterministic recovery actions. Reports what was found + what it fixed.
async function repairWorkflows({ bot, notify } = {}) {
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

  // 3b. Video workflow: re-enable + re-register its jitter scheduler.
  if (!videoWorkflow.getVideoState().enabled) {
    videoWorkflow.setEnabled(true);
    actions.push("video workflow was OFF → turned back ON");
  }
  videoScheduler.reRegister({ notify });
  actions.push("video scheduler re-registered");

  // 4. Jobs DB: force a reconnect-aware health check.
  try {
    const s = await jobsDb.getStats();
    actions.push(`jobs DB ok (applied=${s.applied}, queued=${s.pendingApply})`);
  } catch (err) {
    actions.push(`jobs DB still failing: ${err.message}`);
  }

  // 5. REAL VPS services: restart a down qwen / v61-bot.
  const vpsActions = await vps.repairVps();
  actions.push(...vpsActions);

  return actions;
}

// ── Telegram commands ───────────────────────────────────────────────────────
function registerHealthCommands(bot) {
  // /diag — real health report ForChi can quote.
  bot.command("diag", async (ctx) => {
    const snap = await getHealthSnapshot();
    const s = snap.social;
    const last = s.lastRun;
    const v = snap.video;
    const vLast = v.lastPost;
    const vErr = v.lastError;
    const lines = [
      `🩺 *ForChi diagnostics* — ${snap.utc} UTC`,
      `Uptime: ${Math.floor(snap.uptimeSec / 60)}m ${snap.uptimeSec % 60}s`,
      `Auto mode: ${snap.autoMode === "on" ? "ON ✅" : "OFF ⛔"}`,
      `Social scheduler: ${s.registered ? "registered ✅" : "MISSING ⛔"}${s.running ? " (run in progress)" : ""}`,
      `Last auto post: ${last ? `${last.at} · FB ${last.fb} · LI ${last.li}` : "never yet"}`,
      `Video workflow: ${v.enabled ? "ON ✅" : "OFF ⛔"} · scheduler ${v.registered ? "registered ✅" : "MISSING ⛔"}`,
      `Last Short: ${vLast ? `${vLast.at} · ${vLast.topic} · ${vLast.url}` : "never yet"}${v.totalPosts ? ` (${v.totalPosts} total)` : ""}`,
      vErr ? `⚠️ Last video error: ${vErr.message}` : `Next Short: ${v.nextScheduled ? v.nextScheduled : "not scheduled"}`,
      `Jobs mode: ${snap.jobsMode === "on" ? "ON ✅" : "OFF ⛔"}`,
      `Jobs scheduler: ${snap.jobs.schedulerRunning ? "running ✅" : "NOT RUNNING ⛔"}`,
      `Jobs DB: ${snap.db.jobsDb}`,
    ];
    const vpsSnap = snap.vps || {};
    const svc = vpsSnap.services || {};
    lines.push(
      `VPS services: forchi ${svc.forchi === undefined ? "?" : svc.forchi ? "✅" : "⛔"} · qwen ${svc.qwen === undefined ? "?" : svc.qwen ? "✅" : "⛔"}${vpsSnap.qwenPort ? " (port 8080)" : ""} · v61-bot ${svc.v61bot === undefined ? "?" : svc.v61bot ? "✅" : "⛔"}`
    );
    if (snap.jobs.totalJobs != null) lines.push(`Jobs totals: seen ${snap.jobs.totalJobs} · applied ${snap.jobs.applied} · queued ${snap.jobs.pendingApply}`);
    lines.push(`\nSay "fix the workflows" (or /fix) if anything looks broken.`);
    return ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
  });

  // /fix — run the deterministic repair and report what it did.
  bot.command("fix", async (ctx) => {
    const { notifyTarget } = require("../workflows/jobs/notifyTarget");
    const actions = await repairWorkflows({ bot, notify: (t) => notifyTarget.sendMessage(t) });
    const snap = await getHealthSnapshot();
    return ctx.reply(
      `🔧 *ForChi repair run:*\n` +
      actions.map((a) => `• ${a}`).join("\n") +
      `\n\nNow: auto mode ${snap.autoMode} · social ${snap.social.registered ? "registered ✅" : "MISSING ⛔"} · jobs ${snap.jobs.schedulerRunning ? "running ✅" : "NOT RUNNING ⛔"} · video ${snap.video.enabled ? "ON ✅" : "OFF ⛔"}`,
      { parse_mode: "Markdown" }
    );
  });
}

module.exports = { getHealthSnapshot, repairWorkflows, registerHealthCommands, bootTime };
