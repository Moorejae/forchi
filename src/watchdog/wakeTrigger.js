// src/watchdog/wakeTrigger.js — THE AUTONOMOUS-AGENT WAKE TRIGGER (VPS).
//
// User's model: the agent should NOT stay awake 24/7 burning tokens. Instead a
// lightweight watchdog lives on the VPS, checks every workflow, and ONLY pings
// when something is wrong:
//   - a service is down / crashed (forchi, v10-watchdog, voice-worker, v61-bot)
//   - a scheduled workflow failed or is stuck (V10 build/publish, shorts, social)
//   - the workflow lock is stale (a job died mid-run)
//   - low top-up / API-quota signals (429s, 403s, exhausted keys) are surfaced
//   - it hasn't heard a heartbeat for too long (everything silently dead)
//
// On any NEW failure it:
//   1. sends a Telegram alert (so the user always knows)
//   2. writes a WAKE file the agent can pick up (agent starts a NEW session per
//      issue — cheaper than continuing one long session, per user directive)
//
// Debounce: each failure class alerts at most once per COOLDOWN_MS (default 2h)
// so a stuck workflow doesn't spam Telegram every tick.
//
// Usage (systemd): node src/watchdog/wakeTrigger.js   (daemon, ticks every 60s)
//                  node src/watchdog/wakeTrigger.js check   (one-shot status)
const path = require("path");
const fs = require("fs");

const BASE = process.env.FORCHI_BASE || path.resolve(__dirname, "..", "..", "..");
require("dotenv").config({ path: path.join(BASE, ".env") });

const TICK_MS = 60 * 1000;
const COOLDOWN_MS = 2 * 60 * 60 * 1000; // per-class alert cooldown (2h)
const STATE_FILE = path.join(BASE, "temp_media", "wake_trigger_state.json");
const WAKE_DIR = path.join(BASE, "temp_media", "wake");

function now() { return Date.now(); }
function readState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return { lastAlert: {}, sent: {} }; } }
function writeState(s) { try { fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(s)); } catch {} }

function env(k) { return (process.env[k] || "").trim(); }

async function notify(text) {
  const token = env("TELEGRAM_BOT_TOKEN");
  const chat = env("JOBS_NOTIFY_CHAT_ID") || env("TELEGRAM_CHAT_ID");
  if (!token || !chat) { console.log("[wake] (no telegram) alert:", text); return false; }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: "Markdown" }),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) console.warn("[wake] notify HTTP", r.status);
    return r.ok;
  } catch (e) { console.warn("[wake] notify failed:", e.message); return false; }
}

// --- checks ---------------------------------------------------------------
function servicesDown() {
  const want = ["forchi.service", "v10-watchdog.service", "voice-worker.service", "v61-bot.service"];
  const { spawnSync } = require("child_process");
  const down = [];
  const sysctl = fs.existsSync("/bin/systemctl") ? "/bin/systemctl" : "systemctl";
  for (const s of want) {
    try {
      const r = spawnSync(sysctl, ["is-active", s], { encoding: "utf8", stdio: "pipe", timeout: 10000 });
      const out = (r.stdout || "").toString().trim();
      if (!out || out !== "active") down.push(s);
    } catch (e) { down.push(s); }
  }
  return down;
}

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } }

function checkStaleLock() {
  const lock = readJson(path.join(BASE, "temp_media", "workflow.lock"));
  if (!lock || !lock.owner) return null;
  const ttl = lock.ttlMs || 3 * 60 * 60 * 1000;
  if (now() - (lock.at || 0) > ttl) {
    return `stale workflow lock: ${lock.name || "unknown"} (pid ${lock.owner}) held > ${Math.round(ttl / 60000)}m`;
  }
  return null;
}

