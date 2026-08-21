// ForChi YouTube uploader (OAuth2 + resumable upload, plain fetch, no deps).
// Usage:
//   node src/workflows/video/youtube.js auth          -> prints consent URL, exchanges code, saves refresh token
//   node src/workflows/video/youtube.js upload <mp4> [--title T] [--desc D] [--tags "a,b,c"] [--private]
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", "..", ".env") });
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.YOUTUBE_REFRESH_TOKEN;
const REDIRECT = process.env.YOUTUBE_CALLBACK_URL || "http://localhost:3000/oauth2callback";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPES = "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl";

function consentUrl() {
  const qs = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/auth?${qs}`;
}

async function exchangeCode(code) {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code,
    redirect_uri: REDIRECT,
    grant_type: "authorization_code",
  });
  const res = await fetch(TOKEN_URL, { method: "POST", body });
  const data = await res.json();
  if (!res.ok) throw new Error(`token exchange failed: ${JSON.stringify(data)}`);
  return data; // {access_token, refresh_token, expires_in}
}

async function refreshAccess() {
  const token = await require("./tokenStore.js").getToken();
  if (!token) throw new Error("no YouTube refresh token yet (approve via 'youtube auth' in the bot)");
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: token,
    grant_type: "refresh_token",
  });
  const res = await fetch(TOKEN_URL, { method: "POST", body });
  const data = await res.json();
  if (!res.ok) throw new Error(`refresh failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

// Exchange an authorization code and persist the refresh token to .env.
// The .env write is BEST-EFFORT: in the Render container there is no /app/.env
// (env vars only), so we must never throw here — the caller persists to Render
// env vars separately, and recordAuth keeps the 7-day re-auth clock.
async function saveRefreshToken(token) {
  try {
    const envPath = path.join(__dirname, "..", "..", "..", ".env");
    let env = "";
    try { env = fs.readFileSync(envPath, "utf8"); } catch (e) { env = ""; }
    const line = `YOUTUBE_REFRESH_TOKEN=${token}\n`;
    if (env.includes("YOUTUBE_REFRESH_TOKEN=")) {
      env = env.replace(/^#?\s*YOUTUBE_REFRESH_TOKEN=.*$/m, line.trim());
    } else {
      env = (env.trimEnd() ? env.trimEnd() + "\n" : "") + line;
    }
    fs.writeFileSync(envPath, env);
  } catch (e) {
    // container has no writable .env — that's fine, we persist durably instead
    console.warn("[youtube] saveRefreshToken: no writable .env (container?) — using durable tokenStore:", e.message);
  }
  // record the auth clock for the 7-day re-auth watcher (lazy require avoids a cycle)
  try { require("./authWatch.js").recordAuth(token).catch(() => {}); } catch (e) { /* non-fatal */ }
  // durable persistence (jobs DB kv) so the token survives redeploys WITHOUT the
  // dangerous Render bulk env-var PUT (which wipes secrets the API GET hides)
  try { await require("./tokenStore.js").setToken(token); } catch (e) { /* non-fatal */ }
  return true;
}

// Handles the OAuth redirect: exchange ?code= for tokens and store the refresh token.
async function handleOauthCallback(code) {
  const tokens = await exchangeCode(String(code).trim());
  if (!tokens.refresh_token) throw new Error("no refresh_token returned (approve once with prompt=consent)");
  await saveRefreshToken(tokens.refresh_token);
  return tokens;
}

async function uploadVideo(filePath, { title, description, tags, privacyStatus = "public" } = {}) {
  const token = await refreshAccess();
  const size = fs.statSync(filePath).size;
  const snippet = {
    snippet: { title, description, tags: [...(tags || []), "#Shorts"], categoryId: "22" },
    status: { privacyStatus, selfDeclaredMadeForKids: false },
  };

  // 1. initiate resumable session
  const init = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(size),
        "X-Upload-Content-Type": "video/*",
      },
      body: JSON.stringify(snippet),
    }
  );
  if (!init.ok) throw new Error(`init failed: ${init.status} ${await init.text()}`);
  const session = init.headers.get("location");
  if (!session) throw new Error("no resumable session URI");

  // 2. stream bytes
  const upload = await fetch(session, {
    method: "PUT",
    headers: { "Content-Type": "video/*", "Content-Length": String(size) },
    body: fs.createReadStream(filePath),
    duplex: "half",
  });
  if (!upload.ok) throw new Error(`upload failed: ${upload.status} ${await upload.text()}`);
  const result = await upload.json();
  return { videoId: result.id, url: `https://youtu.be/${result.id}` };
}

async function authFlow() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error("YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET missing in .env");
    process.exit(1);
  }
  console.log("\n1) Open this URL in your browser (signed in as aguswigad@gmail.com — channel @sirxlud):\n");
  console.log(consentUrl() + "\n");
  console.log("2) After approving, you'll get a redirect. Copy the 'code' query param (or the out-of-band code).\n");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const code = await new Promise((r) => rl.question("Paste the code: ", r));
  rl.close();
  await handleOauthCallback(code.trim());
  console.log("✅ Refresh token saved to .env. You can now upload.");
}

