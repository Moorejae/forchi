require("dotenv").config();
const http = require("http");
const { Client, GatewayIntentBits, Partials } = require("discord.js");
const { passesGate } = require("./router/gate");
const { extractPostIntent } = require("./router/extractor");
const { chatReply } = require("./llm/chatChain");
const socialWorkflow = require("./workflows/social/index");
const { processVoiceMessage } = require("./voice/transcriber");
const { initScheduler } = require("./scheduler/jobs");
const db = require("./store/db");

console.log(`\n===== ForChi v2 Discord Bot Startup =====\n`);
console.log("[DIAG] DISCORD_BOT_TOKEN present:", !!process.env.DISCORD_BOT_TOKEN);
console.log("[DIAG] GEMINI_KEYS count:", (process.env.GEMINI_KEYS || "").split(",").filter(Boolean).length);
console.log("[DIAG] HF_TOKEN present:", !!(process.env.HF_TOKEN || process.env.HF_ACCESS_TOKEN));

const token = (process.env.DISCORD_BOT_TOKEN || "").trim();
if (!token) {
  console.error("[FATAL] DISCORD_BOT_TOKEN is missing. Set it in .env or HF Secrets.");
  process.exit(1);
}

// Discord client with required intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// ── Database + Scheduler ──────────────────────────────────────────────────────
db.getDB()
  .then(() => initScheduler())
  .catch((err) => console.error("[DB Error]", err.message));

// ── Core message handler (Blueprint Section 3 — three exits) ──────────────────
async function handleIncomingText(message, text) {
  console.log(`[Inbound Message] From: ${message.author?.username || "?"} (${message.author?.id}) | Text: "${text}"`);

  // Exit 1: Layer 1 gate fails → chat
  if (!passesGate(text)) {
    console.log("[Routing] Gate FAILED → Chat Path");
    const reply = await chatReply(text);
    return message.reply(reply);
  }

  // Exit 2: Layer 2 extractor fails validation → chat
  console.log("[Routing] Gate PASSED → Extractor Path");
  const intent = await extractPostIntent(text);
  if (!intent.isPostTrigger) {
    console.log("[Routing] Extractor: not a trigger → Chat Path");
    const reply = await chatReply(text);
    return message.reply(reply);
  }

  // Exit 3: Confirmed trigger → deterministic workflow (Blueprint Section 0)
  console.log(`[Routing] Confirmed Trigger! Destinations: ${JSON.stringify(intent.destinations)}`);

  // Immediate reply before any generation starts (Blueprint Section 7)
  await message.reply("On it 🤙");

  // Async background execution — never block the Discord response
  socialWorkflow.run({
    destinations: intent.destinations,
    content: intent.content,
  })
    .then(async (result) => {
      if (result.success) {
        await message.reply("Done — go check it out.");
      } else {
        await message.reply(`Ran into an issue posting to ${result.failedPlatforms.join(", ")}: ${result.errorSummary}`);
      }
    })
    .catch(async (err) => {
      console.error("[Bot Workflow Error]", err.message);
      await message.reply(`Ran into an issue posting: ${err.message}`);
    });
}

// ── Discord Event Listener (single handler: voice attachments OR text) ───────
client.on("messageCreate", async (message) => {
  // Ignore bot messages
  if (message.author.bot) return;

  try {
    // Voice note handling: transcribe audio attachment, then run the same pipeline
    const audioAttachment = message.attachments?.find((a) => a.contentType && a.contentType.startsWith("audio/"));
    if (audioAttachment) {
      console.log(`[Bot Voice] File: ${audioAttachment.name} (${audioAttachment.contentType})`);
      // Derive file extension from the attachment name (e.g. .ogg, .mp3, .webm)
      const extMatch = audioAttachment.name.match(/\.([a-zA-Z0-9]+)$/);
      const ext = extMatch ? extMatch[1] : "ogg";
      const transcript = await processVoiceMessage(audioAttachment.url, ext);
      return handleIncomingText(message, transcript);
    }

    // Text handling: skip empty messages (e.g. image-only posts)
    if (!message.content || !message.content.trim()) return;
    return handleIncomingText(message, message.content);
  } catch (err) {
    console.error("[Bot Error] Message handler:", err.message);
    try { await message.reply("Sorry, something went wrong on my end."); } catch (_) {}
  }
});

client.once("ready", () => {
  console.log(`[Discord] ✅ Logged in as ${client.user.tag}`);
  console.log(`[Discord] Connected to ${client.guilds.cache.size} guild(s)`);
});

client.on("error", (err) => {
  console.error("[Discord] Client error:", err.message);
});

// ── HTTP Health Check Server (Port 7860 for HF Spaces) ────────────────────────
const PORT = process.env.PORT || 7860;
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "healthy", bot: "ForChi v2", mode: "discord-gateway" }));
});

server.listen(PORT, () => {
  console.log(`[Health Check Server] Listening on port ${PORT}`);
});

// ── Discord Login with Retry ──────────────────────────────────────────────────
async function launchWithRetry(maxRetries = 10, delayMs = 3000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[Discord] Login attempt ${attempt}/${maxRetries}...`);
      await client.login(token);
      console.log("[Discord] ✅ Bot logged in successfully.");
      return;
    } catch (err) {
      console.error(`[Discord] Attempt ${attempt}/${maxRetries} failed: ${err.message}`);
      if (attempt < maxRetries) {
        console.log(`[Discord] Retrying in ${delayMs / 1000}s...`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  console.error("[Discord] ❌ All login attempts failed. Container will stay alive for health checks.");
}

launchWithRetry();

// ── Graceful Shutdown ─────────────────────────────────────────────────────────
function safeStop(signal) {
  console.log(`[Shutdown] ${signal} received.`);
  try { client.destroy(); } catch (_) {}
  server.close();
}

process.once("SIGINT", () => safeStop("SIGINT"));
process.once("SIGTERM", () => safeStop("SIGTERM"));

module.exports = { client, handleIncomingText };
