require("dotenv").config();
const http = require("http");
const https = require("https");
const dns = require("dns");
const { Telegraf } = require("telegraf");
const { passesGate } = require("./router/gate");
const { extractPostIntent } = require("./router/extractor");
const { detectAutoModeToggle } = require("./router/autoModeToggle");
const { detectJobsToggle, detectJobsReport } = require("./router/jobsToggle");
const { buildDailyReportText } = require("./workflows/jobs/scheduler");
const { chatReply } = require("./llm/chatChain");
const socialWorkflow = require("./workflows/social/index");
const { processVoiceMessage } = require("./voice/transcriber");
const { initScheduler, reRegister, getSchedulerState } = require("./scheduler/jobs");
const autoMode = require("./scheduler/autoMode");
const health = require("./scheduler/health");
const { detectDiagRequest, detectRepairRequest } = require("./router/healthIntent");
const db = require("./store/db");
const jobsScheduler = require("./workflows/jobs/scheduler");
const { registerJobsCommands } = require("./workflows/jobs/commands");
const jobsMode = require("./workflows/jobs/jobsMode");
const jobsNotify = require("./workflows/jobs/notifyTarget");

// Force IPv4 for DNS resolution (avoids IPv6 timeouts in containers)
if (dns.setDefaultResultOrder) dns.setDefaultResultOrder("ipv4first");

// ── Process-level crash guards ──────────────────────────────────────────────
// This bot runs the social auto-post scheduler + the jobs agent. A single stray
// error must never take the whole process (and both workflows) down. Log loudly,
// keep serving — the schedulers each have their own try/catch for real work.
process.on("unhandledRejection", (reason, promise) => {
  console.error("[ProcessGuard] Unhandled rejection (kept alive):", reason instanceof Error ? reason.stack || reason.message : reason);
});
process.on("uncaughtException", (err) => {
  console.error("[ProcessGuard] Uncaught exception (kept alive):", err.stack || err.message);
});

console.log(`\n===== ForChi Telegram Bot Startup =====\n`);
console.log("[DIAG] TELEGRAM_BOT_TOKEN present:", !!process.env.TELEGRAM_BOT_TOKEN);
console.log("[DIAG] GEMINI_KEYS count:", (process.env.GEMINI_KEYS || "").split(",").filter(Boolean).length);
console.log("[DIAG] HF_TOKEN present:", !!(process.env.HF_TOKEN || process.env.HF_ACCESS_TOKEN));

const token = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
if (!token) {
  console.error("[FATAL] TELEGRAM_BOT_TOKEN is missing. Set it in .env or the host's env vars.");
  process.exit(1);
}

// Optional custom API base (proxy) — defaults to the official Telegram API.
const apiBase = (process.env.TELEGRAM_API_BASE || "https://api.telegram.org").trim();
console.log("[DIAG] Using Telegram API Base:", apiBase);

// Custom HTTPS agent: force IPv4, disable keep-alive (avoids stale socket resets)
const telegramAgent = new https.Agent({
  family: 4,
  keepAlive: false,
  timeout: 30000,
});

const bot = new Telegraf(token, {
  telegram: {
    apiRoot: apiBase,
    agent: telegramAgent,
  },
});

// ── Command handlers — registered BEFORE the catch-all text handler so /start
//    and /jobs actually fire instead of falling through to generic chat ──
bot.start((ctx) => {
  jobsNotify.setChatId(ctx.chat && ctx.chat.id);
  return ctx.reply(
    "Hey Victor — I'm ForChi, your personal workflow agent.\n\n" +
    "I post to Facebook & LinkedIn (5x/day), answer voice notes, search the web, and run ForChi Jobs — discovering and applying to matching remote roles for you.\n\n" +
    "Try: /jobs · \"show me the jobs report\" · \"turn on the job workflow\" · or just talk to me."
  );
});
registerJobsCommands(bot);
health.registerHealthCommands(bot);

// ── Database + Scheduler ──────────────────────────────────────────────────────
db.getDB()
  .then(() => {
    initScheduler();
    jobsScheduler.startJobsScheduler({ bot });
  })
  .catch((err) => console.error("[DB Error]", err.message));

// ── Self-healing watchdog ────────────────────────────────────────────────────
// Every 10 min, verify both workflows are alive. If the social scheduler is
// unregistered, the jobs loop is down, or the jobs DB is unreachable, run the
// deterministic repair automatically — so failures self-heal without waiting
// for Victor to notice or type /fix. When something breaks, ForChi TELLS Victor:
// it reports what broke + what it fixed, and escalates loudly if it couldn't
// fix it — instead of Victor finding out first.
let lastWatchdogNotify = null; // { at, sig } dedup so we don't spam every 10 min

