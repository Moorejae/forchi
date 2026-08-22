// src/workflows/video/scheduler.js
// Video auto-post scheduler: posts one Short, then schedules the next with a
// RANDOM 15-50 minute jitter (human-like timing, anti-spam). Self-rescheduling
// loop (random gap -> not a fixed cron). Respects video-mode + global auto-mode.
const fs = require("fs");
const path = require("path");
const videoWorkflow = require("./index.js");
const autoMode = require("../../scheduler/autoMode.js");

const BASE = process.env.FORCHI_BASE || path.resolve(__dirname, "..", "..", "..");
const MODE_FILE = path.join(BASE, "temp_media", "video_mode.json");
const DEFAULT_MIN = 15;
const DEFAULT_MAX = 50;

let timer = null;
let running = false;
let registered = false;
let notify = null;

function loadRange() {
  try {
    const m = JSON.parse(fs.readFileSync(MODE_FILE, "utf8"));
    const min = m.minJitterMinutes != null ? Number(m.minJitterMinutes) : DEFAULT_MIN;
    const max = m.maxJitterMinutes != null ? Number(m.maxJitterMinutes) : DEFAULT_MAX;
    return { min: Math.max(2, Math.min(min, max)), max: Math.max(min, max) };
  } catch {
    return { min: DEFAULT_MIN, max: DEFAULT_MAX };
  }
}

// 5 Shorts/day: random 3-6 HOURS apart PLUS a 15-50 min human-like variation
// (avg ~5h -> ~5 posts/day; the 15-50 min keeps the organic feel).
const HOURS_MIN = 3;
const HOURS_MAX = 6;
const EXTRA_MIN = 15;
const EXTRA_MAX = 50;

function jitterMinutes() {
  const hours = HOURS_MIN + Math.random() * (HOURS_MAX - HOURS_MIN);
  const extra = EXTRA_MIN + Math.random() * (EXTRA_MAX - EXTRA_MIN);
  return Math.round(hours * 60 + extra);
}

function fmtGap(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function getSchedulerState() {
  return {
    registered,
    running,
    enabled: videoWorkflow.state.enabled,
    autoMode: autoMode.isEnabled(),
    nextScheduled: videoWorkflow.state.nextScheduled,
    minJitter: HOURS_MIN * 60 + EXTRA_MIN,
    maxJitter: HOURS_MAX * 60 + EXTRA_MAX,
    lastPost: videoWorkflow.getVideoState().lastPost,
    consecutiveFailures: videoWorkflow.getVideoState().consecutiveFailures,
  };
}

function resetRunning() {
  if (running) {
    console.warn("[VideoScheduler] resetRunning: cleared a stuck in-progress flag.");
    running = false;
  }
}

async function tick() {
  if (!videoWorkflow.state.enabled) { videoWorkflow.state.nextScheduled = null; return; }
  if (!autoMode.isEnabled()) { videoWorkflow.state.nextScheduled = null; return; }
  if (running || videoWorkflow.state.running) return;
  running = true;
  try {
    await videoWorkflow.runOnce({ notify });
  } catch (e) {
    // handled inside runOnce (state.lastError + notify)
  } finally {
    running = false;
    scheduleNext();
  }
}

function scheduleNext() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!videoWorkflow.state.enabled || !autoMode.isEnabled()) {
    videoWorkflow.state.nextScheduled = null;
    return;
  }
  const mins = jitterMinutes();
  videoWorkflow.state.nextScheduled = new Date(Date.now() + mins * 60000).toISOString();
  console.log(`[VideoScheduler] next Short in ~${fmtGap(mins)} (${videoWorkflow.state.nextScheduled})`);
  timer = setTimeout(tick, mins * 60000);
  if (typeof timer.unref === "function") timer.unref();
}

function initVideoScheduler({ notify: nf } = {}) {
  if (registered) return;
  notify = nf;
  registered = true;
  scheduleNext();
  console.log("[VideoScheduler] registered (~5 posts/day: 3-6h apart + 15-50 min jitter)");
}

function reRegister({ notify: nf } = {}) {
  if (timer) { clearTimeout(timer); timer = null; }
  registered = false;
  running = false;
  if (nf) notify = nf;
  initVideoScheduler({ notify });
}

module.exports = { initVideoScheduler, reRegister, getSchedulerState, resetRunning };
