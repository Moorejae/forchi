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

// Build the daily report text (also used for on-demand "show me the jobs report").
async function buildDailyReportText() {
  const since = new Date(Date.now() - 86400000).toISOString();
  const last24 = await db.countAppliedSince(since);
  const s = await statusSummary();
  const applied = await db.getApplied();
  const dateStr = new Date().toLocaleString("en-GB", {
    timeZone: "Africa/Lagos", weekday: "long", day: "2-digit", month: "short",
    year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const parts = [
    `📋 *ForChi Jobs — Daily Report*`,
    `🗓 ${dateStr} (WAT)`,
    `━━━━━━━━━━━━━━━━━━`,
    `✅ Applied in last 24h: *${last24}*`,
    `📊 Total applied: ${s.applied}`,
    `⏳ Queued to apply: ${s.pendingApply}`,
    `⏭ Skipped: ${(s.byStatus && s.byStatus.skipped) || 0}`,
    `🔍 Total jobs seen: ${s.totalJobs}`,
    `🛰 Mode: ${s.mode} · Cap: ${s.cap}/day`,
  ];
  if (s.bySource && Object.keys(s.bySource).length) {
    const src = Object.entries(s.bySource)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([k, v]) => `${k}=${v}`)
      .join(" · ");
    parts.push(`🗂 Sources: ${src}`);
  }
  if (applied && applied.length) {
    parts.push(`━━━━━━━━━━━━━━━━━━`);
    parts.push(`*Recent applications:*`);
    for (const a of applied.slice(0, 8)) {
      parts.push(`✅ ${a.company} — ${a.title} (score ${a.match_score ?? "?"})`);
    }
  }
  return parts.join("\n");
}

// Daily (every 24h) Telegram report: jobs applied + totals, well organized.
// Fires at 19:00 UTC = 20:00 WAT (8pm Nigerian time), and once shortly after
// boot if a chat is known.
async function sendDailyReport(bot) {
  const chatId = notifyTarget.getChatId();
  if (!chatId || !bot) {
    console.warn("[JobsScheduler] No report chat id set — skipping daily report.");
    return;
  }
  try {
    const text = await buildDailyReportText();
    await bot.telegram.sendMessage(chatId, text, { parse_mode: "Markdown" });
    console.log("[JobsScheduler] daily report sent to", chatId);
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

  // Daily (every-24h) report: 19:00 UTC = 20:00 WAT (8pm Nigerian time).
  nodeCron.schedule("0 19 * * *", () => sendDailyReport(bot));
}

module.exports = { startJobsScheduler, runSafe, sendDailyReport, buildDailyReportText };