async function sendWatchdogNotice(text) {
  const chatId = jobsNotify.getChatId();
  if (!chatId) return false;
  try {
    await bot.telegram.sendMessage(chatId, text, { parse_mode: "Markdown" });
    return true;
  } catch (err) {
    console.warn("[Watchdog] notify failed:", err.message);
    return false;
  }
}

setInterval(async () => {
  try {
    const snap = await health.getHealthSnapshot();
    const dbBad = typeof snap.db.jobsDb === "string" && snap.db.jobsDb !== "ok";
    const broken = !snap.social.registered || snap.jobs.schedulerRunning === false || dbBad;
    if (!broken) return;

    // Issue signature so repeat occurrences of the SAME issue don't spam.
    const sig = JSON.stringify([snap.social.registered, snap.jobs.schedulerRunning, dbBad ? snap.db.jobsDb : "ok"]);
    const now = Date.now();
    const cooldownMs = 60 * 60 * 1000; // re-notify same issue at most hourly
    if (lastWatchdogNotify && lastWatchdogNotify.sig === sig && now - lastWatchdogNotify.at < cooldownMs) return;

    console.warn(`[Watchdog] Detected degraded state — repairing (social=${snap.social.registered}, jobs=${snap.jobs.schedulerRunning}, db=${snap.db.jobsDb})`);
    const actions = await health.repairWorkflows({ bot });
    actions.forEach((a) => console.log(`[Watchdog] • ${a}`));

    // Re-check after repair.
    const after = await health.getHealthSnapshot();
    const stillBroken =
      !after.social.registered ||
      after.jobs.schedulerRunning === false ||
      (typeof after.db.jobsDb === "string" && after.db.jobsDb !== "ok");

    const parts = [
      `🩺 *ForChi self-heal* — I detected a problem and tried to fix it automatically.`,
      `• Found: social=${snap.social.registered ? "ok" : "MISSING"}, jobs=${snap.jobs.schedulerRunning ? "ok" : "NOT RUNNING"}, jobs DB=${dbBad ? snap.db.jobsDb : "ok"}`,
      ...actions.map((a) => `• ${a}`),
    ];
    if (stillBroken) {
      parts.push(`\n⚠️ *Still broken after my repair* — please send /diag or "fix the workflows" so we can dig in.`);
    } else {
      parts.push(`\n✅ Everything is back up. No action needed from you.`);
    }
    lastWatchdogNotify = { at: now, sig };
    await sendWatchdogNotice(parts.join("\n"));
  } catch (err) {
    console.error("[Watchdog] error:", err.message);
  }
}, 10 * 60 * 1000).unref();

// Chat reply is decoupled from the Telegram handler: we show a live typing
// indicator and send the answer in the background. This keeps the polling loop
// fast and avoids any handler timeout killing a slow LLM reply.
async function handleChat(ctx, text) {
  console.log("[Routing] Chat Path (background)");
  ctx.sendChatAction("typing").catch(() => {});
  const typing = setInterval(() => ctx.sendChatAction("typing").catch(() => {}), 4000);

  chatReply(text, ctx.chat && ctx.chat.id)
    .then(async (reply) => {
      await ctx.reply(reply);
    })
    .catch(async (err) => {
      console.error("[Bot Error] Chat:", err.message);
      try { await ctx.reply("Sorry, something went wrong on my end."); } catch (_) {}
    })
    .finally(() => clearInterval(typing));
}