function checkStuckV10() {
  // A pending run that's old + still not published = stuck build.
  const mode = readJson(path.join(BASE, "temp_media", "v10_mode.json"));
  if (!mode) return null;
  for (const sl of mode.slots || []) {
    if (sl.pendingRunId && sl.lastPublishAt && sl.nextPublishAt && now() > (sl.nextPublishAt + 3 * 60 * 60 * 1000)) {
      return `V10 slot "${sl.label}" has pending run ${sl.pendingRunId} but publish time (${new Date(sl.nextPublishAt).toISOString()}) passed > 3h ago`;
    }
  }
  return null;
}

function checkLastPosts() {
  // If neither V10 nor shorts posted in ~30h, something is silently dead.
  const out = [];
  const v10Posts = readJson(path.join(BASE, "temp_media", "v10_posts.json"));
  if (Array.isArray(v10Posts) && v10Posts.length) {
    const last = v10Posts[v10Posts.length - 1];
    if (now() - last.at > 30 * 3600 * 1000) out.push(`no V10 post in ${Math.round((now() - last.at) / 3600000)}h`);
  }
  const shPosts = readJson(path.join(BASE, "temp_media", "video_posts.json"));
  if (Array.isArray(shPosts) && shPosts.length) {
    const last = shPosts[shPosts.length - 1];
    if (now() - last.at > 30 * 3600 * 1000) out.push(`no Short post in ${Math.round((now() - last.at) / 3600000)}h`);
  }
  return out;
}

// --- run ------------------------------------------------------------------
function runChecks() {
  const problems = [];
  const down = servicesDown();
  if (down.length) problems.push(`services DOWN: ${down.join(", ")}`);
  const stale = checkStaleLock();
  if (stale) problems.push(stale);
  const stuck = checkStuckV10();
  if (stuck) problems.push(stuck);
  for (const p of checkLastPosts()) problems.push(p);
  return problems;
}

function writeWakeFile(problems) {
  try {
    fs.mkdirSync(WAKE_DIR, { recursive: true });
    const f = path.join(WAKE_DIR, `wake_${now()}.json`);
    fs.writeFileSync(f, JSON.stringify({ at: now(), problems, iso: new Date().toISOString() }, null, 2));
    console.log("[wake] wrote wake file:", f);
  } catch (e) { console.warn("[wake] wake file write failed:", e.message); }
}

async function tick({ force = false } = {}) {
  const state = readState();
  state.lastAlert = state.lastAlert || {};
  state.sent = state.sent || {};
  const problems = runChecks();

  if (!problems.length) {
    state.okSince = state.okSince || now();
    writeState(state);
    console.log(`[wake] all workflows OK (${new Date().toISOString()})`);
    return;
  }

  const key = problems.join(" | ");
  const lastAt = state.lastAlert[key] || 0;
  const isNew = force || now() - lastAt > COOLDOWN_MS;
  state.okSince = null;
  if (isNew) {
    const msg = `⚠️ *ForChi wake trigger*\n` + problems.map((p) => `• ${p}`).join("\n") +
      `\n\nAgent: start a NEW session for this issue.`;
    const ok = await notify(msg);
    writeWakeFile(problems);
    state.lastAlert[key] = now();
    if (ok) state.sent[key] = now();
    console.log("[wake] ALERT sent:", problems.join(" | "));
  } else {
    console.log("[wake] problems (cooldown, not re-alerting):", problems.join(" | "));
  }
  writeState(state);
}

// --- CLI ------------------------------------------------------------------
const cmd = (process.argv[2] || "").toLowerCase();
if (cmd === "check") {
  const problems = runChecks();
  console.log(problems.length ? "PROBLEMS:\n" + problems.join("\n") : "ALL OK");
  process.exit(problems.length ? 1 : 0);
} else if (cmd === "force") {
  tick({ force: true }).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
} else {
  console.log(`[wake] wake-trigger watchdog starting (tick ${TICK_MS / 1000}s, cooldown ${COOLDOWN_MS / 3600000}h)`);
  setInterval(() => { tick().catch((e) => console.error("[wake] tick error:", e.message)); }, TICK_MS);
  tick().catch((e) => console.error("[wake] initial tick error:", e.message));
  setInterval(() => {}, 60 * 1000); // keepalive (systemd daemon)
}

module.exports = { runChecks, tick };
