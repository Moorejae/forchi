// ForChi V10 daily scheduler — TWO 5-min video posts per day (Nigerian time, WAT).
// USER DIRECTIVE (2026-09-02): publish the V10 videos at 2pm and 8pm Nigerian time.
//   Slot 1: BUILD 8:00  -> PUBLISH 14:00 (2pm WAT) + 15-50 min jitter
//   Slot 2: BUILD 16:00 -> PUBLISH 20:00 (8pm WAT) + 15-50 min jitter
//
// State lives in temp_media/v10_mode.json:
//   { enabled, jitterMinMinutes, jitterMaxMinutes, targetTz,
//     slots: [ { label, buildHour, buildMinute, targetHour, targetMinute,
//                nextBuildAt, nextPublishAt, pendingRunId,
//                lastBuildAt, lastPublishAt }, ... ] }
// Legacy single-slot state (top-level nextBuildAt/nextPublishAt/buildHour...) is
// migrated automatically on load.
//
// Usage (CLI):
//   node src/workflows/video/v10Scheduler.js on|off|status|now
//   node src/workflows/video/v10Scheduler.js            (starts the watchdog loop)
const fs = require("fs");
const path = require("path");

const BASE = process.env.FORCHI_BASE || path.resolve(__dirname, "..", "..", "..");
const STATE_FILE = path.join(BASE, "temp_media", "v10_mode.json");

const DEFAULTS = {
  enabled: false,
  jitterMinMinutes: 15,
  jitterMaxMinutes: 50,
  targetTz: "Africa/Lagos", // Nigerian time (WAT, UTC+1, no DST)
  // Legacy top-level fields (kept for backward compat; slots[] is the source of truth)
  buildHour: 8, buildMinute: 0, targetHour: 14, targetMinute: 0,
  slots: [
    { label: "Morning", buildHour: 8,  buildMinute: 0, targetHour: 14, targetMinute: 0 }, // 2pm WAT
    { label: "Evening", buildHour: 16, buildMinute: 0, targetHour: 20, targetMinute: 0 }, // 8pm WAT
  ],
};

function rawState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return {}; }
}
function loadState() {
  const d = Object.assign({}, DEFAULTS, rawState());
  // Migrate legacy single-slot state into slots[]
  if (!Array.isArray(d.slots)) {
    d.slots = [
      { label: "Morning", buildHour: d.buildHour, buildMinute: d.buildMinute, targetHour: d.targetHour, targetMinute: d.targetMinute },
      Object.assign({}, DEFAULTS.slots[1]),
    ];
  }
  d.slots.forEach((sl, i) => {
    sl.label = sl.label || (i === 0 ? "Morning" : "Evening");
    sl.buildHour = sl.buildHour != null ? sl.buildHour : (i === 0 ? 8 : 16);
    sl.buildMinute = sl.buildMinute != null ? sl.buildMinute : 0;
    sl.targetHour = sl.targetHour != null ? sl.targetHour : (i === 0 ? 14 : 20);
    sl.targetMinute = sl.targetMinute != null ? sl.targetMinute : 0;
    sl.nextBuildAt = sl.nextBuildAt || null;
    sl.nextPublishAt = sl.nextPublishAt || null;
    sl.pendingRunId = sl.pendingRunId || null;
    sl.lastBuildAt = sl.lastBuildAt || null;
    sl.lastPublishAt = sl.lastPublishAt || null;
  });
  return d;
}
function saveState(s) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); } catch (e) { console.warn("[v10sched] save failed:", e.message); }
}

// Wall-clock parts of `date` in `tz`.
function zonedParts(date, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(date);
  const get = (t) => parseInt((parts.find((p) => p.type === t) || {}).value, 10);
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour") === 24 ? 0 : get("hour"), mi: get("minute"), s: get("second") };
}

// Millisecond offset for a given UTC timestamp in `tz` (tz local = utc + offset).
function tzOffsetMs(dateUtc, tz) {
  const p = zonedParts(new Date(dateUtc), tz);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - dateUtc;
}

// Next occurrence of hour:minute in tz (+ optional jitter ms), strictly in the future.
function computeNextTime(now, hour, minute, tz, jitterMs = 0) {
  for (let day = 0; day < 8; day++) {
    const probe = new Date(now + day * 86400000);
    const p = zonedParts(probe, tz);
    const guessUtc = Date.UTC(p.y, p.mo - 1, p.d, hour, minute, 0);
    const off = tzOffsetMs(guessUtc, tz);
    const runUtc = guessUtc - off + jitterMs;
    if (runUtc > now) return runUtc;
  }
  return now + 86400000;
}

