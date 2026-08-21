// src/workflows/video/authWatch.js
// YouTube OAuth health watcher — keeps the one-time-consent token alive.
//
// Context: the OAuth app is UNVERIFIED (sensitive scopes like youtube.upload),
// so Google expires its refresh token after ~7 days. Full verification needs a
// paid CASA assessment, so instead we re-consent once a week with a single click.
//
// Every few hours this module:
//   • No refresh token at all  -> DM owner a one-click consent URL
//   • Live refresh attempt     -> invalid_grant = expired -> DM consent URL
//   • Pre-emptive: >=6 days old -> DM "re-approve now, expires in ~1 day"
// Throttled to one DM per day per issue so it never spams. The consent URL is
// generated from YOUTUBE_CLIENT_ID + YOUTUBE_CALLBACK_URL, and the callback
// (bot.js /oauth2callback) persists the token + authorizedAt to Render env vars
// so the 7-day clock survives redeploys.
const fs = require("fs");
const path = require("path");

const BASE = "c:\\Users\\hp\\forchi";
const STATE_FILE = path.join(BASE, "temp_media", "youtube_auth_state.json");
const EXPIRY_DAYS = 7;            // Google: unverified apps get 7-day refresh tokens
const WARN_DAYS = 6;              // warn 1 day before expiry
const THROTTLE_MS = 24 * 3600 * 1000; // one DM per day per issue

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return {}; }
}
function saveState(s) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); } catch {}
}
function youtube() { return require("./youtube.js"); }

function consentUrl() {
  try { return youtube().consentUrl(); } catch (e) { return null; }
}

// Call right after a successful OAuth callback / CLI auth (records the clock).
function recordAuth(token) {
  const s = loadState();
  s.authorizedAt = Date.now();
  s.tokenPresent = !!token || !!(process.env.YOUTUBE_REFRESH_TOKEN);
  s.lastWarned = 0; // fresh token -> allow a new warn when it ages again
  saveState(s);
}

function getAuthState() {
  const s = loadState();
  const envAuthed = process.env.YOUTUBE_AUTHED_AT ? Number(process.env.YOUTUBE_AUTHED_AT) : null;
  const authorizedAt = envAuthed || s.authorizedAt || null;
  const token = process.env.YOUTUBE_REFRESH_TOKEN;
  const expiresAt = authorizedAt ? authorizedAt + EXPIRY_DAYS * 24 * 3600 * 1000 : null;
  const hoursLeft = expiresAt ? Math.floor((expiresAt - Date.now()) / 3600000) : null;
  return {
    tokenPresent: !!token,
    authorizedAt: authorizedAt ? new Date(authorizedAt).toISOString() : null,
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    hoursLeft,
    lastWarnedAt: s.lastWarned ? new Date(s.lastWarned).toISOString() : null,
  };
}

function buildConsentMessage(why) {
  const url = consentUrl();
  const link = url || "(couldn't build consent URL — check YOUTUBE_CLIENT_ID / YOUTUBE_CALLBACK_URL)";
  return (
    `🎬 *ForChi YouTube — action needed*\n\n` +
    `${why}\n\n` +
    `👉 *Click to authorize* (signed in as aguswigad@gmail.com — @sirxlud):\n${link}\n\n` +
    `Then: *Allow* → if you see "Google hasn't verified this app" click *Advanced* → *Go to forchi.onrender.com (unsafe)* → *Allow*. You'll land on the green "ForChi is connected to YouTube" page — I'll take it from there.`
  );
}

async function checkYoutubeAuth({ notify } = {}) {
  const s = loadState();
  const now = Date.now();
  const token = process.env.YOUTUBE_REFRESH_TOKEN;

  const warn = (msg) => {
    s.lastWarned = now;
    saveState(s);
    if (notify) notify(msg);
    else console.warn("[YouTubeAuth] " + msg);
  };

  // 1) No token at all -> needs the very first consent.
  if (!token) {
    if (s.lastWarned && now - s.lastWarned < THROTTLE_MS) return { ok: false, reason: "no-token", throttled: true };
    console.warn("[YouTubeAuth] no YOUTUBE_REFRESH_TOKEN yet");
    warn(buildConsentMessage("I have no YouTube authorization yet, so I can't upload Shorts."));
    return { ok: false, reason: "no-token" };
  }

  // 2) Live-validate the token with a real refresh attempt.
  let refreshOk = false;
  let refreshErr = null;
  try {
    await youtube().refreshAccess();
    refreshOk = true;
  } catch (err) {
    refreshErr = err.message || String(err);
  }

  if (refreshOk) {
    s.lastOk = now;
    s.lastWarned = 0; // healthy -> reset warn cooldown
    saveState(s);
    return { ok: true, reason: "healthy" };
  }

  // Refresh failed — only "invalid_grant" means the token is actually expired.
  if (!/invalid_grant/i.test(refreshErr)) {
    console.warn("[YouTubeAuth] refresh error (transient, not expired — ignoring):", refreshErr);
    return { ok: true, reason: "transient", error: refreshErr };
  }

  // 3) Expired (invalid_grant) -> one-click re-consent, throttled.
  if (s.lastWarned && now - s.lastWarned < THROTTLE_MS) return { ok: false, reason: "expired", throttled: true };
  warn(buildConsentMessage("My YouTube access just expired (unverified apps must be re-approved about once a week)."));
  return { ok: false, reason: "expired" };
}

// Pre-emptive weekly warning: warn when the token is >= WARN_DAYS old (approx
// 1 day left) so the owner can re-approve before anything breaks.
function checkPreemptive({ notify } = {}) {
  const s = loadState();
  const envAuthed = process.env.YOUTUBE_AUTHED_AT ? Number(process.env.YOUTUBE_AUTHED_AT) : null;
  const authorizedAt = envAuthed || s.authorizedAt || null;
  if (!authorizedAt) return { ok: true, reason: "no-eta" };
  const now = Date.now();
  if (now < authorizedAt + WARN_DAYS * 24 * 3600 * 1000) return { ok: true, reason: "still-fresh" };
  if (s.lastWarned && now - s.lastWarned < THROTTLE_MS) return { ok: true, reason: "throttled" };
  s.lastWarned = now;
  saveState(s);
  if (notify) notify(buildConsentMessage("My YouTube access expires in about a day. Re-approve now so posting never breaks."));
  else console.warn("[YouTubeAuth] pre-emptive re-auth needed");
  return { ok: false, reason: "expiring" };
}

// One combined check for the interval: live-validate + pre-emptive aging.
async function runAuthCheck({ notify } = {}) {
  const res = await checkYoutubeAuth({ notify });
  if (res.reason !== "no-token" && res.reason !== "expired") {
    checkPreemptive({ notify });
  }
  return getAuthState();
}

let timer = null;
function startAuthWatch({ notify } = {}, intervalMs = 6 * 3600 * 1000) {
  if (timer) return;
  runAuthCheck({ notify }).catch((e) => console.warn("[YouTubeAuth] initial check failed:", e.message));
  timer = setInterval(() => {
    runAuthCheck({ notify }).catch((e) => console.warn("[YouTubeAuth] check failed:", e.message));
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  console.log("[YouTubeAuth] watcher started (every 6h, one DM/day max)");
}

module.exports = {
  checkYoutubeAuth,
  checkPreemptive,
  runAuthCheck,
  startAuthWatch,
  getAuthState,
  recordAuth,
  consentUrl,
};
