// src/workflows/video/tokenStore.js
// Durable store for the YouTube OAuth refresh token + auth clock.
//
// Env vars are the source of truth when set (Render injects them). Otherwise we
// fall back to the persistent jobs DB (kv table, Postgres on Render) so the token
// SURVIVES redeploys WITHOUT touching the dangerous Render bulk env-var PUT —
// that PUT wipes secret vars the API GET doesn't return (2026-08-21 incident:
// it deleted TELEGRAM_BOT_TOKEN/GEMINI_KEYS/HF_TOKEN and crashed every deploy).
//
// All reads/writes are best-effort (never throw) so auth can never crash the bot.

async function getToken() {
  if (process.env.YOUTUBE_REFRESH_TOKEN) return process.env.YOUTUBE_REFRESH_TOKEN;
  try { return await require("../jobs/db.js").kvGet("youtube_refresh_token"); } catch (e) { return null; }
}

async function getAuthedAt() {
  if (process.env.YOUTUBE_AUTHED_AT) return process.env.YOUTUBE_AUTHED_AT;
  try { return await require("../jobs/db.js").kvGet("youtube_authed_at"); } catch (e) { return null; }
}

async function setToken(token) {
  try { await require("../jobs/db.js").kvSet("youtube_refresh_token", token); } catch (e) { /* non-fatal */ }
}

async function setAuthedAt(ts) {
  try { await require("../jobs/db.js").kvSet("youtube_authed_at", String(ts)); } catch (e) { /* non-fatal */ }
}

module.exports = { getToken, getAuthedAt, setToken, setAuthedAt };