function jitterMs(s) {
  return (s.jitterMinMinutes + Math.random() * (s.jitterMaxMinutes - s.jitterMinMinutes)) * 60000;
}

// Slot-0 aliases (backward compat for old callers).
function computeNextBuild(now = Date.now()) {
  const s = loadState();
  const sl = s.slots[0];
  return computeNextTime(now, sl.buildHour, sl.buildMinute, s.targetTz, 0);
}
function computeNextPublish(now = Date.now()) {
  const s = loadState();
  const sl = s.slots[0];
  return computeNextTime(now, sl.targetHour, sl.targetMinute, s.targetTz, jitterMs(s));
}
// Compatibility alias (older callers used computeNextRun = publish time).
function computeNextRun(now = Date.now()) {
  return computeNextPublish(now);
}

function nextRunLabel(ts) {
  if (!ts) return "never";
  try {
    return new Date(ts).toLocaleString("en-US", { timeZone: loadState().targetTz, dateStyle: "medium", timeStyle: "short" });
  } catch { return new Date(ts).toISOString(); }
}

function status() {
  const s = loadState();
  return {
    enabled: !!s.enabled,
    slots: s.slots.map((sl) => ({
      label: sl.label,
      nextBuildAt: sl.nextBuildAt || null,
      nextBuildLabel: nextRunLabel(sl.nextBuildAt),
      nextPublishAt: sl.nextPublishAt || null,
      nextPublishLabel: nextRunLabel(sl.nextPublishAt),
      pendingRunId: sl.pendingRunId || null,
      lastBuildAt: sl.lastBuildAt || null,
      lastPublishAt: sl.lastPublishAt || null,
      buildTime: `${sl.buildHour}:${String(sl.buildMinute).padStart(2, "0")} ${s.targetTz}`,
      publishTime: `${sl.targetHour}:${String(sl.targetMinute).padStart(2, "0")} ${s.targetTz} (${s.jitterMinMinutes}-${s.jitterMaxMinutes} min jitter)`,
    })),
  };
}

