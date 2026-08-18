// /jobs Telegram commands. The jobs workflow has NO manual apply trigger —
// the only controls here are an emergency stop/start, plus read-only views.
const db = require("./db");
const jobsMode = require("./jobsMode");
const notifyTarget = require("./notifyTarget");
const { runOnce, statusSummary, MAX_AGE_DAYS } = require("./index");
const { AUTO_APPLY, DAILY_CAP, inApplyWindow } = require("./applyEngine");

async function formatStatus() {
  const s = await statusSummary();
  const byStatus = s.byStatus || {};
  const emailed = await db.countEmailsSent();
  const lines = [
    `🤖 *ForChi Jobs agent*`,
    `State: ${jobsMode.isEnabled() ? "RUNNING ✅" : "STOPPED ⛔"} · Apply: ${s.mode}`,
    `Cap: ${s.cap}/day · Window: ${inApplyWindow() ? "open now" : "closed (08:00–20:00 WAT)"}`,
    `Fresh: applies to roles ≤ ${MAX_AGE_DAYS}d old`,
    `Total jobs: ${s.totalJobs} · Applied: ${s.applied} · Emailed: ${emailed} · Queued: ${s.pendingApply}`,
    `By status: ${Object.entries(byStatus).map(([k, v]) => `${k}=${v}`).join(", ")}`,
  ];
  return lines.join("\n");
}

async function listQueue() {
  const rows = await db.getJobsByStatus("matched", 15);
  if (!rows.length) return "No jobs queued for apply.";
  const AUTO_SOURCES = ["greenhouse", "lever", "workable", "ashby"];
  const lines = rows.map((j) => {
    const auto = AUTO_SOURCES.includes(j.source);
    const tag = auto ? "" : "· 🔗 manual apply";
    return `• ${j.company} — ${j.title} (score ${j.match_score ?? "?"})${tag}\n   ${j.url}`;
  });
  return "📥 *Queued for apply:*\n" + lines.join("\n");
}

async function listApplied() {
  const rows = await db.getApplied();
  if (!rows.length) return "No applications submitted yet.";
  return "✅ *Applied:*\n" + rows.map((j) => `• ${j.company} — ${j.title} (${(j.applied_at || "").slice(0, 10)})`).join("\n");
}

function registerJobsCommands(bot) {
  bot.command("jobs", async (ctx) => {
    try {
      const args = (ctx.message.text || "").trim().split(/\s+/).slice(1);
      const cmd = (args[0] || "status").toLowerCase();
      // Any /jobs message auto-registers this chat for the 24h report.
      notifyTarget.setChatId(ctx.chat && ctx.chat.id);
      const help =
        `*Jobs commands:*\n` +
        `/jobs status — pipeline state\n` +
        `/jobs queue — jobs queued for apply\n` +
        `/jobs applied — applications submitted\n` +
        `/jobs notify — send the daily 24h report to this chat\n` +
        `/jobs stop — EMERGENCY stop\n` +
        `/jobs start — resume constant auto\n` +
        `/jobs scan — force one scan (prepares only, never submits out of auto rules)`;
      switch (cmd) {
        case "status":
          return ctx.reply(await formatStatus(), { parse_mode: "Markdown" });
        case "queue":
          return ctx.reply(await listQueue(), { parse_mode: "Markdown" });
        case "applied":
          return ctx.reply(await listApplied(), { parse_mode: "Markdown" });
        case "stop":
          jobsMode.setEnabled(false);
          console.log(`[Jobs] User ${ctx.from?.id} EMERGENCY stopped jobs agent.`);
          return ctx.reply("Jobs agent STOPPED (emergency). Use /jobs start to resume.");
        case "start":
          jobsMode.setEnabled(true);
          console.log(`[Jobs] User ${ctx.from?.id} started jobs agent.`);
          return ctx.reply("Jobs agent RUNNING on constant auto.");
        case "scan":
          ctx.reply("Scanning now (this prepares matches + queued applications; it respects dry-run/window/cap)…").catch(() => {});
          runOnce().then(() => ctx.reply("Scan complete.").catch(() => {})).catch(() => {});
          return;
        case "notify":
          notifyTarget.setChatId(ctx.chat && ctx.chat.id);
          return ctx.reply("✅ This chat will receive the ForChi Jobs 24h report (jobs applied count) every day at 08:00 WAT.");
        default:
          return ctx.reply(help, { parse_mode: "Markdown" });
      }
    } catch (e) {
      console.error("[Jobs] command error:", e.message);
      return ctx.reply("Jobs command errored — check logs.");
    }
  });
}

module.exports = { registerJobsCommands };
