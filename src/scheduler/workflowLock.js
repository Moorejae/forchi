// src/scheduler/workflowLock.js
// GLOBAL single-workflow lock — the user's "nothing runs simultaneously on the VPS"
// rule. A file-based mutex in temp_media so only ONE heavy workflow (V10 build /
// V10 publish / jobs scan / social post) may run at a time. Others see the lock
// and skip their tick (they self-reschedule on the next interval).
//
// Semantics:
//   tryAcquire(name, { ttlMs }) -> true if we got the lock, false if busy
//   release(name)               -> free the lock (always safe)
//   isLocked() / owner()        -> inspection for health/status
//
// A stale lock (owner process died) is auto-released after ttlMs (default 3h).
const fs = require("fs");
const path = require("path");

const BASE = process.env.FORCHI_BASE || path.resolve(__dirname, "..", "..", "..");
const LOCK_FILE = path.join(BASE, "temp_media", "workflow.lock");
const DEFAULT_TTL_MS = 3 * 60 * 60 * 1000; // 3h — a build can take a while

function read() {
  try { return JSON.parse(fs.readFileSync(LOCK_FILE, "utf8")); } catch { return null; }
}
function write(l) {
  try { fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true }); } catch {}
  try { fs.writeFileSync(LOCK_FILE, JSON.stringify(l)); } catch {}
}

function isLocked() {
  const l = read();
  if (!l || !l.owner) return false;
  // stale lock? (owner died without releasing)
  if (Date.now() - (l.at || 0) > (l.ttlMs || DEFAULT_TTL_MS)) {
    write({ owner: null, name: null, at: 0, ttlMs: DEFAULT_TTL_MS });
    return false;
  }
  return true;
}

function owner() {
  const l = read();
  return l && l.owner ? { owner: l.owner, name: l.name, at: l.at } : null;
}

// Try to acquire. Returns true on success, false if another workflow holds it.
function tryAcquire(name, { ttlMs = DEFAULT_TTL_MS } = {}) {
  if (isLocked()) return false;
  write({ owner: `${process.pid}`, name: name || "unknown", at: Date.now(), ttlMs });
  return true;
}

// Release the lock (only if we own it, to avoid stepping on a newer owner).
function release(name) {
  const l = read();
  if (!l) return;
  if (name && l.name && l.name !== name) return; // don't release someone else's
  write({ owner: null, name: null, at: 0, ttlMs: DEFAULT_TTL_MS });
}

module.exports = { tryAcquire, release, isLocked, owner, LOCK_FILE };
