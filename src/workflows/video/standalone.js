// src/workflows/video/standalone.js
// Standalone LOCAL auto-poster for the Victor Moore YouTube Shorts workflow.
// Runs WITHOUT the Telegram bot / Render — purely generates + uploads a Short at
// fixed Nigerian times (11am / 2pm / 5pm WAT) when enabled. Ideal for running on
// this PC (or a VM/VPS) so the video workflow is fully autonomous regardless of
// where the bot lives.
//
// Control (state persisted in temp_media/video_mode.json):
//   node src/workflows/video/standalone.js on      -> enable auto-posting
//   node src/workflows/video/standalone.js off     -> disable
//   node src/workflows/video/standalone.js status  -> show state
//   node src/workflows/video/standalone.js now     -> post one immediately
//   (no arg)                                       -> run the scheduler loop
//
// Notifications go straight to Telegram via the Bot API (no long-polling), so it
// never conflicts with the Render-hosted bot.
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", "..", ".env") });

const videoWorkflow = require("./index.js");
const BASE = process.env.FORCHI_BASE || path.resolve(__dirname, "..", "..", "..");
const MODE_FILE = path.join(BASE, "temp_media", "video_mode.json");
const DEFAULT_MIN = 15;
const DEFAULT_MAX = 50;

function loadMode() {
  try { return JSON.parse(fs.readFileSync(MODE_FILE, "utf8")); } catch { return {}; }
}
function saveMode(m) {
  try { fs.mkdirSync(path.dirname(MODE_FILE), { recursive: true }); fs.writeFileSync(MODE_FILE, JSON.stringify(m, null, 2)); } catch (e) { console.warn("[Standalone] saveMode:", e.message); }
}

function chatId() {
  const env = (process.env.JOBS_NOTIFY_CHAT_ID || "").trim();
  if (env) return env;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(BASE, "data", "jobs_notify.json"), "utf8"));
    return (j.chatId || "").trim() || null;
  } catch { return null; }
}

async function notify(text) {
  const token = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const id = chatId();
  if (!token || !id) { console.log("[Standalone] (no Telegram chat configured) notify:", text); return; }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: id, text, parse_mode: "Markdown" }),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) console.warn("[Standalone] notify HTTP", r.status);
  } catch (e) { console.warn("[Standalone] notify failed:", e.message); }
}

// Fixed 3 Shorts/day at 11:00, 14:00 and 17:00 Nigerian time (WAT) — USER
// DIRECTIVE (2026-09-08). Exact local slot times, no random interval.
const SLOT_HOURS_WAT = [11, 14, 17];
const TZ = "Africa/Lagos"; // WAT, UTC+1, no DST

// Wall-clock parts of `date` in `tz` (same approach as the V10 scheduler).
function zonedParts(date, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(date);
  const get = (t) => parseInt((parts.find((p) => p.type === t) || {}).value, 10);
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour") === 24 ? 0 : get("hour"), mi: get("minute"), s: get("second") };
}
function tzOffsetMs(dateUtc, tz) {
  const p = zonedParts(new Date(dateUtc), tz);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - dateUtc;
}

// Next fixed slot (11/14/17 WAT), strictly in the future.
function nextSlotAt(now = Date.now()) {
  for (let day = 0; day < 8; day++) {
    const probe = new Date(now + day * 86400000);
    const p = zonedParts(probe, TZ);
    for (const h of SLOT_HOURS_WAT) {
      const guessUtc = Date.UTC(p.y, p.mo - 1, p.d, h, 0, 0);
      const runUtc = guessUtc - tzOffsetMs(guessUtc, TZ);
      if (runUtc > now) return runUtc;
    }
  }
  return now + 86400000;
}

let timer = null;
function scheduleNext() {
  if (timer) { clearTimeout(timer); timer = null; }
  const at = nextSlotAt();
  const m = loadMode();
  m.enabled = true;
  m.nextRunAt = at;
  saveMode(m);
  const lbl = new Date(at).toLocaleString("en-US", { timeZone: TZ, weekday: "short", hour: "numeric", minute: "2-digit", hour12: true });
  console.log(`[Standalone] next Short at ${lbl} (${new Date(at).toISOString()})`);
  timer = setTimeout(tick, at - Date.now());
  if (typeof timer.unref === "function") timer.unref();
}

let running = false;
async function tick() {
  const m = loadMode();
  if (!m.enabled) { m.nextRunAt = null; saveMode(m); return; }
  if (running || videoWorkflow.state.running) return;
  running = true;
  console.log("[Standalone] generating a Short...");
  try {
    await videoWorkflow.runOnce({ notify });
  } catch (e) {
    console.error("[Standalone] run failed:", e.message);
  } finally {
    running = false;
    scheduleNext();
  }
}

async function main() {
  const cmd = (process.argv[2] || "").toLowerCase();

  if (cmd === "on") {
    const m = loadMode(); m.enabled = true; saveMode(m);
    console.log("[Standalone] enabled. Run without args to start the loop (or 'now' for an immediate post).");
    return;
  }
  if (cmd === "off") {
    const m = loadMode(); m.enabled = false; m.nextRunAt = null; saveMode(m);
    console.log("[Standalone] disabled.");
    return;
  }
  if (cmd === "status") {
    const m = loadMode();
    console.log(JSON.stringify({
      enabled: !!m.enabled,
      nextRunAt: m.nextRunAt ? new Date(m.nextRunAt).toISOString() : null,
      minJitter: m.minJitterMinutes ?? DEFAULT_MIN,
      maxJitter: m.maxJitterMinutes ?? DEFAULT_MAX,
      totalPosts: videoWorkflow.loadPosts().length,
      lastPost: videoWorkflow.getVideoState().lastPost,
    }, null, 2));
    return;
  }
  if (cmd === "now") {
    console.log("[Standalone] posting one now...");
    await videoWorkflow.runOnce({ notify });
    return;
  }

  // scheduler loop
  const m = loadMode();
  if (!m.enabled) console.log("[Standalone] video auto is OFF — enable with: node src/workflows/video/standalone.js on");
  if (m.enabled && m.nextRunAt && m.nextRunAt > Date.now()) {
    const mins = Math.round((m.nextRunAt - Date.now()) / 60000);
    console.log(`[Standalone] resuming: next Short in ~${mins} min`);
    timer = setTimeout(tick, Math.max(1000, m.nextRunAt - Date.now()));
  } else {
    scheduleNext();
  }
  // watchdog: pick up missed runs if the process was off across a due time
  setInterval(() => {
    const mm = loadMode();
    if (!mm.enabled) return;
    if (mm.nextRunAt && Date.now() >= mm.nextRunAt) tick();
  }, 30000);
  console.log("[Standalone] scheduler loop running — ctrl-c to stop.");
}

main().catch((e) => { console.error(e); process.exit(1); });
process.on("SIGINT", () => { console.log("\n[Standalone] stopping"); process.exit(0); });
process.on("SIGTERM", () => process.exit(0));