async function main() {
  const { createPlaylist, listPlaylists, addVideoToPlaylist } = require("./playlists.js");
  const [cmd, file, ...rest] = process.argv.slice(2);
  if (cmd === "auth") return authFlow();
  if (cmd === "create-playlist") {
    if (!REFRESH_TOKEN) { console.error("No YOUTUBE_REFRESH_TOKEN yet. Run: node src/workflows/video/youtube.js auth"); process.exit(1); }
    if (!file) { console.error("usage: create-playlist <title> [--desc D] [--public]"); process.exit(1); }
    const opts = {};
    for (let i = 0; i < rest.length; i += 2) {
      const k = rest[i].replace("--", ""); const v = rest[i + 1];
      if (k === "desc") opts.description = v;
      if (k === "public") opts.privacyStatus = "public";
    }
    const token = await refreshAccess();
    const p = await createPlaylist(token, file, opts.description || "Victor Moore playlist", opts.privacyStatus || "private");
    console.log("✅ Playlist created:", p.title, "(", p.playlistId, ")");
    return;
  }
  if (cmd === "list-playlists") {
    if (!REFRESH_TOKEN) { console.error("No YOUTUBE_REFRESH_TOKEN yet. Run: node src/workflows/video/youtube.js auth"); process.exit(1); }
    const token = await refreshAccess();
    const pls = await listPlaylists(token);
    if (!pls.length) { console.log("No playlists yet."); return; }
    for (const p of pls) console.log(`${p.playlistId}  [${p.privacy}]  ${p.title}`);
    return;
  }
  if (cmd === "add-to-playlist") {
    if (!REFRESH_TOKEN) { console.error("No YOUTUBE_REFRESH_TOKEN yet. Run: node src/workflows/video/youtube.js auth"); process.exit(1); }
    const [playlistId, videoId] = [file, rest[0]];
    if (!playlistId || !videoId) { console.error("usage: add-to-playlist <playlistId> <videoId>"); process.exit(1); }
    const token = await refreshAccess();
    await addVideoToPlaylist(token, playlistId, videoId);
    console.log("✅ Video", videoId, "added to playlist", playlistId);
    return;
  }
  if (cmd === "upload") {
    if (!file) { console.error("usage: upload <mp4> [--title T] [--desc D] [--tags a,b,c] [--private] [--run run.json] [--playlist <id>]"); process.exit(1); }
    if (!REFRESH_TOKEN) { console.error("No YOUTUBE_REFRESH_TOKEN yet. Run: node src/workflows/video/youtube.js auth"); process.exit(1); }
    const { buildTitle, buildDescription } = require("./metadata.js");
    const opts = {};
    let runJson = null;
    for (let i = 0; i < rest.length; i += 2) {
      const k = rest[i].replace("--", ""); const v = rest[i + 1];
      if (k === "title") opts.title = v;
      if (k === "desc") opts.description = v;
      if (k === "tags") opts.tags = v.split(",").map((s) => s.trim());
      if (k === "private") opts.privacyStatus = "private";
      if (k === "run") runJson = v;
      if (k === "playlist") opts.playlist = v;
    }
    // load run manifest (script excerpt, mood) if provided
    let scriptExcerpt = "", mood = "", mode = "clean", seed = Date.now() % 100000, topic = "";
    if (runJson && fs.existsSync(runJson)) {
      const m = JSON.parse(fs.readFileSync(runJson, "utf8"));
      scriptExcerpt = m.script || "";
      mood = (m.mood || "reflection");
      mode = m.mode || "clean";
      seed = (m.seed != null ? m.seed : seed);
      topic = m.topic || "";
    }
    // metadata: title = base + exactly 3 hashtags (ends #shorts); unique description always
    const baseTitle = opts.title || "Victor Moore";
    const title = buildTitle(baseTitle, null, opts.tags);
    const description = opts.description || buildDescription({
      script: scriptExcerpt, baseTitle, mood, mode, seed,
    });
    const tags = title.match(/#\w+/g) || ["#shorts"];
    const result = await uploadVideo(file, { title, description, tags, privacyStatus: opts.privacyStatus });
    console.log("✅ Uploaded:", result.url, `(${result.videoId})`);
    console.log("   Title:", title);
    // optional auto-add to a playlist (by id, or by topic via ensureTopicPlaylist)
    let playlistId = opts.playlist;
    if (!playlistId && topic) {
      const { ensureTopicPlaylist } = require("./playlists.js");
      playlistId = await ensureTopicPlaylist(await refreshAccess(), topic);
    }
    if (playlistId) {
      const token = await refreshAccess();
      await addVideoToPlaylist(token, playlistId, result.videoId);
      console.log("✅ Added to playlist:", playlistId);
    }
    return;
  }
  console.error("usage: node src/workflows/video/youtube.js auth | create-playlist <title> | list-playlists | add-to-playlist <pid> <vid> | upload <mp4> [--title T] [--desc D] [--tags a,b,c] [--private] [--run run.json] [--playlist <id>]");
}

module.exports = { uploadVideo, refreshAccess, authFlow, consentUrl, handleOauthCallback, saveRefreshToken, REDIRECT };

if (require.main === module) {
  main().catch((e) => { console.error("❌", e.message); process.exit(1); });
}