// ── Core message handler (Blueprint Section 3 — three exits) ──────────────────
async function handleIncomingText(ctx, text) {
  console.log(`[Inbound Message] From: ${ctx.from?.first_name || "?"} (${ctx.from?.id}) | Text: "${text}"`);
  // Auto-register this chat so the daily jobs report reaches the user.
  jobsNotify.setChatId(ctx.chat && ctx.chat.id);

  // Auto-mode toggle command — checked BEFORE gate/extractor so it always works.
  // Only fires when one line contains BOTH the action ("turn/switch on|off")
  // and the trigger ("auto mode").
  const toggle = detectAutoModeToggle(text);
  if (toggle) {
    autoMode.setEnabled(toggle.enabled);
    const state = autoMode.isEnabled() ? "ON ✅" : "OFF ⛔";
    console.log(`[AutoMode] User ${ctx.from?.id} set auto mode ${toggle.enabled ? "ON" : "OFF"}`);
    return ctx.reply(
      toggle.enabled
        ? `Auto mode is now ${state} — I'll keep posting to Facebook & LinkedIn at 08:00, 12:00, 16:00, 20:00 and 00:00 UTC.`
        : `Auto mode is now ${state} — I'll stop scheduled posts. You can still send me a post anytime, or say "turn on auto mode" to resume.`
    );
  }

  // Job-workflow toggle — ForChi starts/stops the jobs agent the same way:
  // "turn on/off the job workflow" or "activate/deactivate the job scanner".
  const jobsToggle = detectJobsToggle(text);
  if (jobsToggle) {
    jobsMode.setEnabled(jobsToggle.enabled);
    const jState = jobsMode.isEnabled() ? "ON ✅" : "OFF ⛔";
    console.log(`[JobsMode] User ${ctx.from?.id} set job workflow ${jobsToggle.enabled ? "ON" : "OFF"}`);
    return ctx.reply(
      jobsToggle.enabled
        ? `Job workflow is now ${jState} — ForChi will scan and prepare applications for matching jobs (still respecting dry-run / apply window / daily cap).`
        : `Job workflow is now ${jState} — ForChi will stop scanning jobs. Say "turn on the job workflow" to resume.`
    );
  }

  // On-demand health diagnostics — "run diagnostics" / "what's wrong?" / "is everything ok?"
  if (detectDiagRequest(text)) {
    console.log(`[Diag] User ${ctx.from?.id} requested diagnostics`);
    const snap = await health.getHealthSnapshot();
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
  }

  // Repair request — "fix the workflows" / "fix the job workflow". ForChi runs
  // the deterministic recovery (re-register schedulers, clear stuck flags,
  // reconnect DB, re-enable auto mode) and reports exactly what it did.
  if (detectRepairRequest(text)) {
    console.log(`[Repair] User ${ctx.from?.id} requested workflow repair`);
    const actions = await health.repairWorkflows({ bot });
    const snap = await health.getHealthSnapshot();
    return ctx.reply(
      `🔧 *ForChi repair run:*\n` +
      actions.map((a) => `• ${a}`).join("\n") +
      `\n\nNow: auto mode ${snap.autoMode} · social ${snap.social.registered ? "registered ✅" : "MISSING ⛔"} · jobs ${snap.jobs.schedulerRunning ? "running ✅" : "NOT RUNNING ⛔"}`,
      { parse_mode: "Markdown" }
    );
  }

  // On-demand jobs report — "show me the jobs report" / "what have you applied for?".
  if (detectJobsReport(text)) {
    console.log(`[JobsReport] User ${ctx.from?.id} requested the jobs report`);
    return buildDailyReportText()
      .then((report) => ctx.reply(report, { parse_mode: "Markdown" }))
      .catch((err) => {
        console.error("[JobsReport] error:", err.message);
        return ctx.reply("Sorry, I couldn't pull the jobs report right now.");
      });
  }

  // Exit 1: Layer 1 gate fails → chat (decoupled: instant ack, reply in background)
  if (!passesGate(text)) {
    console.log("[Routing] Gate FAILED → Chat Path");
    return handleChat(ctx, text);
  }

  // Exit 2: Layer 2 extractor fails validation → chat
  console.log("[Routing] Gate PASSED → Extractor Path");
  const intent = await extractPostIntent(text);
  if (!intent.isPostTrigger) {
    console.log("[Routing] Extractor: not a trigger → Chat Path");
    return handleChat(ctx, text);
  }

  // Exit 3: Confirmed trigger → deterministic workflow (Blueprint Section 0)
  console.log(`[Routing] Confirmed Trigger! Destinations: ${JSON.stringify(intent.destinations)}`);

  // Immediate reply before any generation starts (Blueprint Section 7)
  await ctx.reply("On it 🤙");

  // Async background execution — never block the Telegram response
  socialWorkflow.run({
    destinations: intent.destinations,
    content: intent.content,
  })
    .then(async (result) => {
      if (result.success) {
        await ctx.reply("Done — go check it out.");
      } else {
        await ctx.reply(`Ran into an issue posting to ${result.failedPlatforms.join(", ")}: ${result.errorSummary}`);
      }
    })
    .catch(async (err) => {
      console.error("[Bot Workflow Error]", err.message);
      await ctx.reply(`Ran into an issue posting: ${err.message}`);
    });
}

// ── Telegram Event Listeners ──────────────────────────────────────────────────
bot.on("text", async (ctx) => {
  try {
    await handleIncomingText(ctx, ctx.message.text);
  } catch (err) {
    console.error("[Bot Error] Text handler:", err.message);
    try { await ctx.reply("Sorry, something went wrong on my end."); } catch (_) {}
  }
});

