require("dotenv").config();
const http = require("http");
const https = require("https");
const dns = require("dns");
const { Telegraf } = require("telegraf");
const { passesGate } = require("./router/gate");
const { extractPostIntent } = require("./router/extractor");
const { detectAutoModeToggle } = require("./router/autoModeToggle");
const { chatReply } = require("./llm/chatChain");
const socialWorkflow = require("./workflows/social/index");
const { processVoiceMessage } = require("./voice/transcriber");
const { initScheduler } = require("./scheduler/jobs");
const autoMode = require("./scheduler/autoMode");
const db = require("./store/db");
const jobsScheduler = require("./workflows/jobs/scheduler");
const { registerJobsCommands } = require("./workflows/jobs/commands");
const jobsMode = require("./workflows/jobs/jobsMode");
const jobsNotify = require("./workflows/jobs/notifyTarget");

// Force IPv4 for DNS resolution (avoids IPv6 timeouts in containers)
if (dns.setDefaultResultOrder) dns.setDefaultResultOrder("ipv4first");

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

// ── Database + Scheduler ──────────────────────────────────────────────────────
db.getDB()
  .then(() => {
    initScheduler();
    jobsScheduler.startJobsScheduler({ bot });
    registerJobsCommands(bot);
  })
  .catch((err) => console.error("[DB Error]", err.message));

// Chat reply is decoupled from the Telegram handler: we show a live typing
// indicator and send the answer in the background. This keeps the polling loop
// fast and avoids any handler timeout killing a slow LLM reply.
async function handleChat(ctx, text) {
  console.log("[Routing] Chat Path (background)");
  ctx.sendChatAction("typing").catch(() => {});
  const typing = setInterval(() => ctx.sendChatAction("typing").catch(() => {}), 4000);

  chatReply(text)
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

bot.start((ctx) => {
  jobsNotify.setChatId(ctx.chat && ctx.chat.id);
  return ctx.reply("ForChi active and listening. Jobs agent: send /jobs for status.");
});

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
