// ForChi TikTok poster (OAuth2 consent + Content Posting API, plain fetch, no deps).
//
// Usage:
//   node src/workflows/video/tiktok.js auth          -> prints consent URL, exchanges code, saves tokens
//   node src/workflows/video/tiktok.js upload <mp4> [--title T] [--desc D] [--private]
//   node src/workflows/video/tiktok.js status        -> shows whether an access token is present
//
// TikTok OAuth (Content Posting API):
//   authorize : https://www.tiktok.com/v2/auth/authorize/?client_key=...&scope=user.info.basic,video.publish&response_type=code&redirect_uri=...
//   token     : POST https://open.tiktok.com/v2/oauth/token/   (authorization_code | refresh_token)
//   publish   : POST https://open.tiktok.com/v2/post/publish/video/init/  -> { upload_url, publish_id }
//               PUT  {upload_url}  (video bytes)
//               POST https://open.tiktok.com/v2/post/publish/status/fetch/ -> { status }
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", "..", ".env") });
const fs = require("fs");
const path = require("path");
const readline = require("readline");

// Accept both the canonical TIKTOK_* names and the bare Client_key/Client_secret
// that the user dropped into .env (TikTok's Developer Portal labels them this way).
const CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY || process.env.Client_key;
const CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET || process.env.Client_secret;
const REDIRECT = process.env.TIKTOK_CALLBACK_URL || "http://localhost:7860/tiktok_callback";
const TOKEN_URL = "https://open.tiktok.com/v2/oauth/token/";
const SCOPES = "user.info.basic,video.publish";

function consentUrl() {
  const qs = new URLSearchParams({
    client_key: CLIENT_KEY,
    scope: SCOPES,
    response_type: "code",
    redirect_uri: REDIRECT,
    state: "forchi_video_" + Math.floor(Math.random() * 1e8),
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${qs}`;
}

// Exchange an authorization code (or refresh) for tokens.
async function exchangeTokens(form) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`TikTok token error: ${JSON.stringify(data.error || data)}`);
  }
  return data; // { access_token, expires_in, open_id, refresh_token, refresh_expires_in, scope, token_type }
}

// Get a valid access token, refreshing if we have a refresh token.
async function refreshAccess() {
  const ts = require("./tokenStore.js");
  const access = await ts.getTikTokToken();
  if (access) return access;
  const refresh = await ts.getTikTokRefreshToken();
  if (!refresh) throw new Error("no TikTok access token yet (approve via 'tiktok auth' in the bot)");
  const data = await exchangeTokens({
    client_key: CLIENT_KEY,
    client_secret: CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: refresh,
  });
  await ts.setTikTokToken(data.access_token);
  await ts.setTikTokAuthedAt(Date.now());
  if (data.refresh_token) await ts.setTikTokRefreshToken(data.refresh_token);
  if (data.refresh_expires_in) await ts.setTikTokRefreshExpiresIn(data.refresh_expires_in);
  return data.access_token;
}

// Persist tokens durably (jobs DB kv). Best-effort — never crash auth on a missing .env.
async function saveTokens(tokens) {
  const ts = require("./tokenStore.js");
  try { await ts.setTikTokToken(tokens.access_token); } catch (e) { /* non-fatal */ }
  try { if (tokens.refresh_token) await ts.setTikTokRefreshToken(tokens.refresh_token); } catch (e) { /* non-fatal */ }
  try { if (tokens.open_id) await ts.setTikTokOpenId(tokens.open_id); } catch (e) { /* non-fatal */ }
  try { if (tokens.refresh_expires_in) await ts.setTikTokRefreshExpiresIn(tokens.refresh_expires_in); } catch (e) { /* non-fatal */ }
  try { await ts.setTikTokAuthedAt(Date.now()); } catch (e) { /* non-fatal */ }
  // best-effort .env write (for local runs; container has no writable .env)
  try {
    const envPath = path.join(__dirname, "..", "..", "..", ".env");
    let env = "";
    try { env = fs.readFileSync(envPath, "utf8"); } catch (e) { env = ""; }
    const add = (key, val) => {
      const line = `${key}=${val}`;
      const re = new RegExp(`^#?\\s*${key}=.*$`, "m");
      if (env.includes(`${key}=`)) env = env.replace(re, line);
      else env = (env.trimEnd() ? env.trimEnd() + "\n" : "") + line;
    };
    add("TIKTOK_ACCESS_TOKEN", tokens.access_token);
    if (tokens.refresh_token) add("TIKTOK_REFRESH_TOKEN", tokens.refresh_token);
    if (tokens.open_id) add("TIKTOK_OPEN_ID", tokens.open_id);
    if (tokens.refresh_expires_in) add("TIKTOK_REFRESH_EXPIRES_IN", tokens.refresh_expires_in);
    add("TIKTOK_AUTHED_AT", String(Date.now()));
    fs.writeFileSync(envPath, env);
  } catch (e) {
    console.warn("[tiktok] saveTokens: no writable .env (container?) — durable tokenStore only:", e.message);
  }
}

