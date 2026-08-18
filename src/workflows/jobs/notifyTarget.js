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
  // Fire-and-forget: mirror to a Render ENV VAR so it SURVIVES redeploys
  // (the free-tier disk is wiped on every deploy). Best-effort only.
  persistToRenderEnv(chatId).catch((e) =>
    console.warn("[JobsNotify] Render env persist failed:", e.message)
  );
}

// Render API: update the JOBS_NOTIFY_CHAT_ID env var, PRESERVING all other vars
// (the Render API's bulk PUT replaces the whole list). Requires RENDER_API_KEY +
// RENDER_SERVICE_ID in the bot's own env (added via tools/set_env_var.js).
async function persistToRenderEnv(chatId) {
  const apiKey = (process.env.RENDER_API_KEY || "").trim();
  const svcId = (process.env.RENDER_SERVICE_ID || "").trim();
  if (!apiKey || !svcId) return; // not configured — skip silently

  const API = "https://api.render.com/v1";
  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

  const got = await fetch(`${API}/services/${svcId}/env-vars`, { headers, signal: AbortSignal.timeout(15000) });
  if (!got.ok) throw new Error(`GET env-vars ${got.status}`);
  const body = await got.json();
  const current = (Array.isArray(body) ? body : []).map((x) => ({
    key: x.envVar ? x.envVar.key : x.key,
    value: x.envVar ? x.envVar.value : x.value,
  }));
  const map = new Map(current.map((e) => [e.key, e.value]));
  map.set("JOBS_NOTIFY_CHAT_ID", chatId);
  const list = [...map.entries()].map(([key, value]) => ({ key, value }));

  const put = await fetch(`${API}/services/${svcId}/env-vars`, {
    method: "PUT", headers, body: JSON.stringify(list), signal: AbortSignal.timeout(20000),
  });
  if (!put.ok) throw new Error(`PUT env-vars ${put.status}`);
  console.log(`[JobsNotify] Persisted chat id to Render env (${list.length} vars).`);
}

module.exports = { getChatId, setChatId, FILE };
