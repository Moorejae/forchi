// src/workflows/video/tokenStore.js
// Durable store for the YouTube OAuth refresh token + auth clock, and the TikTok
// OAuth access/refresh tokens + auth clock.
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

// ── TikTok tokens (durable via jobs DB kv, same pattern as YouTube) ──────────
async function getTikTokToken() {
  if (process.env.TIKTOK_ACCESS_TOKEN) return process.env.TIKTOK_ACCESS_TOKEN;
  try { return await require("../jobs/db.js").kvGet("tiktok_access_token"); } catch (e) { return null; }
}
async function getTikTokRefreshToken() {
  if (process.env.TIKTOK_REFRESH_TOKEN) return process.env.TIKTOK_REFRESH_TOKEN;
  try { return await require("../jobs/db.js").kvGet("tiktok_refresh_token"); } catch (e) { return null; }
}
async function getTikTokOpenId() {
  try { return await require("../jobs/db.js").kvGet("tiktok_open_id"); } catch (e) { return null; }
}
async function getTikTokAuthedAt() {
  if (process.env.TIKTOK_AUTHED_AT) return process.env.TIKTOK_AUTHED_AT;
  try { return await require("../jobs/db.js").kvGet("tiktok_authed_at"); } catch (e) { return null; }
}
async function setTikTokToken(token) {
  try { await require("../jobs/db.js").kvSet("tiktok_access_token", token); } catch (e) { /* non-fatal */ }
}
async function setTikTokRefreshToken(token) {
  try { await require("../jobs/db.js").kvSet("tiktok_refresh_token", token); } catch (e) { /* non-fatal */ }
}
async function setTikTokOpenId(openId) {
  try { await require("../jobs/db.js").kvSet("tiktok_open_id", openId); } catch (e) { /* non-fatal */ }
}
async function setTikTokAuthedAt(ts) {
  try { await require("../jobs/db.js").kvSet("tiktok_authed_at", String(ts)); } catch (e) { /* non-fatal */ }
}
async function getTikTokRefreshExpiresIn() {
  if (process.env.TIKTOK_REFRESH_EXPIRES_IN) return process.env.TIKTOK_REFRESH_EXPIRES_IN;
  try { return await require("../jobs/db.js").kvGet("tiktok_refresh_expires_in"); } catch (e) { return null; }
}
async function setTikTokRefreshExpiresIn(sec) {
  try { await require("../jobs/db.js").kvSet("tiktok_refresh_expires_in", String(sec)); } catch (e) { /* non-fatal */ }
}

module.exports = {
  getToken, getAuthedAt, setToken, setAuthedAt,
  getTikTokToken, getTikTokRefreshToken, getTikTokOpenId, getTikTokAuthedAt, getTikTokRefreshExpiresIn,
  setTikTokToken, setTikTokRefreshToken, setTikTokOpenId, setTikTokAuthedAt, setTikTokRefreshExpiresIn,
};