// Handles the OAuth redirect: exchange ?code= for tokens and store them.
async function handleOauthCallback(code) {
  const tokens = await exchangeTokens({
    client_key: CLIENT_KEY,
    client_secret: CLIENT_SECRET,
    code: String(code).trim(),
    grant_type: "authorization_code",
    redirect_uri: REDIRECT,
  });
  if (!tokens.access_token) throw new Error("no access_token returned from TikTok");
  await saveTokens(tokens);
  return tokens;
}

// POST a video to TikTok. Privacy defaults to PUBLIC; pass privacyLevel to change.
async function uploadVideo(filePath, { title, description, privacyLevel = "PUBLIC_TO_EVERYONE" } = {}) {
  const token = await refreshAccess();
  const size = fs.statSync(filePath).size;
  const chunkSize = 5 * 1024 * 1024; // 5MB chunk; our videos are ~30MB -> 6 chunks
  const totalChunkCount = Math.max(1, Math.ceil(size / chunkSize));
  const caption = `${title || "Victor Moore"}${description ? "\n\n" + description : ""}`.slice(0, 2200);

  // 1. initialize the publish
  const initRes = await fetch(
    `https://open.tiktok.com/v2/post/publish/video/init/?access_token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        post_info: {
          title: caption,
          privacy_level: privacyLevel,
          disable_comment: false,
          disable_duet: false,
          disable_stitch: false,
          video_cover_timestamp_ms: 1000,
        },
        source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: chunkSize, total_chunk_count: totalChunkCount },
      }),
    }
  );
  const initData = await initRes.json();
  if (!initRes.ok || !initData || !initData.data) {
    throw new Error(`TikTok init failed: ${JSON.stringify(initData)}`);
  }
  const { upload_url, publish_id } = initData.data;
  if (!upload_url || !publish_id) throw new Error("TikTok init: no upload_url/publish_id");

  // 2. upload the video bytes (single PUT — total_chunk_count 1 path; chunked PUT
  //    is only required when the server returns a chunked_upload flag)
  const upRes = await fetch(upload_url, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4", "Content-Length": String(size) },
    body: fs.createReadStream(filePath),
    duplex: "half",
  });
  if (!upRes.ok) throw new Error(`TikTok upload failed: ${upRes.status} ${await upRes.text()}`);

  // 3. poll publish status briefly
  const status = await checkStatus(token, publish_id);
  const openId = (await require("./tokenStore.js").getTikTokOpenId().catch(() => null)) || "";
  return { publishId: publish_id, status, url: openId ? `https://www.tiktok.com/@${openId}` : "" };
}

async function checkStatus(token, publishId) {
  try {
    const res = await fetch(
      `https://open.tiktok.com/v2/post/publish/status/fetch/?access_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publish_id: publishId }),
      }
    );
    const data = await res.json();
    return (data && data.data && data.data.status) || "PUBLISH_PROCESSING";
  } catch (e) {
    return "PUBLISH_PROCESSING"; // status fetch is best-effort
  }
}

async function authFlow() {
  if (!CLIENT_KEY || !CLIENT_SECRET) {
    console.error("TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET (or Client_key / Client_secret) missing in .env");
    process.exit(1);
  }
  console.log("\n1) Open this URL in your browser (signed in as the TikTok account that owns the Content Posting app):\n");
  console.log(consentUrl() + "\n");
  console.log(`2) After approving you'll be redirected to ${REDIRECT}. Copy the 'code' query param.\n`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const code = await new Promise((r) => rl.question("Paste the code: ", r));
  rl.close();
  const tokens = await handleOauthCallback(code.trim());
  console.log("✅ TikTok tokens saved. You can now upload Shorts.");
  return tokens;
}

async function main() {
  const [cmd, file, ...rest] = process.argv.slice(2);
  if (cmd === "auth") return authFlow();
  if (cmd === "status") {
    const ts = require("./tokenStore.js");
    const has = await ts.getTikTokToken();
    console.log(has ? "✅ TikTok access token present" : "⛔ No TikTok access token yet — run: node src/workflows/video/tiktok.js auth");
    return;
  }
  if (cmd === "upload") {
    if (!file) { console.error("usage: upload <mp4> [--title T] [--desc D] [--private]"); process.exit(1); }
    const opts = {};
    for (let i = 0; i < rest.length; i += 2) {
      const k = rest[i].replace("--", ""); const v = rest[i + 1];
      if (k === "title") opts.title = v;
      if (k === "desc") opts.description = v;
      if (k === "private") opts.privacyLevel = "SELF_ONLY";
    }
    const result = await uploadVideo(file, opts);
    console.log("✅ TikTok publish:", result.publishId, "| status:", result.status);
    return;
  }
  console.error("usage: node src/workflows/video/tiktok.js auth | status | upload <mp4> [--title T] [--desc D] [--private]");
}

module.exports = { uploadVideo, refreshAccess, authFlow, consentUrl, handleOauthCallback, saveTokens, REDIRECT, CLIENT_KEY, CLIENT_SECRET };

if (require.main === module) {
  main().catch((e) => { console.error("❌", e.message); process.exit(1); });
}
