// src/workflows/video/tiktokAuthWatch.js
// TikTok OAuth health watcher — keeps the one-time-consent token alive.
//
// TikTok access tokens auto-refresh every ~24h via the refresh token, so the
// only thing that ever needs a NEW consent is the refresh token expiring
// (default ~365 days; TikTok returns `refresh_expires_in` at consent/refresh).
//
// Every few hours this module:
//   • no refresh token at all     -> send consent URL (Telegram + email)
//   • live refresh attempt        -> invalid_grant = expired -> send consent URL
//   • pre-emptive: <=1 day left   -> send "re-approve now, expires soon"
// Throttled to one notify per day per issue. The consent URL goes to BOTH:
//   • Telegram (backticked so underscores survive Markdown)
//   • Email (plain clickable text — Telegram can mangle long URLs)
//
// Tokens + auth clock live in the jobs DB kv (survive redeploys/restarts).
const fs = require("fs");
const path = require("path");

const BASE = process.env.FORCHI_BASE || path.resolve(__dirname, "..", "..", "..");
const STATE_FILE = path.join(BASE, "temp_media", "tiktok_auth_state.json");
const DEFAULT_REFRESH_SECONDS = 365 * 24 * 3600; // TikTok default refresh_expires_in
const WARN_BEFORE_MS = 24 * 3600 * 1000;         // warn 1 day before expiry
const THROTTLE_MS = 24 * 3600 * 1000;            // one notify per day per issue

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return {}; }
}
function saveState(s) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); } catch {}
}
function tiktok() { return require("./tiktok.js"); }

function consentUrl() {
  try { return tiktok().consentUrl(); } catch (e) { return null; }
}

async function getAuthState() {
  const ts = require("./tokenStore.js");
  let refresh = null, authedAt = null, expSec = null;
  try { refresh = (await ts.getTikTokRefreshToken()) || null; } catch (e) { /* non-fatal */ }
  try { authedAt = Number((await ts.getTikTokAuthedAt()) || 0) || null; } catch (e) { /* non-fatal */ }
  try { expSec = Number((await ts.getTikTokRefreshExpiresIn()) || 0) || DEFAULT_REFRESH_SECONDS; } catch (e) { /* non-fatal */ }
  const expiresAt = authedAt ? authedAt + expSec * 1000 : null;
  const hoursLeft = expiresAt ? Math.floor((expiresAt - Date.now()) / 3600000) : null;
  return {
    tokenPresent: !!refresh,
    authorizedAt: authedAt ? new Date(authedAt).toISOString() : null,
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    refreshExpiresIn: expSec,
    hoursLeft,
  };
}

function buildMessages(why) {
  const url = consentUrl();
  const link = url || "(couldn't build consent URL — check TIKTOK_CLIENT_KEY / TIKTOK_CALLBACK_URL)";
  return {
    telegram:
      `🎥 *ForChi TikTok — action needed*\n\n${why}\n\n` +
      `👉 *Click to authorize:*\n\`${link}\`\n\n` +
      `Approve the login → you'll land on the green "ForChi is connected to TikTok" page. I'll take it from there.`,
    emailText:
      `ForChi TikTok — action needed\n\n${why}\n\nClick to authorize:\n${link}\n\n` +
      `Approve the login and you'll land on the "ForChi is connected to TikTok" page.\n\n— ForChi`,
  };
}

// Send the consent info to Telegram (if wired) AND email. Never throws.
async function notifyAll(msgs, subject, notify) {
  if (notify) {
    try { await notify(msgs.telegram); } catch (e) { console.warn("[TikTokAuth] telegram notify failed:", e.message); }
  } else {
    try {
      const jobsNotify = require("../jobs/notifyTarget");
      if (typeof jobsNotify.sendMessage === "function") await jobsNotify.sendMessage(msgs.telegram);
    } catch (e) { console.warn("[TikTokAuth] telegram notify failed:", e.message); }
  }
  try {
    const emailer = require("../jobs/emailer.js");
    await emailer.sendSimpleEmail({ subject, text: msgs.emailText });
  } catch (e) { console.warn("[TikTokAuth] email notify failed:", e.message); }
}