// Blueprint Section 6: Voice → transcribe → same gate/extractor pipeline.
// Decoupled: typing indicator + background processing (transcribe can be slow).
bot.on("voice", async (ctx) => {
  try {
    ctx.sendChatAction("typing").catch(() => {});
    const typing = setInterval(() => ctx.sendChatAction("typing").catch(() => {}), 4000);
    const fileId = ctx.message.voice.file_id;
    console.log(`[Bot Voice] File ID: ${fileId}`);
    const fileLink = await ctx.telegram.getFileLink(fileId);

    processVoiceMessage(fileLink.href, "ogg")
      .then((transcript) => handleIncomingText(ctx, transcript))
      .catch((err) => {
        console.error("[Bot Error] Voice handler:", err.message);
        ctx.reply("Sorry, I couldn't transcribe that voice note.").catch(() => {});
      })
      .finally(() => clearInterval(typing));
  } catch (err) {
    console.error("[Bot Error] Voice handler:", err.message);
    try { await ctx.reply("Sorry, something went wrong on my end."); } catch (_) {}
  }
});

// (the /start command is registered near the top, before the text handler)

// ── HTTP Health Check Server ──────────────────────────────────────────────────
const PORT = process.env.PORT || 7860;
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  const path = (req.url || "/").split("?")[0];
  if (path === "/status") {
    res.end(JSON.stringify({
      status: "healthy",
      bot: "ForChi",
      mode: "long-polling",
      autoMode: autoMode.isEnabled() ? "on" : "off",
      jobsMode: jobsMode.isEnabled() ? "on" : "off",
      jobsApply: (process.env.JOBS_AUTO_APPLY || "false") === "true" ? "live" : "dry-run",
      utc: new Date().toISOString(),
      schedule: "0 0,8,12,16,20 * * * UTC",
    }));
  } else {
    res.end(JSON.stringify({ status: "healthy", bot: "ForChi", mode: "long-polling" }));
  }
});

server.listen(PORT, () => {
  console.log(`[Health Check Server] Listening on port ${PORT}`);
});

// ── Long-Polling Launcher with Retry ──────────────────────────────────────────
let isRunning = false;

async function launchWithRetry({ baseRetries = 10, conflictRetries = 30, delayMs = 3000 } = {}) {
  // On deploy overlap, Render may briefly run two instances; Telegram returns
  // 409 "Conflict" until the old instance dies. Keep retrying well past that window.
  const isConflict = (msg) => /409|Conflict|terminated by other getUpdates/i.test(msg || "");
  const maxRetries = isConflict ? conflictRetries : baseRetries;
  let conflictMode = isConflict;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[Telegraf] Long-polling launch attempt ${attempt}/${maxRetries}...`);
      await bot.launch({ handlerTimeout: 600000 }); // 10 min safety net for slow background work
      isRunning = true;
      console.log("[Telegraf] ✅ Bot launched successfully in long-polling mode.");
      return;
    } catch (err) {
      const wasConflict = isConflict(err.message);
      console.error(`[Telegraf] Attempt ${attempt}/${maxRetries} failed: ${err.message}`);
      if (!conflictMode && wasConflict) {
        // Switched into conflict mode — extend the budget so we outlast the old instance.
        conflictMode = true;
        console.log(`[Telegraf] Detected 409 conflict (deploy overlap) — extending retry window to ${conflictRetries} attempts.`);
      }
      if (attempt < maxRetries) {
        const wait = wasConflict ? Math.min(delayMs * 2, 10000) : delayMs;
        console.log(`[Telegraf] Retrying in ${wait / 1000}s...`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  console.error("[Telegraf] ❌ All launch attempts failed. Process stays alive for health checks.");
}

async function deleteWebhookAndLaunch() {
  try {
    console.log("[Telegraf] Clearing any existing webhook before long-polling launch...");
    await bot.telegram.deleteWebhook({ drop_pending_updates: false });
    console.log("[Telegraf] Webhook cleared.");
  } catch (err) {
    console.warn("[Telegraf] Could not clear webhook (may not exist):", err.message);
  }
  await launchWithRetry();
}

deleteWebhookAndLaunch();

// ── Graceful Shutdown ─────────────────────────────────────────────────────────
function safeStop(signal) {
  console.log(`[Shutdown] ${signal} received.`);
  if (isRunning) {
    try { bot.stop(signal); } catch (_) {}
    isRunning = false;
  }
  server.close();
}

process.once("SIGINT", () => safeStop("SIGINT"));
process.once("SIGTERM", () => safeStop("SIGTERM"));

module.exports = { bot, handleIncomingText };
