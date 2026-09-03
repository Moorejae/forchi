// src/workflows/social/linkedinAuthWatch.js
// LinkedIn OAuth health watcher — keeps the LINKEDIN_ACCESS_TOKEN alive.
//
// LinkedIn access tokens (3-legged, auth_type "3L") expire after ~60 days
// (2 months). When they expire, LinkedIn posts stop working until the owner
// re-authorizes once. This watcher:
//   • introspects the token via the LinkedIn OAuth API to read its real
//     `expires_at` (the authoritative expiry — no guessing),
//   • no token / inactive token  -> send consent URL (Telegram + email),
//   • pre-emptive: <=48h left    -> send "re-approve now, expires soon"
//     (USER DIRECTIVE 2026-09-03: warn 48 hours before the 2-month period ends,
//     just like YouTube).
// Throttled to one notify per day per issue. The consent URL goes to BOTH
// Telegram (backticked) and email (plain clickable text).
//
// Env: LINKEDIN_ACCESS_TOKEN, LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET,
//      LINKEDIN_CALLBACK_URL (the authorized redirect — user set it to
//      https://forchi.myzelva.com/rest/oauth2-credential/callback).
const fs = require("fs");
const path = require("path");

const BASE = process.env.FORCHI_BASE || path.resolve(__dirname, "..", "..", "..");
const STATE_FILE = path.join(BASE, "temp_media", "linkedin_auth_state.json");
const WARN_BEFORE_MS = 48 * 3600 * 1000; // warn 48h before expiry (USER DIRECTIVE)
const THROTTLE_MS = 24 * 3600 * 1000;    // one notify per day per issue
const INTROSPECT_URL = "https://www.linkedin.com/oauth/v2/introspectToken";

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return {}; }
}
function saveState(s) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); } catch {}
}

function token() { return process.env.LINKEDIN_ACCESS_TOKEN || ""; }
function clientId() { return process.env.LINKEDIN_CLIENT_ID || ""; }
function clientSecret() { return process.env.LINKEDIN_CLIENT_SECRET || ""; }
function callbackUrl() {
  return process.env.LINKEDIN_CALLBACK_URL || "https://forchi.myzelva.com/rest/oauth2-credential/callback";
}

// One-click LinkedIn OAuth consent URL (re-authorize). Uses the same callback
// the user configured (forchi.myzelva.com). Best-effort.
function consentUrl() {
  const cid = clientId();
  if (!cid) return null;
  const qs = new URLSearchParams({
    response_type: "code",
    client_id: cid,
    redirect_uri: callbackUrl(),
    scope: "w_member_social,email,openid,profile",
    state: "forchi-linkedin-reauth",
  });
  return `https://www.linkedin.com/oauth/v2/authorization?${qs.toString()}`;
}

// Introspect the token -> { active, expires_at, status, scope } or null on error.
async function introspect() {
  const tk = token();
  if (!tk) return null;
  const body = new URLSearchParams();
  body.append("token", tk);
  if (clientId()) body.append("client_id", clientId());
  if (clientSecret()) body.append("client_secret", clientSecret());
  const res = await fetch(INTROSPECT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    console.warn(`[LinkedInAuth] introspect HTTP ${res.status}:`, (await res.text()).slice(0, 200));
    return null;
  }
  return await res.json();
}

async function getAuthState() {
  const s = loadState();
  let info = null;
  try { info = await introspect(); } catch (e) { console.warn("[LinkedInAuth] introspect error:", e.message); }
  const active = !!(info && info.active);
  const expiresAt = info && info.expires_at ? Number(info.expires_at) * 1000 : null;
  const hoursLeft = expiresAt ? Math.floor((expiresAt - Date.now()) / 3600000) : null;
  return {
    tokenPresent: !!token(),
    active,
    status: info ? info.status : null,
    scope: info ? info.scope : null,
    authorizedAt: info && info.authorized_at ? new Date(Number(info.authorized_at) * 1000).toISOString() : null,
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    hoursLeft,
    lastWarnedAt: s.lastWarned ? new Date(s.lastWarned).toISOString() : null,
  };
}

function buildMessages(why) {
  const url = consentUrl();
  const link = url || "(couldn't build consent URL — check LINKEDIN_CLIENT_ID / LINKEDIN_CALLBACK_URL)";
  return {
    telegram:
      `💼 *ForChi LinkedIn — action needed*\n\n${why}\n\n` +
      `👉 *Click to re-authorize:*\n\`${link}\`\n\n` +
      `Approve the login → you'll land on the callback page and I'll take it from there.`,
    emailText:
      `ForChi LinkedIn — action needed\n\n${why}\n\nClick to re-authorize:\n${link}\n\n` +
      `Approve the login and LinkedIn posts keep working.\n\n— ForChi`,
  };
}

