// Lightweight per-chat conversation memory (last N messages), persisted to JSON
// so ForChi can "remember" conversations. On Render the data/ dir is ephemeral
// (resets on redeploy), but within a running instance memory persists.
const fs = require("fs");
const path = require("path");

const FILE = process.env.CHAT_MEMORY_PATH || path.join(process.cwd(), "data", "chat_memory.json");
const MAX_PER_CHAT = 20;

let store = {};
try {
  store = JSON.parse(fs.readFileSync(FILE, "utf8")) || {};
} catch {
  store = {};
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(store));
  } catch (e) {
    console.warn("[ChatMemory] persist failed:", e.message);
  }
}

function getHistory(chatId, n = 8) {
  return (store[String(chatId)] || []).slice(-n);
}

function addMessage(chatId, role, text) {
  const key = String(chatId);
  const arr = store[key] || [];
  arr.push({ role, text: String(text || "").slice(0, 1500), at: Date.now() });
  store[key] = arr.slice(-MAX_PER_CHAT);
  persist();
}

function clear(chatId) {
  delete store[String(chatId)];
  persist();
}

module.exports = { getHistory, addMessage, clear };
