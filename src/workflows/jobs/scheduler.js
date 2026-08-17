// Constant-auto scheduler for the jobs workflow — NO manual apply trigger.
// Runs discovery+apply on an interval, plus a morning digest. A /jobs stop
// safety kill-switch is handled in commands.js.
const nodeCron = require("node-cron");
const { runOnce, statusSummary } = require("./index");
const db = require("./db");
const jobsMode = require("./jobsMode");

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

async function sendMorningDigest(bot) {
  const chatId = (process.env.JOBS_NOTIFY_CHAT_ID || "").trim();
  if (!chatId || !bot) return;
  try {
    const s = await statusSummary();
    const applied = await db.getApplied();
    const lines = [];
    lines.push(`📋 *ForChi Jobs — morning digest*`);
    lines.push(`Mode: ${s.mode} · Cap: ${s.cap}/day`);
    lines.push(`Applied: ${s.applied} · Queued: ${s.pendingApply} · Total seen: ${s.totalJobs}`);
    for (const a of applied.slice(0, 8)) {
      lines.push(`✅ ${a.company} — ${a.title} (score ${a.match_score ?? "?"})`);
    }
    await bot.telegram.sendMessage(chatId, lines.join("\n"), { parse_mode: "Markdown" });
  } catch (e) {
    console.warn("[JobsScheduler] digest error:", e.message);
  }
}

function startJobsScheduler({ bot } = {}) {
  const intervalMin = Math.max(5, Number(process.env.JOBS_SCAN_INTERVAL_MIN || 30));
  console.log(`[JobsScheduler] Constant-AUTO loop every ${intervalMin} min (${jobsMode.isEnabled() ? "ON ✅" : "OFF ⛔"}).`);
  console.log(`[JobsScheduler] Auto-apply: ${(process.env.JOBS_AUTO_APPLY || "false") === "true" ? "LIVE 🚀" : "DRY-RUN (prepares only)"}`);

  // First pass shortly after boot (staggered so it doesn't fight social init).
  setTimeout(() => { if (jobsMode.isEnabled()) runSafe(); }, 20000);

  timer = setInterval(() => {
    if (jobsMode.isEnabled()) runSafe();
  }, intervalMin * 60000);

  // Morning digest: 07:00 UTC = 08:00 WAT.
  nodeCron.schedule("0 7 * * *", () => sendMorningDigest(bot));
}

module.exports = { startJobsScheduler, runSafe };
