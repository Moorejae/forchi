// ForChi V10 WATCHDOG — wires the two-slot V10 scheduler to the real pipeline.
//
// Runs forever (systemd): every scheduler tick, if a slot's BUILD time is due it
// runs the V10 pipeline in build-only mode (Vertex images + Contabo voice, off
// HF), and when a slot's PUBLISH time is due it uploads the pre-built run.
//
// Usage:
//   node src/workflows/video/v10Watchdog.js            (start the watchdog)
//   node src/workflows/video/v10Watchdog.js on|off|status|now
const path = require("path");
const BASE = process.env.FORCHI_BASE || path.resolve(__dirname, "..", "..", "..");
require("dotenv").config({ path: path.join(BASE, ".env") });

const v10 = require("./v10Pipeline.js");
const sched = require("./v10Scheduler.js");
const wlock = require("../../scheduler/workflowLock.js");

// Notifications -> Telegram (best-effort; uses the bot token + jobs chat).
async function notify(text) {
  const token = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const chat = (process.env.JOBS_NOTIFY_CHAT_ID || process.env.TELEGRAM_CHAT_ID || "").trim();
  if (!token || !chat) { console.log("[v10watch] (no telegram) notify:", text); return; }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: "Markdown" }),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) console.warn("[v10watch] notify HTTP", r.status);
  } catch (e) { console.warn("[v10watch] notify failed:", e.message); }
}

// BUILD: run the full pipeline in build-only mode (no upload), returns { runId }.
// Honours the GLOBAL single-workflow lock: if a jobs/social workflow is running,
// skip this tick (the scheduler will retry). One workflow at a time on the VPS.
async function buildFn(slot) {
  if (!wlock.tryAcquire("v10_build", { ttlMs: 4 * 60 * 60 * 1000 })) {
    const o = wlock.owner();
    console.warn(`[v10watch] build SKIPPED — ${o ? o.name + " (pid " + o.owner + ")" : "another workflow"} holds the lock`);
    return null;
  }
  try {
    console.log(`[v10watch] buildFn firing for slot "${slot.label}"`);
    const theme = undefined; // v10ScriptGen rotates themes internally
    const res = await v10.runOnce({ buildOnly: true, theme, notify });
    const rid = res && res.runId;
    if (!rid) throw new Error("pipeline returned no runId");
    console.log(`[v10watch] built run ${rid}`);
    return { runId: rid, runDir: res.runDir };
  } finally {
    wlock.release("v10_build");
  }
}

// PUBLISH: upload a pre-built run to YouTube.
async function publishFn(runId) {
  if (!wlock.tryAcquire("v10_publish", { ttlMs: 90 * 60 * 1000 })) {
    const o = wlock.owner();
    console.warn(`[v10watch] publish SKIPPED — ${o ? o.name + " (pid " + o.owner + ")" : "another workflow"} holds the lock`);
    return;
  }
  try {
    console.log(`[v10watch] publishFn firing for run ${runId}`);
    await v10.publishRun(runId, { notify });
  } finally {
    wlock.release("v10_publish");
  }
}

const cmd = (process.argv[2] || "").toLowerCase();
if (cmd === "on" || cmd === "off" || cmd === "status" || cmd === "now") {
  const { execFileSync } = require("child_process");
  execFileSync("node", [path.join(__dirname, "v10Scheduler.js"), cmd], {
    stdio: "inherit", cwd: BASE,
  });
} else {
  sched.startV10Scheduler({ buildFn, publishFn }, { notify });
  console.log("[v10watch] V10 watchdog started (build 8:00/16:00 -> publish 14:00/20:00 WAT)");
  // The scheduler's internal interval is unref'd (so a CLI `node v10Scheduler.js`
  // can exit cleanly). As a systemd daemon we MUST keep the event loop alive.
  const keepalive = setInterval(() => {}, 60 * 1000);
  console.log("[v10watch] keepalive armed (daemon mode)");
}
