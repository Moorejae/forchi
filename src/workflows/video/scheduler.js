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

function jitterMinutes() {
  const { min, max } = loadRange();
  return Math.round(min + Math.random() * (max - min));
}

function getSchedulerState() {
  const r = loadRange();
  return {
    registered,
    running,
    enabled: videoWorkflow.state.enabled,
    autoMode: autoMode.isEnabled(),
    nextScheduled: videoWorkflow.state.nextScheduled,
    minJitter: r.min,
    maxJitter: r.max,
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
  console.log(`[VideoScheduler] next Short in ~${mins} min (${videoWorkflow.state.nextScheduled})`);
  timer = setTimeout(tick, mins * 60000);
  if (typeof timer.unref === "function") timer.unref();
}

function initVideoScheduler({ notify: nf } = {}) {
  if (registered) return;
  notify = nf;
  registered = true;
  scheduleNext();
  console.log("[VideoScheduler] registered (random 15-50 min jitter between Shorts)");
}

function reRegister({ notify: nf } = {}) {
  if (timer) { clearTimeout(timer); timer = null; }
  registered = false;
  running = false;
  if (nf) notify = nf;
  initVideoScheduler({ notify });
}

module.exports = { initVideoScheduler, reRegister, getSchedulerState, resetRunning };
