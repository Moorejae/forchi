require("dotenv").config();
const http = require("http");
const https = require("https");
const dns = require("dns");
const { Telegraf } = require("telegraf");
const { passesGate } = require("./router/gate");
const { extractPostIntent } = require("./router/extractor");
const { chatReply } = require("./llm/chatChain");
const socialWorkflow = require("./workflows/social/index");
const { processVoiceMessage } = require("./voice/transcriber");
const { initScheduler } = require("./scheduler/jobs");
const db = require("./store/db");

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
  .then(() => initScheduler())
  .catch((err) => console.error("[DB Error]", err.message));

// ── Core message handler (Blueprint Section 3 — three exits) ──────────────────
async function handleIncomingText(ctx, text) {
  console.log(`[Inbound Message] From: ${ctx.from?.first_name || "?"} (${ctx.from?.id}) | Text: "${text}"`);

  // Exit 1: Layer 1 gate fails → chat
  if (!passesGate(text)) {
    console.log("[Routing] Gate FAILED → Chat Path");
    const reply = await chatReply(text);
    return ctx.reply(reply);
  }

  // Exit 2: Layer 2 extractor fails validation → chat
  console.log("[Routing] Gate PASSED → Extractor Path");
  const intent = await extractPostIntent(text);
  if (!intent.isPostTrigger) {
    console.log("[Routing] Extractor: not a trigger → Chat Path");
    const reply = await chatReply(text);
    return ctx.reply(reply);
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

// Blueprint Section 6: Voice → transcribe → same gate/extractor pipeline
bot.on("voice", async (ctx) => {
  try {
    const fileId = ctx.message.voice.file_id;
    console.log(`[Bot Voice] File ID: ${fileId}`);
    const fileLink = await ctx.telegram.getFileLink(fileId);
    const transcript = await processVoiceMessage(fileLink.href, "ogg");
    await handleIncomingText(ctx, transcript);
  } catch (err) {
    console.error("[Bot Error] Voice handler:", err.message);
    try { await ctx.reply("Sorry, I couldn't transcribe that voice note."); } catch (_) {}
  }
});

bot.start((ctx) => ctx.reply("ForChi active and listening."));

// ── HTTP Health Check Server ──────────────────────────────────────────────────
const PORT = process.env.PORT || 7860;
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "healthy", bot: "ForChi", mode: "long-polling" }));
});

server.listen(PORT, () => {
  console.log(`[Health Check Server] Listening on port ${PORT}`);
});

// ── Long-Polling Launcher with Retry ──────────────────────────────────────────
let isRunning = false;

async function launchWithRetry(maxRetries = 10, delayMs = 3000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[Telegraf] Long-polling launch attempt ${attempt}/${maxRetries}...`);
      await bot.launch();
      isRunning = true;
      console.log("[Telegraf] ✅ Bot launched successfully in long-polling mode.");
      return;
    } catch (err) {
      console.error(`[Telegraf] Attempt ${attempt}/${maxRetries} failed: ${err.message}`);
      if (attempt < maxRetries) {
        console.log(`[Telegraf] Retrying in ${delayMs / 1000}s...`);
        await new Promise((r) => setTimeout(r, delayMs));
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
