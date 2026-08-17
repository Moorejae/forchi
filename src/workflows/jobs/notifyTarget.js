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
}

module.exports = { getChatId, setChatId, FILE };
