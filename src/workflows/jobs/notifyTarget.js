// Persisted Telegram chat id that receives the daily jobs report.
// Auto-registered when the user messages the bot; also settable via /jobs notify.
const fs = require("fs");
const path = require("path");

function dataDir() {
  const p = process.env.JOBS_DB_PATH || process.env.DATABASE_PATH;
  if (p) return path.dirname(path.resolve(p));
  return path.resolve(process.cwd(), "data");
}

const FILE = path.join(dataDir(), "jobs_notify.json");

function readState() {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return {};
  }
}

function getChatId() {
  return readState().chatId || (process.env.JOBS_NOTIFY_CHAT_ID || "").trim() || null;
}

function setChatId(id) {
  const chatId = String(id || "").trim();
  if (!chatId) return;
  if (readState().chatId === chatId) return; // no-op if unchanged
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify({ chatId, updatedAt: new Date().toISOString() }));
    console.log(`[JobsNotify] Report chat set to ${chatId}`);
  } catch (e) {
    console.warn("[JobsNotify] Could not persist chat id:", e.message);
  }
  // Fire-and-forget: mirror durably to the jobs DB kv store so it SURVIVES
  // redeploys. NOT the Render bulk env-var PUT — that silently wipes secret vars
  // the API GET omits (2026-08-21: deleted TELEGRAM_BOT_TOKEN etc, crashed deploys).
  require("./db.js").kvSet("jobs_notify_chat_id", chatId).catch((e) =>
    console.warn("[JobsNotify] durable chat-id persist failed:", e.message)
  );
}

// DANGER — DISABLED. The Render env-var API is a bulk-PUT whose GET omits secret
// vars, so writing the list back silently deletes them (2026-08-21: wiped
// TELEGRAM_BOT_TOKEN/GEMINI_KEYS/HF_TOKEN, crashed every deploy). The chat id now
// persists via the jobs DB kv store instead (see setChatId). Do not re-enable.
async function persistToRenderEnv(chatId) {
  console.warn("[JobsNotify] persistToRenderEnv DISABLED — bulk env-var PUT wipes secrets.");
  return false;
}

module.exports = { getChatId, setChatId, FILE };