// TWO-SLOT daily watchdog: each slot has a BUILD phase and a PUBLISH phase.
// buildFn runs the pipeline in build-only mode and returns { runId }; publishFn
// uploads that run. The firing slot is passed as the first arg so callers can vary
// theme/etc. per slot if desired.
function startV10Scheduler({ buildFn, publishFn } = {}, { notify } = {}, intervalMs = 30000) {
  let running = false;
  const tick = async () => {
    const s = loadState();
    if (!s.enabled || running) return;
    const now = Date.now();

    // Initialize missing slot timestamps.
    let dirty = false;
    s.slots.forEach((sl) => {
      if (!sl.nextBuildAt) { sl.nextBuildAt = computeNextTime(now, sl.buildHour, sl.buildMinute, s.targetTz, 0); dirty = true; }
      if (!sl.nextPublishAt) { sl.nextPublishAt = computeNextTime(now, sl.targetHour, sl.targetMinute, s.targetTz, jitterMs(s)); dirty = true; }
    });
    if (dirty) saveState(s);

    // ---- BUILD phase: whichever slot is due ----
    const dueBuild = s.slots.find((sl) => now >= sl.nextBuildAt);
    if (dueBuild && buildFn) {
      running = true;
      try {
        console.log(`[v10sched] BUILD firing (${dueBuild.label})`, new Date().toISOString());
        const res = await buildFn(dueBuild);
        const st = loadState();
        const sl = st.slots.find((x) => x.label === dueBuild.label) || st.slots[0];
        sl.lastBuildAt = Date.now();
        sl.pendingRunId = (res && (res.runId || res.runDir)) ? String(res.runId || res.runDir) : null;
        sl.nextBuildAt = computeNextTime(now, sl.buildHour, sl.buildMinute, st.targetTz, 0);
        saveState(st);
        if (notify) {
          try {
            notify(sl.pendingRunId
              ? `🎬 V10 video built (${sl.pendingRunId}, ${sl.label}) — will publish at ${nextRunLabel(sl.nextPublishAt)}`
              : `⚠️ V10 ${sl.label} build finished but produced no video (will retry next slot)`);
          } catch {}
        }
        console.log(`[v10sched] ${sl.label} next build:`, nextRunLabel(sl.nextBuildAt), "| pending:", sl.pendingRunId);
      } catch (e) {
        console.warn(`[v10sched] ${dueBuild.label} build failed:`, e.message);
        const st = loadState();
        const sl = st.slots.find((x) => x.label === dueBuild.label) || st.slots[0];
        sl.nextBuildAt = Date.now() + 60 * 60000; // retry in an hour
        saveState(st);
      } finally { running = false; }
      return;
    }

    // ---- PUBLISH phase: whichever slot is due ----
    const duePublish = s.slots.find((sl) => now >= sl.nextPublishAt);
    if (duePublish) {
      running = true;
      try {
        console.log(`[v10sched] PUBLISH firing (${duePublish.label})`, new Date().toISOString());
        const st = loadState();
        const sl = st.slots.find((x) => x.label === duePublish.label) || st.slots[0];
        if (sl.pendingRunId && publishFn) {
          await publishFn(sl.pendingRunId);
          sl.pendingRunId = null;
          sl.lastPublishAt = Date.now();
          if (notify) { try { notify(`✅ V10 published (${sl.label}) at ` + nextRunLabel(sl.lastPublishAt)); } catch {} }
        } else {
          if (notify) { try { notify(`⚠️ V10 ${sl.label} publish skipped: no built video ready (next build at ${nextRunLabel(sl.nextBuildAt)})`); } catch {} }
        }
        sl.nextPublishAt = computeNextTime(now, sl.targetHour, sl.targetMinute, st.targetTz, jitterMs(st));
        saveState(st);
        console.log(`[v10sched] ${sl.label} next publish:`, nextRunLabel(sl.nextPublishAt));
      } catch (e) {
        console.warn(`[v10sched] ${duePublish.label} publish failed:`, e.message);
        const st = loadState();
        const sl = st.slots.find((x) => x.label === duePublish.label) || st.slots[0];
        sl.nextPublishAt = Date.now() + 60 * 60000; // retry in an hour
        saveState(st);
      } finally { running = false; }
      return;
    }
  };
  const iv = setInterval(tick, intervalMs);
  tick();
  if (typeof iv.unref === "function") iv.unref();
  const st = status();
  console.log(`[v10sched] scheduler started (${st.slots.map((x) => `${x.label}: build ${x.buildTime}, publish ${x.publishTime}`).join(" | ")})`);
  return { interval: iv, tick };
}

// CLI
if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === "on" || cmd === "off") {
    const s = loadState();
    s.enabled = cmd === "on";
    const now = Date.now();
    s.slots.forEach((sl) => {
      if (!sl.nextBuildAt) sl.nextBuildAt = computeNextTime(now, sl.buildHour, sl.buildMinute, s.targetTz, 0);
      if (!sl.nextPublishAt) sl.nextPublishAt = computeNextTime(now, sl.targetHour, sl.targetMinute, s.targetTz, jitterMs(s));
    });
    saveState(s);
    const st = status();
    console.log(`[v10sched] ${cmd === "on" ? "ENABLED" : "DISABLED"} — ${st.slots.map((x) => `${x.label}: build ${x.nextBuildLabel}, publish ${x.nextPublishLabel}`).join(" | ")}`);
  } else if (cmd === "status") {
    console.log(JSON.stringify(status(), null, 2));
  } else if (cmd === "now") {
    // arm the NEXT-due slot's build to fire immediately
    const s = loadState();
    const now = Date.now();
    const next = s.slots.reduce((a, b) => (!a.nextBuildAt || b.nextBuildAt < a.nextBuildAt ? b : a));
    next.nextBuildAt = now - 1000;
    if (!next.nextPublishAt) next.nextPublishAt = computeNextTime(now, next.targetHour, next.targetMinute, s.targetTz, jitterMs(s));
    saveState(s);
    console.log(`[v10sched] armed ${next.label} to build now (watchdog builds, then publishes at ${nextRunLabel(next.nextPublishAt)})`);
  } else {
    // start the watchdog with no-op fns (production wires buildFn/publishFn)
    startV10Scheduler({ buildFn: async () => { console.warn("[v10sched] no buildFn wired — doing nothing"); return null; } });
  }
}

module.exports = { loadState, saveState, computeNextBuild, computeNextPublish, computeNextRun, nextRunLabel, status, startV10Scheduler, DEFAULTS };