// Send to Telegram (if wired) AND email. Never throws.
async function notifyAll(msgs, subject, notify) {
  if (notify) {
    try { await notify(msgs.telegram); } catch (e) { console.warn("[LinkedInAuth] telegram notify failed:", e.message); }
  } else {
    try {
      const jobsNotify = require("../jobs/notifyTarget");
      if (typeof jobsNotify.sendMessage === "function") await jobsNotify.sendMessage(msgs.telegram);
    } catch (e) { console.warn("[LinkedInAuth] telegram notify failed:", e.message); }
  }
  try {
    const emailer = require("../jobs/emailer.js");
    await emailer.sendSimpleEmail({ subject, text: msgs.emailText });
  } catch (e) { console.warn("[LinkedInAuth] email notify failed:", e.message); }
}

async function checkLinkedInAuth({ notify } = {}) {
  const s = loadState();
  const now = Date.now();
  const info = await introspect();

  const send = (why, subject) => {
    s.lastWarned = now;
    saveState(s);
    return notifyAll(buildMessages(why), subject, notify);
  };

  // 1) No token at all -> first consent.
  if (!token()) {
    if (s.lastWarned && now - s.lastWarned < THROTTLE_MS) return { ok: false, reason: "no-token", throttled: true };
    console.warn("[LinkedInAuth] no LINKEDIN_ACCESS_TOKEN yet");
    await send("I have no LinkedIn authorization yet, so I can't post to LinkedIn.", "ForChi LinkedIn — authorize now");
    return { ok: false, reason: "no-token" };
  }

  // 2) Introspection failed (network/API) -> can't confirm, stay quiet (transient).
  if (!info) {
    console.warn("[LinkedInAuth] introspect unavailable (transient — ignoring)");
    return { ok: true, reason: "transient" };
  }

  // 3) Token inactive/expired -> needs re-consent, throttled.
  if (!info.active) {
    if (s.lastWarned && now - s.lastWarned < THROTTLE_MS) return { ok: false, reason: "expired", throttled: true };
    console.warn("[LinkedInAuth] token inactive/expired");
    await send("My LinkedIn access just expired — re-authorize once and posts keep working.", "ForChi LinkedIn — re-authorize (expired)");
    return { ok: false, reason: "expired" };
  }

  // 4) Healthy.
  s.lastOk = now;
  s.lastWarned = 0; // reset warn cooldown while healthy
  saveState(s);
  return { ok: true, reason: "healthy", expiresAt: info.expires_at ? Number(info.expires_at) * 1000 : null };
}

// Pre-emptive warning: notify when <=48h before the token expires.
async function checkPreemptive({ notify } = {}) {
  const s = loadState();
  const info = await introspect();
  if (!info || !info.expires_at) return { ok: true, reason: "no-eta" };
  const expiresAt = Number(info.expires_at) * 1000;
  const now = Date.now();
  const msLeft = expiresAt - now;
  if (msLeft > WARN_BEFORE_MS) return { ok: true, reason: "still-fresh" };
  if (s.lastWarned && now - s.lastWarned < THROTTLE_MS) return { ok: true, reason: "throttled" };
  const hoursLeft = Math.max(0, Math.floor(msLeft / 3600000));
  const daysLeft = Math.floor(msLeft / 86400000);
  s.lastWarned = now;
  saveState(s);
  const why = `My LinkedIn authorization expires in about ${daysLeft > 0 ? `${daysLeft} day${daysLeft === 1 ? "" : "s"}` : `${hoursLeft} hour${hoursLeft === 1 ? "" : "s"}`}. Re-authorize now so LinkedIn posts never break.`;
  await notifyAll(buildMessages(why), "ForChi LinkedIn — expires soon, re-authorize", notify);
  return { ok: false, reason: "expiring" };
}

// One combined check for the interval: introspect + pre-emptive aging.
async function runLinkedInAuthCheck({ notify } = {}) {
  const res = await checkLinkedInAuth({ notify });
  if (res.reason !== "no-token" && res.reason !== "expired" && res.reason !== "transient") {
    await checkPreemptive({ notify });
  }
  return getAuthState();
}

let timer = null;
function startLinkedInAuthWatch({ notify } = {}, intervalMs = 6 * 3600 * 1000) {
  if (timer) return;
  runLinkedInAuthCheck({ notify }).catch((e) => console.warn("[LinkedInAuth] initial check failed:", e.message));
  timer = setInterval(() => {
    runLinkedInAuthCheck({ notify }).catch((e) => console.warn("[LinkedInAuth] check failed:", e.message));
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  console.log("[LinkedInAuth] watcher started (every 6h, 1 notify/day max, Telegram + email)");
}

module.exports = {
  checkLinkedInAuth,
  checkPreemptive,
  runLinkedInAuthCheck,
  startLinkedInAuthWatch,
  getAuthState,
  consentUrl,
};
