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

const BASE = process.env.FORCHI_BASE || path.resolve(__dirname, "..", "..");
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
// USER DIRECTIVE (2026-08-31): "by VPS I don't just mean the VPS host — I mean
// the ENTIRE workflow and pipeline ecosystem." So we monitor every service, the
// remote HF spaces (images + voice), the V10 build/publish pipeline stages, the
// shorts pipeline, the social (FB/LinkedIn) cadence, and the code-server.
function servicesDown() {
  const want = [
    "forchi.service",
    "v10-watchdog.service",
    "voice-worker.service",
    "v61-bot.service",
    "forchi-wake.service",
    "forchi-shorts.service",
    "code-server.service",
  ];
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

// HF spaces health — the remote image-gen + voice backends. Uses the HF runtime
// API (stage field), which is honest about sleep/error/paused states.
async function checkHFSpaces() {
  const spaces = [
    { name: "slymun/forchi-img", label: "HF image gen" },
    { name: "slymun/higgs-tts3", label: "HF higgs voice" },
  ];
  const out = [];
  const BAD = new Set(["ERROR", "PAUSED", "DELETED", "APP_DELETED"]);
  for (const sp of spaces) {
    try {
      const r = await fetch(`https://huggingface.co/api/spaces/${sp.name}/runtime`, { signal: AbortSignal.timeout(12000) });
      if (!r.ok) { out.push(`${sp.label} (${sp.name}) runtime HTTP ${r.status}`); continue; }
      const j = await r.json();
      const stage = (j.stage || "").toUpperCase();
      if (BAD.has(stage)) out.push(`${sp.label} (${sp.name}) stage=${stage}`);
    } catch (e) { out.push(`${sp.label} (${sp.name}) unreachable: ${e.message.slice(0, 60)}`); }
  }
  return out;
}

// V10 pipeline stage failures — walk temp_media/v10_run/*/state.json and flag
// any run whose stage list has a hard "failed" status.
function checkV10Pipeline() {
  const out = [];
  const runsDir = path.join(BASE, "temp_media", "v10_run");
  try {
    if (!fs.existsSync(runsDir)) return out;
    const dirs = fs.readdirSync(runsDir).filter((d) => fs.statSync(path.join(runsDir, d)).isDirectory());
    for (const d of dirs) {
      const st = readJson(path.join(runsDir, d, "state.json"));
      if (!st || !st.stages) continue;
      const failed = Object.entries(st.stages).filter(([, v]) => v && v.status === "failed").map(([k, v]) => `${k}:${(v.error || "").slice(0, 80)}`);
      if (failed.length) out.push(`V10 run ${d} failed stages: ${failed.join(" | ")}`);
    }
  } catch {}
  return out;
}

// Social (FB/LinkedIn) freshness — if auto-mode is on but nothing posted in 48h,
// the social pipeline is silently dead. Best-effort via FB Graph API.
async function checkSocialFreshness() {
  const out = [];
  const auto = readJson(path.join(BASE, "data", "auto_mode.json"));
  if (auto && auto.enabled === false) return out; // auto-mode off = expected silence
  const token = env("FACEBOOK_PAGE_ACCESS_TOKEN");
  const page = env("FACEBOOK_PAGE_ID");
  if (!token || !page) return out; // no FB creds -> can't judge
  try {
    const r = await fetch(
      `https://graph.facebook.com/v19.0/${page}/posts?fields=created_time&limit=1&access_token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(15000) }
    );
    if (!r.ok) return out;
    const j = await r.json();
    const last = j.data && j.data[0] && Date.parse(j.data[0].created_time);
    if (last && now() - last > 48 * 3600 * 1000) {
      out.push(`no Facebook post in ${Math.round((now() - last) / 3600000)}h`);
    }
  } catch {}
  return out;
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

// ms since a post timestamp that may be an ISO string OR a number (JS does NOT
// auto-parse date strings in subtraction — `now() - "2026-..Z"` is NaN, which
// silently disabled the freshness checks). Parse explicitly.
function agoMs(v) {
  const t = typeof v === "number" ? v : Date.parse(v || 0);
  return Number.isFinite(t) ? now() - t : 0;
}

function checkLastPosts() {
  // If neither V10 nor shorts posted in ~30h, something is silently dead.
  const out = [];
  const v10Posts = readJson(path.join(BASE, "temp_media", "v10_posts.json"));
  if (Array.isArray(v10Posts) && v10Posts.length) {
    const last = v10Posts[v10Posts.length - 1];
    const ago = agoMs(last && (last.at || last.time));
    if (ago > 30 * 3600 * 1000) out.push(`no V10 post in ${Math.round(ago / 3600000)}h`);
  }
  const shPosts = readJson(path.join(BASE, "temp_media", "video_posts.json"));
  if (Array.isArray(shPosts) && shPosts.length) {
    const last = shPosts[shPosts.length - 1];
    const ago = agoMs(last && (last.at || last.time));
    if (ago > 30 * 3600 * 1000) out.push(`no Short post in ${Math.round(ago / 3600000)}h`);
  }
  return out;
}

// --- run ------------------------------------------------------------------
async function runChecks() {
  const problems = [];
  const down = servicesDown();
  if (down.length) problems.push(`services DOWN: ${down.join(", ")}`);
  const stale = checkStaleLock();
  if (stale) problems.push(stale);
  const stuck = checkStuckV10();
  if (stuck) problems.push(stuck);
  for (const p of checkLastPosts()) problems.push(p);
  for (const p of checkV10Pipeline()) problems.push(p);
  for (const p of await checkHFSpaces()) problems.push(p);
  for (const p of await checkSocialFreshness()) problems.push(p);
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
    // USER DIRECTIVE (2026-08-31): auto-repair — DeepSeek repair agent fixes the
    // issue using the code-server workspace. Fire-and-forget (detached) so the
    // watchdog keeps ticking; the agent logs + Telegram-notifies its outcome.
    spawnRepairAgent();
    state.lastAlert[key] = now();
    if (ok) state.sent[key] = now();
    console.log("[wake] ALERT sent + repair agent spawned:", problems.join(" | "));
  } else {
    console.log("[wake] problems (cooldown, not re-alerting):", problems.join(" | "));
  }
  writeState(state);
}

// Launch the DeepSeek repair agent detached (no blocking, no shared event loop).
function spawnRepairAgent() {
  const { spawn } = require("child_process");
  try {
    const p = spawn(process.execPath, [path.join(__dirname, "repairAgent.js")], {
      cwd: BASE, detached: true, stdio: "ignore",
      env: { ...process.env, FORCHI_BASE: BASE },
    });
    p.unref();
    console.log("[wake] repair agent spawned (pid", p.pid + ")");
  } catch (e) {
    console.warn("[wake] repair agent spawn failed:", e.message);
  }
}

// --- CLI ------------------------------------------------------------------
const cmd = (process.argv[2] || "").toLowerCase();
if (cmd === "check") {
  runChecks().then((problems) => {
    console.log(problems.length ? "PROBLEMS:\n" + problems.join("\n") : "ALL OK");
    process.exit(problems.length ? 1 : 0);
  }).catch((e) => { console.error(e); process.exit(1); });
} else if (cmd === "force") {
  tick({ force: true }).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
} else {
  console.log(`[wake] wake-trigger watchdog starting (tick ${TICK_MS / 1000}s, cooldown ${COOLDOWN_MS / 3600000}h)`);
  setInterval(() => { tick().catch((e) => console.error("[wake] tick error:", e.message)); }, TICK_MS);
  tick().catch((e) => console.error("[wake] initial tick error:", e.message));
  setInterval(() => {}, 60 * 1000); // keepalive (systemd daemon)
}

module.exports = { runChecks, tick };
