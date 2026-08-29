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

const BASE = process.env.FORCHI_BASE || path.resolve(__dirname, "..", "..", "..");
const STATE_FILE = path.join(BASE, "temp_media", "youtube_auth_state.json");
const EXPIRY_DAYS = 7;            // Google: unverified apps get 7-day refresh tokens
const WARN_DAYS = 5;              // warn 2 days (48h) before expiry — per user directive
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
// Persists durably (jobs DB kv) so the token + clock survive redeploys.
async function recordAuth(token) {
  const s = loadState();
  s.authorizedAt = Date.now();
  try { s.tokenPresent = !!token || !!(await require("./tokenStore.js").getToken()); } catch (e) { s.tokenPresent = !!token; }
  s.lastWarned = 0; // fresh token -> allow a new warn when it ages again
  saveState(s);
  try { await require("./tokenStore.js").setToken(token); } catch (e) { /* non-fatal */ }
  try { await require("./tokenStore.js").setAuthedAt(Date.now()); } catch (e) { /* non-fatal */ }
  return true;
}

async function getAuthState() {
  const s = loadState();
  const ts = require("./tokenStore.js");
  let dbAuthed = null;
  try { dbAuthed = await ts.getAuthedAt(); } catch (e) { /* non-fatal */ }
  const envAuthed = process.env.YOUTUBE_AUTHED_AT ? Number(process.env.YOUTUBE_AUTHED_AT) : null;
  const dbAuthedN = dbAuthed ? Number(dbAuthed) : null;
  const authorizedAt = envAuthed || dbAuthedN || s.authorizedAt || null;
  let token = null;
  try { token = (await ts.getToken()) || null; } catch (e) { token = process.env.YOUTUBE_REFRESH_TOKEN || null; }
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
    `👉 *Click to authorize* (signed in as aguswigad@gmail.com — @sirxlud):\n\`${link}\`\n\n` +
    `Then: *Allow* → if you see "Google hasn't verified this app" click *Advanced* → *Go to forchi.onrender.com (unsafe)* → *Allow*. You'll land on the green "ForChi is connected to YouTube" page — I'll take it from there.`
  );
}

// Send the consent/auth message via Resend email (in addition to the Telegram DM).
async function sendAuthEmail(message) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.EMAIL_TO;
  if (!key || !to) { console.warn("[YouTubeAuth] no RESEND_API_KEY/EMAIL_TO — skipping email"); return; }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || "ForChi <onboarding@resend.dev>",
        to: [to],
        subject: "🎬 ForChi YouTube — re-authorize now (expires soon)",
        text: message.replace(/[*_`]/g, ""), // strip Telegram markdown for email
      }),
    });
    if (!res.ok) console.warn("[YouTubeAuth] email send failed:", res.status, (await res.text()).slice(0, 200));
    else console.log("[YouTubeAuth] auth email sent to", to);
  } catch (e) {
    console.warn("[YouTubeAuth] email error:", e.message);
  }
}

// Notify via BOTH Telegram (if a notifier is wired) AND Resend email.
// emailMessage = full text (with the consent link); tgMessage = short pointer to the
// email (defaults to the full text when omitted).
async function notifyBoth(notify, emailMessage, tgMessage) {
  const tg = tgMessage || emailMessage;
  if (notify) { try { notify(tg); } catch (e) { console.warn("[YouTubeAuth] tg notify failed:", e.message); } }
  await sendAuthEmail(emailMessage);
}

async function checkYoutubeAuth({ notify } = {}) {
  const s = loadState();
  const now = Date.now();
  const token = (await require("./tokenStore.js").getToken()) || null;

  const warn = (msg) => {
    s.lastWarned = now;
    saveState(s);
    if (notify) notifyBoth(notify, msg).catch((e) => console.warn("[YouTubeAuth] notifyBoth failed:", e.message));
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
async function checkPreemptive({ notify } = {}) {
  const s = loadState();
  let dbAuthed = null;
  try { dbAuthed = await require("./tokenStore.js").getAuthedAt(); } catch (e) { /* non-fatal */ }
  const envAuthed = process.env.YOUTUBE_AUTHED_AT ? Number(process.env.YOUTUBE_AUTHED_AT) : null;
  const authorizedAt = envAuthed || (dbAuthed ? Number(dbAuthed) : null) || s.authorizedAt || null;
  if (!authorizedAt) return { ok: true, reason: "no-eta" };
  const now = Date.now();
  if (now < authorizedAt + WARN_DAYS * 24 * 3600 * 1000) return { ok: true, reason: "still-fresh" };
  if (s.lastWarned && now - s.lastWarned < THROTTLE_MS) return { ok: true, reason: "throttled" };
  s.lastWarned = now;
  saveState(s);
  const emailMsg = buildConsentMessage("My YouTube access expires in about 48 hours. Click the link in this email to re-approve now so posting never breaks.");
  const tgMsg = "🎬 *YouTube re-auth needed in ~48h*\n\nI've emailed you the one-click authorization link — click it in your inbox (or reply `youtube auth`) to keep posting.";
  if (notify) notifyBoth(notify, emailMsg, tgMsg)
    .catch((e) => console.warn("[YouTubeAuth] notifyBoth failed:", e.message));
  else console.warn("[YouTubeAuth] pre-emptive re-auth needed");
  return { ok: false, reason: "expiring" };
}

// One combined check for the interval: live-validate + pre-emptive aging.
async function runAuthCheck({ notify } = {}) {
  const res = await checkYoutubeAuth({ notify });
  if (res.reason !== "no-token" && res.reason !== "expired") {
    await checkPreemptive({ notify });
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