async function checkTikTokAuth({ notify } = {}) {
  const s = loadState();
  const now = Date.now();
  const ts = require("./tokenStore.js");
  let refresh = null;
  try { refresh = (await ts.getTikTokRefreshToken()) || null; } catch (e) { /* non-fatal */ }

  const send = (why, subject) => {
    s.lastWarned = now;
    saveState(s);
    return notifyAll(buildMessages(why), subject, notify);
  };

  // 1) No refresh token at all -> first consent.
  if (!refresh) {
    if (s.lastWarned && now - s.lastWarned < THROTTLE_MS) return { ok: false, reason: "no-token", throttled: true };
    console.warn("[TikTokAuth] no TikTok refresh token yet");
    await send("I have no TikTok authorization yet, so I can't post Shorts to TikTok.", "ForChi TikTok — authorize now");
    return { ok: false, reason: "no-token" };
  }

  // 2) Live-validate with a real refresh attempt.
  let refreshOk = false;
  let refreshErr = null;
  try { await tiktok().refreshAccess(); refreshOk = true; } catch (err) { refreshErr = err.message || String(err); }

  if (refreshOk) {
    s.lastOk = now;
    s.lastWarned = 0; // healthy -> reset warn cooldown
    saveState(s);
    return { ok: true, reason: "healthy" };
  }

  // Only an invalid/expired grant means we need a new consent.
  if (!/invalid_grant|invalid token|unauthorized|expired/i.test(refreshErr)) {
    console.warn("[TikTokAuth] refresh error (transient, not expired — ignoring):", refreshErr);
    return { ok: true, reason: "transient", error: refreshErr };
  }

  // 3) Expired -> one-click re-consent, throttled.
  if (s.lastWarned && now - s.lastWarned < THROTTLE_MS) return { ok: false, reason: "expired", throttled: true };
  console.warn("[TikTokAuth] refresh token expired");
  await send("My TikTok access just expired — re-approve once and Shorts keep posting.", "ForChi TikTok — re-authorize (expired)");
  return { ok: false, reason: "expired" };
}

// Pre-emptive warning: notify when <=1 day before the refresh token expires.
async function checkPreemptive({ notify } = {}) {
  const s = loadState();
  const st = await getAuthState();
  if (!st.expiresAt) return { ok: true, reason: "no-eta" };
  const now = Date.now();
  const msLeft = st.expiresAt - now;
  if (msLeft > WARN_BEFORE_MS) return { ok: true, reason: "still-fresh" };
  if (s.lastWarned && now - s.lastWarned < THROTTLE_MS) return { ok: true, reason: "throttled" };
  const daysLeft = Math.max(0, Math.floor(msLeft / 86400000));
  s.lastWarned = now;
  saveState(s);
  const why = `My TikTok authorization expires in about ${daysLeft === 0 ? "1" : daysLeft} day${daysLeft === 1 ? "" : "s"}. Re-approve now so posting never breaks.`;
  await notifyAll(buildMessages(why), "ForChi TikTok — expires soon, re-authorize", notify);
  return { ok: false, reason: "expiring" };
}

// One combined check for the interval: live-validate + pre-emptive aging.
async function runTikTokAuthCheck({ notify } = {}) {
  const res = await checkTikTokAuth({ notify });
  if (res.reason !== "no-token" && res.reason !== "expired") {
    await checkPreemptive({ notify });
  }
  return getAuthState();
}

let timer = null;
function startTikTokAuthWatch({ notify } = {}, intervalMs = 6 * 3600 * 1000) {
  if (timer) return;
  runTikTokAuthCheck({ notify }).catch((e) => console.warn("[TikTokAuth] initial check failed:", e.message));
  timer = setInterval(() => {
    runTikTokAuthCheck({ notify }).catch((e) => console.warn("[TikTokAuth] check failed:", e.message));
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  console.log("[TikTokAuth] watcher started (every 6h, 1 notify/day max, Telegram + email)");
}

module.exports = {
  checkTikTokAuth,
  checkPreemptive,
  runTikTokAuthCheck,
  startTikTokAuthWatch,
  getAuthState,
  consentUrl,
};
