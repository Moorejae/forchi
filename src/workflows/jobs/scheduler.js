// Constant-auto scheduler for the jobs workflow — NO manual apply trigger.
// Runs discovery+apply on an interval, plus a morning digest. A /jobs stop
// safety kill-switch is handled in commands.js.
const nodeCron = require("node-cron");
const { runOnce, statusSummary } = require("./index");
const db = require("./db");
const jobsMode = require("./jobsMode");
const notifyTarget = require("./notifyTarget");

let timer = null;
let running = false;

async function runSafe() {
  if (running) return;
  running = true;
  try {
    await runOnce();
  } catch (e) {
    console.error("[JobsScheduler] run error:", e.message);
  } finally {
    running = false;
  }
}

// Daily (every 24h) Telegram report: number of jobs applied + totals.
// Fires at 07:00 UTC = 08:00 WAT, and once shortly after boot if a chat is known.
async function sendDailyReport(bot) {
  const chatId = notifyTarget.getChatId();
  if (!chatId || !bot) {
    console.warn("[JobsScheduler] No report chat id set — skipping 24h report.");
    return;
  }
  try {
    const since = new Date(Date.now() - 86400000).toISOString();
    const last24 = await db.countAppliedSince(since);
    const s = await statusSummary();
    const lines = [
      `📋 *ForChi Jobs — 24h report*`,
      `Applied in last 24h: *${last24}*`,
      `Total applied: ${s.applied}`,
      `Queued to apply: ${s.pendingApply}`,
      `Total jobs seen: ${s.totalJobs}`,
    ];
    await bot.telegram.sendMessage(chatId, lines.join("\n"), { parse_mode: "Markdown" });
    console.log("[JobsScheduler] 24h report sent to", chatId);
  } catch (e) {
    console.warn("[JobsScheduler] daily report error:", e.message);
  }
}

function startJobsScheduler({ bot } = {}) {
  const intervalMin = Math.max(5, Number(process.env.JOBS_SCAN_INTERVAL_MIN || 30));
  console.log(`[JobsScheduler] Constant-AUTO loop every ${intervalMin} min (${jobsMode.isEnabled() ? "ON ✅" : "OFF ⛔"}).`);
  console.log(`[JobsScheduler] Auto-apply: ${(process.env.JOBS_AUTO_APPLY || "false") === "true" ? "LIVE 🚀" : "DRY-RUN (prepares only)"}`);

  // First pass shortly after boot (staggered so it doesn't fight social init).
  setTimeout(() => { if (jobsMode.isEnabled()) runSafe(); }, 20000);

  // Send an initial 24h report shortly after boot if a chat is already known,
  // so the user can confirm the feature works right away.
  setTimeout(() => sendDailyReport(bot), 45000);

  timer = setInterval(() => {
    if (jobsMode.isEnabled()) runSafe();
  }, intervalMin * 60000);

  // Daily (every-24h) report: 07:00 UTC = 08:00 WAT.
  nodeCron.schedule("0 7 * * *", () => sendDailyReport(bot));
}

module.exports = { startJobsScheduler, runSafe, sendDailyReport };
